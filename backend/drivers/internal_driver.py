"""
InternalDriver – Virtual / Memory / Simulator / Formula (Derived) Tags driver.

Supports 3 address modes without requiring any physical PLC:
1. Memory Tag (Read/Write):
     MEM:SETPOINT_1
     MEM:SETPOINT_1=3.5
2. Simulator Tag (Read-Only auto-generated signals):
     SIM:SINE(0,100,20)      -> Sine wave between 0..100 with 20s period
     SIM:RAMP(0,100,1)       -> Sawtooth ramp 0..100 stepping by 1
     SIM:RANDOM(20,30)       -> Random float between 20..30
     SIM:TOGGLE(5)           -> Boolean toggle every 5 seconds
3. Formula / Derived Tag (Safe AST expression referencing live TagEngine values):
     =FLOW_1 + FLOW_2
     =(AP1 + AP2) / 2
     =round(PUMP1_FLOW * 3.6, 2)
     =1 if AP1 > 2.5 else 0
     CALC:FLOW_1 + FLOW_2
"""

from __future__ import annotations

import ast
import logging
import math
import operator
import random
import re
import time
from typing import Any, Dict, Optional, Tuple

from drivers.base_driver import BaseDriver

logger = logging.getLogger(__name__)

# Safe AST operators for derived formula evaluation
_BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}

_UNARY_OPS = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
    ast.Not: operator.not_,
}

_CMP_OPS = {
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
}

_SAFE_FUNCS = {
    "abs": abs,
    "min": min,
    "max": max,
    "round": round,
    "int": int,
    "float": float,
    "bool": bool,
    "sqrt": math.sqrt,
    "pow": pow,
    "sin": math.sin,
    "cos": math.cos,
}


def _safe_eval_ast(node: ast.AST, env: Dict[str, Any]) -> Any:
    """Safely evaluate a restricted Python AST expression against env."""
    if isinstance(node, ast.Expression):
        return _safe_eval_ast(node.body, env)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float, bool, str)):
            return node.value
        raise ValueError("Unsupported constant type")
    if isinstance(node, ast.Name):
        if node.id in env:
            return env[node.id]
        if node.id.lower() == "true":
            return True
        if node.id.lower() == "false":
            return False
        raise KeyError(f"Unknown tag variable: {node.id}")
    if isinstance(node, ast.Attribute):
        # Support dotted reference like TRAM1.FLOW_1
        parts = []
        curr = node
        while isinstance(curr, ast.Attribute):
            parts.append(curr.attr)
            curr = curr.value
        if isinstance(curr, ast.Name):
            parts.append(curr.id)
            full_key = ".".join(reversed(parts))
            if full_key in env:
                return env[full_key]
        raise KeyError(f"Unknown dotted tag variable: {'.'.join(reversed(parts))}")
    if isinstance(node, ast.UnaryOp):
        op_fn = _UNARY_OPS.get(type(node.op))
        if not op_fn:
            raise ValueError("Unsupported unary operator")
        return op_fn(_safe_eval_ast(node.operand, env))
    if isinstance(node, ast.BinOp):
        op_fn = _BIN_OPS.get(type(node.op))
        if not op_fn:
            raise ValueError("Unsupported binary operator")
        left = _safe_eval_ast(node.left, env)
        right = _safe_eval_ast(node.right, env)
        return op_fn(left, right)
    if isinstance(node, ast.BoolOp):
        if isinstance(node.op, ast.And):
            result = True
            for v in node.values:
                result = _safe_eval_ast(v, env)
                if not result:
                    return result
            return result
        if isinstance(node.op, ast.Or):
            result = False
            for v in node.values:
                result = _safe_eval_ast(v, env)
                if result:
                    return result
            return result
    if isinstance(node, ast.Compare):
        left = _safe_eval_ast(node.left, env)
        for op, comp in zip(node.ops, node.comparators):
            op_fn = _CMP_OPS.get(type(op))
            if not op_fn:
                raise ValueError("Unsupported comparison operator")
            right = _safe_eval_ast(comp, env)
            if not op_fn(left, right):
                return False
            left = right
        return True
    if isinstance(node, ast.IfExp):
        cond = _safe_eval_ast(node.test, env)
        return _safe_eval_ast(node.body if cond else node.orelse, env)
    if isinstance(node, ast.Call):
        if isinstance(node.func, ast.Name) and node.func.id in _SAFE_FUNCS:
            args = [_safe_eval_ast(a, env) for a in node.args]
            return _SAFE_FUNCS[node.func.id](*args)
        raise ValueError("Unsupported function call")
    raise ValueError(f"Unsupported expression element: {type(node).__name__}")


