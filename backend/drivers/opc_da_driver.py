"""
OPC DA (Classic) Client Driver for Windows using comtypes.

Connects natively to OPC DA 2.0 / 3.0 Servers (e.g. Kepware, Matrikon,
RSLinx, Schneider OFS, Siemens SIMATIC NET) without requiring 32-bit wrapper DLLs.

Address format
--------------
The exact OPC Item ID in the OPC Server, for example:
  - Channel1.Device1.TagName
  - _System._Time_Second
  - Simulation Items.Bucket Brigade.Float4
"""

from __future__ import annotations

import asyncio
import ctypes
import logging
from typing import Any, Dict, List, Optional, Tuple
import winreg

import comtypes
import comtypes.client
from comtypes import GUID, IUnknown, COMMETHOD, HRESULT
from comtypes.automation import VARIANT
from ctypes import c_wchar_p, POINTER, Structure, c_ushort, c_short, c_long, c_float
from ctypes.wintypes import DWORD, BOOL, LCID, WORD

from drivers.base_driver import BaseDriver

logger = logging.getLogger(__name__)

ole32 = ctypes.windll.ole32


# ----------------------------------------------------------------------
# OPC DA 2.0 COM Structures & Interfaces
# ----------------------------------------------------------------------

class OPCSERVERSTATUS(Structure):
    _fields_ = [
        ('ftStartTime', ctypes.c_uint64),
        ('ftCurrentTime', ctypes.c_uint64),
        ('ftLastUpdateTime', ctypes.c_uint64),
        ('dwServerState', DWORD),
        ('dwGroupCount', DWORD),
        ('dwBandWidth', DWORD),
        ('wMajorVersion', c_ushort),
        ('wMinorVersion', c_ushort),
        ('wBuildNumber', c_ushort),
        ('wReserved', c_ushort),
        ('szVendorInfo', c_wchar_p)
    ]


class OPCITEMDEF(Structure):
    _fields_ = [
        ('szAccessPath', c_wchar_p),
        ('szItemID', c_wchar_p),
        ('bActive', BOOL),
        ('hClient', DWORD),
        ('dwBlobSize', DWORD),
        ('pBlob', ctypes.c_void_p),
        ('vtRequestedDataType', c_ushort),
        ('wReserved', c_short)
    ]


class OPCITEMRESULT(Structure):
    _fields_ = [
        ('hServer', DWORD),
        ('vtCanonicalDataType', c_ushort),
        ('wReserved', c_short),
        ('dwAccessRights', DWORD),
        ('dwBlobSize', DWORD),
        ('pBlob', ctypes.c_void_p)
    ]


class OPCITEMSTATE(Structure):
    _fields_ = [
        ('hClient', DWORD),
        ('dwLowDateTime', DWORD),
        ('dwHighDateTime', DWORD),
        ('wQuality', WORD),
        ('wReserved', WORD),
        ('vDataValue', VARIANT)
    ]


IID_IOPCServer                  = GUID('{39C13A4D-011E-11D0-9675-0020AFD8adb3}')
IID_IOPCItemMgt                 = GUID('{39C13A54-011E-11D0-9675-0020AFD8adb3}')
IID_IOPCSyncIO                  = GUID('{39C13A52-011E-11D0-9675-0020AFD8adb3}')
IID_IOPCBrowseServerAddressSpace = GUID('{39C13A4F-011E-11D0-9675-0020AFD8adb3}')
IID_IEnumString                 = GUID('{00000101-0000-0000-C000-000000000046}')


class IEnumString(IUnknown):
    _iid_ = IID_IEnumString
    _methods_ = [
        COMMETHOD([], HRESULT, 'Next',
            (['in'], DWORD, 'celt'),
            (['out'], POINTER(c_wchar_p), 'rgelt'),
            (['out'], POINTER(DWORD), 'pceltFetched')),
        COMMETHOD([], HRESULT, 'Skip',
            (['in'], DWORD, 'celt')),
        COMMETHOD([], HRESULT, 'Reset'),
        COMMETHOD([], HRESULT, 'Clone',
            (['out'], POINTER(POINTER(IUnknown)), 'ppenum')),
    ]


