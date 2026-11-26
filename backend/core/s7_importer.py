"""
Siemens TIA Portal / STEP 7 Tag Importer.

Supports:
  1. TIA Portal / STEP 7 DB & UDT source exports (.db, .scl, .awl, .udt)
     with exact Siemens S7 Classic (non-optimized) byte/word offset alignment.
  2. TIA Portal Openness XML exports (.xml): GlobalDB & PlcTagTable.
  3. TIA Portal PLC Tags Excel exports (.xlsx) using pure stdlib zipfile + XML.
  4. Direct Copy-Paste TSV/CSV from TIA Portal DB Editor (using TIA Offset column).
  5. STEP 7 Classic Symbol Table exports (.sdf).
"""

from __future__ import annotations

import csv
import io
import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple


MAX_ARRAY_EXPAND = 512

# Scalar Siemens S7 Classic layout:
#   type_key -> (byte_size, align_even_word, s7_suffix, gateway_dtype)
#   special handled types: bool, string, wstring, skipped 8-byte ints, built-in structs
_SCALAR_MAP: Dict[str, Tuple[int, bool, str, str]] = {
    "byte":        (1, False, "DBB", "uint16"),
    "usint":       (1, False, "DBB", "uint16"),
    "sint":        (1, False, "DBB", "int16"),
    "char":        (1, False, "DBB", "int16"),
    "int":         (2, True,  "DBW", "int16"),
    "uint":        (2, True,  "DBW", "uint16"),
    "word":        (2, True,  "DBW", "uint16"),
    "s5time":      (2, True,  "DBW", "uint16"),
    "date":        (2, True,  "DBW", "uint16"),
    "wchar":       (2, True,  "DBW", "uint16"),
    "dint":        (4, True,  "DBD", "int32"),
    "udint":       (4, True,  "DBD", "int32"),
    "dword":       (4, True,  "DBD", "int32"),
    "time":        (4, True,  "DBD", "int32"),
    "tod":         (4, True,  "DBD", "int32"),
    "time_of_day": (4, True,  "DBD", "int32"),
    "real":        (4, True,  "DBD", "float32"),
    "lreal":       (8, True,  "DBL", "float64"),
}

_SYSTEM_STRUCT_SIZES: Dict[str, int] = {
    "date_and_time": 8,
    "dt": 8,
    "dtl": 12,
    "iec_timer": 16,
    "ton_time": 16,
    "tof_time": 16,
    "tp_time": 16,
    "tonr_time": 16,
    "iec_counter": 6,
    "ctu_int": 6,
    "ctu_dint": 12,
    "ctd_int": 6,
    "ctd_dint": 12,
    "ctud_int": 8,
    "ctud_dint": 16,
    "iec_scounter": 4,
    "iec_ucounter": 6,
}

_UNSUPPORTED_64BIT_INTS = {"lint", "ulint", "lword", "ltime", "ldt", "ltod"}


@dataclass
class _S7OffsetCursor:
    """Tracks Siemens S7 non-optimized DB byte/bit offset."""

    db_number: int
    byte_offset: int = 0
    bit_offset: int = 0
    warnings: List[str] = field(default_factory=list)

    def align_byte(self) -> None:
        if self.bit_offset > 0:
            self.byte_offset += 1
            self.bit_offset = 0

    def align_word(self) -> None:
        self.align_byte()
        if self.byte_offset % 2 != 0:
            self.byte_offset += 1

    def alloc_bool(self) -> Tuple[str, str]:
        b = self.byte_offset
        bit = self.bit_offset
        self.bit_offset += 1
        if self.bit_offset >= 8:
            self.byte_offset += 1
            self.bit_offset = 0
        return f"DB{self.db_number}.DBX{b}.{bit}", f"{b}.{bit}"

    def alloc_scalar(self, tia_type: str) -> Optional[Tuple[str, str, str]]:
        """
        Allocate scalar field and return (s7_address, gateway_dtype, offset_str),
        or None if skipped (after advancing cursor accurately).
        """
        raw_t = (tia_type or "").strip()
        norm_t = _normalize_tia_type(raw_t)
        base_lower = norm_t.lower()

        if base_lower == "bool":
            addr, off = self.alloc_bool()
            return addr, "bool", off

        # String / String[N]
        m_str = re.fullmatch(r"string(?:\s*\[\s*(\d+)\s*\])?", base_lower)
        if m_str:
            max_len = int(m_str.group(1)) if m_str.group(1) else 254
            max_len = max(1, min(254, max_len))
            self.align_word()
            b = self.byte_offset
            self.byte_offset += 2 + max_len
            return f"DB{self.db_number}.DBS{b}.{max_len}", "string", f"{b}.0"

        # WString / WString[N]
        m_wstr = re.fullmatch(r"wstring(?:\s*\[\s*(\d+)\s*\])?", base_lower)
        if m_wstr:
            max_len = int(m_wstr.group(1)) if m_wstr.group(1) else 254
            self.align_word()
            self.byte_offset += 4 + 2 * max_len
            self.warnings.append(f"Bỏ qua kiểu WString[{max_len}] (đã giữ đúng offset tiếp theo)")
            return None

        if base_lower in _SCALAR_MAP:
            sz, even_align, suffix, gw_dt = _SCALAR_MAP[base_lower]
            if even_align:
                self.align_word()
            else:
                self.align_byte()
            b = self.byte_offset
            self.byte_offset += sz
            return f"DB{self.db_number}.{suffix}{b}", gw_dt, f"{b}.0"

        if base_lower in _UNSUPPORTED_64BIT_INTS:
            self.align_word()
            self.byte_offset += 8
            self.warnings.append(f"Bỏ qua kiểu 64-bit '{raw_t}' (không hỗ trợ trực tiếp)")
            return None

        if base_lower in _SYSTEM_STRUCT_SIZES:
            self.align_word()
            self.byte_offset += _SYSTEM_STRUCT_SIZES[base_lower]
            self.warnings.append(f"Bỏ qua kiểu hệ thống '{raw_t}' ({_SYSTEM_STRUCT_SIZES[base_lower]} bytes)")
            return None

        return None


def _strip_quotes(name: str) -> str:
    s = (name or "").strip()
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        return s[1:-1].strip()
    return s


