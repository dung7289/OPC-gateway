"""
ForwardEngine – IoT Gateway Outbound Publisher.

Forwards live TagEngine values to:
1. External MQTT Broker (per-tag topic or JSON payload)
2. HTTP REST Webhook (POST/PUT JSON batch or per-tag payload)

Configuration persisted in forward_config.json.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

if getattr(sys, "frozen", False):
    CONFIG_PATH = Path(sys.executable).parent / "forward_config.json"
else:
    CONFIG_PATH = Path(__file__).parent.parent / "forward_config.json"

DEFAULT_PUBLISH_INTERVAL = 5.0


def _default_config() -> Dict[str, Any]:
    return {
        "enabled": False,
        "publish_interval_seconds": DEFAULT_PUBLISH_INTERVAL,
        "connection_ids": [],  # empty = all enabled connections
        "mqtt": {
            "enabled": False,
            "host": "127.0.0.1",
            "port": 1883,
            "username": "",
            "password": "",
            "topic_prefix": "gateway",
            "qos": 0,
        },
        "webhook": {
            "enabled": False,
            "url": "",
            "method": "POST",
            "auth_header": "",
        },
    }


class ForwardEngine:
    """Singleton IoT Gateway outbound forwarder (MQTT + HTTP Webhook)."""

    _instance: Optional["ForwardEngine"] = None

    def __new__(cls) -> "ForwardEngine":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._running = False
            cls._instance._task: Optional[asyncio.Task] = None
            cls._instance._mqtt_client = None
            cls._instance._mqtt_connected = False
            cls._instance._config: Dict[str, Any] = cls._load_config()
            cls._instance._published_count = 0
            cls._instance._last_publish_at: Optional[str] = None
            cls._instance._last_error: Optional[str] = None
        return cls._instance

    @property
    def config(self) -> Dict[str, Any]:
        return self._config

    def get_status(self) -> Dict[str, Any]:
        return {
            **self._config,
            "running": self._running,
            "mqtt_connected": self._mqtt_connected,
            "published_count": self._published_count,
            "last_publish_at": self._last_publish_at,
            "last_error": self._last_error,
        }

    def update_config(self, new_cfg: Dict[str, Any]) -> Dict[str, Any]:
        merged = _default_config()
        merged.update({
            "enabled": bool(new_cfg.get("enabled", False)),
            "publish_interval_seconds": max(0.5, float(new_cfg.get("publish_interval_seconds", DEFAULT_PUBLISH_INTERVAL))),
            "connection_ids": [int(x) for x in (new_cfg.get("connection_ids") or [])],
        })
        if isinstance(new_cfg.get("mqtt"), dict):
            merged["mqtt"].update(new_cfg["mqtt"])
        if isinstance(new_cfg.get("webhook"), dict):
            merged["webhook"].update(new_cfg["webhook"])

        self._config = merged
        self._save_config(merged)
        return self._config

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> bool:
        """Load config and start the forwarding loop."""
        self._config = self._load_config()
        if not self._config.get("enabled", False):
            logger.info("ForwardEngine: disabled (no forward_config.json or enabled=false)")
            self._running = False
            return False

        if self._running:
            return True

        self._last_error = None
        if self._config.get("mqtt", {}).get("enabled", False):
            await self._setup_mqtt()

        self._running = True
        self._task = asyncio.create_task(self._forward_loop(), name="forward_engine")
        logger.info("ForwardEngine started (interval=%ss)", self._config.get("publish_interval_seconds", 5.0))
        return True

    async def stop(self) -> None:
        """Stop the forwarding loop and disconnect the MQTT client."""
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        await self._teardown_mqtt()
        logger.info("ForwardEngine stopped")

    async def restart(self) -> bool:
        await self.stop()
        return await self.start()

    # ------------------------------------------------------------------
    # Forwarding execution
    # ------------------------------------------------------------------

    async def _collect_snapshot(self) -> List[Dict[str, Any]]:
        from core.tag_engine import TagEngine
        from db.database import get_db

        engine = TagEngine()
        all_values = engine.get_all_values()
        filter_conn_ids = set(self._config.get("connection_ids") or [])

        async with get_db() as db:
            async with db.execute(
                "SELECT t.id, t.connection_id, t.name AS tag_name, t.tag_group, t.data_type, c.name AS conn_name "
                "FROM tags t JOIN connections c ON t.connection_id = c.id "
                "WHERE t.enabled = 1 AND c.enabled = 1"
            ) as cursor:
                rows = await cursor.fetchall()

        items = []
        for r in rows:
            if filter_conn_ids and r["connection_id"] not in filter_conn_ids:
                continue
            entry = all_values.get(r["id"])
            if not entry:
                continue
            grp = (r["tag_group"] or "").strip()
            scada_tag = f"{grp}.{r['tag_name']}" if grp and grp.lower() != "default" else r["tag_name"]
            items.append({
                "tag_id": r["id"],
                "connection": r["conn_name"],
                "group": grp,
                "tag": r["tag_name"],
                "scada_tag": scada_tag,
                "data_type": r["data_type"],
                "value": entry.get("value"),
                "quality": entry.get("quality"),
                "timestamp": entry.get("timestamp"),
            })
        return items

    async def publish_once(self) -> Dict[str, Any]:
        """Execute one forwarding cycle immediately (used by loop and Test Publish button)."""
        items = await self._collect_snapshot()
        mqtt_cfg = self._config.get("mqtt", {})
        webhook_cfg = self._config.get("webhook", {})
        sent_mqtt = 0
        sent_webhook = False
        errors: List[str] = []

        if mqtt_cfg.get("enabled", False):
            if self._mqtt_client is None:
                await self._setup_mqtt()
                await asyncio.sleep(0.3)
            prefix = (mqtt_cfg.get("topic_prefix") or "gateway").strip("/")
            qos = int(mqtt_cfg.get("qos", 0))
            for item in items:
                grp = item["group"]
                if grp and grp.lower() != "default":
                    topic = f"{prefix}/{item['connection']}/{grp}/{item['tag']}"
                else:
                    topic = f"{prefix}/{item['connection']}/{item['tag']}"
                ok = await self._mqtt_publish(topic, json.dumps(item, ensure_ascii=False), qos=qos)
                if ok:
                    sent_mqtt += 1

        if webhook_cfg.get("enabled", False) and (webhook_cfg.get("url") or "").strip():
            ok, err = await self._webhook_publish(webhook_cfg, items)
            sent_webhook = ok
            if err:
                errors.append(err)

        now_iso = datetime.now(timezone.utc).isoformat()
        if sent_mqtt > 0 or sent_webhook:
            self._published_count += 1
            self._last_publish_at = now_iso
        if errors:
            self._last_error = " | ".join(errors)
        else:
            self._last_error = None

        return {
            "ok": len(errors) == 0,
            "tags_count": len(items),
            "sent_mqtt": sent_mqtt,
            "sent_webhook": sent_webhook,
            "error": self._last_error,
            "timestamp": now_iso,
        }

    async def _forward_loop(self) -> None:
        interval = max(0.5, float(self._config.get("publish_interval_seconds", DEFAULT_PUBLISH_INTERVAL)))
        while self._running:
            try:
                await self.publish_once()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                self._last_error = str(exc)
                logger.error("ForwardEngine loop error: %s", exc)
            await asyncio.sleep(interval)

    # ------------------------------------------------------------------
    # MQTT & Webhook helpers
    # ------------------------------------------------------------------

    async def _setup_mqtt(self) -> None:
        mqtt_cfg = self._config.get("mqtt", {})
        host = (mqtt_cfg.get("host") or "").strip()
        if not host:
            return
        try:
            import paho.mqtt.client as mqtt_lib

            port = int(mqtt_cfg.get("port", 1883))
            username = mqtt_cfg.get("username") or ""
            password = mqtt_cfg.get("password") or ""

            client = mqtt_lib.Client(
                callback_api_version=mqtt_lib.CallbackAPIVersion.VERSION2,
                client_id=f"gateway_forward_{int(datetime.now().timestamp()) % 10000}",
            )

            def on_connect(_c, _u, _f, rc, _props=None):
                self._mqtt_connected = (rc == 0)
                if rc != 0:
                    self._last_error = f"MQTT Broker từ chối kết nối (rc={rc})"

            def on_disconnect(_c, _u, _f, _rc, _props=None):
                self._mqtt_connected = False

            client.on_connect = on_connect
            client.on_disconnect = on_disconnect

            if username:
                client.username_pw_set(username, password)

            client.connect_async(host, port, keepalive=60)
            client.loop_start()
            self._mqtt_client = client
            logger.info("ForwardEngine MQTT connecting to %s:%d", host, port)
        except Exception as exc:
            self._last_error = f"Lỗi MQTT: {exc}"
            logger.error("ForwardEngine MQTT setup error: %s", exc)
            self._mqtt_client = None
            self._mqtt_connected = False

    async def _teardown_mqtt(self) -> None:
        try:
            if self._mqtt_client:
                self._mqtt_client.loop_stop()
                self._mqtt_client.disconnect()
        except Exception as exc:
            logger.debug("ForwardEngine MQTT teardown: %s", exc)
        finally:
            self._mqtt_client = None
            self._mqtt_connected = False

    async def _mqtt_publish(self, topic: str, payload: str, qos: int = 0) -> bool:
        if self._mqtt_client is None:
            return False
        try:
            self._mqtt_client.publish(topic, payload, qos=qos)
            return True
        except Exception as exc:
            logger.debug("ForwardEngine publish error [%s]: %s", topic, exc)
            return False

    async def _webhook_publish(self, webhook_cfg: Dict[str, Any], items: List[Dict[str, Any]]) -> tuple[bool, Optional[str]]:
        url = (webhook_cfg.get("url") or "").strip()
        method = (webhook_cfg.get("method") or "POST").upper()
        auth_header = (webhook_cfg.get("auth_header") or "").strip()

        body = json.dumps({
            "source": "IndustrialGateway",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "count": len(items),
            "tags": items,
        }, ensure_ascii=False).encode("utf-8")

        def _send():
            headers = {"Content-Type": "application/json"}
            if auth_header:
                headers["Authorization"] = auth_header
            req = urllib.request.Request(url, data=body, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status

        try:
            loop = asyncio.get_event_loop()
            status = await loop.run_in_executor(None, _send)
            if 200 <= status < 300:
                return True, None
            return False, f"Webhook HTTP {status}"
        except Exception as exc:
            return False, f"Webhook lỗi: {exc}"

    # ------------------------------------------------------------------
    # Config persistence
    # ------------------------------------------------------------------

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
                "publish_interval_seconds": float(raw.get("publish_interval_seconds", DEFAULT_PUBLISH_INTERVAL)),
                "connection_ids": raw.get("connection_ids") or [],
            })
            if isinstance(raw.get("mqtt"), dict):
                cfg["mqtt"].update(raw["mqtt"])
            if isinstance(raw.get("webhook"), dict):
                cfg["webhook"].update(raw["webhook"])
        except Exception as exc:
            logger.error("ForwardEngine: failed to read %s: %s", CONFIG_PATH, exc)
        return cfg

    @staticmethod
    def _save_config(cfg: Dict[str, Any]) -> None:
        try:
            with open(CONFIG_PATH, "w", encoding="utf-8") as fh:
                json.dump(cfg, fh, indent=2, ensure_ascii=False)
        except Exception as exc:
            logger.error("ForwardEngine: failed to write %s: %s", CONFIG_PATH, exc)
