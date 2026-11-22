"""
Pydantic models for Tag CRUD operations.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class DataType(str, Enum):
    bool         = "bool"
    int16        = "int16"
    uint16       = "uint16"
    int32        = "int32"
    int32_swap   = "int32_swap"
    float32      = "float32"
    float32_swap = "float32_swap"
    float32_be   = "float32_be"
    float32_le   = "float32_le"
    float64      = "float64"
    string       = "string"


class Quality(str, Enum):
    Good    = "Good"
    Bad     = "Bad"
    Unknown = "Unknown"


ACCESS_VALUES = ("rw", "ro")
SCALE_TYPES = ("none", "linear", "factor")


def _check_access(v):
    if v is None:
        return v
    v = str(v).strip().lower()
    if v in ("r", "read", "readonly", "read-only", "read only"):
        v = "ro"
    if v in ("w", "readwrite", "read/write", "read-write", "read write"):
        v = "rw"
    if v not in ACCESS_VALUES:
        raise ValueError("access phải là 'rw' (Read/Write) hoặc 'ro' (Read Only)")
    return v


def _check_scale_type(v):
    if v is None:
        return v
    v = str(v).strip().lower()
    if v not in SCALE_TYPES:
        raise ValueError("scale_type phải là 'none', 'linear' hoặc 'factor'")
    return v


class TagCreate(BaseModel):
    connection_id: int
    name:          str      = Field(..., min_length=1, max_length=128)
    address:       str      = Field(..., min_length=1)
    data_type:     DataType = DataType.float32
    scan_rate_ms:  int      = Field(default=100, ge=50, le=60000)
    enabled:       bool     = True
    description:   str      = ""
    tag_group:     str      = ""
    group_name:    Optional[str] = None
    # --- Client access / scaling / unit / data logger ---
    access:        str      = "rw"
    unit:          str      = ""
    scale_type:    str      = "none"
    raw_min:       float    = 0.0
    raw_max:       float    = 100.0
    eng_min:       float    = 0.0
    eng_max:       float    = 100.0
    scale_factor:  float    = 1.0
    scale_offset:  float    = 0.0
    scale_clamp:   bool     = False
    log_enabled:   bool     = False

    @field_validator("access", mode="before")
    @classmethod
    def _v_access(cls, v):
        return _check_access(v) or "rw"

    @field_validator("scale_type", mode="before")
    @classmethod
    def _v_scale_type(cls, v):
        return _check_scale_type(v) or "none"

    @model_validator(mode="before")
    @classmethod
    def resolve_group(cls, values: Any) -> Any:
        if isinstance(values, dict):
            grp = values.get("tag_group") or values.get("group_name") or values.get("group")
            if grp:
                values["tag_group"] = str(grp).strip()
                values["group_name"] = str(grp).strip()
            else:
                values["tag_group"] = ""
                values["group_name"] = ""
        return values


class TagUpdate(BaseModel):
    connection_id: Optional[int]      = None
    name:          Optional[str]      = None
    address:       Optional[str]      = None
    data_type:     Optional[DataType] = None
    scan_rate_ms:  Optional[int]      = Field(default=None, ge=50, le=60000)
    enabled:       Optional[bool]     = None
    description:   Optional[str]      = None
    tag_group:     Optional[str]      = None
    group_name:    Optional[str]      = None
    access:        Optional[str]      = None
    unit:          Optional[str]      = None
    scale_type:    Optional[str]      = None
    raw_min:       Optional[float]    = None
    raw_max:       Optional[float]    = None
    eng_min:       Optional[float]    = None
    eng_max:       Optional[float]    = None
    scale_factor:  Optional[float]    = None
    scale_offset:  Optional[float]    = None
    scale_clamp:   Optional[bool]     = None
    log_enabled:   Optional[bool]     = None

    @field_validator("access", mode="before")
    @classmethod
    def _v_access(cls, v):
        return _check_access(v)

    @field_validator("scale_type", mode="before")
    @classmethod
    def _v_scale_type(cls, v):
        return _check_scale_type(v)

    @model_validator(mode="before")
    @classmethod
    def resolve_group(cls, values: Any) -> Any:
        if isinstance(values, dict):
            grp = values.get("tag_group") or values.get("group_name") or values.get("group")
            if grp:
                values["tag_group"] = str(grp).strip()
                values["group_name"] = str(grp).strip()
        return values


class TagResponse(BaseModel):
    id:            int
    connection_id: int
    name:          str
    address:       str
    data_type:     str
    scan_rate_ms:  int
    enabled:       bool
    description:   str               = ""
    tag_group:     str               = ""
    scada_name:    str               = ""
    access:        str               = "rw"
    unit:          str               = ""
    scale_type:    str               = "none"
    raw_min:       float             = 0.0
    raw_max:       float             = 100.0
    eng_min:       float             = 0.0
    eng_max:       float             = 100.0
    scale_factor:  float             = 1.0
    scale_offset:  float             = 0.0
    scale_clamp:   bool              = False
    log_enabled:   bool              = False
    # Runtime state (injected by the API layer from TagEngine cache)
    current_value: Optional[Any]     = None
    quality:       str               = "Unknown"
    timestamp:     Optional[str]     = None

    model_config = {"from_attributes": True}