def _cast_value(val: Any, data_type: str) -> Any:
    dt = (data_type or "float32").lower()
    if dt == "bool":
        if isinstance(val, str):
            return val.strip().lower() in ("1", "true", "yes", "on")
        return bool(val)
    if "float" in dt:
        return round(float(val), 4)
    if "int" in dt:
        return int(round(float(val)))
    return str(val)


class InternalDriver(BaseDriver):
    """Virtual driver for Memory, Simulator, and Derived Formula tags."""

    def __init__(self, config: dict):
        super().__init__(config)
        self._memory: Dict[str, Any] = {}
        self._ramp_state: Dict[str, float] = {}
        self._start_time = time.monotonic()
        self._tag_lookup_cache: Dict[str, int] = {}
        self._tag_lookup_ts: float = 0.0

    async def connect(self) -> bool:
        self._connected = True
        logger.info("InternalDriver '%s' ready (Memory / Simulator / Formula)", self._config.get("name"))
        return True

    async def disconnect(self) -> None:
        self._connected = False

    async def _refresh_tag_lookup(self) -> Dict[str, int]:
        """Cache mapping of tag names / group.name / TAG_id -> tag_id (refreshed every 3s)."""
        now = time.monotonic()
        if self._tag_lookup_cache and (now - self._tag_lookup_ts) < 3.0:
            return self._tag_lookup_cache

        from db.database import get_db
        lookup: Dict[str, int] = {}
        try:
            async with get_db() as db:
                async with db.execute(
                    "SELECT t.id, t.name, t.tag_group, c.name AS conn_name "
                    "FROM tags t JOIN connections c ON t.connection_id = c.id "
                    "WHERE t.enabled = 1"
                ) as cur:
                    rows = await cur.fetchall()
            for r in rows:
                tid = r["id"]
                tname = (r["name"] or "").strip()
                tgrp = (r["tag_group"] or "").strip().replace("/", ".")
                cname = (r["conn_name"] or "").strip()
                lookup[f"TAG_{tid}"] = tid
                if tname and tname not in lookup:
                    lookup[tname] = tid
                if tgrp and tname:
                    lookup[f"{tgrp}.{tname}"] = tid
                if cname and tgrp and tname:
                    lookup[f"{cname}.{tgrp}.{tname}"] = tid
                elif cname and tname:
                    lookup[f"{cname}.{tname}"] = tid
            self._tag_lookup_cache = lookup
            self._tag_lookup_ts = now
        except Exception as exc:
            logger.debug("InternalDriver lookup refresh error: %s", exc)
        return self._tag_lookup_cache

    async def read_tag(self, address: str, data_type: str) -> Tuple[Any, str]:
        addr = (address or "").strip()
        if not addr:
            return None, "Bad"

        upper = addr.upper()

        # 1. Formula / Derived Tag: "=FLOW_1 + FLOW_2" or "CALC:FLOW_1 + FLOW_2"
        if addr.startswith("=") or upper.startswith("CALC:"):
            expr = addr[1:].strip() if addr.startswith("=") else addr[5:].strip()
            return await self._eval_formula(expr, data_type)

        # 2. Simulator Tag: "SIM:SINE(0,100,20)"
        if upper.startswith("SIM:"):
            spec = addr[4:].strip()
            return self._eval_simulator(spec, data_type)

        # 3. Memory Tag: "MEM:KEY" or "MEM:KEY=123" (or any plain key)
        mem_body = addr[4:].strip() if upper.startswith("MEM:") else addr
        if "=" in mem_body:
            key, default_str = mem_body.split("=", 1)
            key = key.strip()
            if key not in self._memory:
                try:
                    self._memory[key] = _cast_value(default_str.strip(), data_type)
                except Exception:
                    self._memory[key] = default_str.strip()
        else:
            key = mem_body
            if key not in self._memory:
                self._memory[key] = _cast_value(0 if data_type != "string" else "", data_type)

        return self._memory[key], "Good"

    async def write_tag(self, address: str, value: Any, data_type: str) -> bool:
        addr = (address or "").strip()
        upper = addr.upper()
        # Only Memory tags are writable
        if addr.startswith("=") or upper.startswith("CALC:") or upper.startswith("SIM:"):
            logger.warning("InternalDriver: cannot write to read-only simulator/formula tag '%s'", addr)
            return False

        mem_body = addr[4:].strip() if upper.startswith("MEM:") else addr
        key = mem_body.split("=", 1)[0].strip()
        try:
            self._memory[key] = _cast_value(value, data_type)
            return True
        except Exception as exc:
            logger.error("InternalDriver write error [%s]: %s", key, exc)
            return False

    def _eval_simulator(self, spec: str, data_type: str) -> Tuple[Any, str]:
        elapsed = time.monotonic() - self._start_time
        m = re.match(r"^([A-Za-z_]+)\s*\(([^)]*)\)$", spec)
        if not m:
            # Simple shorthand: SIM:SINE, SIM:RANDOM, SIM:TOGGLE, SIM:RAMP
            kind = spec.upper()
            params = []
        else:
            kind = m.group(1).upper()
            params = [float(p.strip()) for p in m.group(2).split(",") if p.strip()]

        try:
            if kind == "SINE":
                lo = params[0] if len(params) > 0 else 0.0
                hi = params[1] if len(params) > 1 else 100.0
                period = params[2] if len(params) > 2 and params[2] > 0 else 20.0
                mid = (lo + hi) / 2.0
                amp = (hi - lo) / 2.0
                val = mid + amp * math.sin(2.0 * math.pi * elapsed / period)
                return _cast_value(val, data_type), "Good"

            if kind == "RAMP":
                lo = params[0] if len(params) > 0 else 0.0
                hi = params[1] if len(params) > 1 else 100.0
                step = params[2] if len(params) > 2 else 1.0
                cur = self._ramp_state.get(spec, lo)
                nxt = cur + step
                if nxt > hi:
                    nxt = lo
                self._ramp_state[spec] = nxt
                return _cast_value(cur, data_type), "Good"

            if kind == "RANDOM":
                lo = params[0] if len(params) > 0 else 0.0
                hi = params[1] if len(params) > 1 else 100.0
                val = random.uniform(lo, hi)
                return _cast_value(val, data_type), "Good"

            if kind == "TOGGLE":
                period = params[0] if len(params) > 0 and params[0] > 0 else 5.0
                val = int(elapsed // period) % 2 == 0
                return _cast_value(val, data_type), "Good"

            return None, "Bad"
        except Exception as exc:
            logger.debug("Simulator eval error [%s]: %s", spec, exc)
            return None, "Bad"

    async def _eval_formula(self, expr: str, data_type: str) -> Tuple[Any, str]:
        if not expr:
            return None, "Bad"
        try:
            from core.tag_engine import TagEngine
            engine = TagEngine()
            lookup = await self._refresh_tag_lookup()
            all_vals = engine.get_all_values()

            env: Dict[str, Any] = {}
            for key, tid in lookup.items():
                entry = all_vals.get(tid)
                if entry and entry.get("value") is not None:
                    v = entry["value"]
                    if isinstance(v, bool):
                        env[key] = 1 if v else 0
                    else:
                        try:
                            env[key] = float(v)
                        except (TypeError, ValueError):
                            env[key] = v

            tree = ast.parse(expr, mode="eval")
            result = _safe_eval_ast(tree, env)
            return _cast_value(result, data_type), "Good"
        except KeyError:
            # Referenced tag has no live value yet
            return None, "Unknown"
        except ZeroDivisionError:
            return 0.0 if "float" in (data_type or "") else 0, "Bad"
        except Exception as exc:
            logger.debug("Formula eval error [%s]: %s", expr, exc)
            return None, "Bad"
