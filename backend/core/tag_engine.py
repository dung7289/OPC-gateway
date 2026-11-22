"""
TagEngine – asynchronous polling engine for all configured tags.

Responsibilities
----------------
* Load enabled tags from the database on startup.
* Group tags by their scan_rate_ms to minimise polling overhead.
* Cache the latest value, quality, and timestamp for every tag.
* Notify WebSocket clients of changed values via api.websocket.broadcast.
* Expose write_tag for on-demand value writes.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from db.database import get_db
from core.scaling import apply_scaling, is_scaled, reverse_scaling

logger = logging.getLogger(__name__)


class TagReadOnlyError(Exception):
    """Raised when a write is attempted on a tag configured as Read Only (access='ro')."""


class TagEngine:
    """
    Polling loop that reads tags from their drivers and maintains a live cache.
    """

    _instance: Optional["TagEngine"] = None

    def __new__(cls) -> "TagEngine":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._tag_cache: Dict[int, dict] = {}
            cls._instance._running = False
            cls._instance._tasks: List[asyncio.Task] = []
        return cls._instance

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Load tags from DB and start per-scan-rate polling tasks."""
        if self._running:
            return
        self._running = True
        await self._launch_polling_tasks()
        logger.info("TagEngine started")

    async def stop(self) -> None:
        """Cancel all polling tasks."""
        self._running = False
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()
        logger.info("TagEngine stopped")

    async def reload(self) -> None:
        """Stop and restart the engine to pick up new tag configuration."""
        await self.stop()
        await self.start()

    # ------------------------------------------------------------------
    # Cache access
    # ------------------------------------------------------------------

    def get_tag_value(self, tag_id: int) -> dict:
        """
        Return the cached entry for a tag, or a default "Unknown" dict.
        """
        return self._tag_cache.get(
            tag_id,
            {"value": None, "quality": "Unknown", "timestamp": None},
        )

    def get_all_values(self) -> Dict[int, dict]:
        """Return the entire tag value cache."""
        return dict(self._tag_cache)

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    async def write_tag(self, tag_id: int, value: Any) -> bool:
        """Write a value to a tag via the DriverManager (honours Read-Only access and reverse scaling)."""
        from core.driver_manager import DriverManager

        async with get_db() as db:
            async with db.execute(
                "SELECT * FROM tags WHERE id = ?", (tag_id,)
            ) as cursor:
                row = await cursor.fetchone()

        if row is None:
            logger.warning("write_tag: tag_id=%d not found", tag_id)
            return False

        tag = dict(row)
        if (tag.get("access") or "rw") == "ro":
            raise TagReadOnlyError(f"Tag '{tag.get('name')}' được cấu hình Read Only, không cho phép ghi")

        # Engineering value (what the user / SCADA sees) -> raw device value
        raw_value = reverse_scaling(tag, value) if is_scaled(tag) else value

        dm  = DriverManager()
        return await dm.write_tag(tag, raw_value)

    # ------------------------------------------------------------------
    # Private – polling
    # ------------------------------------------------------------------

    async def _launch_polling_tasks(self) -> None:
        """Read all enabled tags from DB and create one task per (connection_id, scan_rate_ms) group.
        Isolating by connection_id prevents a slow/timed-out PLC from blocking other connections."""
        async with get_db() as db:
            async with db.execute(
                "SELECT t.* FROM tags t JOIN connections c ON t.connection_id = c.id "
                "WHERE t.enabled = 1 AND c.enabled = 1"
            ) as cursor:
                rows = await cursor.fetchall()

        # Group by (connection_id, scan_rate_ms) so connections poll independently
        groups: Dict[tuple, List[dict]] = defaultdict(list)
        active_ids: set[int] = set()
        for row in rows:
            tag = dict(row)
            active_ids.add(tag["id"])
            groups[(tag["connection_id"], tag["scan_rate_ms"])].append(tag)

        # Prune stale cache entries from deleted or disabled tags/connections
        for cached_id in list(self._tag_cache.keys()):
            if cached_id not in active_ids:
                self._tag_cache.pop(cached_id, None)

        for (conn_id, scan_rate_ms), tags in groups.items():
            task = asyncio.create_task(
                self._poll_group(scan_rate_ms, tags),
                name=f"poll_conn{conn_id}_{scan_rate_ms}ms",
            )
            self._tasks.append(task)

        logger.info(
            "TagEngine: %d tag(s) in %d polling group(s)",
            sum(len(v) for v in groups.values()),
            len(groups),
        )

    async def _poll_group(self, scan_rate_ms: int, tags: List[dict]) -> None:
        """Continuously poll a list of tags at the given interval."""
        from core.driver_manager import DriverManager

        interval = scan_rate_ms / 1000.0
        dm = DriverManager()

        while self._running:
            start_time = asyncio.get_event_loop().time()

            for tag in tags:
                tag_id = tag["id"]
                try:
                    value, quality = await dm.read_tag(tag)
                    if quality == "Good" and is_scaled(tag):
                        value = apply_scaling(tag, value)
                    ts = datetime.now(timezone.utc).isoformat()
                    previous = self._tag_cache.get(tag_id, {})
                    new_entry = {
                        "value":     value,
                        "quality":   quality,
                        "timestamp": ts,
                    }
                    self._tag_cache[tag_id] = new_entry

                    # Broadcast only when value or quality changes (and skip Unknown-to-Unknown noise)
                    prev_quality = previous.get("quality", "Unknown")
                    prev_value   = previous.get("value")
                    value_changed   = prev_value != value
                    quality_changed = prev_quality != quality
                    # Always broadcast if quality improved (Unknown→Good/Bad)
                    if value_changed or quality_changed:
                        await self._broadcast_update(tag_id, new_entry)

                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    logger.error(
                        "TagEngine poll error [tag_id=%d, addr=%s]: %s",
                        tag_id, tag.get("address"), exc,
                    )

            # Sleep for the remainder of the interval
            elapsed = asyncio.get_event_loop().time() - start_time
            sleep_time = max(0.0, interval - elapsed)
            try:
                await asyncio.sleep(sleep_time)
            except asyncio.CancelledError:
                break

    @staticmethod
    async def _broadcast_update(tag_id: int, entry: dict) -> None:
        """Push a tag_update event to all WebSocket clients."""
        try:
            from api.websocket import manager as ws_manager

            await ws_manager.broadcast({
                "type": "tag_update",
                "data": {
                    "tag_id":    tag_id,
                    "value":     entry["value"],
                    "quality":   entry["quality"],
                    "timestamp": entry["timestamp"],
                },
            })
        except Exception as exc:
            logger.debug("TagEngine broadcast error: %s", exc)
