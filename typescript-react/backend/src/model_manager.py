"""Model management and inference logic.

Handles loading, unloading, and running inference with the Hugging Face model,
including thread management and quantization settings.

Notes on environment:
 - The only way to guarantee HuggingFace uses our persistent disk (/model_cache)
   is to set HF_HOME in the operating system environment before Python starts.
   On Render, we set it in render.yaml. Locally, we load it with .env.
"""

import gc
import logging
import os
import threading
import time
from dataclasses import dataclass
from typing import Any

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from torch.ao.quantization import quantize_dynamic

from config import (
    EAGER_LOAD,
    QUANTIZE_MODEL,
    TORCH_INTEROP_THREADS,
    TORCH_NUM_THREADS,
    WARMUP_TEXT,
)
from schemas import ModelStatus

logger = logging.getLogger(__name__)


@dataclass
class _ModelArtifacts:
    """Successfully loaded model components, ready to be published as state."""

    model: Any
    tokenizer: Any
    id2label: dict[int, str]


class ModelManager:
    def __init__(
        self,
        model_id: str,
        hf_home: str,
        idle_unload_seconds: int = 0,
        model_revision: str | None = None,
    ) -> None:
        """Configure the manager.

        The model is loaded eagerly at startup when EAGER_LOAD is true (the
        recommended path on Render with a persistent disk + /ready health
        check), otherwise lazily on the first predict call.
        """
        # Identity / config
        self.model_id = model_id
        self.model_revision = model_revision
        self.hf_home = hf_home
        self.idle_unload_seconds = idle_unload_seconds

        # PyTorch thread tuning
        torch.set_num_threads(TORCH_NUM_THREADS)
        torch.set_num_interop_threads(TORCH_INTEROP_THREADS)

        # State + synchronization. A Condition lets waiters block efficiently
        # and be woken when loading finishes (success or failure).
        self._lock = threading.RLock()
        self._load_cv = threading.Condition(self._lock)
        self._model: Any = None
        self._tokenizer: Any = None
        self._id2label: dict[int, str] = {}
        self._loaded = False
        self._ready = False
        self._loading = False
        self._load_error: BaseException | None = None
        self._last_used_at: float | None = None
        self._loaded_at: float | None = None

        # Ensure the cache dir exists. We do NOT set HF_HOME here — it must be
        # set in the process environment before `transformers` is imported.
        # If the env var is missing or mismatched, warn loudly so it surfaces
        # in logs instead of silently caching to ~/.cache/huggingface.
        env_hf_home = os.environ.get("HF_HOME")
        if env_hf_home is None:
            logger.warning(
                "HF_HOME is not set in the environment; transformers may have "
                "already cached to a default path. Set HF_HOME=%s in render.yaml.",
                self.hf_home,
            )
        elif os.path.realpath(env_hf_home) != os.path.realpath(self.hf_home):
            logger.warning(
                "HF_HOME mismatch: env=%s, manager=%s. The library has already "
                "resolved its cache from the env value.",
                env_hf_home,
                self.hf_home,
            )
        os.makedirs(self.hf_home, exist_ok=True)

    # ------------------------------------------ #
    #             LIFECYCLE & STATE              #
    # ------------------------------------------ #

    def load_model(self) -> bool:
        """Download, quantize, and load the model into memory.

        Returns True if this call performed the load, False if the model was
        already loaded or another thread loaded it while we waited. Raises if
        loading failed (either in this thread or a thread we waited on).

        Flow:
        1. Fast-path return if already loaded.
        2. Claim the load slot, or wait for an in-flight load to finish.
        3. Fetch artifacts (download + quantize) outside the lock.
        4. Publish artifacts atomically and wake any waiters.
        5. Run a single warmup inference.
        """
        if self._already_loaded():
            return False

        if not self._begin_load():
            return False

        try:
            artifacts, elapsed = self._fetch_and_prepare_model()
        except BaseException as exc:  # noqa: BLE001 — re-raised after cleanup
            self._fail_load(exc)
            raise

        self._publish_artifacts(artifacts, elapsed)
        self._run_warmup()
        return True

    def _already_loaded(self) -> bool:
        """Fast-path: True if the model is already loaded and ready."""
        with self._load_cv:
            if self._loaded and self._model is not None:
                self._ready = True
                return True
            return False

    def _begin_load(self) -> bool:
        """Claim the load slot, or wait for an in-flight loader to finish.

        Returns True if this caller should perform the load, False if another
        thread completed the load successfully. Raises if the in-flight loader
        failed.
        """
        with self._load_cv:
            if self._loading:
                self._load_cv.wait_for(lambda: not self._loading)
                if self._load_error is not None:
                    raise RuntimeError(
                        f"Concurrent model load failed: {self._load_error!r}"
                    ) from self._load_error
                if not (self._loaded and self._model is not None):
                    raise RuntimeError("Model load completed but state is invalid")
                return False

            self._loading = True
            self._ready = False
            self._load_error = None
            return True

    def _fetch_and_prepare_model(self) -> tuple[_ModelArtifacts, float]:
        """Download tokenizer/model and apply quantization.

        Pure function — does not mutate manager state. Runs outside the lock so
        /ready, /status, and other callers stay responsive during the
        multi-second download. Returns the loaded artifacts plus elapsed
        seconds for logging.
        """
        start = time.perf_counter()

        tokenizer = AutoTokenizer.from_pretrained(
            self.model_id, revision=self.model_revision
        )
        model = AutoModelForSequenceClassification.from_pretrained(
            self.model_id, revision=self.model_revision
        )
        model.eval()

        if QUANTIZE_MODEL:
            model = self._maybe_quantize(model)

        elapsed = round(time.perf_counter() - start, 2)
        return (
            _ModelArtifacts(
                model=model,
                tokenizer=tokenizer,
                id2label=model.config.id2label,
            ),
            elapsed,
        )

    def _maybe_quantize(self, model: Any) -> Any:
        """Apply INT8 dynamic quantization, falling back gracefully if incompatible with architecture (e.g., Apple M4)."""
        try:
            quantized = quantize_dynamic(
                model, {torch.nn.Linear}, dtype=torch.qint8
            )
            logger.info("Dynamic quantization applied successfully")
            return quantized
        except RuntimeError as e:
            logger.warning(
                "Quantization incompatible with architecture: (%s); running without quantization", e
            )
            return model

    def _publish_artifacts(
        self, artifacts: _ModelArtifacts, elapsed: float
    ) -> None:
        """Atomically publish loaded artifacts as the new state and wake waiters."""
        with self._load_cv:
            self._model = artifacts.model
            self._tokenizer = artifacts.tokenizer
            self._id2label = artifacts.id2label
            self._loaded = True
            self._ready = True
            self._loaded_at = time.time()
            self._last_used_at = time.time()
            self._load_error = None
            self._loading = False
            self._load_cv.notify_all()

        logger.info(
            "[model_manager] loaded model_id=%s revision=%s hf_home=%s "
            "load_seconds=%s quantize=%s",
            self.model_id,
            self.model_revision or "latest",
            self.hf_home,
            elapsed,
            QUANTIZE_MODEL,
        )

    def _fail_load(self, exc: BaseException) -> None:
        """Record load failure and wake waiting threads.

        Must be called from inside an ``except`` block so ``logger.exception``
        captures the active traceback.
        """
        with self._load_cv:
            self._model = None
            self._tokenizer = None
            self._id2label = {}
            self._loaded = False
            self._ready = False
            self._load_error = exc
            self._loading = False
            self._load_cv.notify_all()

        logger.exception("Model load failed for model_id=%s", self.model_id)

    def _run_warmup(self) -> None:
        """Run a single warmup inference. Failures are non-fatal."""
        if not WARMUP_TEXT:
            return
        try:
            self.predict(WARMUP_TEXT)
            logger.info("[model_manager] warmup complete text=%r", WARMUP_TEXT)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[model_manager] warmup failed (non-fatal): %s", exc)

    def unload_model(self) -> bool:
        """Unload the model from memory and run garbage collection."""
        with self._lock:
            if self._model is None and not self._loaded:
                self._ready = False
                return False

            self._model = None
            self._tokenizer = None
            self._id2label = {}
            self._loaded = False
            self._ready = False

        gc.collect()
        logger.info("[model_manager] unloaded model_id=%s", self.model_id)
        return True

    def maybe_unload_if_idle(self) -> bool:
        """Unload the model if it has been idle longer than the configured
        threshold. Disabled when ``idle_unload_seconds <= 0``.

        Important: on Render with ``healthCheckPath: /ready`` you almost
        certainly want this disabled (set ``idle_unload_seconds=0``), because
        an unload will flip /ready to false and trigger a restart loop.
        """
        if self.idle_unload_seconds <= 0:
            return False

        with self._lock:
            if not self._loaded or self._last_used_at is None:
                return False
            idle_for = time.time() - self._last_used_at

        if idle_for >= self.idle_unload_seconds:
            logger.info(
                "[model_manager] idle timeout reached: %.2fs", idle_for
            )
            return self.unload_model()

        return False

    # ------------------------------------------ #
    #             INFERENCE                      #
    # ------------------------------------------ #

    def _ensure_loaded(self) -> None:
        """Make sure the model is loaded, propagating any load failure."""
        with self._lock:
            if self._loaded and self._model is not None:
                return
        # load_model() handles the "another thread is loading" race itself
        # and will raise on failure.
        self.load_model()

    def predict(self, text: str) -> dict[str, Any]:
        """Classify a single text into emotions."""
        self._ensure_loaded()

        with self._lock:
            if not self._ready or self._model is None:
                raise RuntimeError("Model is not ready")
            model = self._model
            tokenizer = self._tokenizer
            id2label = self._id2label

        inputs = tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            max_length=512,
        )

        start = time.perf_counter()
        with torch.no_grad():
            logits = model(**inputs).logits
        infer_ms = round((time.perf_counter() - start) * 1000, 2)

        probs = torch.sigmoid(logits).squeeze()
        probs_list = probs.tolist()

        ranked = sorted(
            [
                {"label": id2label[i], "score": round(float(p), 4)}
                for i, p in enumerate(probs_list)
            ],
            key=lambda x: x["score"],
            reverse=True,
        )

        with self._lock:
            self._last_used_at = time.time()

        return {
            "task": "text-classification",
            "prediction": ranked,
            "inference_ms": infer_ms,
        }

    def predict_batch(self, texts: list[str]) -> dict[str, Any]:
        """
        Classifies multiple texts in a single forward pass.

        Flow:
        1. Ensures model is loaded.
        2. Tokenizes and pads input texts.
        3. Runs batched forward pass without gradients.
        4. Applies sigmoid and ranks emotions per row.
        """
        if not texts:
            return {"task": "text-classification", "predictions": [], "inference_ms": 0.0}

        self._ensure_loaded()

        with self._lock:
            if not self._ready or self._model is None:
                raise RuntimeError("Model is not ready")
            model = self._model
            tokenizer = self._tokenizer
            id2label = self._id2label

        inputs = tokenizer(
            texts,
            return_tensors="pt",
            truncation=True,
            max_length=512,
            padding=True,
        )

        start = time.perf_counter()
        with torch.no_grad():
            logits = model(**inputs).logits
        infer_ms = round((time.perf_counter() - start) * 1000, 2)

        probs = torch.sigmoid(logits)
        predictions: list[list[dict[str, Any]]] = []
        for row in probs.tolist():
            ranked = sorted(
                [
                    {"label": id2label[i], "score": round(float(p), 4)}
                    for i, p in enumerate(row)
                ],
                key=lambda x: x["score"],
                reverse=True,
            )
            predictions.append(ranked)

        with self._lock:
            self._last_used_at = time.time()

        return {
            "task": "text-classification",
            "predictions": predictions,
            "inference_ms": infer_ms,
        }

    # ------------------------------------------ #
    #             STATE ACCESSORS                #
    # ------------------------------------------ #

    def is_loaded(self) -> bool:
        """True if the model is loaded into memory."""
        with self._lock:
            return self._loaded and self._model is not None

    def is_ready(self) -> bool:
        """True if the model is ready to classify text."""
        with self._lock:
            return self._ready and self._model is not None

    def status(self) -> ModelStatus:
        """Immutable snapshot of manager state — safe to share across threads.

        Note: ``eager_load`` is intentionally not included here. The
        ``/admin/status`` handler in ``main.py`` passes it explicitly as a
        keyword argument when constructing ``AdminStatusResponse``.
        """
        with self._lock:
            return ModelStatus(
                model_id=self.model_id,
                hf_home=self.hf_home,
                loaded=self._loaded,
                ready=self._ready and self._model is not None,
                loading=self._loading,
                loaded_at=self._loaded_at,
                last_used_at=self._last_used_at,
                idle_unload_seconds=float(self.idle_unload_seconds),
            )