def _normalize_tia_type(t: str) -> str:
    s = re.sub(r"\s+", " ", _strip_quotes(t)).strip()
    # Clean array spaces: "Array [ 0 .. 3 ] of Real" -> "Array[0..3] of Real"
    s = re.sub(r"(?i)^array\s*\[", "Array[", s)
    return s


def _sanitize_group_segment(seg: str) -> str:
    s = _strip_quotes(seg).replace("\\", "/")
    s = re.sub(r"\s+", "_", s.strip())
    return s.strip("/")


def _join_group(parent: str, child: str) -> str:
    p = (parent or "").strip("/")
    c = _sanitize_group_segment(child)
    if p and c:
        return f"{p}/{c}"
    return p or c


def _normalize_plc_tag_address(raw_addr: str) -> Optional[str]:
    """Convert '%I 0.0', '%MW10', '%QX1.2', 'I   0.0', 'DB10.DBD4' -> 'I0.0', 'MW10', ..."""
    s = (raw_addr or "").strip()
    if not s:
        return None
    if s.startswith("%"):
        s = s[1:].strip()
    # Collapse spaces inside S7 addresses like "I   0.0" or "MW  10" or "DB  1.DBW  2"
    s = re.sub(r"\s+", "", s).upper()
    if re.fullmatch(r"DB\d+\.(DB[XBWDL]\d+(?:\.\d+)?|DB?S\d+(?:\.\d+)?)", s):
        return s
    if re.fullmatch(r"[IQM](?:[XBWDL]?\d+(?:\.\d+)?)", s):
        return s
    return None


def _map_plc_tag_dtype(tia_type: str, normalized_addr: str) -> str:
    t = _normalize_tia_type(tia_type).lower()
    if t == "bool" or "." in normalized_addr:
        return "bool"
    if t in ("byte", "usint", "uint", "word", "s5time", "date", "wchar"):
        return "uint16"
    if t in ("sint", "char", "int"):
        return "int16"
    if t in ("dint", "udint", "dword", "time", "tod", "time_of_day"):
        return "int32"
    if t == "real":
        return "float32"
    if t == "lreal":
        return "float64"
    if t.startswith("string"):
        return "string"
    return "float32"


# ---------------------------------------------------------------------------
# TIA Portal .db / .scl / .awl / .udt Source Parser
# ---------------------------------------------------------------------------

def _strip_scl_noise_and_split(block_body: str) -> List[Tuple[str, str]]:
    """
    Remove {...} TIA attributes and (*...*) block comments (while respecting
    single-quoted strings '...' and preserving trailing '// comment' per line),
    then split declarations safely outside STRUCT/END_STRUCT? Wait — we return
    clean (code_token_or_stmt, inline_comment) tokens preserving STRUCT/END_STRUCT boundaries!
    """
    lines = block_body.splitlines()
    clean_lines: List[Tuple[str, str]] = []
    in_block_comment = False
    attr_depth = 0
    in_sq = False

    for raw_line in lines:
        out_chars: List[str] = []
        comment_text = ""
        i = 0
        n = len(raw_line)
        while i < n:
            ch = raw_line[i]
            nxt = raw_line[i : i + 2]

            if in_block_comment:
                if nxt == "*)":
                    in_block_comment = False
                    i += 2
                else:
                    i += 1
                continue

            if attr_depth > 0:
                if ch == "'" and not in_sq:
                    in_sq = True
                elif ch == "'" and in_sq:
                    in_sq = False
                elif not in_sq:
                    if ch == "{":
                        attr_depth += 1
                    elif ch == "}":
                        attr_depth -= 1
                i += 1
                continue

            if in_sq:
                out_chars.append(ch)
                if ch == "'" and (i + 1 >= n or raw_line[i + 1] != "'"):
                    in_sq = False
                elif ch == "'" and i + 1 < n and raw_line[i + 1] == "'":
                    out_chars.append("'")
                    i += 1
                i += 1
                continue

            if nxt == "//":
                comment_text = raw_line[i + 2 :].strip()
                break
            if nxt == "(*":
                in_block_comment = True
                i += 2
                continue
            if ch == "{":
                attr_depth += 1
                i += 1
                continue
            if ch == "'":
                in_sq = True
                out_chars.append(ch)
                i += 1
                continue

            out_chars.append(ch)
            i += 1

        code_part = "".join(out_chars).strip()
        if code_part or comment_text:
            clean_lines.append((code_part, comment_text))

    return clean_lines


@dataclass
class _AstField:
    name: str
    kind: str  # "scalar" | "struct" | "array" | "ref"
    tia_type: str = ""
    children: List["_AstField"] = field(default_factory=list)
    array_lo: int = 0
    array_hi: int = 0
    elem_kind: str = "scalar"  # "scalar" | "struct" | "ref"
    comment: str = ""


