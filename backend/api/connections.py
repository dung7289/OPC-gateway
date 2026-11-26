"""
Connections CRUD API.

GET    /api/connections           – list all connections with driver status
POST   /api/connections           – create a new connection
GET    /api/connections/{id}      – get a single connection
PUT    /api/connections/{id}      – update a connection
DELETE /api/connections/{id}      – delete a connection
POST   /api/connections/{id}/reconnect – force reconnect
"""

from __future__ import annotations

import json
import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request

from api.logs import add_log
from core.driver_manager import DriverManager
from db.database import get_db
from models.connection import ConnectionCreate, ConnectionResponse, ConnectionUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/connections", tags=["connections"])


def _mask_config_secrets(config: dict) -> dict:
    masked = dict(config)
    for k, v in masked.items():
        if isinstance(v, dict):
            masked[k] = _mask_config_secrets(v)
        elif any(tok in str(k).lower() for tok in ("password", "secret", "token", "auth_header")):
            if v:
                masked[k] = "••••••"
    return masked


def _row_to_response(
    row: dict,
    dm: DriverManager,
    stats: Optional[dict] = None,
    mask_secrets: bool = False,
) -> ConnectionResponse:
    """Convert a DB row dict to a ConnectionResponse with live driver status and _System stats."""
    config: dict = {}
    try:
        config = json.loads(row.get("config_json") or "{}")
    except (json.JSONDecodeError, TypeError):
        pass
    if mask_secrets and isinstance(config, dict):
        config = _mask_config_secrets(config)

    driver = dm.get_driver(row["id"])
    connected = driver.is_connected() if driver else False
    demoted = bool(getattr(driver, "is_demoted", False)) if driver else False
    st = (stats or {}).get(row["id"], {})

    return ConnectionResponse(
        id=row["id"],
        name=row["name"],
        protocol=row["protocol"],
        host=row["host"],
        port=row["port"],
        config=config,
        enabled=bool(row["enabled"]),
        created_at=row["created_at"],
        connected=connected,
        demoted=demoted,
        tag_count=st.get("total", 0),
        good_count=st.get("good", 0),
        bad_count=st.get("bad", 0),
    )


# ------------------------------------------------------------------
# Endpoints
# ------------------------------------------------------------------

@router.get("", response_model=List[ConnectionResponse])
@router.get("/", response_model=List[ConnectionResponse])
async def list_connections(request: Request):
    """List all connections with their current driver connection state and live tag quality counts."""
    user = getattr(request.state, "user", None)
    mask_secrets = bool(user and user.get("role") != "admin")
    from core.tag_engine import TagEngine
    dm = DriverManager()
    engine = TagEngine()
    all_vals = engine.get_all_values()

    async with get_db() as db:
        async with db.execute("SELECT * FROM connections ORDER BY id") as cursor:
            rows = await cursor.fetchall()
        async with db.execute("SELECT id, connection_id FROM tags WHERE enabled = 1") as cursor:
            tag_rows = await cursor.fetchall()

    stats: dict = {}
    for tr in tag_rows:
        cid = tr["connection_id"]
        st = stats.setdefault(cid, {"total": 0, "good": 0, "bad": 0})
        st["total"] += 1
        q = (all_vals.get(tr["id"], {}).get("quality") or "Unknown")
        if q == "Good":
            st["good"] += 1
        else:
            st["bad"] += 1

    return [_row_to_response(dict(row), dm, stats, mask_secrets=mask_secrets) for row in rows]


@router.post("", response_model=ConnectionResponse, status_code=201)
@router.post("/", response_model=ConnectionResponse, status_code=201)
async def create_connection(payload: ConnectionCreate):
    """Create a new connection and start its driver."""
    config_json = json.dumps(payload.config or {})
    async with get_db() as db:
        try:
            cursor = await db.execute(
                "INSERT INTO connections (name, protocol, host, port, config_json, enabled) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    payload.name,
                    payload.protocol.value,
                    payload.host,
                    payload.port,
                    config_json,
                    int(payload.enabled),
                ),
            )
            await db.commit()
            conn_id = cursor.lastrowid
        except Exception as exc:
            logger.error("create_connection DB error: %s", exc)
            raise HTTPException(status_code=400, detail=str(exc))

        async with db.execute(
            "SELECT * FROM connections WHERE id = ?", (conn_id,)
        ) as cur:
            row = dict(await cur.fetchone())

    dm = DriverManager()
    if payload.enabled:
        await dm.add_connection(row)

    await add_log("INFO", "connections", f"Connection '{payload.name}' created (id={conn_id})")
    return _row_to_response(row, dm)


