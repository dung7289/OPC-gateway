"""
Tags CRUD API.

GET    /api/tags            – list tags (optional ?connection_id=N)
POST   /api/tags            – create a tag
GET    /api/tags/{id}       – get a single tag with its current value
PUT    /api/tags/{id}       – update a tag
DELETE /api/tags/{id}       – delete a tag
POST   /api/tags/{id}/write – write a value to a tag
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from typing import Any, List, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field, field_validator

from api.logs import add_log
from core.s7_importer import parse_s7_bytes, parse_s7_text
from core.tag_engine import TagEngine, TagReadOnlyError
from db.database import get_db
from models.tag import DataType, TagCreate, TagResponse, TagUpdate, _check_access, _check_scale_type

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tags", tags=["tags"])


class WriteRequest(BaseModel):
    value: Any


# ------------------------------------------------------------------
# Optional per-tag attributes (access / unit / scaling / data logger)
# ------------------------------------------------------------------

_EXTRA_COLS = [
    "access", "unit", "scale_type", "raw_min", "raw_max", "eng_min", "eng_max",
    "scale_factor", "scale_offset", "scale_clamp", "log_enabled",
]
_EXTRA_COLS_SQL = ", ".join(_EXTRA_COLS)
_EXTRA_PLACEHOLDERS = ", ".join("?" for _ in _EXTRA_COLS)
_EXTRA_BOOL_COLS = {"scale_clamp", "log_enabled"}


def _extra_from_model(m) -> tuple:
    """Extra column values (in _EXTRA_COLS order) from a TagCreate pydantic model."""
    return (
        m.access, (m.unit or "").strip(), m.scale_type,
        m.raw_min, m.raw_max, m.eng_min, m.eng_max,
        m.scale_factor, m.scale_offset, int(m.scale_clamp), int(m.log_enabled),
    )


def _extra_from_row(r: dict) -> tuple:
    """Extra column values (in _EXTRA_COLS order) copied from an existing DB row."""
    def nz(key, default):
        v = r.get(key)
        return default if v is None else v
    return (
        nz("access", "rw"), nz("unit", ""), nz("scale_type", "none"),
        nz("raw_min", 0.0), nz("raw_max", 100.0), nz("eng_min", 0.0), nz("eng_max", 100.0),
        nz("scale_factor", 1.0), nz("scale_offset", 0.0), int(nz("scale_clamp", 0)), int(nz("log_enabled", 0)),
    )


def _enrich(row: dict, engine: TagEngine) -> TagResponse:
    """Merge DB row with live TagEngine cache data."""
    cache = engine.get_tag_value(row["id"])
    grp = (row.get("tag_group") or "").strip()
    tag_name = row["name"].strip()
    scada_name = f"{grp}.{tag_name}" if grp and grp.lower() != "default" else tag_name

    def nz(key, default):
        v = row.get(key)
        return default if v is None else v

    return TagResponse(
        id=row["id"],
        connection_id=row["connection_id"],
        name=tag_name,
        address=row["address"],
        data_type=row["data_type"],
        scan_rate_ms=row["scan_rate_ms"],
        enabled=bool(row["enabled"]),
        description=row.get("description") or "",
        tag_group=grp,
        scada_name=scada_name,
        access=nz("access", "rw"),
        unit=nz("unit", ""),
        scale_type=nz("scale_type", "none"),
        raw_min=nz("raw_min", 0.0),
        raw_max=nz("raw_max", 100.0),
        eng_min=nz("eng_min", 0.0),
        eng_max=nz("eng_max", 100.0),
        scale_factor=nz("scale_factor", 1.0),
        scale_offset=nz("scale_offset", 0.0),
        scale_clamp=bool(nz("scale_clamp", 0)),
        log_enabled=bool(nz("log_enabled", 0)),
        current_value=cache.get("value"),
        quality=cache.get("quality", "Unknown"),
        timestamp=cache.get("timestamp"),
    )


# ------------------------------------------------------------------
# Endpoints
# ------------------------------------------------------------------

@router.get("", response_model=List[TagResponse])
@router.get("/", response_model=List[TagResponse])
async def list_tags(
    connection_id: Optional[int] = Query(default=None, description="Filter by connection_id"),
):
    """List all (or filtered) tags with their current values from the cache."""
    engine = TagEngine()
    async with get_db() as db:
        if connection_id is not None:
            async with db.execute(
                "SELECT * FROM tags WHERE connection_id = ? ORDER BY id",
                (connection_id,),
            ) as cursor:
                rows = await cursor.fetchall()
        else:
            async with db.execute("SELECT * FROM tags ORDER BY id") as cursor:
                rows = await cursor.fetchall()

    return [_enrich(dict(row), engine) for row in rows]


@router.post("", response_model=TagResponse, status_code=201)
@router.post("/", response_model=TagResponse, status_code=201)
async def create_tag(payload: TagCreate):
    """Create a new tag and reload the TagEngine to include it in polling."""
    async with get_db() as db:
        # Verify connection exists
        async with db.execute(
            "SELECT id FROM connections WHERE id = ?", (payload.connection_id,)
        ) as cursor:
            if await cursor.fetchone() is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Connection id={payload.connection_id} not found",
                )

        try:
            if payload.tag_group and payload.tag_group.strip():
                grp = payload.tag_group.strip()
                parts = [p.strip() for p in grp.split('/') if p.strip()]
                accum = ""
                for part in parts:
                    accum = f"{accum}/{part}" if accum else part
                    try:
                        await db.execute(
                            "INSERT OR IGNORE INTO tag_groups (connection_id, name) VALUES (?, ?)",
                            (payload.connection_id, accum),
                        )
                    except Exception:
                        pass

            cursor = await db.execute(
                "INSERT INTO tags (connection_id, name, address, data_type, scan_rate_ms, enabled, description, tag_group, "
                + _EXTRA_COLS_SQL + ") "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, " + _EXTRA_PLACEHOLDERS + ")",
                (
                    payload.connection_id,
                    payload.name,
                    payload.address,
                    payload.data_type.value,
                    payload.scan_rate_ms,
                    int(payload.enabled),
                    payload.description,
                    payload.tag_group,
                    *_extra_from_model(payload),
                ),
            )
            await db.commit()
            tag_id = cursor.lastrowid
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        async with db.execute("SELECT * FROM tags WHERE id = ?", (tag_id,)) as cur:
            row = dict(await cur.fetchone())

    # Reload polling engine to pick up the new tag
    engine = TagEngine()
    await engine.reload()

    await add_log("INFO", "tags", f"Tag '{payload.name}' created (id={tag_id})")
    return _enrich(row, engine)


class TagGroupCreate(BaseModel):
    connection_id: int
    name: str = Field(..., min_length=1, max_length=128)
    description: str = ""


@router.get("/groups")
@router.get("/groups/")
async def list_tag_groups(connection_id: Optional[int] = None):
    """List all user-created tag groups."""
    async with get_db() as db:
        if connection_id is not None:
            async with db.execute(
                "SELECT * FROM tag_groups WHERE connection_id = ? ORDER BY name",
                (connection_id,),
            ) as cursor:
                rows = await cursor.fetchall()
        else:
            async with db.execute("SELECT * FROM tag_groups ORDER BY name") as cursor:
                rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.post("/groups", status_code=201)
@router.post("/groups/", status_code=201)
async def create_tag_group(payload: TagGroupCreate):
    """Create a new tag group folder."""
    async with get_db() as db:
        try:
            # Auto ensure parent folders exist
            parts = [p.strip() for p in payload.name.strip().split('/') if p.strip()]
            accum = ""
            for part in parts[:-1]:
                accum = f"{accum}/{part}" if accum else part
                try:
                    await db.execute(
                        "INSERT OR IGNORE INTO tag_groups (connection_id, name) VALUES (?, ?)",
                        (payload.connection_id, accum),
                    )
                except Exception:
                    pass

            cursor = await db.execute(
                "INSERT INTO tag_groups (connection_id, name, description) VALUES (?, ?, ?)",
                (payload.connection_id, payload.name.strip(), payload.description.strip()),
            )
            await db.commit()
            group_id = cursor.lastrowid
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Group already exists or invalid data")

    await add_log("INFO", "tags", f"Tag group '{payload.name}' created")
    return {"id": group_id, "connection_id": payload.connection_id, "name": payload.name}


class TagGroupRename(BaseModel):
    connection_id: int
    old_name: str
    new_name: str


@router.put("/groups/rename")
@router.put("/groups/rename/")
async def rename_tag_group(payload: TagGroupRename):
    """Rename a tag group and update all associated tags."""
    old_name = payload.old_name.strip()
    new_name = payload.new_name.strip()
    conn_id = payload.connection_id

    if not old_name or not new_name:
        raise HTTPException(status_code=400, detail="Tên thư mục không được để trống")
    if old_name.lower() == new_name.lower():
        return {"message": "Tên thư mục không thay đổi", "old_name": old_name, "new_name": new_name, "updated_tags": 0}

    async with get_db() as db:
        # Check if new_name already exists in tag_groups for this connection
        async with db.execute(
            "SELECT id FROM tag_groups WHERE connection_id = ? AND LOWER(name) = LOWER(?)",
            (conn_id, new_name)
        ) as cur:
            if await cur.fetchone():
                raise HTTPException(status_code=400, detail=f"Thư mục '{new_name}' đã tồn tại trong kết nối này")

        # Update tag_groups table (or insert if old was virtual default)
        async with db.execute(
            "SELECT id FROM tag_groups WHERE connection_id = ? AND LOWER(name) = LOWER(?)",
            (conn_id, old_name)
        ) as cur:
            existing_grp = await cur.fetchone()

        if existing_grp:
            await db.execute(
                "UPDATE tag_groups SET name = ? WHERE connection_id = ? AND LOWER(name) = LOWER(?)",
                (new_name, conn_id, old_name)
            )
        else:
            await db.execute(
                "INSERT INTO tag_groups (connection_id, name) VALUES (?, ?)",
                (conn_id, new_name)
            )

        # Also rename any child tag_groups (e.g. old_name/sub -> new_name/sub)
        old_prefix = f"{old_name}/"
        new_prefix = f"{new_name}/"
        async with db.execute(
            "SELECT id, name FROM tag_groups WHERE connection_id = ? AND name LIKE ? || '%'",
            (conn_id, old_prefix)
        ) as cur:
            child_grps = await cur.fetchall()
            for cg in child_grps:
                updated_cg_name = new_prefix + cg["name"][len(old_prefix):]
                await db.execute(
                    "UPDATE tag_groups SET name = ? WHERE id = ?",
                    (updated_cg_name, cg["id"])
                )

        # Update tags table
        if old_name.lower() == "default":
            cursor = await db.execute(
                "UPDATE tags SET tag_group = ? WHERE connection_id = ? AND (tag_group = 'default' OR tag_group IS NULL OR tag_group = '')",
                (new_name, conn_id)
            )
            updated_count = cursor.rowcount
        else:
            cursor = await db.execute(
                "UPDATE tags SET tag_group = ? WHERE connection_id = ? AND tag_group = ?",
                (new_name, conn_id, old_name)
            )
            updated_count = cursor.rowcount

            # Also update any child tags in subfolders
            async with db.execute(
                "SELECT id, tag_group FROM tags WHERE connection_id = ? AND tag_group LIKE ? || '%'",
                (conn_id, old_prefix)
            ) as cur:
                child_tags = await cur.fetchall()
                for ct in child_tags:
                    updated_tg = new_prefix + ct["tag_group"][len(old_prefix):]
                    await db.execute(
                        "UPDATE tags SET tag_group = ? WHERE id = ?",
                        (updated_tg, ct["id"])
                    )
                updated_count += len(child_tags)

        await db.commit()

    engine = TagEngine()
    await engine.reload()

    await add_log("INFO", "tags", f"Thư mục '{old_name}' đổi tên thành '{new_name}' ({updated_count} tags cập nhật)")
    return {
        "message": f"Đã đổi tên thư mục thành '{new_name}' ({updated_count} tags được cập nhật)",
        "old_name": old_name,
        "new_name": new_name,
        "updated_tags": updated_count,
    }


@router.delete("/groups/by-name")
@router.delete("/groups/by-name/")
async def delete_tag_group_by_name(
    connection_id: int = Query(...),
    group_name: str = Query(...),
    delete_tags: bool = Query(default=True)
):
    """Delete a tag group folder by name and optionally delete or migrate its tags."""
    grp = group_name.strip()
    grp_prefix = f"{grp}/"
    async with get_db() as db:
        # Delete from tag_groups table (both exact and any child groups)
        await db.execute(
            "DELETE FROM tag_groups WHERE connection_id = ? AND (LOWER(name) = LOWER(?) OR name LIKE ? || '%')",
            (connection_id, grp, grp_prefix)
        )

        deleted_tag_count = 0
        if delete_tags:
            # Delete all tags inside this group and child groups
            if grp.lower() == "default":
                cursor = await db.execute(
                    "DELETE FROM tags WHERE connection_id = ? AND (LOWER(tag_group) = 'default' OR tag_group IS NULL OR tag_group = '' OR tag_group LIKE 'default/%')",
                    (connection_id,)
                )
            else:
                cursor = await db.execute(
                    "DELETE FROM tags WHERE connection_id = ? AND (tag_group = ? OR tag_group LIKE ? || '%')",
                    (connection_id, grp, grp_prefix)
                )
            deleted_tag_count = cursor.rowcount
        else:
            # Clear tag_group to empty string instead of forcing back to 'default'
            if grp.lower() == "default":
                await db.execute(
                    "UPDATE tags SET tag_group = '' WHERE connection_id = ? AND (LOWER(tag_group) = 'default' OR tag_group LIKE 'default/%')",
                    (connection_id,)
                )
            else:
                await db.execute(
                    "UPDATE tags SET tag_group = '' WHERE connection_id = ? AND (tag_group = ? OR tag_group LIKE ? || '%')",
                    (connection_id, grp, grp_prefix)
                )
            deleted_tag_count = 0

        await db.commit()

    engine = TagEngine()
    await engine.reload()

    msg = f"Đã xóa thư mục '{grp}'" + (f" và {deleted_tag_count} tag bên trong" if delete_tags else "")
    await add_log("INFO", "tags", msg)
    return {"message": msg, "deleted_tags": deleted_tag_count}


@router.delete("/groups/{group_id}")
async def delete_tag_group(group_id: int):
    """Delete a tag group folder by ID."""
    async with get_db() as db:
        await db.execute("DELETE FROM tag_groups WHERE id = ?", (group_id,))
        await db.commit()
    return {"message": "Group deleted"}


# ---------------------------------------------------------------------------
# Copy / Paste Tags & Folders (with smart trailing-number auto-increment)
# ---------------------------------------------------------------------------

def _next_unique_name(base_name: str, existing_lower: set) -> str:
    """
    Generate a unique name against existing_lower (set of lowercase names).
    - If base_name is unused -> returns base_name.
    - If base_name ends with digits (e.g. 'BOM1', 'TRAM_01') -> increments digits ('BOM2', 'TRAM_02').
    - Otherwise -> appends '_1', '_2', ...
    """
    name = (base_name or "").strip()
    if name.lower() not in existing_lower:
        return name

    import re
    m = re.match(r"^(.*?)(\d+)$", name)
    if m:
        prefix, digits = m.group(1), m.group(2)
        width = len(digits)
        num = int(digits)
        while True:
            num += 1
            cand = f"{prefix}{str(num).zfill(width)}"
            if cand.lower() not in existing_lower:
                return cand
    else:
        num = 1
        while True:
            cand = f"{name}_{num}"
            if cand.lower() not in existing_lower:
                return cand


class PasteTagsRequest(BaseModel):
    tag_ids: List[int] = Field(..., min_length=1)
    target_connection_id: int
    target_group: str = ""


class PasteGroupRequest(BaseModel):
    source_connection_id: int
    source_group: str = Field(..., min_length=1)
    target_connection_id: int
    target_parent_group: str = ""


@router.post("/paste", status_code=201)
@router.post("/paste/", status_code=201)
async def paste_tags(payload: PasteTagsRequest):
    """Clone one or more tags into target_connection_id / target_group, auto-incrementing duplicate names."""
    target_grp = (payload.target_group or "").strip().strip("/")
    created_tags = []

    async with get_db() as db:
        # Verify target connection exists
        async with db.execute(
            "SELECT id FROM connections WHERE id = ?", (payload.target_connection_id,)
        ) as cur:
            if await cur.fetchone() is None:
                raise HTTPException(status_code=400, detail="Không tìm thấy kết nối đích")

        # Ensure target group and its ancestor folders exist
        if target_grp:
            parts = [p.strip() for p in target_grp.split("/") if p.strip()]
            accum = ""
            for part in parts:
                accum = f"{accum}/{part}" if accum else part
                await db.execute(
                    "INSERT OR IGNORE INTO tag_groups (connection_id, name) VALUES (?, ?)",
                    (payload.target_connection_id, accum),
                )

        # Fetch existing tag names in target folder
        async with db.execute(
            "SELECT name FROM tags WHERE connection_id = ? AND COALESCE(tag_group, '') = ?",
            (payload.target_connection_id, target_grp),
        ) as cur:
            existing_names = {row["name"].lower() for row in await cur.fetchall()}

        # Fetch source tags preserving order
        placeholders = ",".join("?" for _ in payload.tag_ids)
        async with db.execute(
            f"SELECT * FROM tags WHERE id IN ({placeholders}) ORDER BY id",
            tuple(payload.tag_ids),
        ) as cur:
            src_rows = [dict(r) for r in await cur.fetchall()]

        if not src_rows:
            raise HTTPException(status_code=404, detail="Không tìm thấy tag nguồn để dán")

        for src in src_rows:
            new_name = _next_unique_name(src["name"], existing_names)
            existing_names.add(new_name.lower())

            cursor = await db.execute(
                "INSERT INTO tags (connection_id, name, address, data_type, scan_rate_ms, enabled, description, tag_group, "
                + _EXTRA_COLS_SQL + ") "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, " + _EXTRA_PLACEHOLDERS + ")",
                (
                    payload.target_connection_id,
                    new_name,
                    src["address"],
                    src["data_type"],
                    src["scan_rate_ms"],
                    src["enabled"],
                    src.get("description") or "",
                    target_grp,
                    *_extra_from_row(src),
                ),
            )
            created_tags.append({"id": cursor.lastrowid, "name": new_name, "tag_group": target_grp})

        await db.commit()

    engine = TagEngine()
    await engine.reload()

    msg = f"Đã dán {len(created_tags)} tag vào '{target_grp or 'Gốc'}'"
    await add_log("INFO", "tags", msg)
    return {"message": msg, "created_count": len(created_tags), "tags": created_tags}


@router.post("/groups/paste", status_code=201)
@router.post("/groups/paste/", status_code=201)
async def paste_tag_group(payload: PasteGroupRequest):
    """
    Deep-copy a folder (including all nested subfolders and tags) into target_connection_id / target_parent_group.
    Automatically increments the folder name index if a sibling folder with the same name already exists.
    """
    src_grp = payload.source_group.strip().strip("/")
    target_parent = (payload.target_parent_group or "").strip().strip("/")
    if not src_grp:
        raise HTTPException(status_code=400, detail="Tên thư mục nguồn không hợp lệ")

    leaf_name = src_grp.split("/")[-1]
    src_prefix = f"{src_grp}/"

    async with get_db() as db:
        # Verify target connection exists
        async with db.execute(
            "SELECT id FROM connections WHERE id = ?", (payload.target_connection_id,)
        ) as cur:
            if await cur.fetchone() is None:
                raise HTTPException(status_code=400, detail="Không tìm thấy kết nối đích")

        # Collect existing sibling folder names under target_parent
        existing_siblings = set()
        async with db.execute(
            "SELECT name FROM tag_groups WHERE connection_id = ?",
            (payload.target_connection_id,),
        ) as cur:
            all_target_groups = [r["name"].strip("/") for r in await cur.fetchall() if r["name"]]

        async with db.execute(
            "SELECT DISTINCT tag_group FROM tags WHERE connection_id = ? AND tag_group IS NOT NULL AND tag_group != ''",
            (payload.target_connection_id,),
        ) as cur:
            for r in await cur.fetchall():
                all_target_groups.append(r["tag_group"].strip("/"))

        parent_prefix = f"{target_parent}/" if target_parent else ""
        for g in all_target_groups:
            if not target_parent:
                existing_siblings.add(g.split("/")[0].lower())
            elif g.startswith(parent_prefix):
                rest = g[len(parent_prefix):]
                if rest:
                    existing_siblings.add(rest.split("/")[0].lower())

        new_leaf = _next_unique_name(leaf_name, existing_siblings)
        new_root = f"{target_parent}/{new_leaf}" if target_parent else new_leaf

        # Ensure target_parent ancestors + new_root exist in tag_groups
        root_parts = [p.strip() for p in new_root.split("/") if p.strip()]
        accum = ""
        for part in root_parts:
            accum = f"{accum}/{part}" if accum else part
            await db.execute(
                "INSERT OR IGNORE INTO tag_groups (connection_id, name) VALUES (?, ?)",
                (payload.target_connection_id, accum),
            )

        # Find all nested child groups under src_grp
        async with db.execute(
            "SELECT name, description FROM tag_groups WHERE connection_id = ? AND (name = ? OR name LIKE ? || '%')",
            (payload.source_connection_id, src_grp, src_prefix),
        ) as cur:
            src_groups = [dict(r) for r in await cur.fetchall()]

        copied_groups = 1
        for sg in src_groups:
            sg_name = sg["name"].strip("/")
            if sg_name == src_grp:
                continue
            rel = sg_name[len(src_prefix):]
            dest_grp = f"{new_root}/{rel}"
            await db.execute(
                "INSERT OR IGNORE INTO tag_groups (connection_id, name, description) VALUES (?, ?, ?)",
                (payload.target_connection_id, dest_grp, sg.get("description") or ""),
            )
            copied_groups += 1

        # Find all tags inside src_grp and its nested subfolders
        async with db.execute(
            "SELECT * FROM tags WHERE connection_id = ? AND (tag_group = ? OR tag_group LIKE ? || '%') ORDER BY id",
            (payload.source_connection_id, src_grp, src_prefix),
        ) as cur:
            src_tags = [dict(r) for r in await cur.fetchall()]

        # Track existing tag names per destination folder
        existing_by_grp: dict[str, set] = {}
        copied_tags = 0

        for st in src_tags:
            old_tg = (st.get("tag_group") or "").strip("/")
            if old_tg == src_grp:
                dest_tg = new_root
            elif old_tg.startswith(src_prefix):
                dest_tg = f"{new_root}/{old_tg[len(src_prefix):]}"
            else:
                dest_tg = new_root

            # Ensure dest_tg and its ancestors are in tag_groups
            if dest_tg != new_root:
                parts = [p.strip() for p in dest_tg.split("/") if p.strip()]
                acc = ""
                for p in parts:
                    acc = f"{acc}/{p}" if acc else p
                    await db.execute(
                        "INSERT OR IGNORE INTO tag_groups (connection_id, name) VALUES (?, ?)",
                        (payload.target_connection_id, acc),
                    )

            if dest_tg not in existing_by_grp:
                async with db.execute(
                    "SELECT name FROM tags WHERE connection_id = ? AND COALESCE(tag_group, '') = ?",
                    (payload.target_connection_id, dest_tg),
                ) as cur:
                    existing_by_grp[dest_tg] = {r["name"].lower() for r in await cur.fetchall()}

            new_tag_name = _next_unique_name(st["name"], existing_by_grp[dest_tg])
            existing_by_grp[dest_tg].add(new_tag_name.lower())

            await db.execute(
                "INSERT INTO tags (connection_id, name, address, data_type, scan_rate_ms, enabled, description, tag_group, "
                + _EXTRA_COLS_SQL + ") "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, " + _EXTRA_PLACEHOLDERS + ")",
                (
                    payload.target_connection_id,
                    new_tag_name,
                    st["address"],
                    st["data_type"],
                    st["scan_rate_ms"],
                    st["enabled"],
                    st.get("description") or "",
                    dest_tg,
                    *_extra_from_row(st),
                ),
            )
            copied_tags += 1

        await db.commit()

    engine = TagEngine()
    await engine.reload()

    msg = f"Đã dán thư mục '{new_root}' ({copied_tags} tag)"
    await add_log("INFO", "tags", msg)
    return {
        "message": msg,
        "new_group": new_root,
        "copied_groups": copied_groups,
        "copied_tags": copied_tags,
    }


# ---------------------------------------------------------------------------
# Bulk Edit & Find/Replace (Kepware-style multi-tag operations)
# ---------------------------------------------------------------------------

class BulkUpdateTagsRequest(BaseModel):
    tag_ids: List[int] = Field(..., min_length=1)
    scan_rate_ms: Optional[int] = Field(default=None, ge=50, le=60000)
    data_type: Optional[DataType] = None
    tag_group: Optional[str] = None
    enabled: Optional[bool] = None
    access: Optional[str] = None
    unit: Optional[str] = None
    log_enabled: Optional[bool] = None
    scale_type: Optional[str] = None
    raw_min: Optional[float] = None
    raw_max: Optional[float] = None
    eng_min: Optional[float] = None
    eng_max: Optional[float] = None
    scale_factor: Optional[float] = None
    scale_offset: Optional[float] = None
    scale_clamp: Optional[bool] = None

    @field_validator("access", mode="before")
    @classmethod
    def _v_access(cls, v):
        return _check_access(v)

    @field_validator("scale_type", mode="before")
    @classmethod
    def _v_scale_type(cls, v):
        return _check_scale_type(v)


class FindReplaceRequest(BaseModel):
    tag_ids: List[int] = Field(..., min_length=1)
    field: str = Field(default="address")  # address | name | description | tag_group
    find_text: str = Field(..., min_length=1)
    replace_text: str = ""
    case_sensitive: bool = False
    dry_run: bool = False


@router.post("/bulk-update")
@router.post("/bulk-update/")
async def bulk_update_tags(payload: BulkUpdateTagsRequest):
    """Apply selected attribute updates to multiple tags at once."""
    updates: dict = {}
    if payload.scan_rate_ms is not None:
        updates["scan_rate_ms"] = payload.scan_rate_ms
    if payload.data_type is not None:
        updates["data_type"] = payload.data_type.value
    if payload.tag_group is not None:
        updates["tag_group"] = payload.tag_group.strip()
    if payload.enabled is not None:
        updates["enabled"] = int(payload.enabled)
    for col in _EXTRA_COLS:
        val = getattr(payload, col, None)
        if val is not None:
            if col == "unit":
                updates[col] = val.strip()
            else:
                updates[col] = int(val) if col in _EXTRA_BOOL_COLS else val

    if not updates:
        raise HTTPException(status_code=400, detail="Chưa chọn trường nào để cập nhật hàng loạt")

    placeholders = ",".join("?" for _ in payload.tag_ids)
    set_clause = ", ".join(f"{k} = ?" for k in updates)

    async with get_db() as db:
        # Ensure new tag_group exists in tag_groups for affected connections
        if "tag_group" in updates and updates["tag_group"]:
            grp = updates["tag_group"]
            async with db.execute(
                f"SELECT DISTINCT connection_id FROM tags WHERE id IN ({placeholders})",
                tuple(payload.tag_ids),
            ) as cur:
                conn_ids = [r["connection_id"] for r in await cur.fetchall()]
            parts = [p.strip() for p in grp.split("/") if p.strip()]
            for cid in conn_ids:
                acc = ""
                for p in parts:
                    acc = f"{acc}/{p}" if acc else p
                    await db.execute(
                        "INSERT OR IGNORE INTO tag_groups (connection_id, name) VALUES (?, ?)",
                        (cid, acc),
                    )

        cursor = await db.execute(
            f"UPDATE tags SET {set_clause} WHERE id IN ({placeholders})",
            (*updates.values(), *payload.tag_ids),
        )
        updated_count = cursor.rowcount
        await db.commit()

    engine = TagEngine()
    await engine.reload()

    msg = f"Đã cập nhật hàng loạt {updated_count} tag"
    await add_log("INFO", "tags", msg)
    return {"message": msg, "updated_count": updated_count}


@router.post("/find-replace")
@router.post("/find-replace/")
async def find_replace_tags(payload: FindReplaceRequest):
    """Find & Replace substring across selected tags' address, name, description, or tag_group."""
    import re as _re
    allowed_fields = ("address", "name", "description", "tag_group")
    if payload.field not in allowed_fields:
        raise HTTPException(status_code=400, detail=f"Trường không hợp lệ. Chọn một trong: {allowed_fields}")

    placeholders = ",".join("?" for _ in payload.tag_ids)
    flags = 0 if payload.case_sensitive else _re.IGNORECASE
    pattern = _re.compile(_re.escape(payload.find_text), flags)

    changes = []
    async with get_db() as db:
        async with db.execute(
            f"SELECT id, connection_id, name, address, description, tag_group FROM tags WHERE id IN ({placeholders}) ORDER BY id",
            tuple(payload.tag_ids),
        ) as cur:
            rows = [dict(r) for r in await cur.fetchall()]

        for r in rows:
            old_val = str(r.get(payload.field) or "")
            new_val, n = pattern.subn(lambda _m: payload.replace_text, old_val)
            if n > 0 and new_val != old_val:
                changes.append({
                    "id": r["id"],
                    "tag_name": r["name"],
                    "field": payload.field,
                    "old_value": old_val,
                    "new_value": new_val,
                })
                if not payload.dry_run:
                    await db.execute(
                        f"UPDATE tags SET {payload.field} = ? WHERE id = ?",
                        (new_val, r["id"]),
                    )

        if not payload.dry_run and changes:
            await db.commit()

    if not payload.dry_run and changes:
        engine = TagEngine()
        await engine.reload()
        await add_log(
            "INFO",
            "tags",
            f"Find & Replace ({payload.field}): '{payload.find_text}' -> '{payload.replace_text}' ({len(changes)} tag)",
        )

    return {
        "dry_run": payload.dry_run,
        "matched_count": len(changes),
        "changes": changes,
        "message": (
            f"Tìm thấy {len(changes)} tag khớp (xem trước)"
            if payload.dry_run
            else f"Đã thay thế thành công trên {len(changes)} tag"
        ),
    }


