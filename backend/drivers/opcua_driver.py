"""
OPC-UA driver using the opcua (freeopcua) library.

Address format
--------------
  NodeId string as recognised by opcua, e.g.:
    "ns=2;i=1001"      – numeric node id in namespace 2
    "ns=2;s=MyTag"     – string node id
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional, Tuple

from drivers.base_driver import BaseDriver

logger = logging.getLogger(__name__)

try:
    from opcua import Client as OpcuaClient
    from opcua import ua
    _OPCUA_AVAILABLE = True
except ImportError:
    OpcuaClient = None  # type: ignore[assignment,misc]
    ua = None           # type: ignore[assignment]
    _OPCUA_AVAILABLE = False
    logger.warning(
        "opcua library is not installed. OpcuaDriver will not be functional."
    )


def _cast_to_ua_variant(value: Any, data_type: str):
    """Convert a Python value to the appropriate OPC-UA variant type."""
    if not _OPCUA_AVAILABLE:
        return value
    if data_type == "bool":
        return ua.Variant(bool(value), ua.VariantType.Boolean)
    elif data_type == "int16":
        return ua.Variant(int(value), ua.VariantType.Int16)
    elif data_type == "int32":
        return ua.Variant(int(value), ua.VariantType.Int32)
    elif data_type == "float32":
        return ua.Variant(float(value), ua.VariantType.Float)
    elif data_type == "float64":
        return ua.Variant(float(value), ua.VariantType.Double)
    elif data_type == "string":
        return ua.Variant(str(value), ua.VariantType.String)
    else:
        return ua.Variant(value)


class OpcuaDriver(BaseDriver):
    """OPC-UA client driver (freeopcua / opcua library)."""

    def __init__(self, connection_config: dict) -> None:
        super().__init__(connection_config)
        self._client: Any = None   # opcua.Client
        self._last_reconnect_attempt: float = 0.0

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------

    async def connect(self) -> bool:
        if not _OPCUA_AVAILABLE:
            logger.error("OpcuaDriver: opcua library not available.")
            return False
        try:
            # Support both "endpoint_url" (from ConnectionForm) and legacy "endpoint"
            endpoint = (
                self._config.get("endpoint_url")
                or self._config.get("endpoint")
                or f"opc.tcp://{self._host() or 'localhost'}:{self._port() or 4840}"
            )
            self._client = OpcuaClient(endpoint)

            # Optional security / credentials
            username = self._config.get("username")
            password = self._config.get("password")
            if username:
                self._client.set_user(username)
                self._client.set_password(password or "")

            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self._client.connect)
            self._connected = True
            logger.info("OpcuaDriver connected to %s", endpoint)
            return True
        except Exception as exc:
            logger.error("OpcuaDriver connect error: %s", exc)
            self._connected = False
            return False

    async def disconnect(self) -> None:
        try:
            if self._client and _OPCUA_AVAILABLE:
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, self._client.disconnect)
        except Exception as exc:
            logger.debug("OpcuaDriver disconnect error: %s", exc)
        finally:
            self._connected = False
            logger.info("OpcuaDriver disconnected")

    # ------------------------------------------------------------------
    # Read / Write
    # ------------------------------------------------------------------

    async def read_tag(self, address: str, data_type: str) -> Tuple[Any, str]:
        if not _OPCUA_AVAILABLE:
            return None, "Bad"
        if not self._connected:
            await self._try_reconnect()
            if not self._connected:
                return None, "Bad"
        try:
            loop = asyncio.get_event_loop()
            node = self._client.get_node(address)
            raw_value = await loop.run_in_executor(None, node.get_value)
            value = self._cast_python_value(raw_value, data_type)
            return value, "Good"
        except Exception as exc:
            logger.error("OpcuaDriver read_tag error [%s]: %s", address, exc)
            err_str = str(exc).lower()
            if any(k in err_str for k in ["connection", "socket", "timeout", "broken", "reset", "closed", "session", "disconnected"]):
                self._connected = False
            return None, "Bad"

    async def write_tag(self, address: str, value: Any, data_type: str) -> bool:
        if not _OPCUA_AVAILABLE:
            return False
        if not self._connected:
            await self._try_reconnect()
            if not self._connected:
                return False
        try:
            loop = asyncio.get_event_loop()
            node = self._client.get_node(address)
            variant = _cast_to_ua_variant(value, data_type)
            await loop.run_in_executor(None, node.set_value, variant)
            return True
        except Exception as exc:
            logger.error("OpcuaDriver write_tag error [%s]: %s", address, exc)
            err_str = str(exc).lower()
            if any(k in err_str for k in ["connection", "socket", "timeout", "broken", "reset", "closed", "session", "disconnected"]):
                self._connected = False
            return False

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _map_variant_type_to_str(vtype: Any) -> str:
        if not _OPCUA_AVAILABLE or vtype is None:
            return "float32"
        try:
            if vtype == ua.VariantType.Boolean:
                return "bool"
            elif vtype in (ua.VariantType.SByte, ua.VariantType.Byte, ua.VariantType.Int16):
                return "int16"
            elif vtype in (ua.VariantType.UInt16,):
                return "uint16"
            elif vtype in (ua.VariantType.Int32, ua.VariantType.UInt32):
                return "int32"
            elif vtype == ua.VariantType.Float:
                return "float32"
            elif vtype == ua.VariantType.Double:
                return "float64"
            elif vtype in (ua.VariantType.String, ua.VariantType.LocalizedText):
                return "string"
        except Exception:
            pass
        return "float32"

    @staticmethod
    def _cast_python_value(raw: Any, data_type: str) -> Any:
        """Cast the raw OPC-UA value to the expected Python type."""
        try:
            if data_type == "bool":
                return bool(raw)
            elif data_type in ("int16", "int32"):
                return int(raw)
            elif data_type in ("float32", "float64"):
                return float(raw)
            elif data_type == "string":
                return str(raw)
        except Exception:
            pass
        return raw

    async def _try_reconnect(self) -> None:
        loop = asyncio.get_event_loop()
        now = loop.time()
        if now - self._last_reconnect_attempt < self._backoff_delay():
            return
        self._last_reconnect_attempt = now
        logger.info("OpcuaDriver attempting reconnect to %s (retry delay %.0fs)...", self._config.get("name", "opcua"), self._backoff_delay())
        ok = await self.connect()
        self._note_connect_result(bool(ok))

    # ------------------------------------------------------------------
    # OPC UA Address Space Browser
    # ------------------------------------------------------------------

    async def browse(self, node_id: Optional[str] = None) -> dict:
        """Browse children of node_id (or Objects node)."""
        if not self._connected or not self._client:
            ok = await self.connect()
            if not ok:
                return {"node_id": node_id or "i=85", "name": "Objects", "branches": [], "leaves": []}

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._sync_browse, node_id)

    def _sync_browse(self, node_id: Optional[str] = None) -> dict:
        try:
            target_id = node_id.strip() if node_id and node_id.strip() else "i=85"
            curr_node = self._client.get_node(target_id)
            node_name = "Objects"
            try:
                node_name = curr_node.get_browse_name().Name
            except Exception:
                pass

            branches = []
            leaves = []

            for child in curr_node.get_children():
                try:
                    bname = child.get_browse_name().Name
                    nclass = child.get_node_class()
                    cid = child.nodeid.to_string()

                    # Filter out standard internal OPC UA Server node if browsing root
                    if target_id == "i=85" and (bname == "Server" or cid == "i=2253"):
                        continue

                    # NodeClass: 1 = Object, 2 = Variable, 4 = Method
                    # In opcua library, NodeClass enum: ua.NodeClass.Object / Variable
                    is_var = False
                    try:
                        if hasattr(ua, "NodeClass"):
                            is_var = (nclass == ua.NodeClass.Variable)
                        else:
                            is_var = (int(nclass) == 2)
                    except Exception:
                        is_var = (int(nclass) == 2)

                    if is_var:
                        dt = "float32"
                        try:
                            vtype = child.get_data_type_as_variant_type()
                            dt = self._map_variant_type_to_str(vtype)
                        except Exception:
                            pass

                        group_name = ""
                        if cid and "s=" in cid:
                            s_val = cid.split("s=", 1)[-1]
                            s_parts = [p.strip() for p in s_val.replace('\\', '.').replace('/', '.').split('.') if p.strip()]
                            if len(s_parts) >= 2:
                                group_name = "/".join(s_parts[:-1])
                        if not group_name:
                            group_name = node_name if node_name and node_name not in ("Objects", "Root") else "default"

                        leaves.append({
                            "name": bname,
                            "item_id": cid,
                            "node_id": cid,
                            "group": group_name,
                            "data_type": dt
                        })
                    else:
                        branches.append({
                            "name": bname,
                            "node_id": cid,
                        })
                except Exception as child_err:
                    logger.debug("OpcuaDriver browse child error: %s", child_err)

            return {
                "node_id": target_id,
                "name": node_name,
                "branches": branches,
                "leaves": leaves
            }
        except Exception as exc:
            logger.error("OpcuaDriver browse error [%s]: %s", node_id, exc)
            return {"node_id": node_id or "i=85", "name": "Error", "branches": [], "leaves": []}

    async def scan_all(self, start_node_id: Optional[str] = None, max_tags: int = 500) -> list:
        """Recursively scan all variables under start_node_id."""
        if not self._connected or not self._client:
            ok = await self.connect()
            if not ok:
                return []

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._sync_scan_all, start_node_id, max_tags)

    def _sync_scan_all(self, start_node_id: Optional[str] = None, max_tags: int = 500) -> list:
        all_tags = []
        try:
            target_id = start_node_id.strip() if start_node_id and start_node_id.strip() else "i=85"
            root_node = self._client.get_node(target_id)

            # Determine initial path if start_node_id points to a folder
            initial_path = []
            if target_id not in ("i=85", "i=84", "Root", "Objects"):
                if "s=" in target_id:
                    s_val = target_id.split("s=", 1)[-1]
                    initial_path = [p.strip() for p in s_val.replace('\\', '.').replace('/', '.').split('.') if p.strip()]
                else:
                    try:
                        bname = root_node.get_browse_name().Name
                        if bname and bname not in ("Objects", "Root"):
                            initial_path = [bname]
                    except Exception:
                        pass

            def _crawl(node, current_path_names: list, depth: int = 0):
                if depth > 8 or len(all_tags) >= max_tags:
                    return

                for child in node.get_children():
                    if len(all_tags) >= max_tags:
                        break
                    try:
                        bname = child.get_browse_name().Name
                        cid = child.nodeid.to_string()
                        nclass = child.get_node_class()

                        # Skip internal Server node
                        if depth == 0 and (bname == "Server" or cid == "i=2253"):
                            continue

                        is_var = False
                        try:
                            if hasattr(ua, "NodeClass"):
                                is_var = (nclass == ua.NodeClass.Variable)
                            else:
                                is_var = (int(nclass) == 2)
                        except Exception:
                            is_var = (int(nclass) == 2)

                        if is_var:
                            dt = "float32"
                            try:
                                vtype = child.get_data_type_as_variant_type()
                                dt = self._map_variant_type_to_str(vtype)
                            except Exception:
                                pass

                            group_name = "/".join(current_path_names) if current_path_names else ""
                            if not group_name and cid:
                                s_val = cid.split("s=", 1)[-1] if "s=" in cid else ""
                                s_parts = [p.strip() for p in s_val.replace('\\', '.').replace('/', '.').split('.') if p.strip()]
                                if len(s_parts) >= 2:
                                    group_name = "/".join(s_parts[:-1])
                            if not group_name:
                                group_name = "default"

                            all_tags.append({
                                "name": bname,
                                "item_id": cid,
                                "node_id": cid,
                                "group": group_name,
                                "data_type": dt
                            })
                        else:
                            _crawl(child, current_path_names + [bname], depth + 1)
                    except Exception as err:
                        logger.debug("Opcua crawl error: %s", err)

            _crawl(root_node, initial_path, 0)
        except Exception as exc:
            logger.error("OpcuaDriver scan_all error: %s", exc)

        return all_tags