@router.get("/{connection_id}", response_model=ConnectionResponse)
async def get_connection(connection_id: int, request: Request):
    """Return details of a single connection."""
    user = getattr(request.state, "user", None)
    mask_secrets = bool(user and user.get("role") != "admin")
    async with get_db() as db:
        async with db.execute(
            "SELECT * FROM connections WHERE id = ?", (connection_id,)
        ) as cursor:
            row = await cursor.fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Connection not found")

    dm = DriverManager()
    return _row_to_response(dict(row), dm, mask_secrets=mask_secrets)


@router.put("/{connection_id}", response_model=ConnectionResponse)
async def update_connection(connection_id: int, payload: ConnectionUpdate):
    """Update an existing connection. Restarts the driver if enabled."""
    async with get_db() as db:
        async with db.execute(
            "SELECT * FROM connections WHERE id = ?", (connection_id,)
        ) as cursor:
            existing = await cursor.fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="Connection not found")

        updates: dict = {}
        if payload.name     is not None: updates["name"]        = payload.name
        if payload.protocol is not None: updates["protocol"]    = payload.protocol.value
        if payload.host     is not None: updates["host"]        = payload.host
        if payload.port     is not None: updates["port"]        = payload.port
        if payload.config   is not None: updates["config_json"] = json.dumps(payload.config)
        if payload.enabled  is not None: updates["enabled"]     = int(payload.enabled)

        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            await db.execute(
                f"UPDATE connections SET {set_clause} WHERE id = ?",
                (*updates.values(), connection_id),
            )
            await db.commit()

        async with db.execute(
            "SELECT * FROM connections WHERE id = ?", (connection_id,)
        ) as cursor:
            row = dict(await cursor.fetchone())

    dm = DriverManager()
    # Restart driver with new config
    await dm.remove_connection(connection_id)
    if row["enabled"]:
        await dm.add_connection(row)

    # Reload TagEngine so disabled channels stop polling and re-enabled ones resume
    from core.tag_engine import TagEngine
    await TagEngine().reload()

    await add_log("INFO", "connections", f"Connection id={connection_id} updated (enabled={bool(row['enabled'])})")
    return _row_to_response(row, dm)


@router.delete("/{connection_id}")
async def delete_connection(connection_id: int):
    """Delete a connection and stop its driver."""
    async with get_db() as db:
        async with db.execute(
            "SELECT id, name FROM connections WHERE id = ?", (connection_id,)
        ) as cursor:
            row = await cursor.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Connection not found")
        name = row["name"]
        await db.execute("DELETE FROM connections WHERE id = ?", (connection_id,))
        await db.commit()

    dm = DriverManager()
    await dm.remove_connection(connection_id)

    from core.tag_engine import TagEngine
    await TagEngine().reload()

    await add_log("INFO", "connections", f"Connection '{name}' (id={connection_id}) deleted")
    return {"message": f"Connection {connection_id} deleted"}


@router.post("/{connection_id}/reconnect")
async def reconnect_connection(connection_id: int):
    """Force a reconnect of the driver for the given connection."""
    async with get_db() as db:
        async with db.execute(
            "SELECT * FROM connections WHERE id = ?", (connection_id,)
        ) as cursor:
            row = await cursor.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Connection not found")

    dm = DriverManager()
    success = await dm.reconnect(connection_id)
    await add_log(
        "INFO" if success else "WARNING",
        "connections",
        f"Reconnect connection id={connection_id}: {'OK' if success else 'FAILED'}",
    )
    return {"connection_id": connection_id, "connected": success}


# ------------------------------------------------------------------
# Test connection (dry-run, no DB save)
# ------------------------------------------------------------------

