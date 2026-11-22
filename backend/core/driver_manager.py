"""
DriverManager – singleton that owns all active protocol drivers.

Responsibilities
----------------
* Load enabled connections from the database on startup.
* Instantiate the correct driver class for each connection.
* Expose a uniform read/write interface that delegates to the right driver.
* Handle connection lifecycle: add, remove, reconnect.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, Optional, Tuple, Type

from db.database import get_db
from drivers.base_driver import BaseDriver
from drivers.modbus_driver import ModbusDriver
from drivers.mqtt_driver import MqttDriver
from drivers.opcua_driver import OpcuaDriver
from drivers.opc_da_driver import OpcDaDriver
from drivers.s7_driver import S7Driver
from drivers.internal_driver import InternalDriver

logger = logging.getLogger(__name__)

# Protocol string -> Driver class
_DRIVER_REGISTRY: Dict[str, Type[BaseDriver]] = {
    "modbus_tcp": ModbusDriver,
    "modbus_rtu": ModbusDriver,
    "s7":         S7Driver,
    "mqtt":       MqttDriver,
    "opcua":      OpcuaDriver,
    "opc_da":     OpcDaDriver,
    "internal":   InternalDriver,
}


def _build_config(row) -> dict:
    """Merge database row fields with the JSON config blob."""
    config: dict = {}
    try:
        config = json.loads(row["config_json"] or "{}")
    except (json.JSONDecodeError, TypeError):
        pass
    config.update({
        "id":       row["id"],
        "name":     row["name"],
        "protocol": row["protocol"],
        "host":     row["host"],
        "port":     row["port"],
        "enabled":  row["enabled"],
    })
    return config


class DriverManager:
    """
    Singleton that manages a pool of protocol drivers keyed by connection_id.
    """

    _instance: Optional["DriverManager"] = None

    def __new__(cls) -> "DriverManager":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._drivers = {}
            cls._instance._initialized = False
        return cls._instance

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Load all enabled connections from DB and connect their drivers."""
        logger.info("DriverManager starting...")
        async with get_db() as db:
            async with db.execute(
                "SELECT * FROM connections WHERE enabled = 1"
            ) as cursor:
                rows = await cursor.fetchall()

        for row in rows:
            await self._create_and_connect(dict(row))

        self._initialized = True
        logger.info("DriverManager started (%d connections)", len(self._drivers))

    async def stop(self) -> None:
        """Disconnect all drivers."""
        logger.info("DriverManager stopping...")
        for conn_id, driver in list(self._drivers.items()):
            try:
                await driver.disconnect()
            except Exception as exc:
                logger.error("Error disconnecting driver %d: %s", conn_id, exc)
        self._drivers.clear()
        logger.info("DriverManager stopped")

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------

    async def add_connection(self, connection: dict) -> bool:
        """Create a new driver for the given connection and connect it."""
        conn_id = connection["id"]
        if conn_id in self._drivers:
            await self.remove_connection(conn_id)
        return await self._create_and_connect(connection)

    async def remove_connection(self, connection_id: int) -> None:
        """Disconnect and remove the driver for the given connection."""
        driver = self._drivers.pop(connection_id, None)
        if driver:
            try:
                await driver.disconnect()
            except Exception as exc:
                logger.error("Error removing connection %d: %s", connection_id, exc)
            logger.info("Connection %d removed from DriverManager", connection_id)

    async def reconnect(self, connection_id: int) -> bool:
        """Disconnect and reconnect the driver for the given connection."""
        driver = self._drivers.get(connection_id)
        if not driver:
            logger.warning("reconnect: no driver for connection_id=%d", connection_id)
            return False
        await driver.disconnect()
        ok = await driver.connect()
        driver._note_connect_result(bool(ok))
        return ok

    def get_driver(self, connection_id: int) -> Optional[BaseDriver]:
        """Return the driver for the given connection_id, or None."""
        return self._drivers.get(connection_id)

    # ------------------------------------------------------------------
    # Tag I/O
    # ------------------------------------------------------------------

    async def read_tag(self, tag: dict) -> Tuple[Any, str]:
        """
        Read a tag value via the appropriate driver.

        Parameters
        ----------
        tag : dict
            Must contain at least ``connection_id``, ``address``, ``data_type``.

        Returns
        -------
        (value, quality) tuple.
        """
        driver = self.get_driver(tag["connection_id"])
        if driver is None:
            return None, "Bad"
        try:
            return await driver.read_tag(tag["address"], tag["data_type"])
        except Exception as exc:
            logger.error(
                "DriverManager.read_tag error [tag_id=%s]: %s", tag.get("id"), exc
            )
            return None, "Bad"

    async def write_tag(self, tag: dict, value: Any) -> bool:
        """Write a value to a tag via the appropriate driver."""
        driver = self.get_driver(tag["connection_id"])
        if driver is None:
            logger.warning(
                "write_tag: no driver for connection_id=%d", tag["connection_id"]
            )
            return False
        try:
            return await driver.write_tag(tag["address"], value, tag["data_type"])
        except Exception as exc:
            logger.error(
                "DriverManager.write_tag error [tag_id=%s]: %s", tag.get("id"), exc
            )
            return False

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    def connection_status(self) -> Dict[int, bool]:
        """Return a mapping of connection_id -> is_connected."""
        return {cid: drv.is_connected() for cid, drv in self._drivers.items()}

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _create_and_connect(self, row: dict) -> bool:
        """Instantiate a driver from the row dict and attempt connection."""
        conn_id  = row["id"]
        protocol = row.get("protocol", "")
        driver_cls = _DRIVER_REGISTRY.get(protocol)
        if driver_cls is None:
            logger.error(
                "No driver registered for protocol '%s' (connection_id=%d)",
                protocol, conn_id,
            )
            return False

        config = _build_config(row) if "config_json" in row else row
        driver = driver_cls(config)
        self._drivers[conn_id] = driver

        try:
            success = await asyncio.wait_for(driver.connect(), timeout=5.0)
        except asyncio.TimeoutError:
            logger.warning(
                "Driver for connection_id=%d (%s) timed out connecting (5s)", conn_id, protocol
            )
            success = False
        except Exception as exc:
            logger.warning(
                "Driver for connection_id=%d (%s) connect error: %s", conn_id, protocol, exc
            )
            success = False
        driver._note_connect_result(bool(success))
        return success
