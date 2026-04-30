"""Review chunking and emotion aggregation.

Splits long review texts into sentence-boundary chunks before classification.
The underlying model has a hard 512-token context window; chunking
ensures no input is silently truncated. Scoring each focused segment separately
also preserves the emotional arc of mixed-tone reviews. Scores are then
weighted-mean aggregated back into a single per-review verdict.

All functions here are pure: no I/O, no FastAPI dependencies. The model's
predict_batch callable is passed in from the caller so this module stays
independently testable.
"""

import re
from collections.abc import Callable

from config import REVIEW_CHUNK_CHARS, REVIEW_CHUNK_HARD_MAX, REVIEW_MAX_CHUNKS

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


# ------------------------------------------ #
#             REVIEW FORMATTING              #
# ------------------------------------------ #


def format_review(raw: dict) -> dict:
    """Pass through TMDB review content verbatim.

    The full content is shown to the user. The classifier sees the same
    content split into chunks (see chunk_review) so what the user reads
    and what the model scores stay aligned end-to-end.
    """
    return {
        "id": raw.get("id"),
        "author": raw.get("author") or "Anonymous",
        "content": (raw.get("content") or "").strip(),
        "created_at": raw.get("created_at"),
        "url": raw.get("url"),
        "rating": (raw.get("author_details") or {}).get("rating"),
    }


# ------------------------------------------ #
#             REVIEW CHUNKING                #
# ------------------------------------------ #


def chunk_review(
    content: str,
    target_chars: int = REVIEW_CHUNK_CHARS,
    hard_max: int = REVIEW_CHUNK_HARD_MAX,
    max_chunks: int = REVIEW_MAX_CHUNKS,
) -> list[str]:
    """Split a review into ~target_chars chunks at sentence boundaries.

    The model silently truncates inputs beyond 512 tokens (~600 chars).
    Chunking at sentence boundaries keeps each piece within that limit while
    preserving semantic coherence. Scoring each chunk independently also
    captures the emotional arc of a mixed-tone review rather than averaging
    it away. The caller weighted-means the chunk scores into one verdict.

    Hard-cap at max_chunks so a 10,000-char review doesn't dominate the
    page's batched forward pass.
    """
    text = (content or "").strip()
    if not text:
        return []
    if len(text) <= hard_max:
        return [text]

    sentences = _SENTENCE_SPLIT_RE.split(text)
    chunks: list[str] = []
    current = ""
    for s in sentences:
        s = s.strip()
        if not s:
            continue
        while len(s) > hard_max:
            head, s = s[:hard_max], s[hard_max:].lstrip()
            if current:
                chunks.append(current)
                current = ""
            chunks.append(head)
            if len(chunks) >= max_chunks:
                return chunks[:max_chunks]

        candidate = (current + " " + s).strip() if current else s
        if len(candidate) <= target_chars:
            current = candidate
        else:
            if current:
                chunks.append(current)
            current = s
            if len(chunks) >= max_chunks:
                return chunks[:max_chunks]

    if current and len(chunks) < max_chunks:
        chunks.append(current)
    return chunks[:max_chunks]


# ------------------------------------------ #
#             EMOTION AGGREGATION            #
# ------------------------------------------ #


def aggregate_chunks_weighted(
    chunk_predictions: list[list[dict]],
    chunk_weights: list[int],
) -> list[dict]:
    """Weighted mean per emotion label across one review's chunks.

    Weight is chunk length in characters — a 50-char chunk shouldn't outvote
    a 400-char one. Returns the full ranked list of {label, score}; callers
    slice [:TOP_EMOTIONS] for display.
    """
    if not chunk_predictions:
        return []
    total_weight = sum(chunk_weights) or 1
    totals: dict[str, float] = {}
    for ranked, weight in zip(chunk_predictions, chunk_weights):
        for entry in ranked:
            label = entry["label"]
            totals[label] = totals.get(label, 0.0) + float(entry["score"]) * weight
    averaged = [
        {"label": label, "score": round(total / total_weight, 4)} for label, total in totals.items()
    ]
    averaged.sort(key=lambda x: x["score"], reverse=True)
    return averaged


def aggregate_emotions(predictions: list[list[dict]]) -> list[dict]:
    """Average each emotion's score across all reviews, then rank.

    Each prediction is the full ranked list for one review (11 labels). To
    aggregate, we sum scores per label across reviews and divide by count.
    Returns the same {label, score} shape, sorted descending.
    """
    if not predictions:
        return []
    totals: dict[str, float] = {}
    for ranked in predictions:
        for entry in ranked:
            label = entry["label"]
            totals[label] = totals.get(label, 0.0) + float(entry["score"])
    n = len(predictions)
    averaged = [{"label": label, "score": round(total / n, 4)} for label, total in totals.items()]
    averaged.sort(key=lambda x: x["score"], reverse=True)
    return averaged


# ------------------------------------------ #
#             ORCHESTRATION                  #
# ------------------------------------------ #


def classify_reviews_chunked(
    reviews: list[dict],
    predict_batch: Callable[[list[str]], dict],
) -> tuple[list[list[dict]], float]:
    """
    Chunk every review, run one flat batched forward pass, regroup, aggregate.

    Flow:
    1. Splits all reviews into sentence-boundary chunks.
    2. Runs a single batched inference pass on all chunks.
    3. Regroups predictions back to their original reviews.
    4. Aggregates chunk scores using weighted means.
    """
    flat_chunks: list[str] = []
    chunk_weights_by_review: list[list[int]] = [[] for _ in reviews]
    chunks_by_review: list[list[int]] = [[] for _ in reviews]

    for r_idx, review in enumerate(reviews):
        for piece in chunk_review(review["content"]):
            chunks_by_review[r_idx].append(len(flat_chunks))
            chunk_weights_by_review[r_idx].append(len(piece))
            flat_chunks.append(piece)

    if not flat_chunks:
        return [[] for _ in reviews], 0.0

    result = predict_batch(flat_chunks)
    chunk_preds = result["predictions"]
    per_review: list[list[dict]] = []
    for r_idx in range(len(reviews)):
        chunk_idxs = chunks_by_review[r_idx]
        preds = [chunk_preds[i] for i in chunk_idxs]
        weights = chunk_weights_by_review[r_idx]
        per_review.append(aggregate_chunks_weighted(preds, weights))

    return per_review, result["inference_ms"]