@router.post("/test")
async def test_connection_config(payload: ConnectionCreate):
    """
    Test a connection config WITHOUT saving it to the database.
    Returns {connected: bool, message: str}.
    """
    import json as _json
    from core.driver_manager import _build_config

    # Build a fake row-like dict
    fake_row = {
        "id": -1,
        "name": payload.name or "test",
        "protocol": payload.protocol,
        "host": payload.host or "",
        "port": payload.port or 0,
        "config_json": _json.dumps(payload.config or {}),
        "enabled": 1,
    }

    # Find driver class
    from core.driver_manager import _DRIVER_REGISTRY
    driver_cls = _DRIVER_REGISTRY.get(payload.protocol)
    if driver_cls is None:
        return {"connected": False, "message": f"Không có driver cho protocol '{payload.protocol}'"}

    config = _build_config(fake_row)
    driver = driver_cls(config)

    try:
        ok = await driver.connect()
        msg = "Kết nối thành công!" if ok else "Kết nối thất bại. Kiểm tra lại cấu hình."
        await driver.disconnect()
        return {"connected": ok, "message": msg}
    except Exception as exc:
        return {"connected": False, "message": f"Lỗi: {exc}"}


# ------------------------------------------------------------------
# OPC DA specific helper endpoints
# ------------------------------------------------------------------

@router.get("/opc-da/servers")
async def get_opc_da_servers():
    """List available OPC DA servers discovered on the local machine."""
    from drivers.opc_da_driver import list_opc_da_servers
    servers = list_opc_da_servers()
    return {"servers": servers}


@router.get("/{connection_id}/opc-da/browse")
async def browse_opc_da(connection_id: int, path: Optional[str] = None, branch: Optional[str] = None):
    """Browse branches and leaves for an OPC DA connection."""
    target_path = path or branch
    dm = DriverManager()
    driver = dm.get_driver(connection_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Connection driver not active. Vui lòng bấm Kết nối lại (Reconnect).")
    if not hasattr(driver, "browse"):
        raise HTTPException(status_code=400, detail="Driver does not support browsing")

    result = await driver.browse(target_path)
    return result


@router.get("/{connection_id}/opc-da/scan")
async def scan_opc_da_tags(connection_id: int, path: Optional[str] = None, max_tags: int = 500):
    """Recursively scan all tags under path for an OPC DA connection."""
    dm = DriverManager()
    driver = dm.get_driver(connection_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Connection driver not active. Vui lòng bấm Kết nối lại (Reconnect).")
    if not hasattr(driver, "scan_all"):
        raise HTTPException(status_code=400, detail="Driver does not support scanning")

    tags = await driver.scan_all(path, max_tags=max_tags)
    return {"connection_id": connection_id, "path": path or "", "count": len(tags), "tags": tags}


# ------------------------------------------------------------------
# OPC UA specific helper endpoints
# ------------------------------------------------------------------

@router.get("/{connection_id}/opcua/browse")
async def browse_opcua(connection_id: int, node_id: Optional[str] = None):
    """Browse child objects and variables of a node for an OPC-UA connection."""
    dm = DriverManager()
    driver = dm.get_driver(connection_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Connection driver not active. Vui lòng bấm Kết nối lại (Reconnect).")
    if not hasattr(driver, "browse"):
        raise HTTPException(status_code=400, detail="Driver does not support browsing")

    result = await driver.browse(node_id)
    return result


@router.get("/{connection_id}/opcua/scan")
async def scan_opcua_tags(connection_id: int, node_id: Optional[str] = None, max_tags: int = 500):
    """Recursively scan all variable tags under node_id for an OPC-UA connection."""
    dm = DriverManager()
    driver = dm.get_driver(connection_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Connection driver not active. Vui lòng bấm Kết nối lại (Reconnect).")
    if not hasattr(driver, "scan_all"):
        raise HTTPException(status_code=400, detail="Driver does not support scanning")

    tags = await driver.scan_all(node_id, max_tags=max_tags)
    return {"connection_id": connection_id, "node_id": node_id or "i=85", "count": len(tags), "tags": tags}