def _parse_decl_block_lines(lines: List[Tuple[str, str]]) -> List[_AstField]:
    """
    Parse VAR..END_VAR or STRUCT..END_STRUCT declaration lines into _AstField tree.
    Handles multi-line declarations, inline comments, nested STRUCTs, and ARRAY[...] OF STRUCT.
    """
    # Convert line list into logical chunks terminated by ';' or STRUCT/END_STRUCT keywords
    stack: List[Tuple[Optional[_AstField], List[_AstField]]] = [(None, [])]

    buf_code: List[str] = []
    last_comment = ""

    def _flush_stmt(stmt_text: str, cmt: str) -> None:
        s = re.sub(r"\s+", " ", stmt_text).strip()
        if not s:
            return
        # Ignore VAR / END_VAR / RETAIN / NON_RETAIN markers
        su = s.upper()
        if su in ("VAR", "VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT", "VAR_TEMP", "VAR_STAT", "RETAIN", "NON_RETAIN", "END_VAR"):
            return

        # END_STRUCT
        if re.fullmatch(r"END_STRUCT\s*;?", s, flags=re.IGNORECASE):
            if len(stack) > 1:
                parent_node, children = stack.pop()
                if parent_node is not None:
                    parent_node.children = children
                    stack[-1][1].append(parent_node)
            return

        # Must be a declaration `name : type_spec [:= default];`
        # Split on first ':' outside quotes
        colon_idx = _find_outside_quotes(s, ":")
        if colon_idx < 0:
            return
        name_raw = _strip_quotes(s[:colon_idx])
        rhs = s[colon_idx + 1 :].strip().rstrip(";").strip()
        if not name_raw:
            return

        # Strip initializer `:= ...` outside quotes ONLY if not STRUCT header
        assign_idx = _find_assign_outside_quotes(rhs)
        if assign_idx >= 0:
            rhs_type = rhs[:assign_idx].strip()
        else:
            rhs_type = rhs

        # Check ARRAY[lo..hi] OF ...
        m_arr = re.match(
            r"(?is)^ARRAY\s*\[\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*\]\s*OF\s*(.+)$",
            rhs_type,
        )
        if m_arr:
            lo = int(m_arr.group(1))
            hi = int(m_arr.group(2))
            elem_rhs = m_arr.group(3).strip()
            if re.fullmatch(r"STRUCT", elem_rhs, flags=re.IGNORECASE):
                node = _AstField(
                    name=name_raw,
                    kind="array",
                    tia_type=f"Array[{lo}..{hi}] of Struct",
                    array_lo=lo,
                    array_hi=hi,
                    elem_kind="struct",
                    comment=cmt,
                )
                stack.append((node, []))
                return
            node = _AstField(
                name=name_raw,
                kind="array",
                tia_type=elem_rhs,
                array_lo=lo,
                array_hi=hi,
                elem_kind="scalar",
                comment=cmt,
            )
            stack[-1][1].append(node)
            return

        # Check STRUCT
        if re.fullmatch(r"STRUCT", rhs_type, flags=re.IGNORECASE):
            node = _AstField(name=name_raw, kind="struct", tia_type="Struct", comment=cmt)
            stack.append((node, []))
            return

        # Scalar or UDT ref
        node = _AstField(name=name_raw, kind="scalar", tia_type=rhs_type, comment=cmt)
        stack[-1][1].append(node)

    for code_line, cmt in lines:
        if not code_line:
            continue
        # Process single or multiple semicolon-separated statements on the line,
        # plus STRUCT openings without semicolon
        line_rem = code_line
        while line_rem:
            semi_idx = _find_outside_quotes(line_rem, ";")
            if semi_idx >= 0:
                piece = line_rem[: semi_idx + 1]
                line_rem = line_rem[semi_idx + 1 :].strip()
                buf_code.append(piece)
                full_stmt = " ".join(buf_code)
                buf_code.clear()
                _flush_stmt(full_stmt, cmt or last_comment)
                last_comment = ""
            else:
                buf_code.append(line_rem)
                full_so_far = re.sub(r"\s+", " ", " ".join(buf_code)).strip()
                # Check if line opens STRUCT or ARRAY[...] OF STRUCT (no trailing ';')
                if re.search(r"(?i)(?::\s*STRUCT|:\s*ARRAY\s*\[[^\]]+\]\s*OF\s*STRUCT)\s*$", full_so_far):
                    buf_code.clear()
                    _flush_stmt(full_so_far, cmt or last_comment)
                    last_comment = ""
                elif re.fullmatch(r"(?i)(?:VAR(?:_INPUT|_OUTPUT|_IN_OUT|_TEMP|_STAT)?|END_VAR|STRUCT|NON_RETAIN|RETAIN)", full_so_far):
                    buf_code.clear()
                    _flush_stmt(full_so_far, "")
                else:
                    if cmt:
                        last_comment = cmt
                break

    if buf_code:
        _flush_stmt(" ".join(buf_code), last_comment)

    while len(stack) > 1:
        parent_node, children = stack.pop()
        if parent_node is not None:
            parent_node.children = children
            stack[-1][1].append(parent_node)

    return stack[0][1]


def _find_outside_quotes(s: str, target_ch: str) -> int:
    in_sq = False
    in_dq = False
    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        if c == "'" and not in_dq:
            in_sq = not in_sq
        elif c == '"' and not in_sq:
            in_dq = not in_dq
        elif not in_sq and not in_dq and c == target_ch:
            return i
        i += 1
    return -1


def _find_assign_outside_quotes(s: str) -> int:
    in_sq = False
    in_dq = False
    i = 0
    n = len(s)
    while i < n - 1:
        c = s[i]
        if c == "'" and not in_dq:
            in_sq = not in_sq
        elif c == '"' and not in_sq:
            in_dq = not in_dq
        elif not in_sq and not in_dq and s[i : i + 2] == ":=":
            return i
        i += 1
    return -1


