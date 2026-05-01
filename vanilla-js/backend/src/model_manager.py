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

logger = logging.getLogger(__name__)


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
        2. If another thread is loading, wait on the condition variable.
        3. Otherwise, claim the load slot, perform the load outside the lock,
           and publish state under the lock when done.
        """
        with self._load_cv:
            if self._loaded and self._model is not None:
                self._ready = True
                return False

            if self._loading:
                # Wait until the in-flight loader signals completion. Whoever
                # finishes will call notify_all() under the same lock.
                self._load_cv.wait_for(lambda: not self._loading)
                if self._load_error is not None:
                    raise RuntimeError(
                        f"Concurrent model load failed: {self._load_error!r}"
                    ) from self._load_error
                if not (self._loaded and self._model is not None):
                    raise RuntimeError("Model load completed but state is invalid")
                return False

            # Claim the load slot.
            self._loading = True
            self._ready = False
            self._load_error = None

        # Perform the actual load outside the lock so /ready, /status, and
        # other callers stay responsive during the multi-second download.
        load_exc: BaseException | None = None
        tokenizer = None
        model = None
        load_elapsed = 0.0
        try:
            start = time.perf_counter()

            tokenizer = AutoTokenizer.from_pretrained(
                self.model_id, revision=self.model_revision
            )
            model = AutoModelForSequenceClassification.from_pretrained(
                self.model_id, revision=self.model_revision
            )
            model.eval()

            if QUANTIZE_MODEL:
                try:
                    model = quantize_dynamic(
                        model, {torch.nn.Linear}, dtype=torch.qint8
                    )
                    logger.info("Dynamic quantization applied successfully")
                except RuntimeError as e:
                    logger.warning(
                        "Quantization failed (%s); running without quantization", e
                    )

            load_elapsed = round(time.perf_counter() - start, 2)
        except BaseException as exc:  # noqa: BLE001 — we re-raise after cleanup
            load_exc = exc
            logger.exception("Model load failed for model_id=%s", self.model_id)

        # Publish state (success or failure) and wake up any waiters.
        with self._load_cv:
            if load_exc is None:
                self._model = model
                self._tokenizer = tokenizer
                self._id2label = model.config.id2label
                self._loaded = True
                self._ready = True
                self._loaded_at = time.time()
                self._last_used_at = time.time()
                self._load_error = None
            else:
                self._model = None
                self._tokenizer = None
                self._id2label = {}
                self._loaded = False
                self._ready = False
                self._load_error = load_exc

            self._loading = False
            self._load_cv.notify_all()

        if load_exc is not None:
            raise load_exc

        logger.info(
            "[model_manager] loaded model_id=%s revision=%s hf_home=%s "
            "load_seconds=%s quantize=%s",
            self.model_id,
            self.model_revision or "latest",
            self.hf_home,
            load_elapsed,
            QUANTIZE_MODEL,
        )

        # Warmup runs after the load is fully published, so /ready is already
        # true by the time we get here. Failures are non-fatal.
        if WARMUP_TEXT:
            try:
                self.predict(WARMUP_TEXT)
                logger.info("[model_manager] warmup complete text=%r", WARMUP_TEXT)
            except Exception as exc:  # noqa: BLE001
                logger.warning("[model_manager] warmup failed (non-fatal): %s", exc)

        return True

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

    def status(self) -> dict[str, Any]:
        """Current state snapshot — safe to expose on a /status endpoint.

        Note: ``eager_load`` is intentionally not included here. The
        ``/admin/status`` handler in ``main.py`` passes it explicitly as a
        keyword argument when constructing ``AdminStatusResponse``.
        """
        with self._lock:
            return {
                "model_id": self.model_id,
                "hf_home": self.hf_home,
                "loaded": self._loaded,
                "ready": self._ready and self._model is not None,
                "loading": self._loading,
                "loaded_at": self._loaded_at,
                "last_used_at": self._last_used_at,
                "idle_unload_seconds": self.idle_unload_seconds,
            }