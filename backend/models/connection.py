"""
Pydantic models for Connection CRUD operations.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class Protocol(str, Enum):
    modbus_tcp = "modbus_tcp"
    modbus_rtu = "modbus_rtu"
    s7         = "s7"
    mqtt       = "mqtt"
    opcua      = "opcua"
    opc_da     = "opc_da"
    internal   = "internal"


class ConnectionCreate(BaseModel):
    name:     str                   = Field(..., min_length=1, max_length=128)
    protocol: Protocol
    host:     Optional[str]         = None
    port:     Optional[int]         = None
    config:   Optional[Dict[str, Any]] = Field(default_factory=dict)
    enabled:  bool                  = True


class ConnectionUpdate(BaseModel):
    name:     Optional[str]            = None
    protocol: Optional[Protocol]       = None
    host:     Optional[str]            = None
    port:     Optional[int]            = None
    config:   Optional[Dict[str, Any]] = None
    enabled:  Optional[bool]           = None


class ConnectionResponse(BaseModel):
    id:         int
    name:       str
    protocol:   str
    host:       Optional[str]
    port:       Optional[int]
    config:     Dict[str, Any]        = Field(default_factory=dict)
    enabled:    bool
    created_at: Optional[str]
    # Runtime state (injected by the API layer)
    connected:  bool                   = False
    demoted:    bool                   = False
    tag_count:  int                    = 0
    good_count: int                    = 0
    bad_count:  int                    = 0

    model_config = {"from_attributes": True}
