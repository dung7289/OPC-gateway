"""
USR-M100 Buffer & MQTT Control Service.

Acts as a control buffer between SCADA / Web UI / TagEngine and PUSR USR-M100
IoT devices over MQTT:
  - Builds official PUSR `rw_prot` payloads (`Ver: "1.0.1"`, `dir: "down"`,
    `id`, `w_data`, `r_data`, auto-chunked at max 5 items per packet) or `flat_json`
    payloads (`{"DO1": 1}`).
  - Stores device profiles & buffered setpoints in `usr_m100_config.json`.
  - Tracks `dir: "up"` ACK responses from `pub_topic` to match `id` and `err`.
  - Optionally auto-publishes buffered commands when linked `source_tag_id` values change.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

if getattr(sys, "frozen", False):
    CONFIG_PATH = Path(sys.executable).parent / "usr_m100_config.json"
else:
    CONFIG_PATH = Path(__file__).parent.parent / "usr_m100_config.json"

MAX_POINTS_PER_PACKET = 5
MAX_HISTORY_ITEMS = 100


def _format_point_value(value: Any, data_type: str, value_as_string: bool) -> Any:
    """Normalize and format a point value according to data_type and value_as_string."""
    dt = (data_type or "string").strip().lower()
    if dt == "bool":
        if isinstance(value, bool):
            num = 1 if value else 0
        elif isinstance(value, (int, float)):
            num = 1 if value != 0 else 0
        else:
            num = 1 if str(value).strip().lower() in ("1", "true", "on", "yes", "bat", "bật") else 0
        return str(num) if value_as_string else num

    if dt == "int":
        try:
            num = int(round(float(value)))
        except (TypeError, ValueError):
            raise ValueError(f"Giá trị số nguyên không hợp lệ: {value!r}")
        return str(num) if value_as_string else num

    if dt == "float":
        try:
            num = round(float(value), 6)
        except (TypeError, ValueError):
            raise ValueError(f"Giá trị số thực không hợp lệ: {value!r}")
        return f"{num:g}" if value_as_string else num

    return "" if value is None else str(value)


def build_payloads(
    payload_mode: str,
    ver: str,
    value_as_string: bool,
    w_items: List[Dict[str, Any]],
    r_items: List[str],
    msg_id: Optional[str] = None,
) -> List[Tuple[str, Dict[str, Any]]]:
    """
    Build one or more MQTT JSON payloads in `rw_prot` (auto-chunked max 5 points)
    or `flat_json` format. Returns list of `(chunk_msg_id, payload_dict)`.
    """
    mode = (payload_mode or "rw_prot").strip().lower()
    base_id = str(msg_id or (int(time.time() * 1000) % 1000000))

    clean_w = [
        {
            "name": str(it["name"]).strip(),
            "value": it.get("value"),
            "data_type": it.get("data_type", "string"),
        }
        for it in (w_items or [])
        if str(it.get("name") or "").strip()
    ]
    clean_r = [str(n).strip() for n in (r_items or []) if str(n or "").strip()]

    if mode == "flat_json":
        if not clean_w:
            if clean_r:
                raise ValueError("Chế độ JSON phẳng không hỗ trợ truy vấn r_data; hãy chuyển sang rw_prot")
            raise ValueError("Chưa có điểm dữ liệu nào để Publish")
        flat_obj: Dict[str, Any] = {}
        for it in clean_w:
            flat_obj[it["name"]] = _format_point_value(it["value"], it["data_type"], value_as_string)
        return [(base_id, flat_obj)]

    # rw_prot (PUSR USR-M100 standard, up to 5 items per array per packet)
    w_chunks = [clean_w[i : i + MAX_POINTS_PER_PACKET] for i in range(0, len(clean_w), MAX_POINTS_PER_PACKET)]
    r_chunks = [clean_r[i : i + MAX_POINTS_PER_PACKET] for i in range(0, len(clean_r), MAX_POINTS_PER_PACKET)]
    total = max(len(w_chunks), len(r_chunks))
    if total == 0:
        raise ValueError("Chưa có điểm dữ liệu w_data hoặc r_data nào để đóng gói")

    packets: List[Tuple[str, Dict[str, Any]]] = []
    ver_str = (ver or "1.0.1").strip() or "1.0.1"

    for idx in range(total):
        cid = base_id if total == 1 else f"{base_id}_{idx + 1}"
        rw_body: Dict[str, Any] = {
            "Ver": ver_str,
            "dir": "down",
            "id": cid,
        }
        if idx < len(r_chunks) and r_chunks[idx]:
            rw_body["r_data"] = [{"name": n} for n in r_chunks[idx]]
        if idx < len(w_chunks) and w_chunks[idx]:
            rw_body["w_data"] = [
                {
                    "name": it["name"],
                    "value": _format_point_value(it["value"], it["data_type"], value_as_string),
                }
                for it in w_chunks[idx]
            ]
        packets.append((cid, {"rw_prot": rw_body}))

    return packets


def _values_differ(
    new_val: Any,
    prev_val: Any,
    data_type: str,
    value_as_string: bool,
    deadband: float = 0.0,
) -> bool:
    """Return True when new_val differs from prev_val (respecting data_type and deadband)."""
    if prev_val is None:
        return True
    dt = (data_type or "string").strip().lower()
    try:
        n_new = _format_point_value(new_val, dt, False)
        n_prev = _format_point_value(prev_val, dt, False)
    except ValueError:
        return True
    if dt in ("int", "float") and float(deadband or 0.0) > 0.0:
        return abs(float(n_new) - float(n_prev)) >= float(deadband)
    return _format_point_value(new_val, dt, value_as_string) != _format_point_value(
        prev_val, dt, value_as_string
    )


def _normalize_device_dict(raw: Dict[str, Any], existing_id: Optional[str] = None) -> Dict[str, Any]:
    points_out: List[Dict[str, Any]] = []
    seen_names: set[str] = set()
    for pt in raw.get("points") or []:
        pname = str(pt.get("name") or "").strip()
        if not pname or pname in seen_names:
            continue
        seen_names.add(pname)
        dt = str(pt.get("data_type") or "bool").strip().lower()
        if dt not in ("bool", "int", "float", "string"):
            dt = "string"
        buf = pt.get("buffered_value")
        if buf is None:
            buf = 0 if dt in ("bool", "int", "float") else ""
        fb_id = pt.get("feedback_tag_id")
        src_id = pt.get("source_tag_id")
        try:
            db_val = max(0.0, float(pt.get("deadband") or 0.0))
        except (TypeError, ValueError):
            db_val = 0.0
        points_out.append({
            "name": pname,
            "label": str(pt.get("label") or pname).strip(),
            "data_type": dt,
            "buffered_value": buf,
            "last_sent_value": pt.get("last_sent_value"),
            "deadband": db_val,
            "feedback_tag_id": int(fb_id) if fb_id not in (None, "") else None,
            "source_tag_id": int(src_id) if src_id not in (None, "") else None,
        })

    mode = str(raw.get("payload_mode") or "rw_prot").strip().lower()
    if mode not in ("rw_prot", "flat_json"):
        mode = "rw_prot"

    return {
        "id": str(existing_id or raw.get("id") or uuid.uuid4().hex[:8]),
        "name": str(raw.get("name") or "").strip(),
        "connection_id": int(raw["connection_id"]),
        "sub_topic": str(raw.get("sub_topic") or "").strip(),
        "pub_topic": str(raw.get("pub_topic") or "").strip(),
        "payload_mode": mode,
        "ver": str(raw.get("ver") or "1.0.1").strip() or "1.0.1",
        "value_as_string": bool(raw.get("value_as_string", True)),
        "include_rdata_on_write": bool(raw.get("include_rdata_on_write", False)),
        "qos": max(0, min(2, int(raw.get("qos", 0)))),
        "retain": bool(raw.get("retain", False)),
        "auto_sync_enabled": bool(raw.get("auto_sync_enabled", True)),
        "points": points_out,
    }


class UsrM100Service:
    """Singleton managing USR-M100 device buffers, MQTT commands, ACK tracking, and Auto-Sync."""

    _instance: Optional["UsrM100Service"] = None

    def __new__(cls) -> "UsrM100Service":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._running = False
            cls._instance._task: Optional[asyncio.Task] = None
            cls._instance._config: Dict[str, Any] = cls._load_config()
            cls._instance._history: List[Dict[str, Any]] = []
            cls._instance._last_synced: Dict[Tuple[str, str], Any] = {}
            cls._instance._last_resp_ts: Dict[str, float] = {}
            cls._instance._last_failed_sync_ts: Dict[str, float] = {}
            cls._instance._config_dirty: bool = False
            cls._instance._last_disk_save_ts: float = 0.0
        return cls._instance

    @property
    def config(self) -> Dict[str, Any]:
        return self._config

    def update_config(self, cfg: Dict[str, Any]) -> Dict[str, Any]:
        devices = [
            _normalize_device_dict(d, existing_id=d.get("id"))
            for d in (cfg.get("devices") or [])
            if d.get("connection_id") is not None and str(d.get("name") or "").strip()
        ]
        self._config = {"devices": devices}
        self._save_config(self._config)
        return self._config

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._monitor_loop())
        logger.info("UsrM100Service started (%d device profile(s))", len(self._config.get("devices", [])))

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        self._flush_dirty_config(force=True)
        logger.info("UsrM100Service stopped")

    def _mark_config_dirty(self, force: bool = False) -> None:
        self._config_dirty = True
        if force:
            self._flush_dirty_config(force=True)

    def _flush_dirty_config(self, force: bool = False) -> None:
        if not getattr(self, "_config_dirty", False):
            return
        now_m = time.monotonic()
        last_ts = getattr(self, "_last_disk_save_ts", 0.0)
        if force or (now_m - last_ts >= 15.0):
            self._save_config(self._config)
            self._config_dirty = False
            self._last_disk_save_ts = now_m

    # ------------------------------------------------------------------
    # Device CRUD & Buffer management
    # ------------------------------------------------------------------

    def list_devices(self) -> List[Dict[str, Any]]:
        return list(self._config.get("devices", []))

    def get_device(self, device_id: str) -> Optional[Dict[str, Any]]:
        for d in self._config.get("devices", []):
            if d["id"] == device_id:
                return d
        return None

    def create_device(self, data: Dict[str, Any]) -> Dict[str, Any]:
        dev = _normalize_device_dict(data)
        self._config.setdefault("devices", []).append(dev)
        self._save_config(self._config)
        return dev

    def update_device(self, device_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        devices = self._config.get("devices", [])
        for idx, existing in enumerate(devices):
            if existing["id"] == device_id:
                merged = {**existing, **data}
                dev = _normalize_device_dict(merged, existing_id=device_id)
                devices[idx] = dev
                self._save_config(self._config)
                # Reset auto-sync baseline for this device so edits don't misfire
                for k in [k for k in self._last_synced if k[0] == device_id]:
                    self._last_synced.pop(k, None)
                return dev
        return None

    def delete_device(self, device_id: str) -> bool:
        devices = self._config.get("devices", [])
        new_list = [d for d in devices if d["id"] != device_id]
        if len(new_list) == len(devices):
            return False
        self._config["devices"] = new_list
        self._save_config(self._config)
        for k in [k for k in self._last_synced if k[0] == device_id]:
            self._last_synced.pop(k, None)
        return True

    def update_buffer(self, device_id: str, values: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        dev = self.get_device(device_id)
        if not dev:
            return None
        for pt in dev.get("points", []):
            if pt["name"] in values:
                pt["buffered_value"] = values[pt["name"]]
        self._save_config(self._config)
        return dev

    # ------------------------------------------------------------------
    # Command Publish & Query
    # ------------------------------------------------------------------

    async def publish_device(
        self,
        device_id: str,
        items: Optional[List[Dict[str, Any]]] = None,
        point_names: Optional[List[str]] = None,
        include_rdata: Optional[bool] = None,
        msg_id: Optional[str] = None,
        dry_run: bool = False,
        only_changed: bool = False,
        trigger: str = "manual",
    ) -> Dict[str, Any]:
        dev = self.get_device(device_id)
        if not dev:
            raise KeyError(f"Không tìm thấy thiết bị USR-M100 '{device_id}'")

        pt_map = {p["name"]: p for p in dev.get("points", [])}

        # Resolve w_items and persist explicit buffered writes
        resolved_w: List[Dict[str, Any]] = []
        if items is not None:
            dirty = False
            for it in items:
                pname = str(it.get("name") or "").strip()
                if not pname:
                    continue
                pt_def = pt_map.get(pname)
                dt = it.get("data_type") or (pt_def["data_type"] if pt_def else "string")
                val = it.get("value")
                resolved_w.append({"name": pname, "value": val, "data_type": dt})
                if pt_def is not None and pt_def.get("buffered_value") != val:
                    pt_def["buffered_value"] = val
                    dirty = True
            if dirty:
                self._mark_config_dirty(force=(trigger != "auto_sync"))
        else:
            selected_set = set(point_names) if point_names else None
            for pt in dev.get("points", []):
                if selected_set is not None and pt["name"] not in selected_set:
                    continue
                resolved_w.append({
                    "name": pt["name"],
                    "value": pt.get("buffered_value"),
                    "data_type": pt.get("data_type", "string"),
                })

        total_candidates = len(resolved_w)
        skipped_count = 0
        if only_changed and total_candidates > 0:
            filtered_w: List[Dict[str, Any]] = []
            for w in resolved_w:
                pt_def = pt_map.get(w["name"])
                if pt_def is None:
                    filtered_w.append(w)
                    continue
                if _values_differ(
                    w["value"],
                    pt_def.get("last_sent_value"),
                    w["data_type"],
                    dev["value_as_string"],
                    pt_def.get("deadband", 0.0),
                ):
                    filtered_w.append(w)
            skipped_count = total_candidates - len(filtered_w)
            resolved_w = filtered_w

        if only_changed and len(resolved_w) == 0:
            return {
                "ok": True,
                "dry_run": dry_run,
                "sent": 0,
                "skipped": skipped_count,
                "topic": dev["sub_topic"],
                "packets": [],
                "message": "Giá trị không thay đổi — không gửi lệnh xuống USR-M100",
            }

        use_rdata = dev.get("include_rdata_on_write", False) if include_rdata is None else bool(include_rdata)
        r_list = [w["name"] for w in resolved_w] if (use_rdata and dev["payload_mode"] == "rw_prot") else []

        packets = build_payloads(
            payload_mode=dev["payload_mode"],
            ver=dev["ver"],
            value_as_string=dev["value_as_string"],
            w_items=resolved_w,
            r_items=r_list,
            msg_id=msg_id,
        )

        if dry_run:
            return {
                "ok": True,
                "dry_run": True,
                "sent": 0,
                "skipped": skipped_count,
                "topic": dev["sub_topic"],
                "packets": [{"msg_id": cid, "payload": pkt} for cid, pkt in packets],
                "message": f"Xem trước {len(packets)} gói tin sẵn sàng gửi tới {dev['sub_topic']}",
            }

        res = await self._dispatch_packets(
            connection_id=dev["connection_id"],
            topic=dev["sub_topic"],
            pub_topic=dev.get("pub_topic", ""),
            qos=dev.get("qos", 0),
            retain=dev.get("retain", False),
            payload_mode=dev["payload_mode"],
            packets=packets,
            device_id=dev["id"],
            device_name=dev["name"],
            trigger=trigger,
        )

        if res.get("ok"):
            updated_last = False
            for w in resolved_w:
                pt_def = pt_map.get(w["name"])
                try:
                    scalar_val = _format_point_value(w["value"], w["data_type"], False)
                except ValueError:
                    scalar_val = w["value"]
                self._last_synced[(device_id, w["name"])] = scalar_val
                if pt_def is not None:
                    pt_def["last_sent_value"] = scalar_val
                    updated_last = True
            if updated_last:
                self._mark_config_dirty(force=(trigger != "auto_sync"))

        res["skipped"] = skipped_count
        return res

    async def query_device(
        self,
        device_id: str,
        point_names: Optional[List[str]] = None,
        msg_id: Optional[str] = None,
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        dev = self.get_device(device_id)
        if not dev:
            raise KeyError(f"Không tìm thấy thiết bị USR-M100 '{device_id}'")
        if dev["payload_mode"] != "rw_prot":
            raise ValueError("Chỉ chế độ rw_prot mới hỗ trợ lệnh truy vấn r_data")

        selected = [p["name"] for p in dev.get("points", []) if not point_names or p["name"] in point_names]
        packets = build_payloads(
            payload_mode="rw_prot",
            ver=dev["ver"],
            value_as_string=dev["value_as_string"],
            w_items=[],
            r_items=selected,
            msg_id=msg_id,
        )

        if dry_run:
            return {
                "ok": True,
                "dry_run": True,
                "topic": dev["sub_topic"],
                "packets": [{"msg_id": cid, "payload": pkt} for cid, pkt in packets],
                "message": f"Xem trước {len(packets)} gói truy vấn r_data",
            }

        return await self._dispatch_packets(
            connection_id=dev["connection_id"],
            topic=dev["sub_topic"],
            pub_topic=dev.get("pub_topic", ""),
            qos=dev.get("qos", 0),
            retain=False,
            payload_mode="rw_prot",
            packets=packets,
            device_id=dev["id"],
            device_name=dev["name"],
            trigger="query",
        )

    async def publish_raw_adhoc(
        self,
        connection_id: int,
        topic: str,
        payload_mode: str = "rw_prot",
        ver: str = "1.0.1",
        value_as_string: bool = True,
        qos: int = 0,
        retain: bool = False,
        w_items: Optional[List[Dict[str, Any]]] = None,
        r_items: Optional[List[str]] = None,
        msg_id: Optional[str] = None,
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        packets = build_payloads(
            payload_mode=payload_mode,
            ver=ver,
            value_as_string=value_as_string,
            w_items=w_items or [],
            r_items=r_items or [],
            msg_id=msg_id,
        )

        if dry_run:
            return {
                "ok": True,
                "dry_run": True,
                "topic": topic,
                "packets": [{"msg_id": cid, "payload": pkt} for cid, pkt in packets],
                "message": f"Xem trước {len(packets)} gói tin JSON",
            }

        return await self._dispatch_packets(
            connection_id=int(connection_id),
            topic=topic,
            pub_topic="",
            qos=qos,
            retain=retain,
            payload_mode=payload_mode,
            packets=packets,
            device_id=None,
            device_name="Quick Publish",
            trigger="adhoc",
        )

    async def _dispatch_packets(
        self,
        connection_id: int,
        topic: str,
        pub_topic: str,
        qos: int,
        retain: bool,
        payload_mode: str,
        packets: List[Tuple[str, Dict[str, Any]]],
        device_id: Optional[str],
        device_name: str,
        trigger: str,
    ) -> Dict[str, Any]:
        from api.logs import add_log
        from core.driver_manager import DriverManager
        from drivers.mqtt_driver import MqttDriver

        driver = DriverManager().get_driver(connection_id)
        topic = (topic or "").strip()

        if not topic:
            return {"ok": False, "sent": 0, "packets": [], "message": "Chưa cấu hình Topic nhận lệnh (sub_topic)"}

        if not isinstance(driver, MqttDriver):
            err = f"Kết nối MQTT ID={connection_id} không khả dụng hoặc chưa bật"
            await add_log("ERROR", "usr_m100", err)
            return {"ok": False, "sent": 0, "packets": [], "message": err}

        if pub_topic:
            driver.subscribe_topic(pub_topic)

        sent = 0
        errors: List[str] = []
        now_iso = datetime.now(timezone.utc).isoformat()

        for cid, pkt in packets:
            payload_str = json.dumps(pkt, ensure_ascii=False)
            ok, err = await driver.publish_raw(topic, payload_str, qos=qos, retain=retain)
            if ok:
                sent += 1
            elif err:
                errors.append(err)

            ack_status = "pending" if (ok and payload_mode == "rw_prot" and pub_topic) else "n/a"
            self._record_history({
                "entry_id": uuid.uuid4().hex[:10],
                "ts": time.time(),
                "iso": now_iso,
                "device_id": device_id,
                "device_name": device_name,
                "topic": topic,
                "msg_id": cid,
                "trigger": trigger,
                "payload": pkt,
                "publish_ok": ok,
                "error": err,
                "ack_status": ack_status,
                "response_payload": None,
                "ack_at": None,
            })

        if errors:
            msg = f"[{device_name}] Lỗi gửi MQTT ({sent}/{len(packets)} gói): {' | '.join(errors)}"
            await add_log("ERROR", "usr_m100", msg)
            return {
                "ok": False,
                "sent": sent,
                "topic": topic,
                "packets": [{"msg_id": cid, "payload": pkt} for cid, pkt in packets],
                "message": msg,
            }

        msg = f"[{device_name}] Đã gửi {sent} gói lệnh tới {topic}"
        await add_log("INFO", "usr_m100", msg)
        return {
            "ok": True,
            "sent": sent,
            "topic": topic,
            "packets": [{"msg_id": cid, "payload": pkt} for cid, pkt in packets],
            "message": msg,
        }

    # ------------------------------------------------------------------
    # History & Monitoring Loop (ACK matching + Auto-Sync)
    # ------------------------------------------------------------------

    def _record_history(self, item: Dict[str, Any]) -> None:
        self._history.insert(0, item)
        if len(self._history) > MAX_HISTORY_ITEMS:
            del self._history[MAX_HISTORY_ITEMS:]

    def get_history(self, device_id: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
        rows = self._history if not device_id else [h for h in self._history if h.get("device_id") == device_id]
        return rows[: max(1, min(limit, MAX_HISTORY_ITEMS))]

    def clear_history(self, device_id: Optional[str] = None) -> int:
        if not device_id:
            n = len(self._history)
            self._history.clear()
            return n
        before = len(self._history)
        self._history = [h for h in self._history if h.get("device_id") != device_id]
        return before - len(self._history)

    async def _monitor_loop(self) -> None:
        while self._running:
            try:
                await asyncio.sleep(0.5)
                await self._poll_acks()
                await self._poll_auto_sync()
                self._flush_dirty_config(force=False)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("UsrM100Service monitor loop error: %s", exc)

    async def _poll_acks(self) -> None:
        from core.driver_manager import DriverManager
        from drivers.mqtt_driver import MqttDriver

        dm = DriverManager()
        for dev in list(self._config.get("devices", [])):
            pub_topic = (dev.get("pub_topic") or "").strip()
            if not pub_topic:
                continue
            driver = dm.get_driver(dev["connection_id"])
            if not isinstance(driver, MqttDriver) or not driver.is_connected():
                continue

            driver.subscribe_topic(pub_topic)
            entry = driver.get_topic_entry(pub_topic)
            if not entry:
                continue
            ts = float(entry.get("timestamp") or 0.0)
            if ts <= self._last_resp_ts.get(pub_topic, 0.0):
                continue
            self._last_resp_ts[pub_topic] = ts

            val = entry.get("value")
            if not isinstance(val, dict) or not isinstance(val.get("rw_prot"), dict):
                continue
            rw = val["rw_prot"]
            if str(rw.get("dir") or "").lower() != "up":
                continue

            resp_id = str(rw.get("id") or "").strip()
            has_error = str(rw.get("err") or "0").strip() not in ("", "0")
            if not has_error:
                for arr_key in ("w_data", "r_data"):
                    for pt_res in rw.get(arr_key) or []:
                        if isinstance(pt_res, dict) and str(pt_res.get("err") or "0").strip() not in ("", "0"):
                            has_error = True
                            break

            ack_iso = datetime.now(timezone.utc).isoformat()
            for hist in self._history:
                if hist.get("device_id") != dev["id"] or hist.get("ack_status") != "pending":
                    continue
                if resp_id and hist.get("msg_id") != resp_id:
                    continue
                hist["ack_status"] = "error" if has_error else "ok"
                hist["response_payload"] = val
                hist["ack_at"] = ack_iso
                break

    async def _poll_auto_sync(self) -> None:
        from core.tag_engine import TagEngine

        engine = TagEngine()
        now_mono = time.monotonic()
        for dev in list(self._config.get("devices", [])):
            dev_id = dev["id"]
            if not dev.get("auto_sync_enabled", False):
                for k in [k for k in self._last_synced if k[0] == dev_id]:
                    self._last_synced.pop(k, None)
                continue

            if now_mono - self._last_failed_sync_ts.get(dev_id, 0.0) < 5.0:
                continue

            changed_items: List[Dict[str, Any]] = []
            pending_updates: List[Tuple[Tuple[str, str], Any]] = []
            baseline_saved = False

            for pt in dev.get("points", []):
                src_id = pt.get("source_tag_id")
                if not src_id:
                    continue
                tv = engine.get_tag_value(int(src_id))
                if not tv or tv.get("quality") != "Good" or tv.get("value") is None:
                    continue

                dt = pt.get("data_type", "string")
                try:
                    norm_val = _format_point_value(tv["value"], dt, False)
                except ValueError:
                    continue

                key = (dev_id, pt["name"])
                if key not in self._last_synced:
                    self._last_synced[key] = norm_val
                    if pt.get("buffered_value") != tv["value"]:
                        pt["buffered_value"] = tv["value"]
                        baseline_saved = True
                    continue

                if _values_differ(
                    tv["value"],
                    self._last_synced[key],
                    dt,
                    dev["value_as_string"],
                    pt.get("deadband", 0.0),
                ):
                    changed_items.append({"name": pt["name"], "value": tv["value"]})
                    pending_updates.append((key, norm_val))

            if baseline_saved:
                self._mark_config_dirty(force=False)

            if changed_items:
                try:
                    res = await self.publish_device(dev_id, items=changed_items, trigger="auto_sync")
                    if res.get("ok"):
                        for k, v in pending_updates:
                            self._last_synced[k] = v
                        self._last_failed_sync_ts.pop(dev_id, None)
                    else:
                        self._last_failed_sync_ts[dev_id] = now_mono
                except Exception as exc:
                    self._last_failed_sync_ts[dev_id] = now_mono
                    logger.warning("Auto-sync USR-M100 [%s] failed: %s", dev.get("name"), exc)

    # ------------------------------------------------------------------
    # Config persistence
    # ------------------------------------------------------------------

    @staticmethod
    def _load_config() -> Dict[str, Any]:
        if not CONFIG_PATH.exists():
            return {"devices": []}
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as fh:
                raw = json.load(fh)
            devices = [
                _normalize_device_dict(d, existing_id=d.get("id"))
                for d in (raw.get("devices") or [])
                if d.get("connection_id") is not None and str(d.get("name") or "").strip()
            ]
            return {"devices": devices}
        except Exception as exc:
            logger.error("UsrM100Service failed to read %s: %s", CONFIG_PATH, exc)
            return {"devices": []}

    @staticmethod
    def _save_config(cfg: Dict[str, Any]) -> None:
        try:
            with open(CONFIG_PATH, "w", encoding="utf-8") as fh:
                json.dump(cfg, fh, indent=2, ensure_ascii=False)
        except Exception as exc:
            logger.error("UsrM100Service failed to write %s: %s", CONFIG_PATH, exc)
