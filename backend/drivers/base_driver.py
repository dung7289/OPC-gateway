"""
Abstract base class for all protocol drivers.
Every concrete driver must implement the methods defined here.
"""

from __future__ import annotations

import abc
from typing import Any, Tuple


class BaseDriver(abc.ABC):
    """
    Abstract base class for Industrial Gateway protocol drivers.

    Each driver wraps one physical or logical connection to a device/broker
    and exposes a uniform async interface for reading and writing tag values.
    """

    def __init__(self, connection_config: dict) -> None:
        """
        Parameters
        ----------
        connection_config : dict
            Merged dictionary containing both top-level connection fields
            (host, port, protocol, name) and the JSON ``config`` blob stored
            in the database.
        """
        self._config: dict = connection_config
        self._connected: bool = False
        # Auto-demotion: number of consecutive failed (re)connect attempts
        self._fail_count: int = 0

    # ------------------------------------------------------------------
    # Auto-demotion / reconnect back-off (Kepware style)
    # ------------------------------------------------------------------

    # Delay (seconds) between reconnect attempts after 0,1,2,3,4+ consecutive failures
    _BACKOFF_STEPS = (5.0, 10.0, 20.0, 30.0, 60.0)

    def _backoff_delay(self) -> float:
        """Seconds to wait before the next reconnect attempt (grows while the device stays offline)."""
        idx = min(self._fail_count, len(self._BACKOFF_STEPS) - 1)
        return self._BACKOFF_STEPS[idx]

    def _note_connect_result(self, ok: bool) -> None:
        """Record the outcome of a (re)connect attempt to drive the back-off schedule."""
        if ok:
            self._fail_count = 0
        else:
            self._fail_count += 1

    @property
    def is_demoted(self) -> bool:
        """True while the device is offline and reconnect attempts are being throttled."""
        return (not self._connected) and self._fail_count >= 2

    # ------------------------------------------------------------------
    # Abstract interface
    # ------------------------------------------------------------------

    @abc.abstractmethod
    async def connect(self) -> bool:
        """
        Establish the connection to the remote device / broker.

        Returns
        -------
        bool
            ``True`` if the connection was established successfully.
        """

    @abc.abstractmethod
    async def disconnect(self) -> None:
        """Cleanly close the connection and release resources."""

    @abc.abstractmethod
    async def read_tag(self, address: str, data_type: str) -> Tuple[Any, str]:
        """
        Read a single tag value.

        Parameters
        ----------
        address : str
            Driver-specific address string (e.g. ``"HR:0"``, ``"DB1.DBW0"``).
        data_type : str
            One of ``bool``, ``int16``, ``int32``, ``float32``, ``float64``,
            ``string``.

        Returns
        -------
        tuple[Any, str]
            ``(value, quality)`` where *quality* is ``"Good"`` or ``"Bad"``.
        """

    @abc.abstractmethod
    async def write_tag(self, address: str, value: Any, data_type: str) -> bool:
        """
        Write a value to a tag.

        Returns
        -------
        bool
            ``True`` on success.
        """

    # ------------------------------------------------------------------
    # Concrete helpers
    # ------------------------------------------------------------------

    def is_connected(self) -> bool:
        """Return the cached connection state."""
        return self._connected

    def _host(self) -> str:
        return self._config.get("host", "")

    def _port(self) -> int:
        return int(self._config.get("port", 0))