class IOPCBrowseServerAddressSpace(IUnknown):
    _iid_ = IID_IOPCBrowseServerAddressSpace
    _methods_ = [
        COMMETHOD([], HRESULT, 'QueryOrganization',
            (['out'], POINTER(DWORD), 'pNameSpaceType')),
        COMMETHOD([], HRESULT, 'ChangeBrowsePosition',
            (['in'], DWORD, 'dwBrowseDirection'),
            (['in'], c_wchar_p, 'szString')),
        COMMETHOD([], HRESULT, 'BrowseOPCItemIDs',
            (['in'], DWORD, 'dwBrowseFilterType'),
            (['in'], c_wchar_p, 'szFilterCriteria'),
            (['in'], c_ushort, 'vtDataTypeFilter'),
            (['in'], DWORD, 'dwAccessRightsFilter'),
            (['out'], POINTER(POINTER(IEnumString)), 'ppIEnumString')),
        COMMETHOD([], HRESULT, 'GetItemID',
            (['in'], c_wchar_p, 'szItemDataID'),
            (['out'], POINTER(c_wchar_p), 'szItemID')),
        COMMETHOD([], HRESULT, 'BrowseAccessPaths',
            (['in'], c_wchar_p, 'szItemID'),
            (['out'], POINTER(POINTER(IUnknown)), 'ppIEnumString')),
    ]


class IOPCItemMgt(IUnknown):
    _iid_ = IID_IOPCItemMgt
    _methods_ = [
        COMMETHOD([], HRESULT, 'AddItems',
            (['in'], DWORD, 'dwCount'),
            (['in'], POINTER(OPCITEMDEF), 'pItemArray'),
            (['out'], POINTER(POINTER(OPCITEMRESULT)), 'ppAddResults'),
            (['out'], POINTER(POINTER(HRESULT)), 'ppErrors')),
        COMMETHOD([], HRESULT, 'ValidateItems',
            (['in'], DWORD, 'dwCount'),
            (['in'], POINTER(OPCITEMDEF), 'pItemArray'),
            (['in'], BOOL, 'bBlobUpdate'),
            (['out'], POINTER(POINTER(OPCITEMRESULT)), 'ppValidationResults'),
            (['out'], POINTER(POINTER(HRESULT)), 'ppErrors')),
        COMMETHOD([], HRESULT, 'RemoveItems',
            (['in'], DWORD, 'dwCount'),
            (['in'], POINTER(DWORD), 'phServer'),
            (['out'], POINTER(POINTER(HRESULT)), 'ppErrors')),
        COMMETHOD([], HRESULT, 'SetActiveState',
            (['in'], DWORD, 'dwCount'),
            (['in'], POINTER(DWORD), 'phServer'),
            (['in'], BOOL, 'bActive'),
            (['out'], POINTER(POINTER(HRESULT)), 'ppErrors')),
    ]


class IOPCSyncIO(IUnknown):
    _iid_ = IID_IOPCSyncIO
    _methods_ = [
        COMMETHOD([], HRESULT, 'Read',
            (['in'], DWORD, 'dwSource'),
            (['in'], DWORD, 'dwCount'),
            (['in'], POINTER(DWORD), 'phServer'),
            (['out'], POINTER(POINTER(OPCITEMSTATE)), 'ppItemValues'),
            (['out'], POINTER(POINTER(HRESULT)), 'ppErrors')),
        COMMETHOD([], HRESULT, 'Write',
            (['in'], DWORD, 'dwCount'),
            (['in'], POINTER(DWORD), 'phServer'),
            (['in'], POINTER(VARIANT), 'pItemValues'),
            (['out'], POINTER(POINTER(HRESULT)), 'ppErrors')),
    ]


