"""
Modbus TCP / RTU driver using pymodbus 3.x async API.

Address format
--------------
  HR:<n>   – Holding Register at address n
  CO:<n>   – Coil at address n
  IR:<n>   – Input Register at address n
  DI:<n>   – Discrete Input at address n

Data types supported: bool, int16, int32, float32

NOTES on pymodbus 3.9+ API change:
  The keyword argument was renamed:  slave= -> device_id=
"""

from __future__ import annotations

import asyncio
import logging
import struct
from typing import Any, Tuple

from drivers.base_driver import BaseDriver

logger = logging.getLogger(__name__)


def _decode_registers(registers: list[int], data_type: str) -> Any:
    """Convert raw Modbus register list to a Python value.

    Byte/Word order variants:
      float32      = Big-Endian ABCD        (Word Hi first)   e.g. Modbus standard
      float32_swap = Word-Swapped CDAB      (Word Lo first)   e.g. Schneider, nhiều PLC
      float32_be   = Byte-Swapped BADC
      float32_le   = Little-Endian DCBA
      int32        = Big-Endian ABCD
      int32_swap   = Word-Swapped CDAB
      uint16       = Unsigned 16-bit integer
    """
    if data_type == "bool":
        return bool(registers[0])
    elif data_type == "int16":
        raw = struct.pack(">H", registers[0])
        return struct.unpack(">h", raw)[0]
    elif data_type == "uint16":
        return registers[0]
    elif data_type == "int32":
        # ABCD - Big-Endian (word hi first)
        raw = struct.pack(">HH", registers[0], registers[1])
        return struct.unpack(">i", raw)[0]
    elif data_type == "int32_swap":
        # CDAB - Word-Swapped (word lo first)
        raw = struct.pack(">HH", registers[1], registers[0])
        return struct.unpack(">i", raw)[0]
    elif data_type == "float32":
        # ABCD - Big-Endian (word hi first)
        raw = struct.pack(">HH", registers[0], registers[1])
        return round(struct.unpack(">f", raw)[0], 6)
    elif data_type == "float32_swap":
        # CDAB - Word-Swapped (word lo first) — phổ biến nhất với PLC/Inverter
        raw = struct.pack(">HH", registers[1], registers[0])
        return round(struct.unpack(">f", raw)[0], 6)
    elif data_type == "float32_be":
        # BADC - Byte-Swapped Big-Endian
        r0_bytes = struct.pack(">H", registers[0])
        r1_bytes = struct.pack(">H", registers[1])
        raw = bytes([r0_bytes[1], r0_bytes[0], r1_bytes[1], r1_bytes[0]])
        return round(struct.unpack(">f", raw)[0], 6)
    elif data_type == "float32_le":
        # DCBA - Little-Endian
        raw = struct.pack("<HH", registers[0], registers[1])
        return round(struct.unpack("<f", raw)[0], 6)
    else:
        return registers[0]


def _encode_value(value: Any, data_type: str) -> list[int]:
    """Encode a Python value into a list of Modbus registers."""
    if data_type == "bool":
        b_val = False
        if isinstance(value, str):
            b_val = value.strip().lower() in ("1", "true", "t", "on", "yes")
        else:
            b_val = bool(value)
        return [1 if b_val else 0]
    elif data_type in ("int16", "uint16"):
        return [int(value) & 0xFFFF]
    elif data_type == "int32":
        raw = struct.pack(">i", int(value))
        hi, lo = struct.unpack(">HH", raw)
        return [hi, lo]
    elif data_type == "int32_swap":
        raw = struct.pack(">i", int(value))
        hi, lo = struct.unpack(">HH", raw)
        return [lo, hi]  # swap words
    elif data_type == "float32":
        raw = struct.pack(">f", float(value))
        hi, lo = struct.unpack(">HH", raw)
        return [hi, lo]
    elif data_type == "float32_swap":
        raw = struct.pack(">f", float(value))
        hi, lo = struct.unpack(">HH", raw)
        return [lo, hi]  # swap words
    elif data_type == "float32_be":
        raw = struct.pack(">f", float(value))
        return [struct.unpack(">H", bytes([raw[1], raw[0]]))[0],
                struct.unpack(">H", bytes([raw[3], raw[2]]))[0]]
    elif data_type == "float32_le":
        raw = struct.pack("<f", float(value))
        lo, hi = struct.unpack("<HH", raw)
        return [lo, hi]
    else:
        return [int(value) & 0xFFFF]


def _parse_address(address: str) -> Tuple[str, int]:
    """Parse address string like 'HR:40' into (register_type, offset)."""
    parts = address.upper().split(":")
    if len(parts) != 2:
        raise ValueError(f"Invalid Modbus address: {address!r}. Expected format TYPE:N")
    reg_type = parts[0].strip()
    offset = int(parts[1].strip())
    return reg_type, offset


def _build_slave_kwargs(config: dict) -> dict:
    """
    Build the correct keyword argument dict for slave/device ID.
    pymodbus >= 3.9 renamed slave= to device_id=.
    We detect this at runtime from the method signature.
    """
    import inspect
    from pymodbus.client import AsyncModbusTcpClient
    client_tmp = AsyncModbusTcpClient.__new__(AsyncModbusTcpClient)
    sig_str = str(inspect.signature(client_tmp.read_holding_registers))
    slave_id = int(config.get("slave_id", 1))
    if "device_id" in sig_str:
        return {"device_id": slave_id}
    return {"slave": slave_id}


