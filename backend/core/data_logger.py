"""
DataLogger (Historian) – periodically records tag values into SQLite (tag_history)
with optional deadband filtering and automatic retention pruning.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

if getattr(sys, "frozen", False):
    CONFIG_PATH = Path(sys.executable).parent / "logger_config.json"
else:
    CONFIG_PATH = Path(__file__).parent.parent / "logger_config.json"


def _default_config() -> Dict[str, Any]:
    return {
        "enabled": False,
        "interval_seconds": 10.0,
        "deadband": 0.0,
        "retention_days": 30,
        "log_all": False,
    }


def _to_float(val: Any) -> Optional[float]:
    if val is None:
        return None
    if isinstance(val, bool):
        return 1.0 if val else 0.0
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


class DataLogger:
    """Singleton historian service writing sampled telemetry into tag_history."""

    _instance: Optional["DataLogger"] = None

    def __new__(cls) -> "DataLogger":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._running = False
            cls._instance._task: Optional[asyncio.Task] = None
            cls._instance._config: Dict[str, Any] = cls._load_config()
            cls._instance._last_logged: Dict[int, float] = {}
            cls._instance._total_written: int = 0
            cls._instance._last_sample_at: Optional[float] = None
        return cls._instance

    @property
    def config(self) -> Dict[str, Any]:
        return self._config

    def get_status(self) -> Dict[str, Any]:
        return {
            **self._config,
            "running": self._running,
            "total_written": self._total_written,
            "last_sample_at": self._last_sample_at,
        }

    def update_config(self, new_cfg: Dict[str, Any]) -> Dict[str, Any]:
        merged = _default_config()
        merged.update({
            "enabled": bool(new_cfg.get("enabled", False)),
            "interval_seconds": max(1.0, float(new_cfg.get("interval_seconds", 10.0))),
            "deadband": max(0.0, float(new_cfg.get("deadband", 0.0))),
            "retention_days": max(1, int(new_cfg.get("retention_days", 30))),
            "log_all": bool(new_cfg.get("log_all", False)),
        })
        self._config = merged
        self._save_config(merged)
        return self._config

    async def start(self) -> bool:
        self._config = self._load_config()
        if not self._config.get("enabled", False):
            self._running = False
            logger.info("DataLogger: disabled (enabled=false)")
            return False
        if self._running:
            return True
        self._running = True
        self._task = asyncio.create_task(self._loop(), name="data_logger")
        logger.info("DataLogger started (interval=%ss)", self._config.get("interval_seconds", 10.0))
        return True

    async def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("DataLogger stopped")

    async def restart(self) -> bool:
        await self.stop()
        return await self.start()

    async def log_once(self, ignore_deadband: bool = False) -> int:
        """Capture one snapshot of eligible tags into tag_history and return sample count."""
        from core.tag_engine import TagEngine
        from db.database import get_db

        engine = TagEngine()
        all_vals = engine.get_all_values()
        if not all_vals:
            return 0

        log_all = bool(self._config.get("log_all", False))
        deadband = 0.0 if ignore_deadband else float(self._config.get("deadband", 0.0))

        sql = (
            "SELECT t.id FROM tags t JOIN connections c ON t.connection_id = c.id "
            "WHERE t.enabled = 1 AND c.enabled = 1"
        )
        if not log_all:
            sql += " AND COALESCE(t.log_enabled, 0) = 1"

        now_ts = time.time()
        rows_to_insert: List[tuple] = []

        async with get_db() as db:
            async with db.execute(sql) as cur:
                target_ids = [r["id"] for r in await cur.fetchall()]

            for tid in target_ids:
                entry = all_vals.get(tid)
                if not entry or entry.get("quality") != "Good":
                    continue
                num = _to_float(entry.get("value"))
                if num is None:
                    continue
                if deadband > 0.0 and tid in self._last_logged:
                    if abs(num - self._last_logged[tid]) < deadband:
                        continue
                self._last_logged[tid] = num
                rows_to_insert.append((tid, now_ts, num, "Good"))

            if rows_to_insert:
                await db.executemany(
                    "INSERT INTO tag_history (tag_id, ts, value, quality) VALUES (?, ?, ?, ?)",
                    rows_to_insert,
                )
                await db.commit()

        self._total_written += len(rows_to_insert)
        self._last_sample_at = now_ts
        return len(rows_to_insert)

    async def _prune_old(self) -> None:
        from db.database import get_db

        retention_days = max(1, int(self._config.get("retention_days", 30)))
        cutoff = time.time() - retention_days * 86400.0
        try:
            async with get_db() as db:
                await db.execute("DELETE FROM tag_history WHERE ts < ?", (cutoff,))
                await db.commit()
        except Exception as exc:
            logger.debug("DataLogger prune error: %s", exc)

    async def _loop(self) -> None:
        cycle = 0
        while self._running:
            interval = max(1.0, float(self._config.get("interval_seconds", 10.0)))
            try:
                await self.log_once()
                if cycle % 60 == 0:
                    await self._prune_old()
                cycle += 1
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("DataLogger loop error: %s", exc)
            await asyncio.sleep(interval)

    @staticmethod
    def _load_config() -> Dict[str, Any]:
        cfg = _default_config()
        if not CONFIG_PATH.exists():
            return cfg
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as fh:
                raw = json.load(fh)
            cfg.update({
                "enabled": bool(raw.get("enabled", False)),
                "interval_seconds": float(raw.get("interval_seconds", 10.0)),
                "deadband": float(raw.get("deadband", 0.0)),
                "retention_days": int(raw.get("retention_days", 30)),
                "log_all": bool(raw.get("log_all", False)),
            })
        except Exception as exc:
            logger.error("DataLogger: failed to read %s: %s", CONFIG_PATH, exc)
        return cfg

    @staticmethod
    def _save_config(cfg: Dict[str, Any]) -> None:
        try:
            with open(CONFIG_PATH, "w", encoding="utf-8") as fh:
                json.dump(cfg, fh, indent=2, ensure_ascii=False)
        except Exception as exc:
            logger.error("DataLogger: failed to write %s: %s", CONFIG_PATH, exc)