class IOPCServer(IUnknown):
    _iid_ = IID_IOPCServer
    _methods_ = [
        COMMETHOD([], HRESULT, 'AddGroup',
            (['in'], c_wchar_p, 'szName'),
            (['in'], BOOL, 'bActive'),
            (['in'], DWORD, 'dwRequestedUpdateRate'),
            (['in'], DWORD, 'hClientGroup'),
            (['in'], POINTER(c_long), 'pTimeBias'),
            (['in'], POINTER(c_float), 'pPercentDeadband'),
            (['in'], DWORD, 'dwLCID'),
            (['out'], POINTER(DWORD), 'phServerGroup'),
            (['out'], POINTER(DWORD), 'pRevisedUpdateRate'),
            (['in'], POINTER(GUID), 'riid'),
            (['out'], POINTER(POINTER(IUnknown)), 'ppUnk')),
        COMMETHOD([], HRESULT, 'GetErrorString',
            (['in'], HRESULT, 'dwError'),
            (['in'], LCID, 'dwLocale'),
            (['out'], POINTER(c_wchar_p), 'ppString')),
        COMMETHOD([], HRESULT, 'GetGroupByName',
            (['in'], c_wchar_p, 'szName'),
            (['in'], POINTER(GUID), 'riid'),
            (['out'], POINTER(POINTER(IUnknown)), 'ppUnk')),
        COMMETHOD([], HRESULT, 'GetStatus',
            (['out'], POINTER(POINTER(OPCSERVERSTATUS)), 'ppServerStatus')),
        COMMETHOD([], HRESULT, 'RemoveGroup',
            (['in'], DWORD, 'hServerGroup'),
            (['in'], BOOL, 'bForce')),
        COMMETHOD([], HRESULT, 'CreateGroupEnumerator',
            (['in'], DWORD, 'dwScope'),
            (['in'], POINTER(GUID), 'riid'),
            (['out'], POINTER(POINTER(IUnknown)), 'ppUnk')),
    ]