def _emit_ast_fields(
    fields: List[_AstField],
    cursor: _S7OffsetCursor,
    udts: Dict[str, List[_AstField]],
    group_path: str,
    scan_rate_ms: int,
    out: List[Dict[str, Any]],
    udt_stack: Optional[set] = None,
) -> None:
    if udt_stack is None:
        udt_stack = set()

    for fld in fields:
        if fld.kind == "struct":
            cursor.align_word()
            sub_grp = _join_group(group_path, fld.name)
            _emit_ast_fields(fld.children, cursor, udts, sub_grp, scan_rate_ms, out, udt_stack)
            cursor.align_word()
            continue

        if fld.kind == "array":
            cursor.align_word()
            lo, hi = fld.array_lo, fld.array_hi
            if hi < lo:
                continue
            count = hi - lo + 1
            if count > MAX_ARRAY_EXPAND:
                cursor.warnings.append(
                    f"Mảng '{fld.name}[{lo}..{hi}]' có {count} phần tử (> {MAX_ARRAY_EXPAND}), chỉ giữ {MAX_ARRAY_EXPAND} phần tử đầu"
                )
                hi = lo + MAX_ARRAY_EXPAND - 1

            arr_grp = _join_group(group_path, fld.name)
            if fld.elem_kind == "struct":
                for idx in range(lo, hi + 1):
                    cursor.align_word()
                    elem_grp = _join_group(arr_grp, str(idx))
                    _emit_ast_fields(fld.children, cursor, udts, elem_grp, scan_rate_ms, out, udt_stack)
                    cursor.align_word()
            else:
                elem_key = _strip_quotes(fld.tia_type).lower()
                if elem_key in udts and elem_key not in udt_stack:
                    for idx in range(lo, hi + 1):
                        cursor.align_word()
                        elem_grp = _join_group(arr_grp, str(idx))
                        _emit_ast_fields(
                            udts[elem_key], cursor, udts, elem_grp, scan_rate_ms, out, udt_stack | {elem_key}
                        )
                        cursor.align_word()
                else:
                    for idx in range(lo, hi + 1):
                        alloc = cursor.alloc_scalar(fld.tia_type)
                        if alloc:
                            addr, gw_dt, off_str = alloc
                            out.append({
                                "name": f"{fld.name}_{idx}",
                                "address": addr,
                                "data_type": gw_dt,
                                "tag_group": arr_grp,
                                "description": fld.comment,
                                "tia_type": fld.tia_type,
                                "offset_str": off_str,
                                "scan_rate_ms": scan_rate_ms,
                            })
            cursor.align_word()
            continue

        # Scalar or UDT reference
        t_clean = _strip_quotes(fld.tia_type).strip()
        t_key = t_clean.lower()
        if t_key in udts and t_key not in udt_stack:
            cursor.align_word()
            sub_grp = _join_group(group_path, fld.name)
            _emit_ast_fields(udts[t_key], cursor, udts, sub_grp, scan_rate_ms, out, udt_stack | {t_key})
            cursor.align_word()
            continue

        alloc = cursor.alloc_scalar(fld.tia_type)
        if alloc:
            addr, gw_dt, off_str = alloc
            out.append({
                "name": fld.name,
                "address": addr,
                "data_type": gw_dt,
                "tag_group": group_path,
                "description": fld.comment,
                "tia_type": t_clean,
                "offset_str": off_str,
                "scan_rate_ms": scan_rate_ms,
            })
        elif (
            t_key not in ("bool",)
            and not re.match(r"(?i)^w?string", t_key)
            and t_key not in _SCALAR_MAP
            and t_key not in _SYSTEM_STRUCT_SIZES
            and t_key not in _UNSUPPORTED_64BIT_INTS
        ):
            cursor.warnings.append(
                f"Không rõ kích thước UDT/kiểu '{t_clean}' ở biến '{fld.name}' — hãy export kèm TYPE UDT hoặc dùng cách Copy-Paste bảng DB có cột Offset."
            )


def _extract_udts_from_source(text: str) -> Dict[str, List[_AstField]]:
    udts: Dict[str, List[_AstField]] = {}
    for m in re.finditer(
        r'(?is)\bTYPE\s+("[^"\r\n]+"|[A-Za-z_][\w\.\-]*)(.*?)\bEND_TYPE\b',
        text,
    ):
        udt_name = _strip_quotes(m.group(1)).lower()
        body = m.group(2)
        body = re.sub(r"(?im)^\s*(?:VERSION|TITLE|AUTHOR|FAMILY|NAME)\s*[:=].*$", "", body)
        m_st = re.search(r"(?is)\bSTRUCT\b(.*)\bEND_STRUCT\b", body)
        inner = m_st.group(1) if m_st else body
        lines = _strip_scl_noise_and_split(inner)
        udts[udt_name] = _parse_decl_block_lines(lines)
    return udts


def _strip_db_header_metadata(decl_section: str) -> str:
    """Strip TIA/STEP7 DB header lines (VERSION : 0.1, TITLE = ..., NON_RETAIN) without swallowing variables."""
    cleaned_lines: List[str] = []
    seen_body = False
    for ln in decl_section.splitlines():
        s = ln.strip()
        if not seen_body:
            if re.match(r"(?i)^(?:VAR(?:_\w+)?|STRUCT)\b", s):
                seen_body = True
            elif re.match(
                r"(?i)^(?:VERSION|TITLE|AUTHOR|FAMILY|NAME)\s*[:=]", s
            ) or re.fullmatch(
                r"(?i)(?:NON_RETAIN|RETAIN|READ_ONLY|UNLINKED|KNOW_HOW_PROTECT)\s*;?", s
            ):
                continue
        cleaned_lines.append(ln)
    return "\n".join(cleaned_lines)


def _parse_tia_db_source(
    text: str,
    db_number: Optional[int],
    default_group: str,
    scan_rate_ms: int,
) -> Dict[str, Any]:
    udts = _extract_udts_from_source(text)
    optimized_warning = bool(re.search(r"(?i)S7_Optimized_Access\s*:=\s*'?TRUE'?", text))

    # Locate DATA_BLOCK ... END_DATA_BLOCK (or single block)
    m_db = re.search(
        r'(?is)\bDATA_BLOCK\s+("[^"\r\n]+"|DB\s*\d+|[A-Za-z_][\w\.\-]*)(.*?)\bEND_DATA_BLOCK\b',
        text,
    )
    resolved_db_num = db_number
    db_name = ""
    candidates: List[Dict[str, Any]] = []
    warnings: List[str] = []

    if optimized_warning:
        warnings.append(
            "File đang bật S7_Optimized_Access := 'TRUE'. Để đọc qua S7 (snap7), trong TIA Portal hãy chuột phải DB -> Properties -> Attributes -> bỏ tích 'Optimized block access' rồi Compile lại."
        )

    if m_db:
        raw_header_id = m_db.group(1).strip()
        db_body_full = m_db.group(2)
        m_num = re.fullmatch(r"(?i)DB\s*(\d+)", _strip_quotes(raw_header_id))
        if m_num:
            resolved_db_num = int(m_num.group(1))
            db_name = f"DB{resolved_db_num}"
        else:
            db_name = _strip_quotes(raw_header_id)

        if resolved_db_num is None:
            resolved_db_num = 1
            warnings.append(
                f"Source '{db_name}' không ghi số DB cụ thể — tạm dùng DB{resolved_db_num}. Hãy chỉnh đúng 'Số DB' trên màn hình nếu DB của bạn khác {resolved_db_num}."
            )

        # Strip BEGIN ... value assignment section at bottom of DATA_BLOCK
        m_begin = re.search(r"(?im)^\s*BEGIN\b", db_body_full)
        decl_section = db_body_full[: m_begin.start()] if m_begin else db_body_full
        decl_section = _strip_db_header_metadata(decl_section)
        clean_lines = _strip_scl_noise_and_split(decl_section)

        # Support DB derived directly from a UDT: DATA_BLOCK "DB_Pump" ... "UDT_Pump" BEGIN
        non_empty_code = [c for c, _ in clean_lines if c]
        if (
            len(non_empty_code) == 1
            and ":" not in non_empty_code[0]
            and _strip_quotes(non_empty_code[0].rstrip(";")).lower() in udts
        ):
            ast_fields = udts[_strip_quotes(non_empty_code[0].rstrip(";")).lower()]
        else:
            ast_fields = _parse_decl_block_lines(clean_lines)

        root_group = default_group.strip() if default_group.strip() else _sanitize_group_segment(db_name)
        cursor = _S7OffsetCursor(db_number=resolved_db_num, warnings=warnings)
        _emit_ast_fields(ast_fields, cursor, udts, root_group, scan_rate_ms, candidates)
        warnings = cursor.warnings
    elif udts:
        # File contains only UDT(s)
        if resolved_db_num is None:
            resolved_db_num = 1
            warnings.append("File UDT không chứa số DB — tạm dùng DB1.")
        for u_name, u_fields in udts.items():
            db_name = db_name or u_name
            root_group = default_group.strip() if default_group.strip() else _sanitize_group_segment(u_name)
            cursor = _S7OffsetCursor(db_number=resolved_db_num, warnings=warnings)
            _emit_ast_fields(u_fields, cursor, udts, root_group, scan_rate_ms, candidates)
            warnings = cursor.warnings

    return {
        "detected_format": "tia_db_source",
        "db_number": resolved_db_num,
        "db_name": db_name or f"DB{resolved_db_num or 1}",
        "optimized_warning": optimized_warning,
        "warnings": list(dict.fromkeys(warnings)),
        "candidates": candidates,
        "message": f"Đã trích xuất {len(candidates)} tag từ file Source TIA Portal ({db_name or 'DB'}).",
    }