@router.get("/{tag_id}", response_model=TagResponse)
async def get_tag(tag_id: int):
    """Return a single tag with its current cached value."""
    async with get_db() as db:
        async with db.execute(
            "SELECT * FROM tags WHERE id = ?", (tag_id,)
        ) as cursor:
            row = await cursor.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Tag not found")

    engine = TagEngine()
    return _enrich(dict(row), engine)


@router.put("/{tag_id}", response_model=TagResponse)
async def update_tag(tag_id: int, payload: TagUpdate):
    """Update tag metadata and reload the TagEngine."""
    async with get_db() as db:
        async with db.execute(
            "SELECT * FROM tags WHERE id = ?", (tag_id,)
        ) as cursor:
            existing = await cursor.fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="Tag not found")

        updates: dict = {}
        if payload.connection_id is not None: updates["connection_id"] = payload.connection_id
        if payload.name          is not None: updates["name"]          = payload.name
        if payload.address       is not None: updates["address"]       = payload.address
        if payload.data_type     is not None: updates["data_type"]     = payload.data_type.value
        if payload.scan_rate_ms  is not None: updates["scan_rate_ms"]  = payload.scan_rate_ms
        if payload.enabled       is not None: updates["enabled"]       = int(payload.enabled)
        if payload.description   is not None: updates["description"]   = payload.description
        if payload.tag_group     is not None: updates["tag_group"]     = payload.tag_group
        for _col in _EXTRA_COLS:
            _val = getattr(payload, _col, None)
            if _val is not None:
                updates[_col] = int(_val) if _col in _EXTRA_BOOL_COLS else _val

        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            await db.execute(
                f"UPDATE tags SET {set_clause} WHERE id = ?",
                (*updates.values(), tag_id),
            )
            await db.commit()

        async with db.execute("SELECT * FROM tags WHERE id = ?", (tag_id,)) as cur:
            row = dict(await cur.fetchone())

    engine = TagEngine()
    await engine.reload()

    await add_log("INFO", "tags", f"Tag id={tag_id} updated")
    return _enrich(row, engine)


