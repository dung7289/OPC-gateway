"""
API endpoints for IoT Gateway (ForwardEngine) configuration, lifecycle, and testing.
"""

from __future__ import annotations

from typing import List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

from core.forward_engine import ForwardEngine

router = APIRouter(prefix="/api/forward", tags=["forward"])


class MqttForwardConfig(BaseModel):
    enabled: bool = False
    host: str = "127.0.0.1"
    port: int = Field(default=1883, ge=1, le=65535)
    username: str = ""
    password: str = ""
    topic_prefix: str = "gateway"
    qos: int = Field(default=0, ge=0, le=2)


class WebhookForwardConfig(BaseModel):
    enabled: bool = False
    url: str = ""
    method: str = "POST"
    auth_header: str = ""


class ForwardConfigModel(BaseModel):
    enabled: bool = False
    publish_interval_seconds: float = Field(default=5.0, ge=0.5, le=3600.0)
    connection_ids: List[int] = Field(default_factory=list)
    mqtt: MqttForwardConfig = Field(default_factory=MqttForwardConfig)
    webhook: WebhookForwardConfig = Field(default_factory=WebhookForwardConfig)


@router.get("/config")
async def get_forward_config():
    """Return current IoT Gateway forwarding config and live runtime status."""
    return ForwardEngine().get_status()


@router.put("/config")
async def update_forward_config(payload: ForwardConfigModel):
    """Save IoT Gateway forwarding config and restart the service if enabled."""
    fe = ForwardEngine()
    fe.update_config(payload.model_dump())
    if payload.enabled:
        await fe.restart()
    else:
        await fe.stop()
    status = fe.get_status()
    status["message"] = (
        "Đã lưu cấu hình và khởi động IoT Gateway!"
        if payload.enabled
        else "Đã lưu cấu hình (IoT Gateway đang tắt)."
    )
    return status


@router.post("/start")
async def start_forward():
    fe = ForwardEngine()
    cfg = dict(fe.config)
    cfg["enabled"] = True
    fe.update_config(cfg)
    started = await fe.start()
    return {**fe.get_status(), "message": "IoT Gateway đã khởi động!" if started else "Không thể khởi động IoT Gateway."}


@router.post("/stop")
async def stop_forward():
    fe = ForwardEngine()
    cfg = dict(fe.config)
    cfg["enabled"] = False
    fe.update_config(cfg)
    await fe.stop()
    return {**fe.get_status(), "message": "Đã dừng IoT Gateway."}


@router.post("/test")
async def test_forward():
    """Trigger one immediate publish cycle and report result."""
    fe = ForwardEngine()
    result = await fe.publish_once()
    return {
        **result,
        "message": (
            f"Đã gửi thử thành công ({result['tags_count']} tag | MQTT: {result['sent_mqtt']} | Webhook: {'OK' if result['sent_webhook'] else 'Off'})"
            if result["ok"]
            else f"Gửi thử có lỗi: {result['error']}"
        ),
    }