# ---------------------------------------------------------------------------
# TIA Portal Openness XML Parser (.xml)
# ---------------------------------------------------------------------------

def _local_tag(elem: ET.Element) -> str:
    return elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag


def _find_child(elem: ET.Element, name: str) -> Optional[ET.Element]:
    for c in elem:
        if _local_tag(c) == name:
            return c
    return None


def _extract_xml_comment(elem: ET.Element) -> str:
    for node in elem.iter():
        if _local_tag(node) == "Comment":
            for sub in node.iter():
                if _local_tag(sub) == "MultiLanguageText" and sub.text and sub.text.strip():
                    return sub.text.strip()
        elif _local_tag(node) == "MultilingualText" and node.attrib.get("CompositionName") == "Comment":
            for sub in node.iter():
                if _local_tag(sub) == "Text" and sub.text and sub.text.strip():
                    return sub.text.strip()
    return ""


def _walk_openness_members(
    container: ET.Element,
    cursor: _S7OffsetCursor,
    group_path: str,
    scan_rate_ms: int,
    out: List[Dict[str, Any]],
) -> None:
    for child in container:
        if _local_tag(child) != "Member":
            continue
        m_name = child.attrib.get("Name", "").strip()
        m_type = child.attrib.get("Datatype", "").strip()
        if not m_name:
            continue
        comment = _extract_xml_comment(child)
        nested_members = [c for c in child if _local_tag(c) == "Member"]

        m_arr = re.match(r"(?is)^Array\s*\[\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*\]\s*of\s*(.+)$", m_type)
        if m_arr:
            cursor.align_word()
            lo = int(m_arr.group(1))
            hi = int(m_arr.group(2))
            elem_type = m_arr.group(3).strip()
            if hi >= lo:
                if hi - lo + 1 > MAX_ARRAY_EXPAND:
                    hi = lo + MAX_ARRAY_EXPAND - 1
                    cursor.warnings.append(f"Mảng '{m_name}' vượt {MAX_ARRAY_EXPAND} phần tử, chỉ lấy {MAX_ARRAY_EXPAND} phần tử đầu.")
                arr_grp = _join_group(group_path, m_name)
                if elem_type.lower() == "struct" or nested_members:
                    for idx in range(lo, hi + 1):
                        cursor.align_word()
                        _walk_openness_members(child, cursor, _join_group(arr_grp, str(idx)), scan_rate_ms, out)
                        cursor.align_word()
                else:
                    for idx in range(lo, hi + 1):
                        alloc = cursor.alloc_scalar(elem_type)
                        if alloc:
                            addr, gw_dt, off_str = alloc
                            out.append({
                                "name": f"{m_name}_{idx}",
                                "address": addr,
                                "data_type": gw_dt,
                                "tag_group": arr_grp,
                                "description": comment,
                                "tia_type": elem_type,
                                "offset_str": off_str,
                                "scan_rate_ms": scan_rate_ms,
                            })
            cursor.align_word()
            continue

        if m_type.lower() == "struct" or nested_members:
            cursor.align_word()
            _walk_openness_members(child, cursor, _join_group(group_path, m_name), scan_rate_ms, out)
            cursor.align_word()
            continue

        alloc = cursor.alloc_scalar(m_type)
        if alloc:
            addr, gw_dt, off_str = alloc
            out.append({
                "name": m_name,
                "address": addr,
                "data_type": gw_dt,
                "tag_group": group_path,
                "description": comment,
                "tia_type": m_type,
                "offset_str": off_str,
                "scan_rate_ms": scan_rate_ms,
            })