@router.delete("/{tag_id}")
async def delete_tag(tag_id: int):
    """Delete a tag and reload the TagEngine."""
    async with get_db() as db:
        async with db.execute(
            "SELECT id, name FROM tags WHERE id = ?", (tag_id,)
        ) as cursor:
            row = await cursor.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Tag not found")
        name = row["name"]
        await db.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
        await db.commit()

    engine = TagEngine()
    await engine.reload()

    await add_log("INFO", "tags", f"Tag '{name}' (id={tag_id}) deleted")
    return {"message": f"Tag {tag_id} deleted"}


@router.post("/batch", status_code=201)
@router.post("/batch/", status_code=201)
async def create_tags_batch(tags: List[TagCreate]):
    """
    Bulk create tags from Excel / CSV import.
    Skips any tag that already exists (connection_id + tag_group + name) to prevent duplicate tags.
    """
    engine = TagEngine()
    inserted_ids = []
    skipped_count = 0

    async with get_db() as db:
        for t in tags:
            tag_name = t.name.strip()
            group_name = (t.tag_group or getattr(t, 'group_name', None) or "").strip()
            t.tag_group = group_name
            
            # Auto ensure tag_group and all its parent folders exist in tag_groups table
            if group_name:
                parts = [p.strip() for p in group_name.split('/') if p.strip()]
                accum = ""
                for part in parts:
                    accum = f"{accum}/{part}" if accum else part
                    try:
                        await db.execute(
                            "INSERT OR IGNORE INTO tag_groups (connection_id, name) VALUES (?, ?)",
                            (t.connection_id, accum),
                        )
                    except Exception:
                        pass

            # Check if tag already exists in (connection_id, tag_group, name)
            async with db.execute(
                "SELECT id FROM tags WHERE connection_id = ? AND tag_group = ? AND name = ?",
                (t.connection_id, group_name, tag_name),
            ) as cursor:
                exists = await cursor.fetchone()

            if exists:
                skipped_count += 1
                continue

            cursor = await db.execute(
                "INSERT INTO tags (connection_id, name, address, data_type, scan_rate_ms, enabled, description, tag_group, "
                + _EXTRA_COLS_SQL + ") "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, " + _EXTRA_PLACEHOLDERS + ")",
                (
                    t.connection_id,
                    tag_name,
                    t.address.strip(),
                    t.data_type.value,
                    t.scan_rate_ms,
                    int(t.enabled),
                    t.description,
                    group_name,
                    *_extra_from_model(t),
                ),
            )
            inserted_ids.append(cursor.lastrowid)

        await db.commit()

    if inserted_ids:
        await engine.reload()

    await add_log("INFO", "tags", f"Batch import: {len(inserted_ids)} added, {skipped_count} duplicates skipped")
    return {
        "count": len(inserted_ids),
        "skipped": skipped_count,
        "ids": inserted_ids,
        "message": f"Đã thêm {len(inserted_ids)} tag mới, bỏ qua {skipped_count} tag đã tồn tại."
    }


