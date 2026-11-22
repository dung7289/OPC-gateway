"""
API endpoints for Data Logger (Historian) configuration & historical queries.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from core.data_logger import DataLogger
from db.database import get_db

router = APIRouter(prefix="/api/history", tags=["history"])


class LoggerConfigModel(BaseModel):
    enabled: bool = False
    interval_seconds: float = Field(default=10.0, ge=1.0, le=3600.0)
    deadband: float = Field(default=0.0, ge=0.0)
    retention_days: int = Field(default=30, ge=1, le=3650)
    log_all: bool = False


@router.get("/config")
async def get_logger_config():
    """Return Data Logger config, runtime status, and total stored sample count."""
    dl = DataLogger()
    total_samples = 0
    async with get_db() as db:
        async with db.execute("SELECT COUNT(*) FROM tag_history") as cur:
            row = await cur.fetchone()
            total_samples = row[0] if row else 0
    return {**dl.get_status(), "total_samples": total_samples}


@router.put("/config")
async def update_logger_config(payload: LoggerConfigModel):
    """Save Data Logger config and start/stop background recording."""
    dl = DataLogger()
    dl.update_config(payload.model_dump())
    if payload.enabled:
        await dl.restart()
    else:
        await dl.stop()

    status = dl.get_status()
    status["message"] = (
        "Đã lưu cấu hình và bật Data Logger!"
        if payload.enabled
        else "Đã lưu cấu hình (Data Logger đang tắt)."
    )
    return status


@router.post("/sample-now")
async def sample_now():
    """Immediately write one snapshot of eligible tags (ignoring deadband)."""
    dl = DataLogger()
    written = await dl.log_once(ignore_deadband=True)
    return {
        "written": written,
        "message": (
            f"Đã ghi {written} mẫu vào lịch sử!"
            if written > 0
            else "Chưa có tag nào có giá trị số hợp lệ để ghi (hãy bật 'Ghi lịch sử' trên tag hoặc bật 'Ghi tất cả tag')."
        ),
    }


@router.get("/query")
async def query_history(
    tag_id: int = Query(...),
    hours: float = Query(default=24.0, ge=0.01, le=8760.0),
    limit: int = Query(default=2000, ge=1, le=10000),
):
    """Query historical samples for a tag within the last N hours."""
    since_ts = time.time() - hours * 3600.0
    async with get_db() as db:
        # Fetch newest up to `limit`, then reverse so points are chronological
        async with db.execute(
            "SELECT ts, value, quality FROM tag_history "
            "WHERE tag_id = ? AND ts >= ? ORDER BY ts DESC LIMIT ?",
            (tag_id, since_ts, limit),
        ) as cur:
            rows = await cur.fetchall()

    rows = list(reversed(rows))
    samples = []
    numeric_vals = []
    for r in rows:
        ts = float(r["ts"])
        val = r["value"]
        if val is not None:
            numeric_vals.append(float(val))
        iso = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
        samples.append({
            "ts": ts,
            "iso": iso,
            "value": val,
            "quality": r["quality"] or "Good",
        })

    return {
        "tag_id": tag_id,
        "count": len(samples),
        "min": round(min(numeric_vals), 4) if numeric_vals else None,
        "max": round(max(numeric_vals), 4) if numeric_vals else None,
        "avg": round(sum(numeric_vals) / len(numeric_vals), 4) if numeric_vals else None,
        "latest": samples[-1]["value"] if samples else None,
        "samples": samples,
    }


@router.delete("/clear")
async def clear_history(tag_id: Optional[int] = Query(default=None)):
    """Delete historical samples for a specific tag or for the entire database."""
    async with get_db() as db:
        if tag_id is not None:
            cur = await db.execute("DELETE FROM tag_history WHERE tag_id = ?", (tag_id,))
        else:
            cur = await db.execute("DELETE FROM tag_history")
        deleted = cur.rowcount
        await db.commit()
    return {"deleted": deleted, "message": f"Đã xóa {deleted} mẫu lịch sử."}
