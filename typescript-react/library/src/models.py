"""ORM model for the saved-movies table."""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    DateTime,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from db import Base

# ------------------------------------------ #
#             MODELS                         #
# ------------------------------------------ #


class SavedMovie(Base):
    """SQLAlchemy model for a saved movie."""

    __tablename__ = "saved_movies"
    # Primary keys and foreign keys
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # Movie metadata
    tmdb_id: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    year: Mapped[str | None] = mapped_column(String(4))
    runtime_min: Mapped[int | None] = mapped_column(Integer)
    poster_url: Mapped[str | None] = mapped_column(String(500))
    tagline: Mapped[str | None] = mapped_column(String(500))
    overview: Mapped[str | None] = mapped_column(Text)
    genres: Mapped[list[str] | None] = mapped_column(ARRAY(String))
    tmdb_rating: Mapped[str | None] = mapped_column(String(64))
    emotions: Mapped[list[dict[str, Any]] | None] = mapped_column(
        JSONB().with_variant(JSON, "sqlite")
    )
    # Timestamps
    saved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
    )
    # Indexes
    __table_args__ = (
        UniqueConstraint("user_id", "tmdb_id", name="uq_saved_movies_user_tmdb"),
        Index("ix_saved_movies_user_saved_at", "user_id", "saved_at"),
    )