def _parse_tia_xml(
    text: str,
    db_number: Optional[int],
    default_group: str,
    scan_rate_ms: int,
) -> Dict[str, Any]:
    root = ET.fromstring(text)
    warnings: List[str] = []
    candidates: List[Dict[str, Any]] = []

    # 1. Check GlobalDB
    db_block = None
    for el in root.iter():
        if _local_tag(el) == "SW.Blocks.GlobalDB":
            db_block = el
            break

    if db_block is not None:
        attrs = _find_child(db_block, "AttributeList")
        db_name = "DB"
        xml_num: Optional[int] = None
        optimized_warning = False

        if attrs is not None:
            for c in attrs:
                lt = _local_tag(c)
                if lt == "Name" and c.text:
                    db_name = c.text.strip()
                elif lt == "Number" and c.text and c.text.strip().isdigit():
                    xml_num = int(c.text.strip())
                elif lt == "MemoryLayout" and c.text and "optimized" in c.text.lower():
                    optimized_warning = True

        resolved_db = xml_num if xml_num is not None else (db_number if db_number is not None else 1)
        if optimized_warning:
            warnings.append(
                f"XML DB '{db_name}' đang đặt MemoryLayout=Optimized. Cần tắt Optimized block access trong TIA Portal để đọc qua S7."
            )

        static_sec = None
        for el in db_block.iter():
            if _local_tag(el) == "Section" and el.attrib.get("Name") in ("Static", "None"):
                static_sec = el
                break

        if static_sec is not None:
            root_grp = default_group.strip() if default_group.strip() else _sanitize_group_segment(db_name)
            cursor = _S7OffsetCursor(db_number=resolved_db, warnings=warnings)
            _walk_openness_members(static_sec, cursor, root_grp, scan_rate_ms, candidates)
            warnings = cursor.warnings

        return {
            "detected_format": "tia_xml_db",
            "db_number": resolved_db,
            "db_name": db_name,
            "optimized_warning": optimized_warning,
            "warnings": list(dict.fromkeys(warnings)),
            "candidates": candidates,
            "message": f"Đã trích xuất {len(candidates)} tag từ file TIA Openness XML ({db_name} / DB{resolved_db}).",
        }

    # 2. Check PlcTagTable
    table_name = ""
    for el in root.iter():
        if _local_tag(el) == "SW.Tags.PlcTagTable":
            attrs = _find_child(el, "AttributeList")
            if attrs is not None:
                n_el = _find_child(attrs, "Name")
                if n_el is not None and n_el.text:
                    table_name = n_el.text.strip()
        elif _local_tag(el) == "SW.Tags.PlcTag":
            attrs = _find_child(el, "AttributeList")
            if attrs is None:
                continue
            t_name, t_dtype, t_addr = "", "", ""
            for c in attrs:
                lt = _local_tag(c)
                if lt == "Name" and c.text:
                    t_name = c.text.strip()
                elif lt == "DataTypeName" and c.text:
                    t_dtype = c.text.strip()
                elif lt == "LogicalAddress" and c.text:
                    t_addr = c.text.strip()
            norm_addr = _normalize_plc_tag_address(t_addr)
            if t_name and norm_addr:
                candidates.append({
                    "name": t_name,
                    "address": norm_addr,
                    "data_type": _map_plc_tag_dtype(t_dtype, norm_addr),
                    "tag_group": default_group.strip() or _sanitize_group_segment(table_name) or "PLC_Tags",
                    "description": _extract_xml_comment(el),
                    "tia_type": t_dtype,
                    "offset_str": t_addr,
                    "scan_rate_ms": scan_rate_ms,
                })

    return {
        "detected_format": "tia_xml_tags",
        "db_number": None,
        "db_name": table_name or "PLC Tags XML",
        "optimized_warning": False,
        "warnings": warnings,
        "candidates": candidates,
        "message": f"Đã trích xuất {len(candidates)} PLC Tag từ file XML.",
    }


# ---------------------------------------------------------------------------
# TIA Portal PLC Tags .xlsx Parser (Pure stdlib zipfile + XML)
# ---------------------------------------------------------------------------

def _col_letters_to_idx(ref: str) -> int:
    letters = "".join(ch for ch in ref if ch.isalpha()).upper()
    idx = 0
    for ch in letters:
        idx = idx * 26 + (ord(ch) - ord("A") + 1)
    return max(0, idx - 1)


def _read_xlsx_rows(raw_bytes: bytes) -> List[List[str]]:
    with zipfile.ZipFile(io.BytesIO(raw_bytes), "r") as zf:
        names = zf.namelist()
        shared: List[str] = []
        if "xl/sharedStrings.xml" in names:
            ss_root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in ss_root:
                if _local_tag(si) == "si":
                    parts = [el.text or "" for el in si.iter() if _local_tag(el) == "t"]
                    shared.append("".join(parts))

        sheet_files = sorted(n for n in names if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n))
        if not sheet_files:
            return []

        # Prefer PLC Tags sheet if multiple exist
        target_sheet = sheet_files[0]
        if "xl/workbook.xml" in names:
            wb_root = ET.fromstring(zf.read("xl/workbook.xml"))
            sheets = [el for el in wb_root.iter() if _local_tag(el) == "sheet"]
            for idx, sh in enumerate(sheets):
                sname = (sh.attrib.get("name") or "").lower()
                if "plc tag" in sname and f"xl/worksheets/sheet{idx + 1}.xml" in names:
                    target_sheet = f"xl/worksheets/sheet{idx + 1}.xml"
                    break

        ws_root = ET.fromstring(zf.read(target_sheet))
        rows_out: List[List[str]] = []
        for row_el in ws_root.iter():
            if _local_tag(row_el) != "row":
                continue
            row_vals: Dict[int, str] = {}
            max_c = -1
            for c_el in row_el:
                if _local_tag(c_el) != "c":
                    continue
                ref = c_el.attrib.get("r", "")
                c_idx = _col_letters_to_idx(ref) if ref else (max_c + 1)
                max_c = max(max_c, c_idx)
                ctype = c_el.attrib.get("t", "")
                val_str = ""
                if ctype == "inlineStr":
                    is_el = _find_child(c_el, "is")
                    if is_el is not None:
                        val_str = "".join(el.text or "" for el in is_el.iter() if _local_tag(el) == "t")
                else:
                    v_el = _find_child(c_el, "v")
                    if v_el is not None and v_el.text is not None:
                        if ctype == "s":
                            try:
                                val_str = shared[int(v_el.text)]
                            except (ValueError, IndexError):
                                val_str = v_el.text
                        else:
                            val_str = v_el.text
                row_vals[c_idx] = val_str
            if max_c >= 0:
                rows_out.append([row_vals.get(i, "") for i in range(max_c + 1)])
        return rows_out