@router.post("/{tag_id}/write")
async def write_tag_value(tag_id: int, body: WriteRequest):
    """Write a value to a tag immediately via the driver."""
    async with get_db() as db:
        async with db.execute(
            "SELECT * FROM tags WHERE id = ?", (tag_id,)
        ) as cursor:
            row = await cursor.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Tag not found")

    engine = TagEngine()
    try:
        success = await engine.write_tag(tag_id, body.value)
    except TagReadOnlyError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    if not success:
        raise HTTPException(status_code=502, detail="Write failed – check driver connection")

    await add_log("INFO", "tags", f"Tag id={tag_id} written value={body.value!r}")
    return {"tag_id": tag_id, "written_value": body.value, "success": success}


# ------------------------------------------------------------------
# MQTT / JSON Auto Tag Generation (Kepware Style)
# ------------------------------------------------------------------

class MqttScanRequest(BaseModel):
    connection_id: int
    topic: str = ""
    default_group: Optional[str] = None
    timeout_seconds: float = 5.0
    json_payload: Optional[str] = None


class MqttScanCandidate(BaseModel):
    name: str
    tag_group: str
    address: str
    data_type: str
    scan_rate_ms: int = 100
    enabled: bool = True
    description: str = ""
    sample_value: Optional[str] = ""
    scada_name: str
    json_path: str


