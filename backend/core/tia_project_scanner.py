"""
Dual-Engine Scanner for Siemens TIA Portal Projects (.ap11-.ap21 / .zap11-.zap21)
and multi-file TIA exports (.db, .scl, .awl, .udt, .xml, .xlsx, .sdf).

Engine 1 (Official): Siemens TIA Portal Openness (.NET 4.8 PowerShell bridge)
  - Opens a temporary copy of .ap14-.ap21 / extracted .zapXX (never mutates original)
  - Or attaches directly to an already-open TIA Portal window
  - Exports UDTs, Global/Instance DBs, and PLC Tag Tables preserving folder hierarchy

Engine 2 (Offline Fallback):
  - Extracts .zapXX / inspects .apXX XML metadata (V11..V21)
  - Scans embedded sources / exports inside the project folder or multi-file uploads
  - Never fabricates fake offsets from binary System/PEData.plf; reports honest
    Openness setup & TIA V11-V13 upgrade/export guidance instead.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

if sys.platform == "win32":
    import winreg
else:
    winreg = None

from core.s7_importer import (
    _parse_step7_sdf,
    _parse_tia_db_source_blocks,
    _parse_tia_xlsx_bytes,
    _parse_tia_xml,
    build_s7_project_tree,
    extract_source_udts,
    parse_tia_xml_udt,
)

CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0
_TIA_JSON_START = "###TIA_JSON_START###"
_TIA_JSON_END = "###TIA_JSON_END###"


def _get_openness_ps1_path() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        cand = Path(sys._MEIPASS) / "core" / "tia_openness_export.ps1"
        if cand.exists():
            return cand
    return Path(__file__).resolve().parent / "tia_openness_export.ps1"


def _ensure_list(val: Any) -> List[Any]:
    if val is None:
        return []
    if isinstance(val, list):
        return val
    return [val]


def _decode_bytes(raw: bytes) -> str:
    for enc in ("utf-8-sig", "utf-16", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="ignore")


def _parse_version_tuple(label: str) -> Tuple[int, int]:
    nums = re.findall(r"\d+", label or "")
    if not nums:
        return (0, 0)
    major = int(nums[0])
    minor = int(nums[1]) if len(nums) > 1 else 0
    return (major, minor)


def _discover_installed_openness() -> List[Dict[str, Any]]:
    """Discover installed Siemens TIA Portal Openness DLLs (V14-V21+) from Registry & Program Files."""
    found: Dict[str, Dict[str, Any]] = {}

    def _register_dll(dll_path_str: str, hint_ver: str = "") -> None:
        p = Path(dll_path_str)
        if not p.is_file():
            return
        key = str(p.resolve()).lower()
        # Infer version label from path e.g. ...\PublicAPI\V15.1\... or ...\Portal V21\...
        m_pub = re.search(r"PublicAPI[\\/]V?([\d]+(?:[._]\d+)?)", str(p), re.IGNORECASE)
        m_por = re.search(r"Portal\s+V?([\d]+(?:[._]\d+)?)", str(p), re.IGNORECASE)
        ver_label = (
            m_pub.group(1).replace("_", ".")
            if m_pub
            else (m_por.group(1).replace("_", ".") if m_por else hint_ver.replace("_", "."))
        )
        major, minor = _parse_version_tuple(ver_label)
        display = f"V{ver_label}" if ver_label and not ver_label.upper().startswith("V") else (ver_label or f"V{major}")
        if key not in found:
            found[key] = {
                "version": display,
                "major": major,
                "minor": minor,
                "dll_path": str(p.resolve()),
            }

    if winreg is not None:
        access = winreg.KEY_READ | getattr(winreg, "KEY_WOW64_64KEY", 0)
        try:
            root_key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Siemens\Automation\Openness", 0, access)
        except OSError:
            root_key = None

        if root_key is not None:
            def _walk_reg(hkey, hint: str = ""):
                try:
                    _, num_vals, _ = winreg.QueryInfoKey(hkey)
                    for i in range(num_vals):
                        try:
                            _, val, _ = winreg.EnumValue(hkey, i)
                            if isinstance(val, str) and (
                                val.lower().endswith("siemens.engineering.dll")
                                or val.lower().endswith("siemens.engineering.base.dll")
                            ):
                                _register_dll(val, hint)
                        except OSError:
                            pass
                    idx = 0
                    while True:
                        try:
                            sub_name = winreg.EnumKey(hkey, idx)
                            idx += 1
                            with winreg.OpenKey(hkey, sub_name, 0, access) as sk:
                                _walk_reg(sk, hint or sub_name)
                        except OSError:
                            break
                except OSError:
                    pass

            with root_key:
                _walk_reg(root_key)

    # Filesystem fallback scan under standard Siemens Automation roots
    for base_env in ("ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"):
        base_dir = os.environ.get(base_env)
        if not base_dir:
            continue
        auto_dir = Path(base_dir) / "Siemens" / "Automation"
        if not auto_dir.is_dir():
            continue
        for pat in (
            "Portal V*/PublicAPI/*/Siemens.Engineering.dll",
            "Portal V*/PublicAPI/*/net48/Siemens.Engineering.Base.dll",
        ):
            for match in auto_dir.glob(pat):
                _register_dll(str(match))

    items = list(found.values())
    items.sort(key=lambda x: (x["major"], x["minor"], x["dll_path"]), reverse=True)
    return items


def _check_openness_group() -> Tuple[str, bool]:
    user_dom = os.environ.get("USERDOMAIN", "").strip()
    user_name = os.environ.get("USERNAME", "").strip()
    full_user = f"{user_dom}\\{user_name}" if user_dom and user_name else (user_name or "current user")
    if sys.platform != "win32":
        return full_user, False
    try:
        proc = subprocess.run(
            ["whoami", "/groups"],
            capture_output=True,
            timeout=5,
            creationflags=CREATE_NO_WINDOW,
        )
        out = _decode_bytes(proc.stdout or b"") + _decode_bytes(proc.stderr or b"")
        return full_user, ("siemens tia openness" in out.lower())
    except Exception:
        return full_user, False


def _is_tia_portal_running() -> bool:
    if sys.platform != "win32":
        return False
    try:
        proc = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq Siemens.Automation.Portal.exe", "/NH"],
            capture_output=True,
            timeout=5,
            creationflags=CREATE_NO_WINDOW,
        )
        out = _decode_bytes(proc.stdout or b"")
        return "siemens.automation.portal.exe" in out.lower()
    except Exception:
        return False


def _run_ps1_json(args: List[str], timeout: int = 120) -> Dict[str, Any]:
    ps1 = _get_openness_ps1_path()
    if not ps1.is_file():
        return {"ok": False, "error_code": "PS1_MISSING", "error": f"Thiếu script Openness: {ps1}"}

    cmd = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ps1)] + args
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            timeout=timeout,
            creationflags=CREATE_NO_WINDOW,
        )
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "error_code": "TIMEOUT",
            "error": f"Quá thời gian chờ TIA Openness ({timeout}s). Nếu TIA hiện popup xác nhận Openness, hãy chọn 'Yes to all'.",
        }
    except Exception as exc:
        return {"ok": False, "error_code": "EXEC_ERROR", "error": str(exc)}

    stdout_txt = _decode_bytes(proc.stdout or b"")
    stderr_txt = _decode_bytes(proc.stderr or b"")
    s_idx = stdout_txt.find(_TIA_JSON_START)
    e_idx = stdout_txt.find(_TIA_JSON_END)
    if s_idx >= 0 and e_idx > s_idx:
        raw_json = stdout_txt[s_idx + len(_TIA_JSON_START) : e_idx].strip()
        try:
            return json.loads(raw_json)
        except json.JSONDecodeError as exc:
            return {"ok": False, "error_code": "JSON_PARSE", "error": f"Lỗi JSON từ Openness: {exc}"}

    err_detail = stderr_txt.strip() or stdout_txt.strip() or f"Exit code {proc.returncode}"
    return {"ok": False, "error_code": "NO_OUTPUT", "error": err_detail}


def detect_tia_environment() -> Dict[str, Any]:
    """Return installed TIA Openness DLLs, Windows group status, and running TIA Portal windows."""
    installed = _discover_installed_openness()
    current_user, in_group = _check_openness_group()
    uname = os.environ.get("USERNAME", "$env:USERNAME")
    group_cmd = f'Add-LocalGroupMember -Group "Siemens TIA Openness" -Member "{uname}"'

    running_processes: List[Dict[str, Any]] = []
    if installed and _is_tia_portal_running():
        res = _run_ps1_json(["-Mode", "list_processes", "-DllPath", installed[0]["dll_path"]], timeout=20)
        if res.get("ok"):
            running_processes = _ensure_list(res.get("processes"))

    return {
        "is_windows": sys.platform == "win32",
        "current_user": current_user,
        "in_openness_group": in_group,
        "openness_group_cmd": group_cmd,
        "installed_versions": installed,
        "running_tia_processes": running_processes,
        "openness_ready": bool(installed) and in_group,
    }


def pick_local_tia_file() -> Dict[str, Any]:
    """Open native Windows file dialog for picking .ap11-.ap21 / .zap11-.zap21 / exports."""
    if sys.platform != "win32":
        return {"path": "", "filename": "", "cancelled": True}

    ps_script = (
        "Add-Type -AssemblyName System.Windows.Forms;"
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;"
        "$owner = New-Object System.Windows.Forms.Form;"
        "$owner.TopMost = $true;"
        "$owner.ShowInTaskbar = $false;"
        "$owner.StartPosition = 'Manual';"
        "$owner.Location = New-Object System.Drawing.Point(-20000, -20000);"
        "$owner.Size = New-Object System.Drawing.Size(1, 1);"
        "$owner.Show();"
        "$owner.Activate();"
        "$dlg = New-Object System.Windows.Forms.OpenFileDialog;"
        "$dlg.Title = 'Chon file du an TIA Portal (.ap11 - .ap21 / .zapXX) hoac file export';"
        "$dlg.Filter = 'TIA Portal Projects (*.ap11..*.ap21;*.zapXX)|*.ap11;*.ap12;*.ap13;*.ap14;*.ap15;*.ap15_1;*.ap16;*.ap17;*.ap18;*.ap19;*.ap20;*.ap21;*.zap11;*.zap12;*.zap13;*.zap14;*.zap15;*.zap15_1;*.zap16;*.zap17;*.zap18;*.zap19;*.zap20;*.zap21|TIA Exports (*.db;*.scl;*.awl;*.udt;*.xml;*.xlsx;*.sdf)|*.db;*.scl;*.awl;*.udt;*.xml;*.xlsx;*.sdf|All files (*.*)|*.*';"
        "$res = $dlg.ShowDialog($owner);"
        "$owner.Close();"
        "$owner.Dispose();"
        "if ($res -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output ('SELECTED::' + $dlg.FileName) } else { Write-Output 'CANCELLED::' }"
    )
    try:
        proc = subprocess.run(
            ["powershell.exe", "-STA", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps_script],
            capture_output=True,
            timeout=120,
            creationflags=CREATE_NO_WINDOW,
        )
        out = _decode_bytes(proc.stdout or b"")
        for line in out.splitlines():
            if line.startswith("SELECTED::"):
                sel = line[len("SELECTED::") :].strip()
                return {"path": sel, "filename": Path(sel).name if sel else "", "cancelled": not bool(sel)}
    except Exception:
        pass
    return {"path": "", "filename": "", "cancelled": True}


def inspect_ap_metadata(ap_path: Path) -> Dict[str, Any]:
    """Read TIA Portal version label & check companion System/PEData.plf next to .apXX."""
    ext = ap_path.suffix.lower()
    tia_major: Optional[int] = None
    tia_ver_label = ""
    m_ext = re.fullmatch(r"\.z?ap(\d+)(?:_(\d+))?", ext)
    if m_ext:
        tia_major = int(m_ext.group(1))
        tia_ver_label = f"V{tia_major}.{m_ext.group(2)}" if m_ext.group(2) else f"V{tia_major}"

    try:
        head = ap_path.read_bytes()[:65536]
        txt = _decode_bytes(head)
        m_eng = re.search(r'<Engineering\s+version="([^"]+)"', txt, re.IGNORECASE)
        if m_eng:
            eng_v = m_eng.group(1).strip()
            maj, _ = _parse_version_tuple(eng_v)
            if maj:
                tia_major = maj
                tia_ver_label = eng_v if eng_v.upper().startswith("V") else f"V{eng_v}"
    except OSError:
        pass

    has_pedata = (ap_path.parent / "System" / "PEData.plf").is_file()
    return {
        "project_name": ap_path.stem,
        "tia_major": tia_major,
        "tia_version_label": tia_ver_label or (f"V{tia_major}" if tia_major else "Unknown"),
        "has_pedata": has_pedata,
    }


def _select_openness_dll(
    installed: List[Dict[str, Any]],
    tia_major: Optional[int],
    preferred_version: str = "",
) -> Optional[Dict[str, Any]]:
    if not installed:
        return None
    if preferred_version.strip():
        pv = preferred_version.strip().lower().lstrip("v")
        for item in installed:
            if item["version"].lower().lstrip("v") == pv or str(item["major"]) == pv:
                return item

    if tia_major:
        # 1. Exact major version match
        for item in installed:
            if item["major"] == tia_major:
                return item
        # 2. Smallest installed major >= tia_major (preferred for OpenWithUpgrade)
        newer = [x for x in installed if x["major"] > tia_major]
        if newer:
            newer.sort(key=lambda x: (x["major"], x["minor"]))
            return newer[0]

    return installed[0]


def _tree_blocks_from_openness_manifest(
    manifest: Dict[str, Any],
    scan_rate_ms: int,
) -> Tuple[List[Dict[str, Any]], List[str]]:
    blocks_out: List[Dict[str, Any]] = []
    warnings: List[str] = [str(w) for w in _ensure_list(manifest.get("warnings")) if w]

    for plc in _ensure_list(manifest.get("plcs")):
        if not isinstance(plc, dict):
            continue
        plc_name = (plc.get("plc_name") or plc.get("device_name") or "PLC_1").strip()

        xml_udts: Dict[str, Any] = {}
        for u_entry in _ensure_list(plc.get("udts")):
            if not isinstance(u_entry, dict) or not u_entry.get("file"):
                continue
            try:
                utxt = _decode_bytes(Path(u_entry["file"]).read_bytes())
                xml_udts.update(parse_tia_xml_udt(utxt))
            except Exception as exc:
                warnings.append(f"Lỗi đọc UDT XML '{u_entry.get('name', '')}': {exc}")

        for b_entry in _ensure_list(plc.get("blocks")):
            if not isinstance(b_entry, dict) or not b_entry.get("file"):
                continue
            try:
                btxt = _decode_bytes(Path(b_entry["file"]).read_bytes())
                res = _parse_tia_xml(
                    btxt,
                    db_number=b_entry.get("number"),
                    default_group="",
                    scan_rate_ms=scan_rate_ms,
                    xml_udts=xml_udts,
                )
                warnings.extend(res.get("warnings") or [])
                b_name = (res.get("db_name") or b_entry.get("name") or "DB").strip()
                blocks_out.append({
                    "plc_name": plc_name,
                    "category": "Program Blocks",
                    "folder_parts": [str(p) for p in _ensure_list(b_entry.get("folder_parts")) if p],
                    "block_name": b_name,
                    "block_kind": "db",
                    "db_number": res.get("db_number") or b_entry.get("number"),
                    "optimized": bool(res.get("optimized_warning")),
                    "candidates": res.get("candidates") or [],
                })
            except Exception as exc:
                warnings.append(f"Lỗi đọc XML DB '{b_entry.get('name', '')}': {exc}")

        for t_entry in _ensure_list(plc.get("tag_tables")):
            if not isinstance(t_entry, dict) or not t_entry.get("file"):
                continue
            try:
                ttxt = _decode_bytes(Path(t_entry["file"]).read_bytes())
                res = _parse_tia_xml(
                    ttxt,
                    db_number=None,
                    default_group="",
                    scan_rate_ms=scan_rate_ms,
                    xml_udts=xml_udts,
                )
                warnings.extend(res.get("warnings") or [])
                t_name = (t_entry.get("name") or res.get("db_name") or "PLC_Tags").strip()
                blocks_out.append({
                    "plc_name": plc_name,
                    "category": "PLC Tags",
                    "folder_parts": [str(p) for p in _ensure_list(t_entry.get("folder_parts")) if p],
                    "block_name": t_name,
                    "block_kind": "tag_table",
                    "db_number": None,
                    "optimized": False,
                    "candidates": res.get("candidates") or [],
                })
            except Exception as exc:
                warnings.append(f"Lỗi đọc XML TagTable '{t_entry.get('name', '')}': {exc}")

    return blocks_out, list(dict.fromkeys(warnings))


def _scan_offline_directory(
    root_dir: Path,
    db_number: Optional[int],
    default_group: str,
    scan_rate_ms: int,
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Scan any exported .udt/.db/.scl/.awl/.xml/.xlsx/.sdf files inside a folder."""
    items: List[Tuple[str, bytes, List[str]]] = []
    exts = {".udt", ".db", ".scl", ".awl", ".xml", ".xlsx", ".sdf"}
    for fpath in sorted(root_dir.rglob("*")):
        if not fpath.is_file():
            continue
        if fpath.suffix.lower() not in exts:
            continue
        rel_parts = list(fpath.relative_to(root_dir).parts[:-1])
        # Strip standard TIA 'External source files' folder prefix for cleaner tree
        if rel_parts and rel_parts[0].lower() in ("external source files", "externalsources", "exports"):
            rel_parts = rel_parts[1:]
        try:
            raw = fpath.read_bytes()
        except OSError:
            continue
        # Only accept SimaticML XMLs, ignore .apXX / project internal XMLs
        if fpath.suffix.lower() == ".xml":
            head = _decode_bytes(raw[:4096])
            if not any(tok in head for tok in ("<SW.Blocks.", "<SW.Tags.", "<SW.Types.")):
                continue
        items.append((fpath.name, raw, rel_parts))

    return _parse_bundle_to_tree_blocks(
        items,
        db_number=db_number,
        default_group=default_group,
        scan_rate_ms=scan_rate_ms,
    )


