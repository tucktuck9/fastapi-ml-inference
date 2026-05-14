"""Bounded concurrency gate for CPU model inference.

PyTorch CPU inference on a fixed thread pool (TORCH_NUM_THREADS=2) cannot
parallelize beyond its allocated cores. Letting unlimited concurrent /predict
calls into asyncio.to_thread queues them inside the default executor — that
queue time gets billed as latency rather than as backpressure, and tail
latency under burst load climbs invisibly.

This module exposes a single semaphore sized to INFERENCE_CONCURRENCY (default
matches TORCH_NUM_THREADS) plus an optional fast-fail wait budget. Callers
either acquire and run, or wait up to INFERENCE_QUEUE_TIMEOUT_MS and raise
InferenceBusy if the gate doesn't open in time.

Usage:

    async with inference_gate():
        result = await asyncio.to_thread(manager.predict, text)

The route handler catches InferenceBusy and returns 503 with Retry-After.
"""

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from config import INFERENCE_CONCURRENCY, INFERENCE_QUEUE_TIMEOUT_MS
from schemas import GateStatus

logger = logging.getLogger(__name__)

_semaphore = asyncio.Semaphore(INFERENCE_CONCURRENCY)
_inflight: int = 0


# ------------------------------------------ #
#             EXCEPTIONS                     #
# ------------------------------------------ #


class InferenceBusy(Exception):
    """Raised when the inference gate cannot be acquired within the wait budget."""

    pass


# ------------------------------------------ #
#             GATE                           #
# ------------------------------------------ #


def _is_at_capacity() -> bool:
    """Return True if the inference gate is at capacity."""
    return _semaphore.locked()


def _log_capacity_warning() -> None:
    """Log a warning that the inference gate is at capacity."""
    if INFERENCE_QUEUE_TIMEOUT_MS > 0:
        logger.warning("[gate] at capacity — %d/%d slots in use; waiting up to %d ms", _inflight, INFERENCE_CONCURRENCY, INFERENCE_QUEUE_TIMEOUT_MS)
    else:
        logger.warning("[gate] at capacity — %d/%d slots in use; waiting", _inflight, INFERENCE_CONCURRENCY)


async def _wait_for_slot() -> float:
    """
    Wait for an inference slot to become available.
    Raises InferenceBusy if the timeout is exceeded.
    Returns the wait time in milliseconds.
    """
    t0 = time.perf_counter()
    timeout_s = (INFERENCE_QUEUE_TIMEOUT_MS / 1000.0) if INFERENCE_QUEUE_TIMEOUT_MS > 0 else None
    
    try:
        await asyncio.wait_for(_semaphore.acquire(), timeout=timeout_s)
    except TimeoutError as exc:
        logger.error("[gate] rejected after %d ms — %d/%d slots occupied", INFERENCE_QUEUE_TIMEOUT_MS, _inflight, INFERENCE_CONCURRENCY)
        raise InferenceBusy(f"Inference gate busy after {INFERENCE_QUEUE_TIMEOUT_MS} ms") from exc
        
    return round((time.perf_counter() - t0) * 1000, 1)


async def _acquire() -> None:
    """Acquire the semaphore, raising InferenceBusy if the wait budget expires."""
    if not _is_at_capacity():
        await _semaphore.acquire()
        logger.debug("[gate] acquired — %d/%d slots now in use", _inflight + 1, INFERENCE_CONCURRENCY)
    else:
        _log_capacity_warning()
        wait_ms = await _wait_for_slot()
        logger.warning("[gate] acquired after waiting %.1f ms — %d/%d slots now in use", wait_ms, _inflight + 1, INFERENCE_CONCURRENCY)


@asynccontextmanager
async def _hold() -> AsyncIterator[None]:
    """Track in-flight count while the caller runs, then release the semaphore."""
    global _inflight
    _inflight += 1
    try:
        yield
    except Exception:
        logger.exception("[gate] inference raised an unhandled exception")
        raise
    finally:
        _inflight -= 1
        _semaphore.release()
        logger.debug("[gate] released — %d/%d slots now in use", _inflight, INFERENCE_CONCURRENCY)


@asynccontextmanager
async def inference_gate() -> AsyncIterator[None]:
    """
    Bound concurrent inference to INFERENCE_CONCURRENCY in-flight calls.

    Flow:
    1. Acquire the semaphore (with optional wait timeout) via _acquire.
    2. Track in-flight count and release the semaphore via _hold.
    """
    await _acquire()
    async with _hold():
        yield


# ------------------------------------------ #
#             OBSERVABILITY                  #
# ------------------------------------------ #


def gate_status() -> GateStatus:
    """Return current gate occupancy for /admin/status integration."""
    return GateStatus(
        concurrency_limit=INFERENCE_CONCURRENCY,
        inflight=_inflight,
        queue_timeout_ms=INFERENCE_QUEUE_TIMEOUT_MS,
    )
