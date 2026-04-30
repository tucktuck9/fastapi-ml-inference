"""Model management and inference logic.

Handles loading, unloading, and running inference with the Hugging Face model,
including thread management and quantization settings.
"""

import gc
import logging
import os
import threading
import time
from typing import Any

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from config import QUANTIZE_MODEL, TORCH_INTEROP_THREADS, TORCH_NUM_THREADS, WARMUP_TEXT

logger = logging.getLogger(__name__)


class ModelManager:
    def __init__(
        self,
        model_id: str,
        hf_home: str,
        idle_unload_seconds: int = 900,
        model_revision: str | None = None,
    ) -> None:
        """Configure the manager.

        Model loads at startup when EAGER_LOAD is true, otherwise on the first predict call.
        """
        # Set model ID, revision, and HF home
        self.model_id = model_id
        self.model_revision = model_revision
        self.hf_home = hf_home
        self.idle_unload_seconds = idle_unload_seconds
        # Set PyTorch thread counts and initialize model state
        torch.set_num_threads(TORCH_NUM_THREADS)
        torch.set_num_interop_threads(TORCH_INTEROP_THREADS)
        # Initialize model state
        self._lock = threading.RLock()
        self._model = None
        self._tokenizer = None
        self._id2label: dict[int, str] = {}
        self._loaded = False
        self._ready = False
        self._loading = False
        self._last_used_at: float | None = None
        self._loaded_at: float | None = None
        # Set HF_HOME environment variable and create cache directory
        os.environ["HF_HOME"] = self.hf_home
        os.makedirs(self.hf_home, exist_ok=True)

    # ------------------------------------------ #
    #             LIFECYCLE & STATE              #
    # ------------------------------------------ #

    def load_model(self) -> bool:
        """
        Downloads, quantizes, and loads the model into memory.

        Flow:
        1. Checks if already loaded or loading.
        2. Loads tokenizer and model from Hugging Face.
        3. Applies dynamic quantization if enabled.
        4. Updates internal state and timestamps.
        """
        with self._lock:
            if self._loaded and self._model is not None:
                self._ready = True
                return False

            if self._loading:
                while self._loading:
                    time.sleep(0.1)
                return False

            self._loading = True
            self._ready = False

        try:
            start = time.perf_counter()

            tokenizer = AutoTokenizer.from_pretrained(self.model_id, revision=self.model_revision)
            model = AutoModelForSequenceClassification.from_pretrained(
                self.model_id, revision=self.model_revision
            )
            model.eval()

            if QUANTIZE_MODEL:
                try:
                    model = torch.quantization.quantize_dynamic(
                        model, {torch.nn.Linear}, dtype=torch.qint8
                    )
                    logger.info("Dynamic quantization applied successfully")
                except RuntimeError as e:
                    logger.warning(f"Quantization failed ({e}); running without quantization")

            load_elapsed = round(time.perf_counter() - start, 2)

            with self._lock:
                self._model = model
                self._tokenizer = tokenizer
                self._id2label = model.config.id2label
                self._loaded = True
                self._ready = True
                self._loaded_at = time.time()
                self._last_used_at = time.time()

            print(
                f"[model_manager] loaded model_id={self.model_id} "
                f"revision={self.model_revision or 'latest'} "
                f"hf_home={self.hf_home} load_seconds={load_elapsed} "
                f"quantize={QUANTIZE_MODEL}"
            )

            if WARMUP_TEXT:
                try:
                    self.predict(WARMUP_TEXT)
                    print(f"[model_manager] warmup complete text={WARMUP_TEXT!r}")
                except Exception as exc:
                    print(f"[model_manager] warmup failed (non-fatal): {exc}")

            return True
        finally:
            with self._lock:
                self._loading = False

    def unload_model(self) -> bool:
        """
        Unloads the model from memory and runs garbage collection.

        Flow:
        1. Clears model, tokenizer, and label references.
        2. Resets state flags.
        3. Forces Python garbage collection.
        """
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
        print(f"[model_manager] unloaded model_id={self.model_id}")
        return True

    def maybe_unload_if_idle(self) -> bool:
        """
        Unloads the model from memory if it's been idle for too long.

        Flow:
        1. Checks if idle timeout is configured.
        2. Calculates time since last inference.
        3. Unloads model if timeout is exceeded.
        """
        if self.idle_unload_seconds <= 0:
            return False

        with self._lock:
            if not self._loaded or self._last_used_at is None:
                return False
            idle_for = time.time() - self._last_used_at

        if idle_for >= self.idle_unload_seconds:
            print(f"[model_manager] idle timeout reached: {round(idle_for, 2)}s")
            return self.unload_model()

        return False

    # ------------------------------------------ #
    #             INFERENCE                      #
    # ------------------------------------------ #

    def predict(self, text: str) -> dict[str, Any]:
        """
        Classifies a single text into emotions.

        Flow:
        1. Ensures model is loaded.
        2. Tokenizes input text.
        3. Runs forward pass without gradients.
        4. Applies sigmoid and ranks emotions by score.
        """
        if not self._loaded or self._model is None:
            self.load_model()

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
            [{"label": id2label[i], "score": round(float(p), 4)} for i, p in enumerate(probs_list)],
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

        if not self._loaded or self._model is None:
            self.load_model()

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
                [{"label": id2label[i], "score": round(float(p), 4)} for i, p in enumerate(row)],
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
        """State accessor that returns True if the model is loaded into memory."""
        with self._lock:
            return self._loaded and self._model is not None

    def is_ready(self) -> bool:
        """State accessor that returns True if the model is ready to classify text."""
        with self._lock:
            return self._ready and self._model is not None

    def status(self) -> dict[str, Any]:
        """Returns the current state of the model manager."""
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