def _parse_tia_xlsx_bytes(
    raw_bytes: bytes,
    default_group: str,
    scan_rate_ms: int,
) -> Dict[str, Any]:
    rows = _read_xlsx_rows(raw_bytes)
    if not rows:
        return {
            "detected_format": "tia_xlsx_tags",
            "db_number": None,
            "db_name": "PLC Tags XLSX",
            "optimized_warning": False,
            "warnings": ["File Excel không chứa dữ liệu PLC Tags."],
            "candidates": [],
            "message": "Không tìm thấy tag nào trong file Excel.",
        }

    # Find header row
    header_idx = 0
    col_map: Dict[str, int] = {}
    for r_idx, row in enumerate(rows[:10]):
        low = [c.strip().lower() for c in row]
        if any(h in low for h in ("logical address", "address")) and "name" in low:
            header_idx = r_idx
            for c_i, h in enumerate(low):
                if h in ("name", "tag name"):
                    col_map["name"] = c_i
                elif h == "path":
                    col_map["path"] = c_i
                elif h in ("data type", "datatype"):
                    col_map["dtype"] = c_i
                elif h in ("logical address", "address"):
                    col_map["addr"] = c_i
                elif h in ("comment", "description"):
                    col_map["comment"] = c_i
            break

    if "name" not in col_map or "addr" not in col_map:
        return {
            "detected_format": "tia_xlsx_tags",
            "db_number": None,
            "db_name": "PLC Tags XLSX",
            "optimized_warning": False,
            "warnings": ["Không nhận diện được các cột 'Name' và 'Logical Address' chuẩn TIA Portal."],
            "candidates": [],
            "message": "File Excel chưa đúng định dạng PLC Tags Export của TIA Portal.",
        }

    candidates: List[Dict[str, Any]] = []
    for row in rows[header_idx + 1 :]:
        t_name = row[col_map["name"]].strip() if col_map["name"] < len(row) else ""
        t_addr = row[col_map["addr"]].strip() if col_map["addr"] < len(row) else ""
        t_dtype = row[col_map["dtype"]].strip() if "dtype" in col_map and col_map["dtype"] < len(row) else ""
        t_path = row[col_map["path"]].strip() if "path" in col_map and col_map["path"] < len(row) else ""
        t_cmt = row[col_map["comment"]].strip() if "comment" in col_map and col_map["comment"] < len(row) else ""

        norm_addr = _normalize_plc_tag_address(t_addr)
        if not t_name or not norm_addr:
            continue

        grp = default_group.strip() or _sanitize_group_segment(t_path) or "PLC_Tags"
        candidates.append({
            "name": _strip_quotes(t_name),
            "address": norm_addr,
            "data_type": _map_plc_tag_dtype(t_dtype, norm_addr),
            "tag_group": grp,
            "description": t_cmt,
            "tia_type": t_dtype,
            "offset_str": t_addr,
            "scan_rate_ms": scan_rate_ms,
        })

    return {
        "detected_format": "tia_xlsx_tags",
        "db_number": None,
        "db_name": "TIA PLC Tags (.xlsx)",
        "optimized_warning": False,
        "warnings": [],
        "candidates": candidates,
        "message": f"Đã trích xuất {len(candidates)} PLC Tag từ file Excel TIA Portal.",
    }


# ---------------------------------------------------------------------------
# TIA Portal DB Editor Copy-Paste (TSV) & STEP 7 .sdf Symbol Table Parser
# ---------------------------------------------------------------------------

def _address_from_compiled_offset(
    db_num: int,
    tia_type: str,
    offset_str: str,
) -> Optional[Tuple[str, str]]:
    """Map an explicit TIA DB Offset (e.g. '12.3', '4.0', '16') + Data type -> (S7_Address, gw_dtype)."""
    m_off = re.fullmatch(r"\s*(\d+)(?:\.(\d))?\s*", offset_str)
    if not m_off:
        return None
    byte_off = int(m_off.group(1))
    bit_off = int(m_off.group(2)) if m_off.group(2) is not None else 0

    t_norm = _normalize_tia_type(tia_type).lower()
    if t_norm == "bool":
        return f"DB{db_num}.DBX{byte_off}.{bit_off}", "bool"

    m_str = re.fullmatch(r"string(?:\s*\[\s*(\d+)\s*\])?", t_norm)
    if m_str:
        max_len = max(1, min(254, int(m_str.group(1)) if m_str.group(1) else 254))
        return f"DB{db_num}.DBS{byte_off}.{max_len}", "string"

    if t_norm in _SCALAR_MAP:
        _, _, suffix, gw_dt = _SCALAR_MAP[t_norm]
        return f"DB{db_num}.{suffix}{byte_off}", gw_dt

    return None


def _parse_tia_db_paste(
    text: str,
    db_number: Optional[int],
    default_group: str,
    scan_rate_ms: int,
) -> Dict[str, Any]:
    resolved_db = db_number if db_number is not None else 1
    warnings: List[str] = []
    if db_number is None:
        warnings.append("Chưa nhập Số DB cho bảng Copy-Paste — tạm dùng DB1.")

    lines = [ln for ln in text.splitlines() if ln.strip()]
    rows = [ln.split("\t") for ln in lines]

    # Detect header row columns if present
    name_idx, type_idx, off_idx, cmt_idx = 0, 1, 2, -1
    start_row = 0
    if rows:
        hdr = [c.strip().lower() for c in rows[0]]
        if any(h in hdr for h in ("data type", "datatype")) and any(h == "offset" for h in hdr):
            start_row = 1
            for idx, h in enumerate(hdr):
                if h == "name":
                    name_idx = idx
                elif h in ("data type", "datatype"):
                    type_idx = idx
                elif h == "offset":
                    off_idx = idx
                elif h == "comment":
                    cmt_idx = idx

    candidates: List[Dict[str, Any]] = []
    root_grp = default_group.strip() or f"DB{resolved_db}"

    for row in rows[start_row:]:
        if len(row) < 3:
            continue
        raw_name = row[name_idx].strip() if name_idx < len(row) else ""
        raw_type = row[type_idx].strip() if type_idx < len(row) else ""
        raw_off = row[off_idx].strip() if off_idx < len(row) else ""
        raw_cmt = ""
        if cmt_idx >= 0:
            raw_cmt = row[cmt_idx].strip() if cmt_idx < len(row) else ""
        elif len(row) > 3 and not re.fullmatch(r"(?i)(true|false|\d+(?:\.\d+)?)", row[-1].strip()):
            raw_cmt = row[-1].strip()

        if not raw_name or not raw_type:
            continue

        t_low = _normalize_tia_type(raw_type).lower()
        if t_low == "struct" or t_low.startswith("array"):
            continue  # Skip container header rows

        if not re.fullmatch(r"\d+(?:\.\d)?", raw_off):
            continue

        mapped = _address_from_compiled_offset(resolved_db, raw_type, raw_off)
        if not mapped:
            continue
        s7_addr, gw_dt = mapped

        # Support dotted path names pasted like "Motor1"."Run"
        parts = [_strip_quotes(p) for p in raw_name.split(".") if _strip_quotes(p)]
        if len(parts) > 1:
            t_name = parts[-1]
            t_grp = "/".join([root_grp] + [_sanitize_group_segment(x) for x in parts[:-1]])
        else:
            t_name = _strip_quotes(raw_name)
            t_grp = root_grp

        candidates.append({
            "name": t_name,
            "address": s7_addr,
            "data_type": gw_dt,
            "tag_group": t_grp,
            "description": raw_cmt,
            "tia_type": _normalize_tia_type(raw_type),
            "offset_str": raw_off,
            "scan_rate_ms": scan_rate_ms,
        })

    return {
        "detected_format": "tia_db_paste",
        "db_number": resolved_db,
        "db_name": f"DB{resolved_db} (Copy-Paste)",
        "optimized_warning": False,
        "warnings": warnings,
        "candidates": candidates,
        "message": f"Đã trích xuất {len(candidates)} tag theo Offset chính xác của TIA Portal (DB{resolved_db}).",
    }