def _parse_bundle_to_tree_blocks(
    items: List[Tuple[str, bytes, List[str]]],
    db_number: Optional[int],
    default_group: str,
    scan_rate_ms: int,
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Parse multiple (filename, raw_bytes, folder_parts) entries resolving UDTs across files."""
    combined_source_udts: Dict[str, Any] = {}
    combined_xml_udts: Dict[str, Any] = {}
    decoded_cache: List[Tuple[str, str, bytes, List[str]]] = []
    warnings: List[str] = []

    # Pass 1: Collect all UDTs (.udt/.scl source + Openness <SW.Types.PlcStruct> XML)
    for fname, raw, folder_parts in items:
        ext = Path(fname).suffix.lower()
        if ext == ".xlsx" or raw[:2] == b"PK":
            decoded_cache.append((fname, "", raw, folder_parts))
            continue
        text = _decode_bytes(raw)
        decoded_cache.append((fname, text, raw, folder_parts))
        if ext in (".udt", ".scl", ".db", ".awl") or re.search(r'(?im)^\s*TYPE\s+(?:"|\w)', text):
            combined_source_udts.update(extract_source_udts(text))
        if ext == ".xml" or text.lstrip().startswith("<?xml") or text.lstrip().startswith("<Document"):
            combined_xml_udts.update(parse_tia_xml_udt(text))

    # Pass 2: Parse all DBs / Tag Tables / Excel / SDF
    blocks_out: List[Dict[str, Any]] = []
    for fname, text, raw, folder_parts in decoded_cache:
        ext = Path(fname).suffix.lower()
        stem = Path(fname).stem

        if ext == ".xlsx" or raw[:2] == b"PK":
            try:
                res = _parse_tia_xlsx_bytes(raw, default_group=default_group, scan_rate_ms=scan_rate_ms)
                warnings.extend(res.get("warnings") or [])
                if res.get("candidates"):
                    blocks_out.append({
                        "plc_name": "",
                        "category": "PLC Tags",
                        "folder_parts": folder_parts,
                        "block_name": stem or "PLC Tags (.xlsx)",
                        "block_kind": "tag_table",
                        "db_number": None,
                        "optimized": False,
                        "candidates": res["candidates"],
                    })
            except Exception as exc:
                warnings.append(f"Lỗi đọc Excel '{fname}': {exc}")
            continue

        stripped = text.lstrip()
        if ext == ".xml" or stripped.startswith("<?xml") or stripped.startswith("<Document"):
            try:
                res = _parse_tia_xml(
                    text,
                    db_number=db_number,
                    default_group=default_group,
                    scan_rate_ms=scan_rate_ms,
                    xml_udts=combined_xml_udts,
                )
                warnings.extend(res.get("warnings") or [])
                # Skip pure UDT XML if DBs also exist (avoid duplicate DB1 template noise)
                is_pure_udt = "<SW.Types.PlcStruct" in text and "<SW.Blocks." not in text and "<SW.Tags." not in text
                if is_pure_udt and len(decoded_cache) > 1:
                    continue
                if res.get("candidates"):
                    fmt = res.get("detected_format")
                    is_tag_tbl = fmt == "tia_xml_tags"
                    blocks_out.append({
                        "plc_name": "",
                        "category": "PLC Tags" if is_tag_tbl else "Program Blocks",
                        "folder_parts": folder_parts,
                        "block_name": res.get("db_name") or stem,
                        "block_kind": "tag_table" if is_tag_tbl else "db",
                        "db_number": res.get("db_number"),
                        "optimized": bool(res.get("optimized_warning")),
                        "candidates": res["candidates"],
                    })
            except Exception as exc:
                warnings.append(f"Lỗi đọc XML '{fname}': {exc}")
            continue

        if ext == ".sdf":
            try:
                res = _parse_step7_sdf(text, default_group=default_group, scan_rate_ms=scan_rate_ms)
                if res.get("candidates"):
                    blocks_out.append({
                        "plc_name": "",
                        "category": "PLC Tags",
                        "folder_parts": folder_parts,
                        "block_name": stem or "Symbol Table",
                        "block_kind": "tag_table",
                        "db_number": None,
                        "optimized": False,
                        "candidates": res["candidates"],
                    })
            except Exception as exc:
                warnings.append(f"Lỗi đọc .sdf '{fname}': {exc}")
            continue

        # Source (.db / .scl / .awl / .udt)
        db_results = _parse_tia_db_source_blocks(
            text,
            db_number=db_number,
            default_group=default_group,
            scan_rate_ms=scan_rate_ms,
            extra_udts=combined_source_udts,
        )
        if db_results:
            for dbr in db_results:
                warnings.extend(dbr.get("warnings") or [])
                blocks_out.append({
                    "plc_name": "",
                    "category": "Program Blocks",
                    "folder_parts": folder_parts,
                    "block_name": dbr.get("db_name") or stem,
                    "block_kind": "db",
                    "db_number": dbr.get("db_number"),
                    "optimized": bool(dbr.get("optimized_warning")),
                    "candidates": dbr.get("candidates") or [],
                })
        elif ext == ".udt" and len(decoded_cache) == 1:
            # Single standalone UDT uploaded directly
            from core.s7_importer import _parse_tia_db_source
            res = _parse_tia_db_source(
                text,
                db_number=db_number,
                default_group=default_group,
                scan_rate_ms=scan_rate_ms,
                extra_udts=combined_source_udts,
            )
            warnings.extend(res.get("warnings") or [])
            if res.get("candidates"):
                blocks_out.append({
                    "plc_name": "",
                    "category": "Program Blocks",
                    "folder_parts": folder_parts,
                    "block_name": res.get("db_name") or stem,
                    "block_kind": "db",
                    "db_number": res.get("db_number"),
                    "optimized": False,
                    "candidates": res["candidates"],
                })

    return blocks_out, list(dict.fromkeys(warnings))


def scan_tia_project(
    project_path: str = "",
    attach_process_index: Optional[int] = None,
    preferred_version: str = "",
    scan_rate_ms: int = 100,
) -> Dict[str, Any]:
    """
    Scan a local TIA Portal project (.ap11-.ap21, .zap11-.zap21, folder) OR
    attach to a running TIA Portal instance using Dual-Engine scanner.
    Always operates on a temporary copy of .apXX/.zapXX so originals stay untouched.
    """
    scan_rate_ms = max(50, min(60000, int(scan_rate_ms)))
    installed = _discover_installed_openness()
    current_user, in_group = _check_openness_group()

    # Mode A: Attach directly to a running TIA Portal window
    if attach_process_index is not None:
        if not installed:
            raise ValueError("Máy chưa cài Siemens TIA Portal Openness.")
        dll = _select_openness_dll(installed, None, preferred_version=preferred_version)
        temp_dir = Path(tempfile.mkdtemp(prefix="tia_attach_"))
        try:
            res = _run_ps1_json(
                [
                    "-Mode", "attach",
                    "-DllPath", dll["dll_path"],
                    "-ProcessIndex", str(attach_process_index),
                    "-OutputDir", str(temp_dir),
                ],
                timeout=120,
            )
            if not res.get("ok"):
                err_code = res.get("error_code", "")
                if err_code == "OPENNESS_PERMISSION":
                    tree = build_s7_project_tree("TIA_Openness_Permission", [])
                    return {
                        "project_name": "TIA_Project",
                        "tia_version": dll["version"],
                        "engine_used": "none",
                        "openness_required": True,
                        "warnings": [
                            f"Tài khoản Windows '{current_user}' chưa thuộc nhóm 'Siemens TIA Openness'.",
                            res.get("error", ""),
                        ],
                        "total_tags": 0,
                        "tree": tree,
                        "message": "Cần cấp quyền nhóm 'Siemens TIA Openness' để đọc TIA Portal đang mở.",
                    }
                raise ValueError(res.get("error") or "Không thể gắn vào TIA Portal đang mở.")

            proj_name = (res.get("project_name") or "TIA_Project").strip()
            proj_ver = (res.get("project_version") or dll["version"]).strip()
            tree_blocks, warnings = _tree_blocks_from_openness_manifest(res, scan_rate_ms=scan_rate_ms)
            tree = build_s7_project_tree(proj_name, tree_blocks)
            total_tags = tree["tag_count"]
            return {
                "project_name": proj_name,
                "tia_version": proj_ver,
                "engine_used": "tia_openness_attach",
                "openness_required": False,
                "warnings": warnings,
                "total_tags": total_tags,
                "tree": tree,
                "message": f"Đã quét trực tiếp {total_tags} tag từ TIA Portal đang mở ({proj_name}).",
            }
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    # Mode B: Scan local .apXX / .zapXX / project folder (on a temporary copy!)
    raw_path = (project_path or "").strip().strip('"').strip("'")
    if not raw_path:
        raise ValueError("Vui lòng nhập hoặc chọn đường dẫn file .apXX / .zapXX.")
    src_path = Path(raw_path)
    if not src_path.exists():
        raise ValueError(f"Không tìm thấy đường dẫn: {src_path}")

    temp_dir = Path(tempfile.mkdtemp(prefix="tia_scan_"))
    try:
        proj_copy_dir = temp_dir / "project"
        proj_copy_dir.mkdir(parents=True, exist_ok=True)
        warnings: List[str] = []

        if src_path.is_file() and re.fullmatch(r"\.zap\d+(?:_\d+)?", src_path.suffix.lower()):
            try:
                with zipfile.ZipFile(src_path, "r") as zf:
                    zf.extractall(proj_copy_dir)
            except zipfile.BadZipFile as exc:
                raise ValueError(f"File nén TIA '{src_path.name}' không hợp lệ hoặc bị hỏng: {exc}")
            ap_candidates = sorted(proj_copy_dir.rglob("*.ap*"))
            ap_candidates = [p for p in ap_candidates if re.fullmatch(r"\.ap\d+(?:_\d+)?", p.suffix.lower())]
            if not ap_candidates:
                ap_path = proj_copy_dir / src_path.stem
                meta = {
                    "project_name": src_path.stem,
                    "tia_major": _parse_version_tuple(src_path.suffix)[0] or None,
                    "tia_version_label": src_path.suffix.upper().lstrip("."),
                    "has_pedata": False,
                }
            else:
                ap_path = ap_candidates[0]
                meta = inspect_ap_metadata(ap_path)
        elif src_path.is_dir():
            shutil.copytree(
                src_path,
                proj_copy_dir,
                dirs_exist_ok=True,
                ignore=shutil.ignore_patterns("*.lck", "~*", "Lock*"),
            )
            ap_candidates = [
                p for p in sorted(proj_copy_dir.rglob("*.ap*"))
                if re.fullmatch(r"\.ap\d+(?:_\d+)?", p.suffix.lower())
            ]
            if not ap_candidates:
                raise ValueError(f"Không tìm thấy file dự án .apXX trong thư mục: {src_path}")
            ap_path = ap_candidates[0]
            meta = inspect_ap_metadata(ap_path)
        else:
            # File .ap11..ap21 (copy sibling project folder so PEData.plf travels with it)
            if not re.fullmatch(r"\.ap\d+(?:_\d+)?", src_path.suffix.lower()):
                raise ValueError(f"Định dạng '{src_path.suffix}' không phải file dự án TIA Portal (.apXX/.zapXX).")
            shutil.copytree(
                src_path.parent,
                proj_copy_dir,
                dirs_exist_ok=True,
                ignore=shutil.ignore_patterns("*.lck", "~*", "Lock*"),
            )
            ap_path = proj_copy_dir / src_path.name
            meta = inspect_ap_metadata(ap_path)

        project_name = meta["project_name"] or src_path.stem
        tia_major = meta["tia_major"]
        tia_ver_label = meta["tia_version_label"]
        has_pedata = meta["has_pedata"]
        openness_required = False
        engine_used = "none"
        tree_blocks: List[Dict[str, Any]] = []

        if not has_pedata and ap_path.is_file():
            warnings.append(
                f"File '{src_path.name}' thiếu thư mục dữ liệu 'System\\PEData.plf' đi kèm. "
                "Lưu ý: file .apXX chỉ là file mục lục; dữ liệu DB nằm trong 'System\\PEData.plf' cùng thư mục dự án."
            )

        # Engine 1: Try Siemens TIA Portal Openness when V14+ project + PEData present + Openness installed
        if has_pedata and installed and (tia_major is None or tia_major >= 14):
            dll = _select_openness_dll(installed, tia_major, preferred_version=preferred_version)
            export_dir = temp_dir / "openness_export"
            export_dir.mkdir(parents=True, exist_ok=True)
            res = _run_ps1_json(
                [
                    "-Mode", "open",
                    "-DllPath", dll["dll_path"],
                    "-ProjectPath", str(ap_path),
                    "-OutputDir", str(export_dir),
                ],
                timeout=180,
            )
            if res.get("ok"):
                tree_blocks, open_warns = _tree_blocks_from_openness_manifest(res, scan_rate_ms=scan_rate_ms)
                warnings.extend(open_warns)
                engine_used = "tia_openness"
                if res.get("project_name"):
                    project_name = str(res["project_name"])
            else:
                err_code = res.get("error_code", "")
                err_msg = res.get("error", "")
                if err_code == "OPENNESS_PERMISSION" or not in_group:
                    openness_required = True
                    warnings.append(
                        f"Máy đã cài TIA Openness ({dll['version']}) nhưng tài khoản '{current_user}' chưa thuộc nhóm Windows 'Siemens TIA Openness'."
                    )
                else:
                    warnings.append(f"TIA Openness ({dll['version']}) không mở trực tiếp được bản sao dự án: {err_msg}")

        # Engine 2: Offline Fallback (scan exported sources / .zap contents / TIA V11-V13 notes)
        if not tree_blocks:
            off_blocks, off_warns = _scan_offline_directory(
                proj_copy_dir,
                db_number=None,
                default_group="",
                scan_rate_ms=scan_rate_ms,
            )
            if off_blocks:
                tree_blocks = off_blocks
                warnings.extend(off_warns)
                engine_used = "offline_sources"

        if not tree_blocks:
            if tia_major is not None and tia_major in (11, 12, 13):
                warnings.append(
                    f"Dự án TIA Portal {tia_ver_label} (trước V14) chưa có TIA Openness API và dùng cấu trúc nhị phân PEData.plf đóng của Siemens. "
                    "Bạn có 2 cách nhanh: (1) Mở trong TIA Portal -> chuột phải DB chọn 'Generate source from blocks' (.db/.udt) hoặc Export PLC Tags (.xlsx) nạp vào Tab 'Nhiều file xuất', "
                    "hoặc (2) nâng cấp dự án qua V13 SP2 -> V14+ rồi quét trực tiếp .apXX."
                )
            elif not installed:
                warnings.append(
                    "Máy Gateway hiện chưa cài Siemens TIA Portal Openness. Bạn vẫn có thể xuất .db/.udt/.xml/.xlsx từ TIA Portal hoặc dùng máy có cài TIA Portal để quét trực tiếp .apXX."
                )

        tree = build_s7_project_tree(project_name, tree_blocks)
        total_tags = tree["tag_count"]
        if total_tags > 0:
            msg = f"Đã quét {total_tags} tag từ dự án '{project_name}' ({tia_ver_label}, Engine: {engine_used})."
        elif openness_required:
            msg = "Cần thêm tài khoản Windows vào nhóm 'Siemens TIA Openness' để đọc trực tiếp DB/Tag bên trong file .apXX."
        else:
            msg = f"Đã đọc cấu trúc dự án '{project_name}' ({tia_ver_label}) nhưng chưa trích xuất được tag nào. Xem hướng dẫn bên dưới."

        return {
            "project_name": project_name,
            "tia_version": tia_ver_label,
            "engine_used": engine_used,
            "openness_required": openness_required,
            "warnings": list(dict.fromkeys(w for w in warnings if w)),
            "total_tags": total_tags,
            "tree": tree,
            "message": msg,
        }
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def scan_multi_files(
    files: List[Tuple[str, bytes]],
    db_number: Optional[int] = None,
    default_group: str = "",
    scan_rate_ms: int = 100,
) -> Dict[str, Any]:
    """Scan uploaded .zapXX archive OR multi-file bundle (.udt + .db + .xml + .xlsx + .sdf) into unified tree."""
    if not files:
        raise ValueError("Chưa chọn file nào để quét.")

    scan_rate_ms = max(50, min(60000, int(scan_rate_ms)))

    # Handle single .zap11-.zap21 compressed TIA Portal project
    if len(files) == 1:
        fname, raw = files[0]
        ext = Path(fname).suffix.lower()
        if re.fullmatch(r"\.zap\d+(?:_\d+)?", ext):
            tmp_dir = Path(tempfile.mkdtemp(prefix="tia_zap_"))
            try:
                zap_path = tmp_dir / Path(fname).name
                zap_path.write_bytes(raw)
                return scan_tia_project(project_path=str(zap_path), scan_rate_ms=scan_rate_ms)
            finally:
                shutil.rmtree(tmp_dir, ignore_errors=True)

        if re.fullmatch(r"\.ap\d+(?:_\d+)?", ext):
            meta = inspect_ap_metadata(Path(fname))
            try:
                head_txt = _decode_bytes(raw[:65536])
                m_eng = re.search(r'<Engineering\s+version="([^"]+)"', head_txt, re.IGNORECASE)
                ver = m_eng.group(1) if m_eng else meta["tia_version_label"]
            except Exception:
                ver = meta["tia_version_label"]
            proj = Path(fname).stem
            warn_msg = (
                f"Trình duyệt chỉ gửi riêng file chỉ mục '{fname}' ({ver}) mà không gửi kèm thư mục 'System\\PEData.plf'. "
                "Hãy dùng nút 'Chọn file trên máy' ở tab 'Dự án TIA (.ap11–.ap21)' để chọn đúng đường dẫn gốc trên máy, "
                "hoặc trong TIA Portal chọn Project -> Archive (.zapXX) rồi tải lên đây."
            )
            return {
                "project_name": proj,
                "tia_version": ver,
                "engine_used": "none",
                "openness_required": False,
                "warnings": [warn_msg],
                "total_tags": 0,
                "tree": build_s7_project_tree(proj, []),
                "message": "Cần chọn đường dẫn file .apXX trên máy (kèm thư mục dự án) hoặc tải file nén .zapXX.",
            }

    items: List[Tuple[str, bytes, List[str]]] = []
    for fname, raw in files:
        if raw:
            items.append((Path(fname).name, raw, []))

    blocks_out, warnings = _parse_bundle_to_tree_blocks(
        items,
        db_number=db_number,
        default_group=default_group,
        scan_rate_ms=scan_rate_ms,
    )
    proj_name = Path(files[0][0]).stem if len(files) == 1 else f"TIA_Import_{len(files)}_Files"
    tree = build_s7_project_tree(proj_name, blocks_out)
    total_tags = tree["tag_count"]
    return {
        "project_name": proj_name,
        "tia_version": "Multi-File Export",
        "engine_used": "offline_sources",
        "openness_required": False,
        "warnings": warnings,
        "total_tags": total_tags,
        "tree": tree,
        "message": f"Đã quét {total_tags} tag từ {len(files)} file xuất TIA Portal.",
    }