def list_opc_da_servers() -> List[str]:
    """Discover installed OPC DA Servers from Windows Registry (both 32-bit and 64-bit)."""
    servers = set()

    # 1. Search Implemented Categories in WOW6432Node and 64-bit CLSID
    roots = [
        (winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\WOW6432Node\Classes\CLSID'),
        (winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\Classes\CLSID'),
        (winreg.HKEY_CLASSES_ROOT, 'CLSID'),
    ]
    for root, path in roots:
        try:
            with winreg.OpenKey(root, path) as clsid_key:
                num_subkeys = winreg.QueryInfoKey(clsid_key)[0]
                for i in range(num_subkeys):
                    try:
                        guid = winreg.EnumKey(clsid_key, i)
                        is_opc_da = False
                        try:
                            with winreg.OpenKey(clsid_key, f'{guid}\\Implemented Categories') as ic:
                                for k in range(winreg.QueryInfoKey(ic)[0]):
                                    cat = winreg.EnumKey(ic, k).upper()
                                    # Matches standard OPC DA 1.0, 2.0, 3.0 CATIDs and vendor variants (e.g. Phoenix Contact)
                                    if '63D5F4' in cat or 'CC6036' in cat or 'OPC' in cat:
                                        is_opc_da = True
                                        break
                        except OSError:
                            pass

                        if is_opc_da:
                            for sub in ['ProgID', 'VersionIndependentProgID']:
                                try:
                                    with winreg.OpenKey(clsid_key, f'{guid}\\{sub}') as pk:
                                        prog_id = winreg.QueryValue(pk, None)
                                        if prog_id and not any(x in prog_id.lower() for x in ['form', 'column', 'cell', 'line', 'property']):
                                            servers.add(prog_id)
                                except OSError:
                                    pass
                    except OSError:
                        pass
        except OSError:
            pass

    # 2. Well-known ProgIDs fallback
    common_progids = [
        'Kepware.KEPServerEX.V6',
        'Kepware.KEPServerEX.V5',
        'PhoenixContact.AX-Server.21',
        'PhoenixContact.AX-Server',
        'Matrikon.OPC.Simulation.1',
        'Schneider-Aut.OFS',
        'RSLinx OPC Server',
        'OPC.SimaticNET',
        'Yokogawa.Exaopc.DA.1',
        'ABB.OPCServer.DA',
        'CoDeSys.OPC.DA',
        'National Instruments.OPCFieldPoint',
    ]
    for p in common_progids:
        try:
            with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, p):
                servers.add(p)
        except OSError:
            pass

    return sorted(list(servers))


def _init_com():
    try:
        comtypes.CoInitializeEx(comtypes.COINIT_MULTITHREADED)
    except Exception:
        try:
            comtypes.CoInitialize()
        except Exception:
            pass


class OpcDaDriver(BaseDriver):
    """
    OPC DA 2.0 / 3.0 Client Driver using COM custom interfaces.
    """

    def __init__(self, connection_config: dict) -> None:
        super().__init__(connection_config)
        self._server = None
        self._group = None
        self._item_mgt = None
        self._sync_io = None
        self._browser = None
        self._server_group_handle: int = 0
        self._items: Dict[str, int] = {}  # address -> server_handle
        self._client_handle_counter: int = 1
        self._last_reconnect_attempt: float = 0.0
        self._lock = asyncio.Lock()

    def _get_prog_id(self) -> str:
        return (
            self._config.get("server_prog_id")
            or self._config.get("prog_id")
            or self._config.get("host")
            or "Kepware.KEPServerEX.V6"
        ).strip()

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------

    async def connect(self) -> bool:
        async with self._lock:
            return await asyncio.to_thread(self._sync_connect)

    def _sync_connect(self) -> bool:
        _init_com()
        try:
            prog_id = self._get_prog_id()
            logger.info("OpcDaDriver connecting to %s ...", prog_id)

            obj = comtypes.client.CreateObject(prog_id)
            self._server = obj.QueryInterface(IOPCServer)

            # Check status
            try:
                status_ptr = self._server.GetStatus()
                state = status_ptr.contents.dwServerState
                vendor = status_ptr.contents.szVendorInfo
                logger.info("OpcDaDriver connected: Vendor=%s State=%s", vendor, state)
                ole32.CoTaskMemFree(status_ptr)
            except Exception as e:
                logger.debug("OpcDaDriver GetStatus warning: %s", e)

            # Add a dedicated group for this gateway connection
            group_name = f"IndustrialGateway_{self._config.get('name', 'Group')}_{id(self)}"
            update_rate = int(self._config.get("update_rate_ms", 500))

            phGroup, pRevRate, pUnk = self._server.AddGroup(
                group_name,
                True,
                update_rate,
                1,
                None,
                None,
                0x0800,
                ctypes.byref(IID_IOPCItemMgt)
            )
            self._server_group_handle = phGroup
            self._group = pUnk
            self._item_mgt = pUnk.QueryInterface(IOPCItemMgt)
            self._sync_io = pUnk.QueryInterface(IOPCSyncIO)

            try:
                self._browser = obj.QueryInterface(IOPCBrowseServerAddressSpace)
            except Exception:
                self._browser = None

            self._items.clear()
            self._connected = True
            logger.info("OpcDaDriver established group '%s' (revised rate: %sms)", group_name, pRevRate)
            return True

        except Exception as exc:
            logger.error("OpcDaDriver connect error [%s]: %s", self._get_prog_id(), exc)
            self._connected = False
            self._server = None
            self._group = None
            self._item_mgt = None
            self._sync_io = None
            return False

    async def disconnect(self) -> None:
        async with self._lock:
            await asyncio.to_thread(self._sync_disconnect)

    def _sync_disconnect(self) -> None:
        try:
            if self._server and self._server_group_handle:
                self._server.RemoveGroup(self._server_group_handle, True)
        except Exception as exc:
            logger.debug("OpcDaDriver RemoveGroup error: %s", exc)
        finally:
            self._connected = False
            self._server = None
            self._group = None
            self._item_mgt = None
            self._sync_io = None
            self._browser = None
            self._items.clear()
            try:
                comtypes.CoUninitialize()
            except Exception:
                pass
            logger.info("OpcDaDriver disconnected")

    # ------------------------------------------------------------------
    # Read / Write
    # ------------------------------------------------------------------

    async def read_tag(self, address: str, data_type: str) -> Tuple[Any, str]:
        if not self._connected or self._sync_io is None:
            loop = asyncio.get_event_loop()
            now = loop.time()
            if now - self._last_reconnect_attempt < self._backoff_delay():
                return None, "Bad"
            self._last_reconnect_attempt = now
            ok = await self.connect()
            self._note_connect_result(bool(ok))
            if not ok:
                return None, "Bad"

        return await asyncio.to_thread(self._sync_read_tag, address, data_type)

    def _ensure_item(self, address: str) -> Optional[int]:
        """Ensure an OPC item is added to the group and return its server handle."""
        if address in self._items:
            return self._items[address]

        if not self._item_mgt:
            return None

        self._client_handle_counter += 1
        item_def = OPCITEMDEF('', address, True, self._client_handle_counter, 0, None, 0, 0)
        item_defs = (OPCITEMDEF * 1)(item_def)

        ppResults = None
        ppErrors = None
        try:
            ppResults, ppErrors = self._item_mgt.AddItems(1, item_defs)
            err = ppErrors[0] & 0xFFFFFFFF
            if err != 0:
                logger.warning("OpcDaDriver AddItem failed for '%s' (HRESULT: 0x%08X)", address, err)
                return None

            hServer = ppResults[0].hServer
            self._items[address] = hServer
            return hServer
        except Exception as exc:
            logger.error("OpcDaDriver _ensure_item exception for '%s': %s", address, exc)
            return None
        finally:
            if ppResults:
                ole32.CoTaskMemFree(ppResults)
            if ppErrors:
                ole32.CoTaskMemFree(ppErrors)

    def _sync_read_tag(self, address: str, data_type: str) -> Tuple[Any, str]:
        _init_com()
        try:
            hServer = self._ensure_item(address)
            if not hServer:
                return None, "Bad"

            handles = (DWORD * 1)(hServer)
            ppValues = None
            ppReadErrors = None
            try:
                # 2 = OPC_DS_DEVICE (or 1 = OPC_DS_CACHE)
                ppValues, ppReadErrors = self._sync_io.Read(2, 1, handles)
                err = ppReadErrors[0] & 0xFFFFFFFF
                if err != 0:
                    return None, "Bad"

                state = ppValues[0]
                quality = state.wQuality
                # In OPC DA: 0xC0 (192) indicates Good quality
                is_good = (quality & 0xC0) == 0xC0

                val = state.vDataValue.value

                # Cast according to requested data_type if needed
                if val is not None and is_good:
                    val = self._convert_value(val, data_type)

                return val, "Good" if is_good else "Bad"
            finally:
                if ppValues:
                    ole32.CoTaskMemFree(ppValues)
                if ppReadErrors:
                    ole32.CoTaskMemFree(ppReadErrors)

        except Exception as exc:
            logger.error("OpcDaDriver read_tag error [%s]: %s", address, exc)
            err_str = str(exc).lower()
            if any(k in err_str for k in ["0x800706ba", "rpc", "disconnected", "server execution failed"]):
                self._connected = False
            return None, "Bad"

    async def write_tag(self, address: str, value: Any, data_type: str) -> bool:
        if not self._connected or self._sync_io is None:
            ok = await self.connect()
            if not ok:
                return False

        return await asyncio.to_thread(self._sync_write_tag, address, value, data_type)

    def _sync_write_tag(self, address: str, value: Any, data_type: str) -> bool:
        _init_com()
        try:
            hServer = self._ensure_item(address)
            if not hServer:
                return False

            handles = (DWORD * 1)(hServer)
            v = VARIANT(self._convert_value(value, data_type))
            values = (VARIANT * 1)(v)

            ppErrors = None
            try:
                ppErrors = self._sync_io.Write(1, handles, values)
                err = ppErrors[0] & 0xFFFFFFFF
                return err == 0
            finally:
                if ppErrors:
                    ole32.CoTaskMemFree(ppErrors)
        except Exception as exc:
            logger.error("OpcDaDriver write_tag error [%s]: %s", address, exc)
            err_str = str(exc).lower()
            if any(k in err_str for k in ["0x800706ba", "rpc", "disconnected", "server execution failed"]):
                self._connected = False
            return False

    def _convert_value(self, val: Any, data_type: str) -> Any:
        try:
            if data_type == "bool":
                if isinstance(val, str):
                    return val.lower() in ("1", "true", "t", "on", "yes")
                return bool(val)
            elif data_type in ("int16", "uint16", "int32", "int32_swap"):
                return int(val)
            elif data_type in ("float32", "float32_swap", "float32_be", "float32_le", "float64"):
                return float(val)
            elif data_type == "string":
                return str(val)
            return val
        except Exception:
            return val

    # ------------------------------------------------------------------
    # Address Space Browser (for tag selection UI)
    # ------------------------------------------------------------------

    def _navigate_to(self, path: Optional[str] = None) -> None:
        """Reset to root, then navigate down each segment in path."""
        if not self._browser:
            return
        # Go to root
        try:
            self._browser.ChangeBrowsePosition(3, '')
        except Exception:
            for _ in range(10):
                try:
                    self._browser.ChangeBrowsePosition(1, '')
                except Exception:
                    break

        if not path:
            return

        parts = [p.strip() for p in path.replace('\\', '/').split('/') if p.strip()]
        for seg in parts:
            try:
                self._browser.ChangeBrowsePosition(2, seg)
            except Exception as e:
                logger.warning("ChangeBrowsePosition down into '%s' failed: %s", seg, e)
                break

    async def browse(self, path: Optional[str] = None) -> Dict[str, Any]:
        """Browse child branches and item leaves at path."""
        return await asyncio.to_thread(self._sync_browse, path)

    def _sync_browse(self, path: Optional[str] = None) -> Dict[str, Any]:
        _init_com()
        branches: List[str] = []
        leaves: List[Dict[str, str]] = []

        if not self._browser:
            return {"path": path or "", "branches": [], "leaves": []}

        try:
            self._navigate_to(path)

            # 1 = OPC_BRANCH
            enum_b = self._browser.BrowseOPCItemIDs(1, '', 0, 0)
            while True:
                elt, fetched = enum_b.Next(1)
                if fetched == 0:
                    break
                branches.append(elt)

            # 2 = OPC_LEAF
            enum_l = self._browser.BrowseOPCItemIDs(2, '', 0, 0)
            while True:
                elt, fetched = enum_l.Next(1)
                if fetched == 0:
                    break
                try:
                    item_id = self._browser.GetItemID(elt)
                except Exception:
                    item_id = f"{path.replace('/', '.')}.{elt}" if path else elt

                dt = "float32"
                elt_l = elt.lower()
                if any(k in elt_l for k in ["status", "cmd", "en", "run", "stop", "fault", "alm", "bool"]):
                    dt = "bool"
                elif any(k in elt_l for k in ["count", "num", "id", "index", "int"]):
                    dt = "int16"

                group_name = path.replace('\\', '/').strip('/') if path else ""
                if not group_name and item_id:
                    parts = item_id.replace('\\', '.').replace('/', '.').split('.')
                    if len(parts) >= 2:
                        group_name = "/".join(parts[:-1])
                if not group_name:
                    group_name = "default"

                leaves.append({
                    "name": elt,
                    "item_id": item_id,
                    "group": group_name,
                    "data_type": dt
                })

        except Exception as exc:
            logger.warning("OpcDaDriver browse error [%s]: %s", path, exc)

        return {"path": path or "", "branches": branches, "leaves": leaves}

    async def scan_all(self, start_path: Optional[str] = None, max_tags: int = 500) -> List[Dict[str, str]]:
        """Recursively scan all leaves under start_path (or root)."""
        return await asyncio.to_thread(self._sync_scan_all, start_path, max_tags)

    def _sync_scan_all(self, start_path: Optional[str] = None, max_tags: int = 500) -> List[Dict[str, str]]:
        _init_com()
        all_tags: List[Dict[str, str]] = []

        if not self._browser:
            return []

        def _crawl(current_parts: List[str], depth: int = 0):
            if depth > 8 or len(all_tags) >= max_tags:
                return

            path_str = "/".join(current_parts)
            self._navigate_to(path_str)

            # Read leaves
            try:
                enum_l = self._browser.BrowseOPCItemIDs(2, '', 0, 0)
                while len(all_tags) < max_tags:
                    elt, fetched = enum_l.Next(1)
                    if fetched == 0:
                        break
                    try:
                        item_id = self._browser.GetItemID(elt)
                    except Exception:
                        item_id = f"{'.'.join(current_parts)}.{elt}" if current_parts else elt

                    dt = "float32"
                    elt_l = elt.lower()
                    if any(k in elt_l for k in ["status", "cmd", "en", "run", "stop", "fault", "alm", "bool"]):
                        dt = "bool"
                    elif any(k in elt_l for k in ["count", "num", "id", "index", "int"]):
                        dt = "int16"

                    group_name = "/".join(current_parts) if current_parts else ""
                    if not group_name and item_id:
                        parts = item_id.replace('\\', '.').replace('/', '.').split('.')
                        if len(parts) >= 2:
                            group_name = "/".join(parts[:-1])
                    if not group_name:
                        group_name = "default"

                    all_tags.append({
                        "name": elt,
                        "item_id": item_id,
                        "group": group_name,
                        "data_type": dt
                    })
            except Exception as e:
                logger.debug("Scan leaves error at %s: %s", path_str, e)

            # Read sub-branches
            try:
                self._navigate_to(path_str)
                enum_b = self._browser.BrowseOPCItemIDs(1, '', 0, 0)
                sub_branches = []
                while True:
                    elt, fetched = enum_b.Next(1)
                    if fetched == 0:
                        break
                    sub_branches.append(elt)

                for sb in sub_branches:
                    if len(all_tags) >= max_tags:
                        break
                    _crawl(current_parts + [sb], depth + 1)
            except Exception as e:
                logger.debug("Scan branches error at %s: %s", path_str, e)

        start_parts = [p.strip() for p in start_path.replace('\\', '/').split('/') if p.strip()] if start_path else []
        _crawl(start_parts, 0)
        return all_tags
