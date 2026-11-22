"""
Siemens S7 driver using python-snap7.

Address format
--------------
  DB<n>.DBX<byte>.<bit>   – DB bit (bool)
  DB<n>.DBB<byte>         – DB byte (int16)
  DB<n>.DBW<byte>         – DB word (int16)
  DB<n>.DBD<byte>         – DB dword (int32 / float32)
  M<byte>.<bit>           – Memory bit
  Q<byte>.<bit>           – Output bit
  I<byte>.<bit>           – Input bit

Data types supported: bool, int16, int32, float32
"""

from __future__ import annotations

import asyncio
import logging
import struct
from typing import Any, Tuple

from drivers.base_driver import BaseDriver

logger = logging.getLogger(__name__)

# Guard against missing native shared library
try:
    import snap7
    from snap7 import util as snap7_util
    _SNAP7_AVAILABLE = True
except ImportError:
    snap7 = None  # type: ignore[assignment]
    snap7_util = None  # type: ignore[assignment]
    _SNAP7_AVAILABLE = False
    logger.warning(
        "python-snap7 is not installed or the native snap7 library is missing. "
        "S7Driver will not be functional."
    )


def _parse_s7_address(address: str):
    """
    Parse an S7 address string into a dict describing the memory area.

    Returns a dict with keys: area, db_number, start, bit, size, is_bit
    """
    addr = address.strip().upper()
    result = {
        "area": None,
        "db_number": 0,
        "start": 0,
        "bit": 0,
        "size": 2,
        "is_bit": False,
    }

    if addr.startswith("DB"):
        # DB block: DB1.DBX0.0 / DB1.DBW0 / DB1.DBD0 / DB1.DBB0
        result["area"] = "DB"
        dot_pos = addr.index(".")
        result["db_number"] = int(addr[2:dot_pos])
        rest = addr[dot_pos + 1:]  # e.g. DBX0.0 / DBW0

        if rest.startswith("DBX"):
            # Bit access
            parts = rest[3:].split(".")
            result["start"] = int(parts[0])
            result["bit"] = int(parts[1]) if len(parts) > 1 else 0
            result["size"] = 1
            result["is_bit"] = True
        elif rest.startswith("DBB"):
            result["start"] = int(rest[3:])
            result["size"] = 1
        elif rest.startswith("DBW"):
            result["start"] = int(rest[3:])
            result["size"] = 2
        elif rest.startswith("DBD"):
            result["start"] = int(rest[3:])
            result["size"] = 4

    elif addr.startswith("M"):
        result["area"] = "MK"
        if "." in addr:
            byte_part, bit_part = addr[1:].split(".")
            result["start"] = int(byte_part)
            result["bit"] = int(bit_part)
            result["size"] = 1
            result["is_bit"] = True
        else:
            result["start"] = int(addr[1:])
            result["size"] = 2

    elif addr.startswith("Q"):
        result["area"] = "PA"
        if "." in addr:
            byte_part, bit_part = addr[1:].split(".")
            result["start"] = int(byte_part)
            result["bit"] = int(bit_part)
            result["size"] = 1
            result["is_bit"] = True
        else:
            result["start"] = int(addr[1:])
            result["size"] = 2

    elif addr.startswith("I"):
        result["area"] = "PE"
        if "." in addr:
            byte_part, bit_part = addr[1:].split(".")
            result["start"] = int(byte_part)
            result["bit"] = int(bit_part)
            result["size"] = 1
            result["is_bit"] = True
        else:
            result["start"] = int(addr[1:])
            result["size"] = 2

    else:
        raise ValueError(f"Cannot parse S7 address: {address!r}")

    return result


_AREA_MAP = {
    "DB": 0x84,   # S7AreaDB
    "MK": 0x83,   # S7AreaMK
    "PA": 0x82,   # S7AreaPA (outputs)
    "PE": 0x81,   # S7AreaPE (inputs)
}


