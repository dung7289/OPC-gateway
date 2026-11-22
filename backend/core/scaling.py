"""
Tag scaling helpers (Kepware "Scaling" tab equivalent).

Modes
-----
none    -> value returned unchanged
linear  -> map raw range [raw_min, raw_max] onto engineering range [eng_min, eng_max]
factor  -> eng = raw * scale_factor + scale_offset
"""

from __future__ import annotations

from typing import Any, Optional


def is_scaled(tag: dict) -> bool:
    return (tag.get("scale_type") or "none") in ("linear", "factor")


def _num(v: Any) -> Optional[float]:
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def apply_scaling(tag: dict, raw: Any) -> Any:
    """Convert a raw device value into an engineering value. Non-numeric values pass through."""
    st = (tag.get("scale_type") or "none")
    if st == "none" or raw is None:
        return raw
    x = _num(raw)
    if x is None:
        return raw

    if st == "linear":
        r0, r1 = float(tag.get("raw_min") or 0.0), float(tag.get("raw_max") if tag.get("raw_max") is not None else 100.0)
        e0, e1 = float(tag.get("eng_min") or 0.0), float(tag.get("eng_max") if tag.get("eng_max") is not None else 100.0)
        if r1 == r0:
            return raw
        eng = e0 + (x - r0) * (e1 - e0) / (r1 - r0)
        if tag.get("scale_clamp"):
            lo, hi = (e0, e1) if e0 <= e1 else (e1, e0)
            eng = max(lo, min(hi, eng))
    else:  # factor
        factor = float(tag.get("scale_factor") if tag.get("scale_factor") is not None else 1.0)
        offset = float(tag.get("scale_offset") or 0.0)
        eng = x * factor + offset

    return round(eng, 6)


def reverse_scaling(tag: dict, eng: Any) -> Any:
    """Convert an engineering value (typed by the user / SCADA) back to the raw device value."""
    st = (tag.get("scale_type") or "none")
    if st == "none" or eng is None:
        return eng
    y = _num(eng)
    if y is None:
        return eng

    if st == "linear":
        r0, r1 = float(tag.get("raw_min") or 0.0), float(tag.get("raw_max") if tag.get("raw_max") is not None else 100.0)
        e0, e1 = float(tag.get("eng_min") or 0.0), float(tag.get("eng_max") if tag.get("eng_max") is not None else 100.0)
        if e1 == e0:
            return eng
        raw = r0 + (y - e0) * (r1 - r0) / (e1 - e0)
    else:  # factor
        factor = float(tag.get("scale_factor") if tag.get("scale_factor") is not None else 1.0)
        offset = float(tag.get("scale_offset") or 0.0)
        if factor == 0:
            return eng
        raw = (y - offset) / factor

    dt = (tag.get("data_type") or "float32").lower()
    if "int" in dt:
        return int(round(raw))
    return raw
