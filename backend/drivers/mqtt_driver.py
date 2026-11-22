"""
MQTT driver using paho-mqtt v2 (MQTTv5).

The driver subscribes to tag addresses (topics) on connect.
Incoming messages are stored in a local cache; read_tag returns cached values.
write_tag publishes a message to the topic.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from typing import Any, Dict, Tuple

from urllib.parse import urlparse
import paho.mqtt.client as mqtt

from drivers.base_driver import BaseDriver

logger = logging.getLogger(__name__)


def extract_json_path(data: Any, path: str) -> Any:
    """
    Safely extract a value from nested dicts / lists using dot-separated path or JSONPath.
    e.g. 'BOM_1.ACK', '$.BOM_1.CUR', 'sensors.0.temp'
    """
    if not path:
        return data
    if path.startswith("$."):
        path = path[2:]
    elif path.startswith("$"):
        path = path[1:]

    current = data
    for part in path.split("."):
        if not part:
            continue
        if isinstance(current, dict):
            if part in current:
                current = current[part]
            else:
                return None
        elif isinstance(current, list):
            try:
                current = current[int(part)]
            except (ValueError, IndexError):
                return None
        else:
            return None
    return current


class MqttDriver(BaseDriver):
    """MQTT protocol driver (paho-mqtt v2, MQTTv5)."""

    def __init__(self, connection_config: dict) -> None:
        super().__init__(connection_config)
        # Cache: topic -> {"value": ..., "timestamp": float}
        self._values: Dict[str, Dict[str, Any]] = {}
        self._client: mqtt.Client | None = None
        self._subscribed_topics: set[str] = set()
        self._connect_event: threading.Event = threading.Event()
        self._loop: asyncio.AbstractEventLoop | None = None

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------

    async def connect(self) -> bool:
        self._loop = asyncio.get_event_loop()
        try:
            # Parse broker_url if present (e.g. mqtt://123.31.43.19:1883)
            broker_url = self._config.get("broker_url")
            host = self._host()
            port = self._port()

            if broker_url:
                if not broker_url.startswith(("mqtt://", "tcp://")):
                    broker_url = f"mqtt://{broker_url}"
                parsed = urlparse(broker_url)
                if parsed.hostname:
                    host = parsed.hostname
                if parsed.port:
                    port = parsed.port

            host = host or "localhost"
            port = port or 1883

            client_id = self._config.get("client_id") or f"gateway_{id(self)}"
            username  = self._config.get("username")
            password  = self._config.get("password")
            keepalive = int(self._config.get("keepalive", 60))

            try:
                self._client = mqtt.Client(
                    callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                    client_id=client_id,
                )
            except (AttributeError, TypeError):
                self._client = mqtt.Client(
                    client_id=client_id,
                )

            if username:
                self._client.username_pw_set(username, password)

            self._client.on_connect    = self._on_connect
            self._client.on_disconnect = self._on_disconnect
            self._client.on_message    = self._on_message

            self._connect_event.clear()
            # Use blocking connect in executor thread to avoid race conditions with connect_async
            def _do_connect():
                try:
                    self._client.connect(host, port, keepalive=keepalive)
                    self._client.loop_start()
                    return True
                except Exception as ex:
                    logger.error("MqttDriver _do_connect error: %s", ex)
                    return False

            ok = await self._loop.run_in_executor(None, _do_connect)
            if not ok:
                self._connected = False
                return False

            # Wait up to 8 seconds for on_connect callback
            connected = await self._loop.run_in_executor(
                None, self._connect_event.wait, 8.0
            )
            self._connected = connected and self._client.is_connected()
            if self._connected:
                logger.info("MqttDriver connected to %s:%d", host, port)
            else:
                logger.warning("MqttDriver: could not connect to %s:%d", host, port)
            return self._connected
        except Exception as exc:
            logger.error("MqttDriver connect error: %s", exc)
            self._connected = False
            return False

    async def disconnect(self) -> None:
        try:
            if self._client:
                self._client.loop_stop()
                self._client.disconnect()
        except Exception as exc:
            logger.debug("MqttDriver disconnect error: %s", exc)
        finally:
            self._connected = False
            logger.info("MqttDriver disconnected")

    # ------------------------------------------------------------------
    # Subscription management
    # ------------------------------------------------------------------

    def subscribe_topic(self, topic: str) -> None:
        """Subscribe to a topic if not already subscribed."""
        topic = (topic or "").strip()
        if topic and self._client and topic not in self._subscribed_topics:
            self._client.subscribe(topic, qos=int(self._config.get("qos", 0)))
            self._subscribed_topics.add(topic)
            logger.debug("MqttDriver subscribed to topic: %s", topic)

    def get_topic_entry(self, topic: str) -> Dict[str, Any] | None:
        """Return latest cached MQTT message dict {value, timestamp} for topic."""
        return self._values.get((topic or "").strip())

    async def publish_raw(
        self, topic: str, payload: str, qos: int = 0, retain: bool = False
    ) -> Tuple[bool, str | None]:
        """Publish an arbitrary JSON/text payload to an MQTT topic without blocking the event loop."""
        topic = (topic or "").strip()
        if not topic:
            return False, "Topic publish không được để trống"
        if not self._connected or self._client is None:
            return False, "Kết nối MQTT chưa online"

        loop = self._loop or asyncio.get_running_loop()

        def _do_pub():
            try:
                info = self._client.publish(topic, payload, qos=int(qos), retain=bool(retain))
                info.wait_for_publish(timeout=5.0)
                if info.is_published():
                    return True, None
                return False, "Publish MQTT quá thời gian chờ xác nhận"
            except Exception as ex:
                return False, f"Lỗi publish MQTT: {ex}"

        return await loop.run_in_executor(None, _do_pub)

    # ------------------------------------------------------------------
    # Read / Write
    # ------------------------------------------------------------------

    async def read_tag(self, address: str, data_type: str) -> Tuple[Any, str]:
        """
        Return cached value for the given topic address.
        Supports JSON key extraction using topic.key or topic:key or topic/key syntax,
        e.g.: 'devices/telemetry.AP1' or 'devices/telemetry:DI1'
        """
        topic = address
        json_key = None

        if ":" in address:
            topic, json_key = address.split(":", 1)
        elif "." in address and not address.endswith((".json", ".txt")):
            # split from right by last dot
            parts = address.rsplit(".", 1)
            topic, json_key = parts[0], parts[1]

        # Ensure we are subscribed to the base topic
        if self._connected and topic not in self._subscribed_topics:
            self.subscribe_topic(topic)

        # Fallback check if address itself was subscribed
        entry = self._values.get(topic) or self._values.get(address)
        if entry is None:
            return None, "Unknown"

        raw_value = entry.get("value")

        # If payload was JSON object and a key was requested
        if json_key:
            if isinstance(raw_value, (dict, list)):
                raw_value = extract_json_path(raw_value, json_key)
            elif json_key != "":
                raw_value = None
            if raw_value is None:
                return None, "Unknown"

        try:
            value = self._cast_value(raw_value, data_type)
            return value, "Good"
        except Exception as exc:
            logger.debug("MqttDriver type conversion error [%s]: %s", address, exc)
            return raw_value, "Bad"

    async def scan_topic(self, topic: str, timeout: float = 5.0) -> Any:
        """
        Wait for a message on `topic` and return the payload.
        Returns parsed dict/list/primitive or None if timed out.
        """
        if not self._connected or not self._client:
            return None

        self.subscribe_topic(topic)

        # Check existing cached value if recent (within 5s)
        entry = self._values.get(topic)
        if entry and (time.time() - entry.get("timestamp", 0) < 5.0):
            return entry.get("value")

        init_ts = entry.get("timestamp", 0) if entry else 0
        start = time.time()
        while time.time() - start < timeout:
            await asyncio.sleep(0.2)
            cur = self._values.get(topic)
            if cur and cur.get("timestamp", 0) > init_ts:
                return cur.get("value")

        if entry:
            return entry.get("value")
        return None

    async def write_tag(self, address: str, value: Any, data_type: str) -> bool:
        if not self._connected or self._client is None:
            return False
        try:
            topic = (address or "").strip()
            if ":" in topic:
                topic, key = topic.split(":", 1)
                topic = topic.strip()
                key = key.strip()
                if key:
                    parts = [p for p in key.split(".") if p]
                    nested_obj: Any = value
                    for part in reversed(parts):
                        nested_obj = {part: nested_obj}
                    payload = json.dumps(nested_obj, ensure_ascii=False)
                else:
                    payload = json.dumps(value, ensure_ascii=False) if not isinstance(value, (str, bytes)) else str(value)
            else:
                payload = json.dumps(value, ensure_ascii=False) if not isinstance(value, (str, bytes)) else str(value)

            ok, err = await self.publish_raw(
                topic,
                payload,
                qos=int(self._config.get("qos", 0)),
                retain=bool(self._config.get("retain", False)),
            )
            if not ok and err:
                logger.error("MqttDriver write_tag error [%s -> %s]: %s", address, topic, err)
            return ok
        except Exception as exc:
            logger.error("MqttDriver write_tag error [%s]: %s", address, exc)
            return False

    # ------------------------------------------------------------------
    # paho callbacks
    # ------------------------------------------------------------------

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        code_val = reason_code.value if hasattr(reason_code, "value") else reason_code
        logger.info("MqttDriver _on_connect: reason_code=%s (val=%s)", reason_code, code_val)
        if code_val == 0:
            self._connected = True
            # Re-subscribe on reconnect
            for topic in self._subscribed_topics:
                client.subscribe(topic, qos=int(self._config.get("qos", 0)))
            logger.info("MqttDriver: CONNECTED successfully")
        else:
            self._connected = False
            logger.warning("MqttDriver: connection refused, reason_code=%s", reason_code)
        self._connect_event.set()

    def _on_disconnect(self, client, userdata, disconnect_flags, reason_code, properties=None):
        self._connected = False
        logger.warning("MqttDriver disconnected: reason_code=%s", reason_code)

    def _on_message(self, client, userdata, msg: mqtt.MQTTMessage):
        topic = msg.topic
        try:
            payload_str = msg.payload.decode("utf-8", errors="replace")
            # Try to parse as JSON first
            try:
                value = json.loads(payload_str)
            except json.JSONDecodeError:
                value = payload_str
        except Exception:
            value = msg.payload

        self._values[topic] = {"value": value, "timestamp": time.time()}
        logger.debug("MqttDriver received [%s]: %s", topic, value)

    # ------------------------------------------------------------------
    # Type casting helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _cast_value(raw: Any, data_type: str) -> Any:
        if data_type == "bool":
            if isinstance(raw, str):
                return raw.lower() in ("true", "1", "on", "yes")
            return bool(raw)
        elif data_type in ("int16", "int32"):
            return int(float(str(raw)))
        elif data_type in ("float32", "float64"):
            return float(str(raw))
        else:
            return raw