class MqttScanResponse(BaseModel):
    topic: str
    raw_payload: str
    candidates: List[MqttScanCandidate]
    source: str  # "live_mqtt" | "manual_json"
    message: str


def _extract_tags_from_json(payload: Any, topic: str = "", default_group: Optional[str] = None, prefix: str = "") -> List[dict]:
    """Recursively traverse JSON structure to generate candidate tags with Kepware-style hierarchy."""
    tags = []

    if not default_group and topic:
        clean_parts = [p for p in topic.replace("\\", "/").split("/") if p]
        if clean_parts:
            default_group = clean_parts[-1]
    if not default_group:
        default_group = "default"

    if isinstance(payload, dict):
        for k, v in payload.items():
            curr_path = f"{prefix}.{k}" if prefix else str(k)
            if isinstance(v, dict):
                group_name = str(k) if not prefix else f"{prefix}_{k}"
                tags.extend(_extract_tags_from_json(v, topic=topic, default_group=group_name, prefix=curr_path))
            elif isinstance(v, list):
                for idx, item in enumerate(v):
                    item_path = f"{curr_path}.{idx}"
                    if isinstance(item, (int, float, bool, str)):
                        tags.append(_create_candidate_dict(name=f"{k}_{idx}", group=default_group, path=item_path, val=item, topic=topic))
                    elif isinstance(item, dict):
                        tags.extend(_extract_tags_from_json(item, topic=topic, default_group=f"{k}_{idx}", prefix=item_path))
            else:
                tags.append(_create_candidate_dict(name=str(k), group=default_group, path=curr_path, val=v, topic=topic))
    elif isinstance(payload, list):
        for idx, item in enumerate(payload):
            item_path = str(idx)
            if isinstance(item, dict):
                tags.extend(_extract_tags_from_json(item, topic=topic, default_group=f"item_{idx}", prefix=item_path))
            elif isinstance(item, (int, float, bool, str)):
                tags.append(_create_candidate_dict(name=f"item_{idx}", group=default_group, path=item_path, val=item, topic=topic))

    return tags


