"""
WebSocket endpoint and connection manager.

Clients connect to WS /ws and receive real-time tag update events.
Message format:
  {"type": "tag_update", "data": {"tag_id": int, "value": Any, "quality": str, "timestamp": str}}
"""

from __future__ import annotations

import json
import logging
from typing import List

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter()


class ConnectionManager:
    """Manages a list of active WebSocket connections and provides broadcast."""

    def __init__(self) -> None:
        self._active: List[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._active.append(websocket)
        logger.info(
            "WebSocket client connected. Total clients: %d", len(self._active)
        )

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self._active:
            self._active.remove(websocket)
        logger.info(
            "WebSocket client disconnected. Total clients: %d", len(self._active)
        )

    async def broadcast(self, data: dict) -> None:
        """Send a JSON message to all connected clients."""
        if not self._active:
            return
        message = json.dumps(data, default=str)
        dead: List[WebSocket] = []
        for ws in list(self._active):
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    @property
    def client_count(self) -> int:
        return len(self._active)


# Singleton manager used by TagEngine and the WebSocket endpoint
manager = ConnectionManager()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """Accept WebSocket connections and keep them alive until they disconnect."""
    await manager.connect(websocket)
    try:
        while True:
            # Keep the connection open; we only push from the server side.
            # Accept any incoming text (e.g. ping) but do nothing with it.
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as exc:
        logger.warning("WebSocket error: %s", exc)
        manager.disconnect(websocket)


@router.get("/api/ws/status")
async def ws_status():
    """Return the number of currently connected WebSocket clients."""
    return {"connected_clients": manager.client_count}
