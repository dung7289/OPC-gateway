"""
System API – Project Backup / Restore (Kepware .opf-style single-file export/import)
and Windows Auto-Start management (Registry HKCU Run + hidden console launcher).
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.logs import add_log
from api.tags import _EXTRA_COLS, _EXTRA_COLS_SQL, _EXTRA_PLACEHOLDERS, _extra_from_row
from core.data_logger import DataLogger
from core.driver_manager import DriverManager
from core.forward_engine import ForwardEngine
from core.opcua_server import OpcUaServerService
from core.tag_engine import TagEngine
from core.usr_m100_service import UsrM100Service
from db.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/system", tags=["system"])

_RUN_KEY_PATH = r"Software\Microsoft\Windows\CurrentVersion\Run"
_RUN_VALUE_NAME = "IndustrialGateway"


def _app_base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).parent.parent


# ---------------------------------------------------------------------------
# Backup & Restore
# ---------------------------------------------------------------------------

@router.get("/backup")
async def export_project_backup():
    """Export complete gateway configuration (connections, folders, tags, services) as one JSON bundle."""
    async with get_db() as db:
        async with db.execute("SELECT * FROM connections ORDER BY id") as cur:
            conns = [dict(r) for r in await cur.fetchall()]
        async with db.execute("SELECT * FROM tag_groups ORDER BY id") as cur:
            groups = [dict(r) for r in await cur.fetchall()]
        async with db.execute("SELECT * FROM tags ORDER BY id") as cur:
            tags = [dict(r) for r in await cur.fetchall()]

    return {
        "version": "1.0.0",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "connections": conns,
        "tag_groups": groups,
        "tags": tags,
        "opcua_config": OpcUaServerService().config,
        "forward_config": ForwardEngine().config,
        "logger_config": DataLogger().config,
        "usr_m100_config": UsrM100Service().config,
    }


class RestoreProjectRequest(BaseModel):
    mode: Literal["replace", "merge"] = "replace"
    data: Dict[str, Any]


@router.post("/restore")
async def restore_project_backup(payload: RestoreProjectRequest):
    """Restore connections, folders, tags, and service configs from a JSON backup."""
    bundle = payload.data or {}
    conns = bundle.get("connections") or []
    groups = bundle.get("tag_groups") or []
    tags = bundle.get("tags") or []

    if not isinstance(conns, list) or not isinstance(tags, list):
        raise HTTPException(status_code=400, detail="File backup không đúng định dạng")

    conn_id_map: Dict[int, int] = {}
    tag_id_map: Dict[int, int] = {}
    restored_conns = 0
    restored_groups = 0
    restored_tags = 0

    async with get_db() as db:
        if payload.mode == "replace":
            await db.execute("DELETE FROM tags")
            await db.execute("DELETE FROM tag_groups")
            await db.execute("DELETE FROM connections")

        for c in conns:
            old_id = c.get("id")
            cname = (c.get("name") or "").strip()
            if not cname:
                continue

            async with db.execute("SELECT id FROM connections WHERE name = ?", (cname,)) as cur:
                existing = await cur.fetchone()

            if existing:
                conn_id_map[old_id] = existing["id"]
                continue

            cur = await db.execute(
                "INSERT INTO connections (name, protocol, host, port, config_json, enabled) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    cname,
                    c.get("protocol", "modbus_tcp"),
                    c.get("host"),
                    c.get("port"),
                    c.get("config_json") or json.dumps(c.get("config") or {}),
                    int(c.get("enabled", 1)),
                ),
            )
            conn_id_map[old_id] = cur.lastrowid
            restored_conns += 1

        for g in groups:
            new_cid = conn_id_map.get(g.get("connection_id"))
            gname = (g.get("name") or "").strip()
            if not new_cid or not gname:
                continue
            cur = await db.execute(
                "INSERT OR IGNORE INTO tag_groups (connection_id, name, description) VALUES (?, ?, ?)",
                (new_cid, gname, g.get("description") or ""),
            )
            restored_groups += cur.rowcount

        for t in tags:
            old_tid = t.get("id")
            new_cid = conn_id_map.get(t.get("connection_id"))
            tname = (t.get("name") or "").strip()
            addr = (t.get("address") or "").strip()
            if not new_cid or not tname or not addr:
                continue

            tgrp = (t.get("tag_group") or "").strip()
            if payload.mode == "merge":
                async with db.execute(
                    "SELECT id FROM tags WHERE connection_id = ? AND COALESCE(tag_group, '') = ? AND name = ?",
                    (new_cid, tgrp, tname),
                ) as cur:
                    existing_tag = await cur.fetchone()
                    if existing_tag is not None:
                        if old_tid is not None:
                            tag_id_map[int(old_tid)] = int(existing_tag["id"])
                        continue

            cur = await db.execute(
                "INSERT OR IGNORE INTO tags (connection_id, name, address, data_type, scan_rate_ms, enabled, description, tag_group, "
                + _EXTRA_COLS_SQL + ") "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, " + _EXTRA_PLACEHOLDERS + ")",
                (
                    new_cid,
                    tname,
                    addr,
                    t.get("data_type", "float32"),
                    int(t.get("scan_rate_ms", 100)),
                    int(t.get("enabled", 1)),
                    t.get("description") or "",
                    tgrp,
                    *_extra_from_row(t),
                ),
            )
            if cur.lastrowid and old_tid is not None:
                tag_id_map[int(old_tid)] = int(cur.lastrowid)
            restored_tags += 1

        await db.commit()

    # Restore optional service configs
    if isinstance(bundle.get("opcua_config"), dict):
        opc = OpcUaServerService()
        opc.update_config(bundle["opcua_config"])
        await opc.restart()

    if isinstance(bundle.get("forward_config"), dict):
        fwd_raw = dict(bundle["forward_config"])
        if isinstance(fwd_raw.get("connection_ids"), list):
            fwd_raw["connection_ids"] = [
                conn_id_map.get(int(cid), int(cid))
                for cid in fwd_raw["connection_ids"]
                if cid is not None
            ]
        fe = ForwardEngine()
        fe.update_config(fwd_raw)
        if fe.config.get("enabled"):
            await fe.restart()
        else:
            await fe.stop()

    if isinstance(bundle.get("logger_config"), dict):
        dl = DataLogger()
        dl.update_config(bundle["logger_config"])
        if dl.config.get("enabled"):
            await dl.restart()
        else:
            await dl.stop()

    if isinstance(bundle.get("usr_m100_config"), dict):
        m100_raw = json.loads(json.dumps(bundle["usr_m100_config"]))
        for dev in m100_raw.get("devices") or []:
            old_dcid = dev.get("connection_id")
            if old_dcid in conn_id_map:
                dev["connection_id"] = conn_id_map[old_dcid]
            for pt in dev.get("points") or []:
                for id_field in ("source_tag_id", "feedback_tag_id"):
                    old_ref = pt.get(id_field)
                    if old_ref is not None:
                        try:
                            pt[id_field] = tag_id_map.get(int(old_ref), int(old_ref))
                        except (TypeError, ValueError):
                            pass
        UsrM100Service().update_config(m100_raw)

    # Reload drivers and polling engine without blocking HTTP response on offline PLC timeouts
    if payload.mode == "replace" or restored_conns > 0:
        async def _reload_all():
            try:
                dm = DriverManager()
                await dm.stop()
                await dm.start()
                await TagEngine().reload()
            except Exception as exc:
                logger.error("Background reload after restore failed: %s", exc)
        asyncio.create_task(_reload_all())
    elif restored_tags > 0:
        await TagEngine().reload()

    msg = f"Khôi phục ({payload.mode}) thành công: {restored_conns} kênh, {restored_groups} thư mục, {restored_tags} tag"
    await add_log("INFO", "system", msg)
    return {
        "connections": restored_conns,
        "tag_groups": restored_groups,
        "tags": restored_tags,
        "message": msg,
    }


# ---------------------------------------------------------------------------
# Windows Auto-Start (HKCU Run + Hidden VBS Launcher)
# ---------------------------------------------------------------------------

def _ensure_hidden_launcher(base_dir: Path) -> Path:
    """Create start_hidden.vbs beside the app so Auto-Start runs without popping a console window."""
    vbs_path = base_dir / "start_hidden.vbs"
    if getattr(sys, "frozen", False):
        target_cmd = f'"""{sys.executable}"""'
    else:
        py_exe = Path(sys.executable)
        pyw = py_exe.parent / "pythonw.exe"
        runner = pyw if pyw.exists() else py_exe
        main_py = base_dir / "main.py"
        target_cmd = f'"""{runner}"" ""{main_py}"""'

    vbs_content = (
        'Set WshShell = CreateObject("WScript.Shell")\n'
        f'WshShell.CurrentDirectory = "{base_dir}"\n'
        f"WshShell.Run {target_cmd}, 0, False\n"
    )
    vbs_path.write_text(vbs_content, encoding="utf-8")
    return vbs_path


def _read_autostart_state() -> Dict[str, Any]:
    if sys.platform != "win32":
        return {"supported": False, "enabled": False, "command": None, "detail": "Chỉ hỗ trợ trên Windows"}
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY_PATH, 0, winreg.KEY_READ) as key:
            val, _ = winreg.QueryValueEx(key, _RUN_VALUE_NAME)
            return {"supported": True, "enabled": True, "command": val, "detail": "Đã bật tự khởi động cùng Windows"}
    except FileNotFoundError:
        return {"supported": True, "enabled": False, "command": None, "detail": "Chưa bật tự khởi động"}
    except Exception as exc:
        return {"supported": False, "enabled": False, "command": None, "detail": str(exc)}


class AutoStartToggle(BaseModel):
    enabled: bool


@router.get("/autostart")
async def get_autostart():
    """Check whether Industrial Gateway is registered in HKCU Windows Startup."""
    return _read_autostart_state()


@router.post("/autostart")
async def set_autostart(payload: AutoStartToggle):
    """Enable or disable hidden background Auto-Start via Windows Registry (HKCU Run)."""
    if sys.platform != "win32":
        raise HTTPException(status_code=400, detail="Chức năng Auto-Start Registry chỉ hỗ trợ Windows")

    try:
        import winreg
        base_dir = _app_base_dir()
        if payload.enabled:
            vbs_path = _ensure_hidden_launcher(base_dir)
            cmd = f'wscript.exe "{vbs_path}"'
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY_PATH, 0, winreg.KEY_SET_VALUE) as key:
                winreg.SetValueEx(key, _RUN_VALUE_NAME, 0, winreg.REG_SZ, cmd)
            msg = "Đã bật tự động chạy ngầm khi mở Windows!"
        else:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY_PATH, 0, winreg.KEY_SET_VALUE) as key:
                try:
                    winreg.DeleteValue(key, _RUN_VALUE_NAME)
                except FileNotFoundError:
                    pass
            msg = "Đã tắt tự khởi động cùng Windows."
        await add_log("INFO", "system", msg)
        return {**_read_autostart_state(), "message": msg}
    except Exception as exc:
        logger.error("set_autostart error: %s", exc)
        raise HTTPException(status_code=500, detail=f"Không thể ghi Windows Registry: {exc}")