def _create_candidate_dict(name: str, group: str, path: str, val: Any, topic: str) -> dict:
    if isinstance(val, bool):
        dtype = "bool"
    elif isinstance(val, int):
        dtype = "int32"
    elif isinstance(val, float):
        dtype = "float32"
    else:
        dtype = "string"

    addr = f"{topic}:{path}" if topic else path
    grp = group.strip() if group else "default"
    clean_name = name.strip()
    scada_name = f"{grp}.{clean_name}" if grp and grp.lower() != "default" else clean_name

    return {
        "name": clean_name,
        "tag_group": grp,
        "address": addr,
        "data_type": dtype,
        "scan_rate_ms": 100,
        "enabled": True,
        "description": f"Auto-generated from node '{path}'",
        "sample_value": str(val) if val is not None else "",
        "scada_name": scada_name,
        "json_path": path,
    }


async def _temporary_mqtt_sample(conn: dict, topic: str, timeout: float = 5.0) -> Any:
    """Connect temporarily to an MQTT broker to sample 1 message on topic."""
    import paho.mqtt.client as mqtt

    cfg = {}
    try:
        cfg = json.loads(conn.get("config_json") or "{}")
    except Exception:
        pass

    broker_url = cfg.get("broker_url")
    host = conn.get("host") or "localhost"
    port = conn.get("port") or 1883

    if broker_url:
        if not broker_url.startswith(("mqtt://", "tcp://")):
            broker_url = f"mqtt://{broker_url}"
        parsed = urlparse(broker_url)
        if parsed.hostname:
            host = parsed.hostname
        if parsed.port:
            port = parsed.port

    username = cfg.get("username")
    password = cfg.get("password")

    result = {"payload": None}
    received_event = threading.Event()

    client_id = f"scanner_{int(time.time()*1000)}"
    try:
        client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2, client_id=client_id)
    except Exception:
        client = mqtt.Client(client_id=client_id)

    if username:
        client.username_pw_set(username, password)

    def on_connect(c, userdata, flags, rc, properties=None):
        code_val = rc.value if hasattr(rc, "value") else rc
        if code_val == 0:
            c.subscribe(topic)

    def on_message(c, userdata, msg):
        try:
            text = msg.payload.decode("utf-8", errors="replace")
            try:
                result["payload"] = json.loads(text)
            except Exception:
                result["payload"] = text
        except Exception:
            result["payload"] = str(msg.payload)
        received_event.set()

    client.on_connect = on_connect
    client.on_message = on_message

    def _worker():
        try:
            client.connect(host, int(port), keepalive=10)
            client.loop_start()
            received_event.wait(timeout)
            client.loop_stop()
            client.disconnect()
        except Exception as ex:
            logger.warning("_temporary_mqtt_sample connection failed: %s", ex)

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _worker)
    return result["payload"]


