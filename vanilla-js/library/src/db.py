"""Async SQLAlchemy engine and session helpers."""

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from config import DATABASE_URL


class Base(DeclarativeBase):
    """Declarative base class for SQLAlchemy models."""

    pass


# ------------------------------------------ #
#             DATABASE SETUP                 #
# ------------------------------------------ #


def _build_database_url() -> str:
    """Ensure the database URL uses the asyncpg driver."""
    url = DATABASE_URL
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    if url.startswith("postgresql://") and "+asyncpg" not in url:
        url = "postgresql+asyncpg://" + url[len("postgresql://") :]
    return url


engine = create_async_engine(_build_database_url(), pool_pre_ping=True, future=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


# ------------------------------------------ #
#             SESSION MANAGEMENT             #
# ------------------------------------------ #


async def get_session() -> AsyncIterator[AsyncSession]:
    """Yield an async database session."""
    async with SessionLocal() as session:
        yield session


# ------------------------------------------ #
#             SCHEMA INITIALIZATION          #
# ------------------------------------------ #


async def init_schema() -> None:
    """Create all database tables."""
    from models import SavedMovie  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