class ModbusDriver(BaseDriver):
    """Modbus TCP or RTU async driver."""

    def __init__(self, connection_config: dict) -> None:
        super().__init__(connection_config)
        self._client = None
        self._protocol: str = connection_config.get("protocol", "modbus_tcp")
        self._reconnect_task: asyncio.Task | None = None
        self._slave_kwargs: dict | None = None  # Lazily initialised on first use
        self._last_reconnect_attempt: float = 0.0

    def _get_slave_kwargs(self) -> dict:
        if self._slave_kwargs is None:
            self._slave_kwargs = _build_slave_kwargs(self._config)
        return self._slave_kwargs

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------

    async def connect(self) -> bool:
        try:
            if self._protocol == "modbus_tcp":
                from pymodbus.client import AsyncModbusTcpClient
                host = self._host() or "127.0.0.1"
                port = self._port() or 502
                self._client = AsyncModbusTcpClient(host=host, port=port)
            else:
                # Modbus RTU over serial
                from pymodbus.client import AsyncModbusSerialClient
                serial_port = self._config.get("serial_port", "COM1")
                baudrate    = int(self._config.get("baudrate", 9600))
                self._client = AsyncModbusSerialClient(
                    port=serial_port,
                    baudrate=baudrate,
                    bytesize=int(self._config.get("bytesize", 8)),
                    parity=self._config.get("parity", "N"),
                    stopbits=int(self._config.get("stopbits", 1)),
                )

            await self._client.connect()
            self._connected = self._client.connected
            if self._connected:
                logger.info("ModbusDriver connected (%s)", self._protocol)
            else:
                logger.warning("ModbusDriver failed to connect (%s)", self._protocol)
            return self._connected
        except Exception as exc:
            logger.error("ModbusDriver connect error: %s", exc)
            self._connected = False
            return False

    async def disconnect(self) -> None:
        if self._reconnect_task and not self._reconnect_task.done():
            self._reconnect_task.cancel()
        try:
            if self._client:
                self._client.close()
        except Exception as exc:
            logger.debug("ModbusDriver disconnect error: %s", exc)
        finally:
            self._connected = False
            logger.info("ModbusDriver disconnected")

    # ------------------------------------------------------------------
    # Read / Write
    # ------------------------------------------------------------------

    async def read_tag(self, address: str, data_type: str) -> Tuple[Any, str]:
        if not self._connected or self._client is None:
            await self._try_reconnect()
            if not self._connected:
                return None, "Bad"
        try:
            reg_type, offset = _parse_address(address)
            skw = self._get_slave_kwargs()

            _32BIT_TYPES = ("int32", "int32_swap", "float32", "float32_swap", "float32_be", "float32_le")

            if reg_type == "HR":
                count = 2 if data_type in _32BIT_TYPES else 1
                result = await self._client.read_holding_registers(offset, count=count, **skw)
                if result.isError():
                    logger.warning("ModbusDriver HR read error at %s: %s", address, result)
                    return None, "Bad"
                return _decode_registers(result.registers, data_type), "Good"

            elif reg_type == "IR":
                count = 2 if data_type in _32BIT_TYPES else 1
                result = await self._client.read_input_registers(offset, count=count, **skw)
                if result.isError():
                    return None, "Bad"
                return _decode_registers(result.registers, data_type), "Good"

            elif reg_type == "CO":
                result = await self._client.read_coils(offset, count=1, **skw)
                if result.isError():
                    return None, "Bad"
                return bool(result.bits[0]), "Good"

            elif reg_type == "DI":
                result = await self._client.read_discrete_inputs(offset, count=1, **skw)
                if result.isError():
                    return None, "Bad"
                return bool(result.bits[0]), "Good"

            else:
                logger.error("Unknown Modbus register type: %s", reg_type)
                return None, "Bad"

        except TypeError as exc:
            # API version mismatch – reset slave_kwargs cache and retry once
            logger.warning("ModbusDriver API mismatch (retrying): %s", exc)
            self._slave_kwargs = None
            return None, "Bad"
        except Exception as exc:
            logger.error("ModbusDriver read_tag error [%s]: %s", address, exc)
            self._connected = False
            return None, "Bad"

    async def write_tag(self, address: str, value: Any, data_type: str) -> bool:
        if not self._connected or self._client is None:
            await self._try_reconnect()
            if not self._connected:
                return False
        try:
            reg_type, offset = _parse_address(address)
            skw = self._get_slave_kwargs()

            if reg_type == "HR":
                registers = _encode_value(value, data_type)
                if len(registers) == 1:
                    result = await self._client.write_register(offset, registers[0], **skw)
                else:
                    result = await self._client.write_registers(offset, registers, **skw)
                return not result.isError()

            elif reg_type == "CO":
                result = await self._client.write_coil(offset, bool(value), **skw)
                return not result.isError()

            else:
                logger.warning("Write not supported for register type: %s", reg_type)
                return False

        except Exception as exc:
            logger.error("ModbusDriver write_tag error [%s]: %s", address, exc)
            self._connected = False
            return False

    # ------------------------------------------------------------------
    # Reconnect helpers
    # ------------------------------------------------------------------

    async def _try_reconnect(self) -> None:
        """Attempt a single reconnection with growing back-off (5s -> 60s) while offline."""
        loop = asyncio.get_event_loop()
        now = loop.time()
        if now - self._last_reconnect_attempt < self._backoff_delay():
            return
        self._last_reconnect_attempt = now
        logger.info("ModbusDriver attempting reconnect (retry delay %.0fs)...", self._backoff_delay())
        ok = await self.connect()
        self._note_connect_result(bool(ok))

