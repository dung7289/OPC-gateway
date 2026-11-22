"""
API endpoints for USR-M100 MQTT Buffer & Control Console.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from core.driver_manager import DriverManager
from core.tag_engine import TagEngine
from core.usr_m100_service import UsrM100Service
from db.database import get_db

router = APIRouter(prefix="/api/usr-m100", tags=["usr_m100"])


class UsrM100PointModel(BaseModel):
    name: str = Field(..., min_length=1)
    label: str = ""
    data_type: Literal["bool", "int", "float", "string"] = "bool"
    buffered_value: Any = 0
    last_sent_value: Any = None
    deadband: float = Field(default=0.0, ge=0.0)
    feedback_tag_id: Optional[int] = None
    source_tag_id: Optional[int] = None


class UsrM100DeviceCreate(BaseModel):
    name: str = Field(..., min_length=1)
    connection_id: int
    sub_topic: str = Field(..., min_length=1)
    pub_topic: str = ""
    payload_mode: Literal["rw_prot", "flat_json"] = "rw_prot"
    ver: str = "1.0.1"
    value_as_string: bool = True
    include_rdata_on_write: bool = False
    qos: int = Field(default=0, ge=0, le=2)
    retain: bool = False
    auto_sync_enabled: bool = True
    points: List[UsrM100PointModel] = Field(default_factory=list)


class UsrM100DeviceUpdate(BaseModel):
    name: Optional[str] = None
    connection_id: Optional[int] = None
    sub_topic: Optional[str] = None
    pub_topic: Optional[str] = None
    payload_mode: Optional[Literal["rw_prot", "flat_json"]] = None
    ver: Optional[str] = None
    value_as_string: Optional[bool] = None
    include_rdata_on_write: Optional[bool] = None
    qos: Optional[int] = Field(default=None, ge=0, le=2)
    retain: Optional[bool] = None
    auto_sync_enabled: Optional[bool] = None
    points: Optional[List[UsrM100PointModel]] = None


class BufferUpdateRequest(BaseModel):
    values: Dict[str, Any]


class WriteItemModel(BaseModel):
    name: str = Field(..., min_length=1)
    value: Any
    data_type: Optional[Literal["bool", "int", "float", "string"]] = None


class PublishDeviceRequest(BaseModel):
    items: Optional[List[WriteItemModel]] = None
    point_names: Optional[List[str]] = None
    include_rdata: Optional[bool] = None
    msg_id: Optional[str] = None
    dry_run: bool = False
    only_changed: bool = False


class QueryDeviceRequest(BaseModel):
    point_names: Optional[List[str]] = None
    msg_id: Optional[str] = None
    dry_run: bool = False


class AdhocPublishRequest(BaseModel):
    connection_id: int
    topic: str = Field(..., min_length=1)
    payload_mode: Literal["rw_prot", "flat_json"] = "rw_prot"
    ver: str = "1.0.1"
    value_as_string: bool = True
    qos: int = Field(default=0, ge=0, le=2)
    retain: bool = False
    w_items: List[WriteItemModel] = Field(default_factory=list)
    r_items: List[str] = Field(default_factory=list)
    msg_id: Optional[str] = None
    dry_run: bool = False


async def _tag_label_map() -> Dict[int, str]:
    async with get_db() as db:
        async with db.execute(
            "SELECT t.id, t.name, t.tag_group, c.name AS conn_name "
            "FROM tags t JOIN connections c ON t.connection_id = c.id"
        ) as cur:
            out: Dict[int, str] = {}
            for r in await cur.fetchall():
                grp = (r["tag_group"] or "").strip()
                path = f"{grp}/{r['name']}" if grp else r["name"]
                out[int(r["id"])] = f"[{r['conn_name']}] {path}"
            return out


async def _enrich_device(
    dev: Dict[str, Any], conn_names: Dict[int, str], tag_labels: Dict[int, str]
) -> Dict[str, Any]:
    dm = DriverManager()
    engine = TagEngine()
    drv = dm.get_driver(dev["connection_id"])
    enriched_pts = []
    for pt in dev.get("points", []):
        fb_val, fb_q = None, None
        src_val, src_q = None, None
        fb_id = pt.get("feedback_tag_id")
        src_id = pt.get("source_tag_id")
        if fb_id:
            tv = engine.get_tag_value(int(fb_id))
            if tv:
                fb_val = tv.get("value")
                fb_q = tv.get("quality")
        if src_id:
            stv = engine.get_tag_value(int(src_id))
            if stv:
                src_val = stv.get("value")
                src_q = stv.get("quality")
        enriched_pts.append({
            **pt,
            "feedback_value": fb_val,
            "feedback_quality": fb_q,
            "feedback_tag_label": tag_labels.get(int(fb_id)) if fb_id else None,
            "source_value": src_val,
            "source_quality": src_q,
            "source_tag_label": tag_labels.get(int(src_id)) if src_id else None,
        })

    return {
        **dev,
        "mqtt_name": conn_names.get(dev["connection_id"], f"Conn #{dev['connection_id']}"),
        "mqtt_connected": bool(drv and drv.is_connected()),
        "points": enriched_pts,
    }


async def _conn_name_map() -> Dict[int, str]:
    async with get_db() as db:
        async with db.execute("SELECT id, name FROM connections") as cur:
            return {int(r["id"]): r["name"] for r in await cur.fetchall()}


@router.get("/devices")
async def list_devices():
    """List saved USR-M100 device profiles with live MQTT status & feedback values."""
    svc = UsrM100Service()
    cnames = await _conn_name_map()
    tlabels = await _tag_label_map()
    return [await _enrich_device(d, cnames, tlabels) for d in svc.list_devices()]


@router.post("/devices")
async def create_device(payload: UsrM100DeviceCreate):
    svc = UsrM100Service()
    dev = svc.create_device(payload.model_dump())
    cnames = await _conn_name_map()
    tlabels = await _tag_label_map()
    return await _enrich_device(dev, cnames, tlabels)


@router.put("/devices/{device_id}")
async def update_device(device_id: str, payload: UsrM100DeviceUpdate):
    svc = UsrM100Service()
    data = {k: v for k, v in payload.model_dump(exclude_unset=True).items()}
    dev = svc.update_device(device_id, data)
    if not dev:
        raise HTTPException(status_code=404, detail="Không tìm thấy trạm USR-M100")
    cnames = await _conn_name_map()
    tlabels = await _tag_label_map()
    return await _enrich_device(dev, cnames, tlabels)


@router.delete("/devices/{device_id}")
async def delete_device(device_id: str):
    svc = UsrM100Service()
    if not svc.delete_device(device_id):
        raise HTTPException(status_code=404, detail="Không tìm thấy trạm USR-M100")
    return {"deleted": True, "message": "Đã xóa trạm USR-M100"}


@router.post("/devices/{device_id}/buffer")
async def update_device_buffer(device_id: str, payload: BufferUpdateRequest):
    svc = UsrM100Service()
    dev = svc.update_buffer(device_id, payload.values)
    if not dev:
        raise HTTPException(status_code=404, detail="Không tìm thấy trạm USR-M100")
    cnames = await _conn_name_map()
    tlabels = await _tag_label_map()
    return await _enrich_device(dev, cnames, tlabels)


@router.post("/devices/{device_id}/publish")
async def publish_device_commands(device_id: str, payload: PublishDeviceRequest):
    svc = UsrM100Service()
    items = [it.model_dump(exclude_none=True) for it in payload.items] if payload.items is not None else None
    try:
        return await svc.publish_device(
            device_id=device_id,
            items=items,
            point_names=payload.point_names,
            include_rdata=payload.include_rdata,
            msg_id=payload.msg_id,
            dry_run=payload.dry_run,
            only_changed=payload.only_changed,
            trigger="manual",
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/devices/{device_id}/query")
async def query_device_points(device_id: str, payload: QueryDeviceRequest):
    svc = UsrM100Service()
    try:
        return await svc.query_device(
            device_id=device_id,
            point_names=payload.point_names,
            msg_id=payload.msg_id,
            dry_run=payload.dry_run,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/publish-raw")
async def publish_raw_adhoc(payload: AdhocPublishRequest):
    svc = UsrM100Service()
    try:
        return await svc.publish_raw_adhoc(
            connection_id=payload.connection_id,
            topic=payload.topic,
            payload_mode=payload.payload_mode,
            ver=payload.ver,
            value_as_string=payload.value_as_string,
            qos=payload.qos,
            retain=payload.retain,
            w_items=[it.model_dump(exclude_none=True) for it in payload.w_items],
            r_items=payload.r_items,
            msg_id=payload.msg_id,
            dry_run=payload.dry_run,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/history")
async def get_command_history(
    device_id: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
):
    return UsrM100Service().get_history(device_id=device_id, limit=limit)


@router.delete("/history")
async def clear_command_history(device_id: Optional[str] = Query(default=None)):
    deleted = UsrM100Service().clear_history(device_id=device_id)
    return {"deleted": deleted, "message": f"Đã xóa {deleted} bản ghi lịch sử lệnh"}