class S7Driver(BaseDriver):
    """Siemens S7 driver (snap7)."""

    def __init__(self, connection_config: dict) -> None:
        super().__init__(connection_config)
        self._client = None

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------

    async def connect(self) -> bool:
        if not _SNAP7_AVAILABLE:
            logger.error("S7Driver: snap7 library not available.")
            return False
        try:
            import asyncio
            self._client = snap7.client.Client()
            host    = self._host() or "192.168.0.1"
            rack    = int(self._config.get("rack", 0))
            slot    = int(self._config.get("slot", 1))
            # snap7 connect is synchronous – run in executor
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self._client.connect, host, rack, slot)
            self._connected = self._client.get_connected()
            if self._connected:
                logger.info("S7Driver connected to %s rack=%d slot=%d", host, rack, slot)
            else:
                logger.warning("S7Driver: connect returned but not connected.")
            return self._connected
        except Exception as exc:
            logger.error("S7Driver connect error: %s", exc)
            self._connected = False
            return False

    async def disconnect(self) -> None:
        try:
            if self._client and _SNAP7_AVAILABLE:
                import asyncio
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, self._client.disconnect)
        except Exception as exc:
            logger.debug("S7Driver disconnect error: %s", exc)
        finally:
            self._connected = False
            logger.info("S7Driver disconnected")

    # ------------------------------------------------------------------
    # Read / Write
    # ------------------------------------------------------------------

    async def read_tag(self, address: str, data_type: str) -> Tuple[Any, str]:
        if not _SNAP7_AVAILABLE:
            return None, "Bad"
        if not self._connected:
            await self._try_reconnect()
            if not self._connected:
                return None, "Bad"
        try:
            import asyncio
            parsed = _parse_s7_address(address)
            area_code = _AREA_MAP.get(parsed["area"], 0x84)
            loop = asyncio.get_event_loop()

            raw: bytes = await loop.run_in_executor(
                None,
                self._client.read_area,
                area_code,
                parsed["db_number"],
                parsed["start"],
                parsed["size"],
            )

            value = self._bytes_to_value(raw, parsed, data_type)
            return value, "Good"
        except Exception as exc:
            logger.error("S7Driver read_tag error [%s]: %s", address, exc)
            self._connected = False
            return None, "Bad"

    async def write_tag(self, address: str, value: Any, data_type: str) -> bool:
        if not _SNAP7_AVAILABLE:
            return False
        if not self._connected:
            await self._try_reconnect()
            if not self._connected:
                return False
        try:
            import asyncio
            parsed = _parse_s7_address(address)
            area_code = _AREA_MAP.get(parsed["area"], 0x84)
            loop = asyncio.get_event_loop()

            if parsed["is_bit"] or data_type == "bool":
                # Convert value to actual boolean
                b_val = False
                if isinstance(value, str):
                    b_val = value.strip().lower() in ("1", "true", "t", "on", "yes")
                else:
                    b_val = bool(value)

                # Read current byte to preserve neighboring bits (read-modify-write)
                current_raw = await loop.run_in_executor(
                    None,
                    self._client.read_area,
                    area_code,
                    parsed["db_number"],
                    parsed["start"],
                    1,
                )
                byte_val = current_raw[0]
                bit_mask = 1 << parsed["bit"]
                if b_val:
                    byte_val |= bit_mask
                else:
                    byte_val &= ~bit_mask

                raw = bytearray([byte_val])
            else:
                raw = self._value_to_bytes(value, parsed, data_type)

            await loop.run_in_executor(
                None,
                self._client.write_area,
                area_code,
                parsed["db_number"],
                parsed["start"],
                raw,
            )
            return True
        except Exception as exc:
            logger.error("S7Driver write_tag error [%s]: %s", address, exc)
            self._connected = False
            return False

    # ------------------------------------------------------------------
    # Type conversion helpers
    # ------------------------------------------------------------------

    def _bytes_to_value(self, raw: bytes, parsed: dict, data_type: str) -> Any:
        if parsed["is_bit"] or data_type == "bool":
            byte_val = raw[0]
            return bool((byte_val >> parsed["bit"]) & 1)
        elif data_type == "int16":
            return struct.unpack(">h", raw[:2])[0]
        elif data_type == "int32":
            return struct.unpack(">i", raw[:4])[0]
        elif data_type == "float32":
            return struct.unpack(">f", raw[:4])[0]
        else:
            return raw.hex()

    def _value_to_bytes(self, value: Any, parsed: dict, data_type: str) -> bytearray:
        if parsed["is_bit"] or data_type == "bool":
            # Read-modify-write for bit
            area_code = _AREA_MAP.get(parsed["area"], 0x84)
            import asyncio
            # Synchronous read in executor is not feasible here without await;
            # use a simple approach: write the whole byte
            byte_val = 1 << parsed["bit"] if value else 0
            return bytearray([byte_val])
        elif data_type == "int16":
            return bytearray(struct.pack(">h", int(value)))
        elif data_type == "int32":
            return bytearray(struct.pack(">i", int(value)))
        elif data_type == "float32":
            return bytearray(struct.pack(">f", float(value)))
        else:
            return bytearray(str(value).encode())

    # ------------------------------------------------------------------
    # Reconnect
    # ------------------------------------------------------------------

    async def _try_reconnect(self) -> None:
        """Reconnect with growing back-off (5s -> 60s) while the PLC stays offline."""
        loop = asyncio.get_event_loop()
        now = loop.time()
        last = getattr(self, "_last_reconnect_attempt", 0.0)
        if now - last < self._backoff_delay():
            return
        self._last_reconnect_attempt = now
        logger.info("S7Driver attempting reconnect (retry delay %.0fs)...", self._backoff_delay())
        ok = await self.connect()
        self._note_connect_result(bool(ok))
