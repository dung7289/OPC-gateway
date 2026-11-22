"""
Industrial Gateway – FastAPI application entry point.

Startup sequence
----------------
1. Initialize SQLite database (create tables if missing).
2. Start DriverManager   – connects enabled protocol drivers.
3. Start TagEngine       – begins async polling loops.
4. Start ForwardEngine   – forwards values to external sinks (if configured).

Shutdown sequence (reverse order):
1. Stop ForwardEngine
2. Stop TagEngine
3. Stop DriverManager
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api import connections, logs, tags, websocket, opcua_api, forward_api, history_api, system_api, usr_m100_api
from core.data_logger import DataLogger
from core.driver_manager import DriverManager
from core.forward_engine import ForwardEngine
from core.tag_engine import TagEngine
from core.opcua_server import OpcUaServerService
from core.usr_m100_service import UsrM100Service
from db.database import init_db

# ---------------------------------------------------------------------------
# Logging configuration
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logging.getLogger("opcua").setLevel(logging.WARNING)
logging.getLogger("snap7").setLevel(logging.WARNING)
logging.getLogger("pymodbus").setLevel(logging.WARNING)
logger = logging.getLogger("gateway")


# ---------------------------------------------------------------------------
# Lifespan (startup / shutdown)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- STARTUP ---
    logger.info("=== Industrial Gateway starting ===")

    # 1. Initialize database
    await init_db()
    logger.info("Database initialized")

    # 2. Start DriverManager
    dm = DriverManager()
    await dm.start()

    # 3. Start TagEngine
    engine = TagEngine()
    await engine.start()

    # 4. Start ForwardEngine
    fe = ForwardEngine()
    await fe.start()

    # 5. Start OPC-UA Server
    opc_server = OpcUaServerService()
    await opc_server.start(host="0.0.0.0")

    # 6. Start DataLogger (Historian)
    dl = DataLogger()
    await dl.start()

    # 7. Start USR-M100 Buffer & Control Service
    m100_svc = UsrM100Service()
    await m100_svc.start()

    logger.info("=== Industrial Gateway ready ===")
    yield

    # --- SHUTDOWN ---
    logger.info("=== Industrial Gateway shutting down ===")
    await m100_svc.stop()
    await dl.stop()
    await opc_server.stop()
    await fe.stop()
    await engine.stop()
    await dm.stop()
    logger.info("=== Industrial Gateway stopped ===")


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Industrial Gateway",
    description="Kepware-like industrial protocol gateway with REST + WebSocket API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# CORS – allow the React dev server on localhost:5173
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from pathlib import Path
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# ---------------------------------------------------------------------------
# Routers & API
# ---------------------------------------------------------------------------

app.include_router(connections.router)
app.include_router(tags.router)
app.include_router(logs.router)
app.include_router(websocket.router)   # provides /ws and /api/ws/status
app.include_router(opcua_api.router)
app.include_router(forward_api.router)
app.include_router(history_api.router)
app.include_router(system_api.router)
app.include_router(usr_m100_api.router)


@app.get("/api/health", tags=["health"])
async def health():
    """Simple health-check endpoint."""
    return {"status": "ok", "service": "Industrial Gateway"}


# ---------------------------------------------------------------------------
# Static Web UI (Single Page Application)
# ---------------------------------------------------------------------------
import sys

dist_dir = None
candidate_dirs = [
    getattr(sys, "_MEIPASS", None) and Path(sys._MEIPASS) / "frontend" / "dist",
    Path(sys.executable).parent / "frontend" / "dist",
    Path(sys.executable).parent / "_internal" / "frontend" / "dist",
    Path(__file__).parent.parent / "frontend" / "dist",
]
for d in candidate_dirs:
    if d and Path(d).exists() and (Path(d) / "index.html").exists():
        dist_dir = Path(d)
        break

if dist_dir and (dist_dir / "index.html").exists():
    if (dist_dir / "assets").exists():
        app.mount("/assets", StaticFiles(directory=str(dist_dir / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        if full_path.startswith(("api", "ws")):
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Not found")
        target_file = dist_dir / full_path
        if full_path and target_file.is_file():
            return FileResponse(target_file)
        return FileResponse(dist_dir / "index.html")
else:
    @app.get("/", tags=["health"])
    async def root_health():
        return {"status": "ok", "service": "Industrial Gateway (Web UI not built)"}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def _find_available_web_port(host: str = "0.0.0.0", preferred_port: int = 8000, max_tries: int = 20) -> int:
    """Return preferred_port if free, otherwise scan consecutive ports up to preferred_port + max_tries."""
    import socket
    for port in range(preferred_port, preferred_port + max_tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host, port))
                return port
            except OSError:
                continue
    return preferred_port


if __name__ == "__main__":
    import os
    preferred = int(os.environ.get("GATEWAY_PORT", "8000"))
    selected_port = _find_available_web_port("0.0.0.0", preferred)
    if selected_port != preferred:
        logger.warning(
            "Web UI port %d is already in use. Auto-switching Web UI to http://localhost:%d",
            preferred,
            selected_port,
        )
    else:
        logger.info("Web UI available at http://localhost:%d", selected_port)
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=selected_port,
        log_level="info",
    )
