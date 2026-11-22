"""
OPC-UA Server Service for Industrial Gateway with Security & Authentication support.

Runs an OPC-UA Server on opc.tcp://0.0.0.0:4840.
Exposes all active tags in folders grouped by Connection Name:
  Objects/
    IndustrialGateway/
      plc/
        BOM1_ACK (bool)
        BOM1_RT (float)
      MQTT1/
        DI1 (bool)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

if getattr(sys, "frozen", False):
    CONFIG_PATH = Path(sys.executable).parent / "opcua_config.json"
    CERT_DIR = Path(sys.executable).parent / "certs"
else:
    CONFIG_PATH = Path(__file__).parent.parent / "opcua_config.json"
    CERT_DIR = Path(__file__).parent.parent / "certs"

_OPCUA_AVAILABLE = False
try:
    import opcua
    from opcua import Server, ua
    _OPCUA_AVAILABLE = True
except ImportError:
    Server = None
    ua = None


def _load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning("Error reading opcua_config.json: %s", e)
    return {
        "port": 4840,
        "endpoint": "opc.tcp://0.0.0.0:4840/freeopcua/server/",
        "security_mode": "None",
        "require_auth": False,
        "username": "admin",
        "password": "password123",
        "server_name": "Industrial Gateway OPC-UA Server",
        "enabled": True,
    }


def _save_config(cfg: dict) -> None:
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
    except Exception as e:
        logger.error("Error writing opcua_config.json: %s", e)


def _generate_self_signed_cert(cert_path: Path, key_path: Path):
    """Generate self-signed certificate for OPC-UA security using cryptography."""
    try:
        from cryptography import x509
        from cryptography.hazmat.backends import default_backend
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID
        import datetime

        CERT_DIR.mkdir(parents=True, exist_ok=True)
        key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048,
            backend=default_backend()
        )

        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME, "Industrial Gateway OPC-UA Server"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Industrial Gateway"),
        ])

        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1))
            .not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3650))
            .sign(key, hashes.SHA256(), default_backend())
        )

        with open(key_path, "wb") as f:
            f.write(key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption(),
            ))

        with open(cert_path, "wb") as f:
            f.write(cert.public_bytes(serialization.Encoding.DER))

        logger.info("Generated OPC-UA certificates at %s", CERT_DIR)
        return True
    except Exception as e:
        logger.error("Failed to generate certificate: %s", e)
        return False


class OpcUaServerService:
    """
    Singleton OPC-UA Server that mirrors TagEngine values into OPC-UA nodes.
    Supports Security (Basic256Sha256) and User/Password authentication.
    """

    _instance: Optional["OpcUaServerService"] = None

    def __new__(cls) -> "OpcUaServerService":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._server: Optional[Server] = None
            cls._instance._running = False
            cls._instance._task: Optional[asyncio.Task] = None
            cls._instance._nodes: Dict[int, Any] = {}
            cls._instance._folders: Dict[str, Any] = {}
            cls._instance._sys_nodes: Dict[tuple, Any] = {}
            cls._instance._idx = 0
            cls._instance._root_folder = None
            cls._instance._config = _load_config()
            cls._instance._last_error = None
            cls._instance._auto_fallback = False
        return cls._instance

    @property
    def config(self) -> dict:
        return self._config

    def update_config(self, new_cfg: dict) -> dict:
        self._config.update(new_cfg)
        _save_config(self._config)
        return self._config

    async def restart(self) -> bool:
        await self.stop()
        return await self.start()

    @staticmethod
    def _is_port_in_use(host: str, port: int) -> bool:
        """Check if a TCP port is already bound by another process."""
        import socket
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind((host, port))
                return False
            except OSError:
                return True

    async def start(self, host: str = "0.0.0.0", port: Optional[int] = None) -> bool:
        if not _OPCUA_AVAILABLE:
            self._last_error = "Thư viện python-opcua chưa được nạp. Không thể khởi động OPC-UA Server."
            logger.warning("opcua library not available. OPC-UA Server will not start.")
            return False

        if self._running:
            return True

        self._config = _load_config()
        if not self._config.get("enabled", True):
            self._last_error = "OPC-UA Server đang bị tắt trong cấu hình."
            logger.info("OPC-UA Server is disabled in config.")
            return False

        port = port or self._config.get("port", 4840)
        self._auto_fallback = False

        # Check if the requested port is already occupied (e.g., Kepware, Windows LDS, etc.)
        if self._is_port_in_use(host, port):
            logger.warning("Port %d is already occupied on %s", port, host)
            # If the occupied port is the default 4840, automatically fallback to 4841, 4842...
            if port == 4840:
                fallback_port = 4841
                while fallback_port < 4855 and self._is_port_in_use(host, fallback_port):
                    fallback_port += 1
                
                if not self._is_port_in_use(host, fallback_port):
                    logger.info("Auto-switching OPC-UA Server from occupied port 4840 to free port %d", fallback_port)
                    port = fallback_port
                    self._auto_fallback = True
                    self._config["port"] = port
                    self._config["endpoint"] = f"opc.tcp://0.0.0.0:{port}/freeopcua/server/"
                    _save_config(self._config)
                    self._last_error = f"Cổng 4840 mặc định đã bị phần mềm khác (như Kepware hoặc dịch vụ OPC của Windows) chiếm dụng. Hệ thống đã tự động chuyển sang cổng {port} để khởi động thành công."
                else:
                    self._last_error = f"Cổng {port} đang bị ứng dụng khác chiếm dụng ([WinError 10048]). Vui lòng đổi sang cổng khác (ví dụ: 4845, 49320) trong trang Cài Đặt."
                    self._running = False
                    return False
            else:
                self._last_error = f"Cổng {port} đang bị ứng dụng khác trên máy chiếm dụng ([WinError 10048]). Vui lòng chọn cổng khác rồi bấm 'Lưu & Khởi Động Lại Server'."
                self._running = False
                return False

        sec_mode = self._config.get("security_mode", "None")  # "None", "Sign", "SignAndEncrypt"
        require_auth = self._config.get("require_auth", False)
        username = self._config.get("username", "admin")
        password = self._config.get("password", "password123")

        try:
            loop = asyncio.get_event_loop()
            self._server = Server()
            endpoint = f"opc.tcp://{host}:{port}/freeopcua/server/"
            self._server.set_endpoint(endpoint)
            self._server.set_server_name(self._config.get("server_name", "Industrial Gateway OPC-UA Server"))

            # Security configuration
            if sec_mode in ("Sign", "SignAndEncrypt"):
                cert_file = CERT_DIR / "server_cert.der"
                key_file = CERT_DIR / "server_key.pem"
                if not cert_file.exists() or not key_file.exists():
                    _generate_self_signed_cert(cert_file, key_file)

                if cert_file.exists() and key_file.exists():
                    self._server.load_certificate(str(cert_file))
                    self._server.load_private_key(str(key_file))

                    sec_policies = []
                    if sec_mode == "Sign":
                        sec_policies = [
                            ua.SecurityPolicyType.Basic256Sha256_Sign,
                            ua.SecurityPolicyType.Basic128Rsa15_Sign,
                        ]
                    else:
                        sec_policies = [
                            ua.SecurityPolicyType.Basic256Sha256_SignAndEncrypt,
                            ua.SecurityPolicyType.Basic128Rsa15_SignAndEncrypt,
                        ]
                    self._server.set_security_policy(sec_policies)
                    logger.info("OPC-UA Security Policy enabled: %s", sec_mode)

            # User authentication (User / Password)
            if require_auth:
                self._server.user_manager.set_user_credentials(username, password)
                logger.info("OPC-UA User Authentication required for user: %s", username)

            # Setup namespace
            uri = "http://industrial.gateway.org"
            self._idx = self._server.register_namespace(uri)

            # Get Objects node as root folder (matching Kepware standard: Channels/Connections directly under Objects)
            self._root_folder = self._server.get_objects_node()

            # Start OPC-UA server in executor
            await loop.run_in_executor(None, self._server.start)
            self._running = True
            if not self._auto_fallback:
                self._last_error = None
            logger.info("=== OPC-UA Server started at %s (Security: %s, Auth: %s) ===", endpoint, sec_mode, require_auth)

            # Start sync loop
            self._task = asyncio.create_task(self._sync_loop(), name="opcua_sync_loop")
            return True
        except Exception as exc:
            err_str = str(exc)
            if "10048" in err_str or "bind" in err_str.lower():
                self._last_error = f"Cổng {port} đang bị ứng dụng khác (Kepware, OPC LDS...) chiếm dụng ([WinError 10048]). Vui lòng đổi sang cổng khác (ví dụ: 4841, 49320)."
            else:
                self._last_error = f"Lỗi khởi động OPC-UA Server: {err_str}"
            logger.error("Failed to start OPC-UA Server: %s", exc)
            self._running = False
            return False

    async def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

        if self._server:
            try:
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, self._server.stop)
                logger.info("OPC-UA Server stopped")
            except Exception as exc:
                logger.error("Error stopping OPC-UA Server: %s", exc)
            finally:
                self._server = None
                self._nodes.clear()
                self._folders.clear()
                self._sys_nodes.clear()
        await asyncio.sleep(0.3)

    async def _sync_loop(self) -> None:
        from datetime import datetime, timezone
        from core.driver_manager import DriverManager
        from core.tag_engine import TagEngine
        from db.database import get_db

        dm = DriverManager()
        engine = TagEngine()
        loop = asyncio.get_event_loop()
        tag_meta_cache = {}
        last_synced_values = {}
        tag_defs = []
        conn_defs = []
        loop_counter = 0

        while self._running:
            try:
                # Refresh tag & connection definitions from DB on first run and every 3rd cycle (~3s)
                if loop_counter % 3 == 0 or (not tag_defs and not conn_defs):
                    async with get_db() as db:
                        async with db.execute(
                            "SELECT t.id, t.connection_id, t.name as tag_name, t.data_type, t.tag_group, t.access, c.name as conn_name "
                            "FROM tags t JOIN connections c ON t.connection_id = c.id "
                            "WHERE t.enabled = 1 AND c.enabled = 1"
                        ) as cursor:
                            rows = await cursor.fetchall()
                        async with db.execute(
                            "SELECT id, name FROM connections WHERE enabled = 1 ORDER BY id"
                        ) as cursor:
                            conn_rows = await cursor.fetchall()

                    tag_defs = [dict(r) for r in rows]
                    conn_defs = [dict(r) for r in conn_rows]
                    current_tag_ids = {t["id"] for t in tag_defs}
                    current_conn_names = {c["name"] for c in conn_defs}

                    # Check if any tag definition changed group/name/type/access or was deleted
                    meta_changed = False
                    for t in tag_defs:
                        tid = t["id"]
                        t_meta = (
                            t["conn_name"],
                            (t.get("tag_group") or "").strip(),
                            t["tag_name"],
                            t["data_type"],
                            (t.get("access") or "rw"),
                        )
                        if tid in tag_meta_cache and tag_meta_cache[tid] != t_meta:
                            meta_changed = True
                            break
                        tag_meta_cache[tid] = t_meta

                    if set(self._nodes.keys()) - current_tag_ids:
                        meta_changed = True
                    # Check if any previously exposed connection was disabled/removed
                    existing_sys_conns = {k[0] for k in self._sys_nodes.keys()}
                    if existing_sys_conns - current_conn_names:
                        meta_changed = True

                    if meta_changed:
                        logger.info("OPC-UA Server: tag/connection structure changed, rebuilding address space...")
                        old_nodes = list(self._nodes.values()) + list(self._sys_nodes.values())
                        if old_nodes and self._server:
                            try:
                                await loop.run_in_executor(None, self._server.delete_nodes, old_nodes)
                            except Exception as del_exc:
                                logger.debug("Error deleting old OPC-UA nodes: %s", del_exc)
                        self._nodes.clear()
                        self._folders.clear()
                        self._sys_nodes.clear()
                        last_synced_values.clear()
                        tag_meta_cache = {
                            t["id"]: (
                                t["conn_name"],
                                (t.get("tag_group") or "").strip(),
                                t["tag_name"],
                                t["data_type"],
                                (t.get("access") or "rw"),
                            )
                            for t in tag_defs
                        }

                    # Ensure connection folders + _System tags exist for every enabled connection
                    sys_specs = (
                        ("_Connected", ua.Variant(False, ua.VariantType.Boolean)),
                        ("_Error", ua.Variant(True, ua.VariantType.Boolean)),
                        ("_Demoted", ua.Variant(False, ua.VariantType.Boolean)),
                        ("_TagCount", ua.Variant(0, ua.VariantType.Int32)),
                        ("_GoodCount", ua.Variant(0, ua.VariantType.Int32)),
                        ("_BadCount", ua.Variant(0, ua.VariantType.Int32)),
                        ("_Timestamp", ua.Variant("", ua.VariantType.String)),
                    )
                    for c in conn_defs:
                        cname = c["name"]
                        if cname not in self._folders:
                            conn_node_id = ua.NodeId(cname, self._idx)
                            try:
                                conn_folder = await loop.run_in_executor(
                                    None,
                                    self._root_folder.add_folder,
                                    conn_node_id,
                                    ua.QualifiedName(cname, self._idx),
                                )
                            except Exception:
                                conn_folder = self._server.get_node(conn_node_id)
                            self._folders[cname] = conn_folder

                        sys_key = f"{cname}/_System"
                        if sys_key not in self._folders:
                            sys_node_id = ua.NodeId(f"{cname}._System", self._idx)
                            try:
                                sys_folder = await loop.run_in_executor(
                                    None,
                                    self._folders[cname].add_folder,
                                    sys_node_id,
                                    ua.QualifiedName("_System", self._idx),
                                )
                            except Exception:
                                sys_folder = self._server.get_node(sys_node_id)
                            self._folders[sys_key] = sys_folder

                        sys_folder = self._folders[sys_key]
                        for var_name, init_var in sys_specs:
                            if (cname, var_name) not in self._sys_nodes:
                                nid = ua.NodeId(f"{cname}._System.{var_name}", self._idx)
                                try:
                                    ua_sys = await loop.run_in_executor(
                                        None,
                                        sys_folder.add_variable,
                                        nid,
                                        ua.QualifiedName(var_name, self._idx),
                                        init_var,
                                    )
                                except Exception:
                                    ua_sys = self._server.get_node(nid)
                                self._sys_nodes[(cname, var_name)] = ua_sys

                    # Create folders and variables according to Kepware hierarchy:
                    # Objects -> Connection (e.g. plc) -> Tag Group (e.g. BOM_1) -> Tag (e.g. ACK)
                    for t in tag_defs:
                        tag_id = t["id"]
                        conn_name = t["conn_name"]
                        tag_group = (t.get("tag_group") or "").strip()
                        tag_name = t["tag_name"]
                        data_type = (t["data_type"] or "float32").lower()

                        # 1. Connection Folder directly under Objects (matches Kepware Channels/Devices)
                        if conn_name not in self._folders:
                            conn_node_id = ua.NodeId(conn_name, self._idx)
                            try:
                                conn_folder = await loop.run_in_executor(
                                    None,
                                    self._root_folder.add_folder,
                                    conn_node_id,
                                    ua.QualifiedName(conn_name, self._idx),
                                )
                            except Exception:
                                conn_folder = self._server.get_node(conn_node_id)
                            self._folders[conn_name] = conn_folder

                        conn_folder = self._folders[conn_name]

                        # 2. Group Folders (supports nested folders: e.g. BOM_1 or BOM_1/SUB_1)
                        if tag_group and tag_group.lower() != "default":
                            parts = [p.strip() for p in tag_group.split("/") if p.strip()]
                            curr_parent_folder = conn_folder
                            path_accum = conn_name
                            for part in parts:
                                prev_path = path_accum
                                path_accum = f"{prev_path}/{part}"
                                if path_accum not in self._folders:
                                    grp_node_id = ua.NodeId(path_accum.replace("/", "."), self._idx)
                                    try:
                                        sub_folder = await loop.run_in_executor(
                                            None,
                                            curr_parent_folder.add_folder,
                                            grp_node_id,
                                            ua.QualifiedName(part, self._idx),
                                        )
                                    except Exception:
                                        sub_folder = self._server.get_node(grp_node_id)
                                    self._folders[path_accum] = sub_folder
                                curr_parent_folder = self._folders[path_accum]

                            target_folder = curr_parent_folder
                            scada_path = tag_group.replace("/", ".")
                            var_node_id = ua.NodeId(f"{conn_name}.{scada_path}.{tag_name}", self._idx)
                        else:
                            target_folder = conn_folder
                            var_node_id = ua.NodeId(f"{conn_name}.{tag_name}", self._idx)

                        # 3. Add Tag Variable with exact VariantType matching set_value
                        if tag_id not in self._nodes:
                            if data_type == "bool":
                                init_variant = ua.Variant(False, ua.VariantType.Boolean)
                            elif data_type == "float64":
                                init_variant = ua.Variant(0.0, ua.VariantType.Double)
                            elif "float" in data_type:
                                init_variant = ua.Variant(0.0, ua.VariantType.Float)
                            elif "int" in data_type:
                                init_variant = ua.Variant(0, ua.VariantType.Int32)
                            else:
                                init_variant = ua.Variant("", ua.VariantType.String)

                            try:
                                ua_var = await loop.run_in_executor(
                                    None,
                                    target_folder.add_variable,
                                    var_node_id,
                                    ua.QualifiedName(tag_name, self._idx),
                                    init_variant,
                                )
                                # Honour per-tag Read-Only vs Read/Write permission
                                if (t.get("access") or "rw") != "ro":
                                    await loop.run_in_executor(None, ua_var.set_writable)
                            except Exception:
                                ua_var = self._server.get_node(var_node_id)
                            self._nodes[tag_id] = ua_var

                loop_counter += 1

                # Update _System diagnostic variables for each enabled connection
                all_vals = engine.get_all_values()
                conn_counts: Dict[int, list] = {}  # cid -> [total, good, bad]
                for t in tag_defs:
                    cid = t["connection_id"]
                    c_arr = conn_counts.setdefault(cid, [0, 0, 0])
                    c_arr[0] += 1
                    q = all_vals.get(t["id"], {}).get("quality", "Unknown")
                    if q == "Good":
                        c_arr[1] += 1
                    else:
                        c_arr[2] += 1

                now_iso = datetime.now(timezone.utc).isoformat()
                for c in conn_defs:
                    cid = c["id"]
                    cname = c["name"]
                    drv = dm.get_driver(cid)
                    is_conn = bool(drv.is_connected()) if drv else False
                    is_dem = bool(getattr(drv, "is_demoted", False)) if drv else False
                    total_c, good_c, bad_c = conn_counts.get(cid, [0, 0, 0])
                    sys_updates = (
                        ("_Connected", ua.Variant(is_conn, ua.VariantType.Boolean)),
                        ("_Error", ua.Variant(not is_conn, ua.VariantType.Boolean)),
                        ("_Demoted", ua.Variant(is_dem, ua.VariantType.Boolean)),
                        ("_TagCount", ua.Variant(int(total_c), ua.VariantType.Int32)),
                        ("_GoodCount", ua.Variant(int(good_c), ua.VariantType.Int32)),
                        ("_BadCount", ua.Variant(int(bad_c), ua.VariantType.Int32)),
                        ("_Timestamp", ua.Variant(now_iso, ua.VariantType.String)),
                    )
                    for var_name, var_val in sys_updates:
                        ua_sys = self._sys_nodes.get((cname, var_name))
                        if ua_sys is not None:
                            try:
                                await loop.run_in_executor(None, ua_sys.set_value, ua.DataValue(var_val))
                            except Exception:
                                pass

                # Sync live values from TagEngine cache to OPC-UA variables,
                # and detect if a SCADA client wrote a new value to OPC-UA
                for t in tag_defs:
                    tag_id = t["id"]
                    data_type = (t["data_type"] or "float32").lower()
                    is_readonly = (t.get("access") or "rw") == "ro"
                    cached = all_vals.get(tag_id) or {"value": None}
                    engine_val = cached.get("value")

                    if tag_id in self._nodes:
                        ua_node = self._nodes[tag_id]

                        # Check if SCADA client wrote a value into OPC-UA node (skip Read-Only tags)
                        if not is_readonly:
                            try:
                                current_opcua_val = await loop.run_in_executor(None, ua_node.get_value)
                                last_synced = last_synced_values.get(tag_id)

                                if (
                                    last_synced is not None
                                    and current_opcua_val != last_synced
                                    and current_opcua_val != engine_val
                                ):
                                    # SCADA client performed a write!
                                    logger.info(
                                        "OPC-UA Client write detected on tag_id=%d (%s): %s -> forwarding to driver",
                                        tag_id, t["tag_name"], current_opcua_val
                                    )
                                    await engine.write_tag(tag_id, current_opcua_val)
                                    last_synced_values[tag_id] = current_opcua_val
                                    continue
                            except Exception:
                                pass

                        # Push latest value from TagEngine to OPC-UA variable
                        if engine_val is not None:
                            try:
                                if data_type == "bool":
                                    typed_val = bool(engine_val)
                                    ua_val = ua.DataValue(ua.Variant(typed_val, ua.VariantType.Boolean))
                                elif data_type == "float64":
                                    typed_val = float(engine_val)
                                    ua_val = ua.DataValue(ua.Variant(typed_val, ua.VariantType.Double))
                                elif "float" in data_type:
                                    typed_val = float(engine_val)
                                    ua_val = ua.DataValue(ua.Variant(typed_val, ua.VariantType.Float))
                                elif "int" in data_type:
                                    typed_val = int(engine_val)
                                    ua_val = ua.DataValue(ua.Variant(typed_val, ua.VariantType.Int32))
                                else:
                                    typed_val = str(engine_val)
                                    ua_val = ua.DataValue(ua.Variant(typed_val, ua.VariantType.String))

                                if last_synced_values.get(tag_id) != typed_val:
                                    await loop.run_in_executor(None, ua_node.set_value, ua_val)
                                    last_synced_values[tag_id] = typed_val
                            except Exception as val_exc:
                                logger.debug("OPC-UA set_value error on tag_id=%d (%s): %s", tag_id, data_type, val_exc)

            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("OPC-UA sync loop error: %s", exc)

            await asyncio.sleep(1.0)
