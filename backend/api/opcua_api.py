"""
API endpoints for OPC-UA Server configuration and status.
"""

from __future__ import annotations

import logging
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.opcua_server import OpcUaServerService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/opcua", tags=["opcua"])


class OpcUaConfigModel(BaseModel):
    port: int = Field(default=4840, ge=1024, le=65535)
    endpoint: Optional[str] = None
    security_mode: str = Field(default="None")  # "None", "Sign", "SignAndEncrypt"
    require_auth: bool = False
    username: str = "admin"
    password: str = "password123"
    server_name: str = "Industrial Gateway OPC-UA Server"
    enabled: bool = True


@router.get("/config")
async def get_opcua_config():
    """Return the current OPC-UA server configuration and status."""
    service = OpcUaServerService()
    cfg = service.config
    return {
        **cfg,
        "running": service._running,
        "nodes_count": len(service._nodes),
        "last_error": getattr(service, "_last_error", None),
        "auto_fallback": getattr(service, "_auto_fallback", False),
    }


@router.put("/config")
async def update_opcua_config(payload: OpcUaConfigModel):
    """Update OPC-UA server configuration and restart the service."""
    service = OpcUaServerService()
    data = payload.model_dump()
    data["endpoint"] = f"opc.tcp://0.0.0.0:{payload.port}/freeopcua/server/"
    updated = service.update_config(data)
    
    # Restart server with new config
    restarted = await service.restart()
    msg = (
        "Cập nhật cấu hình và khởi động lại OPC-UA Server thành công!"
        if restarted
        else (getattr(service, "_last_error", None) or "Không thể khởi động OPC-UA Server.")
    )
    return {
        **updated,
        "running": restarted,
        "nodes_count": len(service._nodes),
        "last_error": getattr(service, "_last_error", None),
        "auto_fallback": getattr(service, "_auto_fallback", False),
        "message": msg,
    }


@router.post("/start")
async def start_opcua():
    """Manually start OPC-UA Server."""
    service = OpcUaServerService()
    res = await service.start()
    return {
        "running": res,
        "port": service.config.get("port", 4840),
        "last_error": getattr(service, "_last_error", None),
        "auto_fallback": getattr(service, "_auto_fallback", False),
        "message": "Đã khởi động OPC-UA Server" if res else (getattr(service, "_last_error", None) or "Khởi động thất bại"),
    }


@router.post("/stop")
async def stop_opcua():
    """Manually stop OPC-UA Server."""
    service = OpcUaServerService()
    await service.stop()
    return {"running": False, "message": "Đã dừng OPC-UA Server"}