@router.post("/auto-generate/scan", response_model=MqttScanResponse)
@router.post("/auto-generate/scan/", response_model=MqttScanResponse)
async def scan_topic_for_tags(payload: MqttScanRequest):
    """
    Kepware-style Auto Tag Generation:
    Subscribe to an MQTT topic (or parse a sample JSON string), extract all JSON keys/nodes,
    and generate candidate tags with hierarchical groups and SCADA paths.
    """
    topic = payload.topic.strip()
    raw_payload_str = ""
    parsed_payload = None
    source = "manual_json"

    # 1. Manual JSON payload provided
    if payload.json_payload and payload.json_payload.strip():
        raw_payload_str = payload.json_payload.strip()
        try:
            parsed_payload = json.loads(raw_payload_str)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Chuỗi JSON không đúng định dạng: {exc}")
        source = "manual_json"
    else:
        # 2. Live MQTT capture from broker
        if not topic:
            raise HTTPException(status_code=400, detail="Vui lòng nhập MQTT Topic để quét.")

        async with get_db() as db:
            async with db.execute(
                "SELECT * FROM connections WHERE id = ?", (payload.connection_id,)
            ) as cursor:
                conn_row = await cursor.fetchone()

        if not conn_row:
            raise HTTPException(status_code=404, detail="Không tìm thấy kết nối được chọn")

        conn = dict(conn_row)
        if conn["protocol"] != "mqtt":
            raise HTTPException(
                status_code=400,
                detail="Kết nối này không phải giao thức MQTT. Bạn có thể dán trực tiếp chuỗi JSON mẫu để quét tạo tag."
            )

        from core.driver_manager import DriverManager
        dm = DriverManager()
        driver = dm.get_driver(payload.connection_id)

        if driver and hasattr(driver, "scan_topic") and driver.is_connected():
            parsed_payload = await driver.scan_topic(topic, timeout=payload.timeout_seconds)
        else:
            parsed_payload = await _temporary_mqtt_sample(conn, topic, timeout=payload.timeout_seconds)

        if parsed_payload is None:
            raise HTTPException(
                status_code=400,
                detail=f"Không nhận được gói tin nào từ Broker trên topic '{topic}' trong {payload.timeout_seconds}s. Vui lòng kiểm tra thiết bị/broker hoặc dán trực tiếp JSON mẫu vào ô bên dưới."
            )

        source = "live_mqtt"
        raw_payload_str = json.dumps(parsed_payload, ensure_ascii=False, indent=2) if isinstance(parsed_payload, (dict, list)) else str(parsed_payload)

    # 3. Extract candidate tags from payload
    candidates_raw = _extract_tags_from_json(
        parsed_payload,
        topic=topic,
        default_group=payload.default_group
    )

    if not candidates_raw:
        raise HTTPException(status_code=400, detail="Không tìm thấy node dữ liệu nào trong JSON để tạo tag.")

    candidates = [MqttScanCandidate(**c) for c in candidates_raw]
    return MqttScanResponse(
        topic=topic,
        raw_payload=raw_payload_str,
        candidates=candidates,
        source=source,
        message=f"Đã quét thành công {len(candidates)} node tag từ {source}."
    )


