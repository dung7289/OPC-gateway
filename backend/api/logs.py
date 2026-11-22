"""
Event log API endpoints.

GET  /api/logs          – list logs (filter by level / source, paginated)
DELETE /api/logs        – clear all logs

Also exposes add_log() as a convenience helper for other modules.
"""

from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, Query

from db.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/logs", tags=["logs"])


# ------------------------------------------------------------------
# Helper used by other modules
# ------------------------------------------------------------------

async def add_log(level: str, source: str, message: str) -> None:
    """
    Insert a new record into the event_logs table.

    Parameters
    ----------
    level   : str  – e.g. "INFO", "WARNING", "ERROR"
    source  : str  – name of the originating module
    message : str  – human-readable description
    """
    try:
        async with get_db() as db:
            await db.execute(
                "INSERT INTO event_logs (level, source, message) VALUES (?, ?, ?)",
                (level.upper(), source, message),
            )
            await db.commit()
    except Exception as exc:
        logger.error("add_log failed: %s", exc)


# ------------------------------------------------------------------
# API endpoints
# ------------------------------------------------------------------

@router.get("")
@router.get("/")
async def list_logs(
    level:  Optional[str] = Query(default=None, description="Filter by log level (INFO/WARNING/ERROR)"),
    source: Optional[str] = Query(default=None, description="Filter by source module"),
    limit:  int           = Query(default=100, ge=1, le=1000),
    offset: int           = Query(default=0, ge=0),
):
    """Return event log records, newest first."""
    conditions: list[str] = []
    params: list = []

    if level:
        conditions.append("level = ?")
        params.append(level.upper())
    if source:
        conditions.append("source LIKE ?")
        params.append(f"%{source}%")

    where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    params += [limit, offset]

    query = (
        f"SELECT * FROM event_logs {where_clause} "
        f"ORDER BY id DESC LIMIT ? OFFSET ?"
    )

    async with get_db() as db:
        async with db.execute(query, params) as cursor:
            rows = await cursor.fetchall()

        # Total count for pagination
        count_query = f"SELECT COUNT(*) FROM event_logs {where_clause}"
        async with db.execute(count_query, params[:-2]) as cursor:
            total = (await cursor.fetchone())[0]

    return {
        "total":  total,
        "limit":  limit,
        "offset": offset,
        "items":  [dict(row) for row in rows],
    }


@router.delete("")
@router.delete("/")
async def clear_logs():
    """Delete all records from the event_logs table."""
    async with get_db() as db:
        await db.execute("DELETE FROM event_logs")
        await db.commit()
    return {"message": "All logs cleared"}