def _parse_step7_sdf(
    text: str,
    default_group: str,
    scan_rate_ms: int,
) -> Dict[str, Any]:
    candidates: List[Dict[str, Any]] = []
    reader = csv.reader(io.StringIO(text))
    for row in reader:
        if len(row) < 3:
            continue
        t_name = row[0].strip()
        raw_addr = row[1].strip()
        t_dtype = row[2].strip()
        t_cmt = row[3].strip() if len(row) > 3 else ""
        if t_name.lower() in ("symbol", "name") and raw_addr.lower() in ("address", "operand"):
            continue
        norm_addr = _normalize_plc_tag_address(raw_addr)
        if not t_name or not norm_addr:
            continue
        candidates.append({
            "name": t_name,
            "address": norm_addr,
            "data_type": _map_plc_tag_dtype(t_dtype, norm_addr),
            "tag_group": default_group.strip() or "Symbols",
            "description": t_cmt,
            "tia_type": t_dtype,
            "offset_str": raw_addr,
            "scan_rate_ms": scan_rate_ms,
        })

    return {
        "detected_format": "step7_sdf",
        "db_number": None,
        "db_name": "STEP 7 Symbol Table (.sdf)",
        "optimized_warning": False,
        "warnings": [],
        "candidates": candidates,
        "message": f"Đã trích xuất {len(candidates)} tag từ bảng Symbol (.sdf).",
    }


# ---------------------------------------------------------------------------
# Public Entry Points
# ---------------------------------------------------------------------------

def parse_s7_text(
    text: str,
    filename: str = "",
    db_number: Optional[int] = None,
    default_group: str = "",
    scan_rate_ms: int = 100,
) -> Dict[str, Any]:
    """Auto-detect and parse TIA Portal / STEP 7 text input (.db, .xml, TSV paste, .sdf)."""
    content = (text or "").lstrip("\ufeff")
    if not content.strip():
        raise ValueError("Nội dung file/dữ liệu trống.")

    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    stripped = content.lstrip()

    if ext == "xml" or stripped.startswith("<?xml") or stripped.startswith("<Document"):
        return _parse_tia_xml(content, db_number=db_number, default_group=default_group, scan_rate_ms=scan_rate_ms)

    # Check TSV copied from TIA DB Editor (tabs present in first few lines and not an SCL source block)
    sample_lines = [ln for ln in content.splitlines()[:5] if ln.strip()]
    is_scl_block = bool(re.search(r'(?im)^\s*(?:DATA_BLOCK|TYPE)\s+(?:"|\w)', content))
    if any("\t" in ln for ln in sample_lines) and not is_scl_block:
        return _parse_tia_db_paste(content, db_number=db_number, default_group=default_group, scan_rate_ms=scan_rate_ms)

    if is_scl_block and ext not in ("sdf", "csv", "tsv"):
        return _parse_tia_db_source(content, db_number=db_number, default_group=default_group, scan_rate_ms=scan_rate_ms)

    if ext == "sdf" or ("," in content and re.search(r'"\s*[IQM]\s*\d', content, re.IGNORECASE)):
        return _parse_step7_sdf(content, default_group=default_group, scan_rate_ms=scan_rate_ms)

    # Fallback: try DB source anyway in case user pasted partial VAR/STRUCT block
    if ":" in content and not "\t" in content:
        wrapped = f'DATA_BLOCK "DB{db_number or 1}"\nVAR\n{content}\nEND_VAR\nEND_DATA_BLOCK'
        res = _parse_tia_db_source(wrapped, db_number=db_number, default_group=default_group, scan_rate_ms=scan_rate_ms)
        if res["candidates"]:
            return res

    raise ValueError(
        "Không nhận diện được định dạng S7/TIA Portal. Hỗ trợ: file .db/.scl/.awl/.udt, file .xml/.xlsx/.sdf, hoặc bảng Copy-Paste (cột Offset) từ TIA Portal."
    )


def parse_s7_bytes(
    raw_bytes: bytes,
    filename: str = "",
    db_number: Optional[int] = None,
    default_group: str = "",
    scan_rate_ms: int = 100,
) -> Dict[str, Any]:
    """Auto-detect binary (.xlsx) vs text (.db/.xml/.sdf/...) S7 uploads."""
    if not raw_bytes:
        raise ValueError("File tải lên bị trống.")

    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if ext == "xlsx" or raw_bytes[:2] == b"PK":
        try:
            return _parse_tia_xlsx_bytes(raw_bytes, default_group=default_group, scan_rate_ms=scan_rate_ms)
        except zipfile.BadZipFile:
            raise ValueError("File .xlsx không hợp lệ hoặc bị hỏng.")

    # Try UTF-8 / UTF-16 / Windows-1252 / Latin-1 decoding
    decoded: Optional[str] = None
    for enc in ("utf-8-sig", "utf-16", "cp1252", "latin-1"):
        try:
            decoded = raw_bytes.decode(enc)
            break
        except UnicodeDecodeError:
            continue

    if decoded is None:
        raise ValueError("Không thể giải mã nội dung text của file.")

    return parse_s7_text(
        decoded,
        filename=filename,
        db_number=db_number,
        default_group=default_group,
        scan_rate_ms=scan_rate_ms,
    )