# ------------------------------------------------------------------
# Siemens TIA Portal / STEP 7 Tag Importer
# ------------------------------------------------------------------

class S7ParseTextRequest(BaseModel):
    text: str = Field(..., min_length=1)
    filename: str = ""
    db_number: Optional[int] = Field(default=None, ge=1, le=65535)
    default_group: str = ""
    scan_rate_ms: int = Field(default=100, ge=50, le=60000)


class S7TagCandidate(BaseModel):
    name: str
    address: str
    data_type: str
    tag_group: str = ""
    description: str = ""
    tia_type: str = ""
    offset_str: str = ""
    scan_rate_ms: int = 100


class S7ParseResponse(BaseModel):
    detected_format: str
    db_number: Optional[int] = None
    db_name: str = ""
    optimized_warning: bool = False
    warnings: List[str] = Field(default_factory=list)
    candidates: List[S7TagCandidate] = Field(default_factory=list)
    message: str


@router.post("/s7/parse", response_model=S7ParseResponse)
@router.post("/s7/parse/", response_model=S7ParseResponse)
async def parse_s7_text_endpoint(payload: S7ParseTextRequest):
    """Parse pasted TIA Portal DB Editor text, .db/.scl/.udt source, .xml or .sdf symbol text."""
    try:
        res = parse_s7_text(
            text=payload.text,
            filename=payload.filename,
            db_number=payload.db_number,
            default_group=payload.default_group,
            scan_rate_ms=payload.scan_rate_ms,
        )
        return S7ParseResponse(**res)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("S7 text parse error")
        raise HTTPException(status_code=400, detail=f"Lỗi phân tích dữ liệu S7: {exc}")


@router.post("/s7/parse-file", response_model=S7ParseResponse)
@router.post("/s7/parse-file/", response_model=S7ParseResponse)
async def parse_s7_file_endpoint(
    file: UploadFile = File(...),
    db_number: Optional[int] = Form(default=None),
    default_group: str = Form(default=""),
    scan_rate_ms: int = Form(default=100),
):
    """Parse uploaded TIA Portal / STEP 7 file (.db, .scl, .awl, .udt, .xml, .xlsx, .sdf)."""
    if db_number is not None and (db_number < 1 or db_number > 65535):
        raise HTTPException(status_code=400, detail="Số DB phải nằm trong khoảng 1..65535")
    scan_clamped = max(50, min(60000, int(scan_rate_ms)))

    raw = await file.read()
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File quá lớn (tối đa 10 MB)")

    try:
        res = parse_s7_bytes(
            raw_bytes=raw,
            filename=file.filename or "",
            db_number=db_number,
            default_group=default_group,
            scan_rate_ms=scan_clamped,
        )
        return S7ParseResponse(**res)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("S7 file parse error [%s]", file.filename)
        raise HTTPException(status_code=400, detail=f"Lỗi đọc file S7 '{file.filename}': {exc}")
