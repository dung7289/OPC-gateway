"""
Authentication & Role-Based Access Control (RBAC) service.

Roles:
  - 'admin':  Full configuration, device control, tag writes, backup/restore, user management.
  - 'viewer': Read-only monitoring across dashboards, tag tables, logs, historian graphs.

Password storage: PBKDF2-HMAC-SHA256 with 200,000 iterations and random 16-byte salt.
Sessions: random 32-byte URL-safe tokens stored as SHA-256 digests in SQLite `user_sessions`.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
import secrets
import time
from typing import Any, Dict, List, Optional, Tuple

from db.database import get_db

logger = logging.getLogger(__name__)

_PBKDF2_ITERS = 200_000
_SESSION_TTL_REMEMBER = 7 * 24 * 3600  # 7 days
_SESSION_TTL_SHORT = 24 * 3600         # 24 hours
VALID_ROLES = {"admin", "viewer"}


def hash_password(password: str) -> str:
    """Hash a plain-text password with PBKDF2-HMAC-SHA256."""
    if not isinstance(password, str) or len(password) < 4:
        raise ValueError("Mật khẩu phải có ít nhất 4 ký tự")
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERS)
    return f"pbkdf2_sha256${_PBKDF2_ITERS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Verify a password against stored PBKDF2 hash in constant time."""
    if not password or not stored_hash:
        return False
    try:
        parts = stored_hash.split("$")
        if len(parts) != 4 or parts[0] != "pbkdf2_sha256":
            return False
        iters = int(parts[1])
        salt = bytes.fromhex(parts[2])
        expected = bytes.fromhex(parts[3])
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iters)
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False


def hash_token(raw_token: str) -> str:
    return hashlib.sha256((raw_token or "").encode("utf-8")).hexdigest()


def _normalize_username(username: str) -> str:
    return re.sub(r"\s+", "", (username or "").strip()).lower()


def _user_row_to_dict(row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "username": row["username"],
        "full_name": row["full_name"] or "",
        "role": row["role"],
        "enabled": bool(row["enabled"]),
        "created_at": row["created_at"],
        "last_login_at": row["last_login_at"],
    }


async def ensure_default_users() -> None:
    """Seed default 'admin' and 'viewer' accounts if `users` table is empty."""
    admin_pwd = os.environ.get("GATEWAY_ADMIN_PASSWORD", "").strip() or "admin123"
    if len(admin_pwd) < 4:
        admin_pwd = "admin123"
    viewer_pwd = os.environ.get("GATEWAY_VIEWER_PASSWORD", "").strip() or "viewer123"
    if len(viewer_pwd) < 4:
        viewer_pwd = "viewer123"

    async with get_db() as db:
        async with db.execute("SELECT COUNT(*) FROM users") as cur:
            row = await cur.fetchone()
            count = row[0] if row else 0
        if count == 0:
            await db.execute(
                "INSERT INTO users (username, full_name, password_hash, role, enabled) VALUES (?, ?, ?, ?, 1)",
                ("admin", "Quản trị viên", hash_password(admin_pwd), "admin"),
            )
            await db.execute(
                "INSERT INTO users (username, full_name, password_hash, role, enabled) VALUES (?, ?, ?, ?, 1)",
                ("viewer", "Tài khoản chỉ xem", hash_password(viewer_pwd), "viewer"),
            )
            await db.commit()
            logger.info("Seeded default users: admin (admin) and viewer (viewer)")


async def authenticate_user(
    username: str,
    password: str,
    remember: bool = True,
) -> Optional[Tuple[str, int, Dict[str, Any]]]:
    """Authenticate username/password and create a new session token."""
    uname = _normalize_username(username)
    if not uname or not password:
        return None

    now = time.time()
    ttl = _SESSION_TTL_REMEMBER if remember else _SESSION_TTL_SHORT
    expires_at = now + ttl
    raw_token = secrets.token_urlsafe(32)
    t_hash = hash_token(raw_token)

    async with get_db() as db:
        async with db.execute(
            "SELECT * FROM users WHERE LOWER(username) = ?",
            (uname,),
        ) as cur:
            row = await cur.fetchone()

        if not row or not bool(row["enabled"]):
            return None
        if not verify_password(password, row["password_hash"]):
            return None

        # Clean up expired sessions opportunistically
        await db.execute("DELETE FROM user_sessions WHERE expires_at <= ?", (now,))
        await db.execute(
            "INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
            (t_hash, row["id"], expires_at),
        )
        await db.execute(
            "UPDATE users SET last_login_at = datetime('now') WHERE id = ?",
            (row["id"],),
        )
        await db.commit()

        async with db.execute("SELECT * FROM users WHERE id = ?", (row["id"],)) as cur:
            fresh_row = await cur.fetchone()

    return raw_token, ttl, _user_row_to_dict(fresh_row)


async def get_user_by_token(raw_token: Optional[str]) -> Optional[Dict[str, Any]]:
    """Validate Bearer token and return active user dict, or None if invalid/expired/disabled."""
    if not raw_token:
        return None
    t_hash = hash_token(raw_token.strip())
    now = time.time()

    async with get_db() as db:
        async with db.execute(
            """
            SELECT u.*
            FROM user_sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ? AND s.expires_at > ? AND u.enabled = 1
            """,
            (t_hash, now),
        ) as cur:
            row = await cur.fetchone()
    return _user_row_to_dict(row) if row else None


async def revoke_token(raw_token: Optional[str]) -> None:
    if not raw_token:
        return
    t_hash = hash_token(raw_token.strip())
    async with get_db() as db:
        await db.execute("DELETE FROM user_sessions WHERE token_hash = ?", (t_hash,))
        await db.commit()


async def revoke_user_sessions(user_id: int, keep_raw_token: Optional[str] = None) -> None:
    async with get_db() as db:
        if keep_raw_token:
            keep_hash = hash_token(keep_raw_token.strip())
            await db.execute(
                "DELETE FROM user_sessions WHERE user_id = ? AND token_hash != ?",
                (user_id, keep_hash),
            )
        else:
            await db.execute("DELETE FROM user_sessions WHERE user_id = ?", (user_id,))
        await db.commit()


async def change_own_password(
    user_id: int,
    current_password: str,
    new_password: str,
    current_token: Optional[str] = None,
) -> None:
    if len(new_password or "") < 4:
        raise ValueError("Mật khẩu mới phải có ít nhất 4 ký tự")

    async with get_db() as db:
        async with db.execute("SELECT * FROM users WHERE id = ?", (user_id,)) as cur:
            row = await cur.fetchone()
        if not row:
            raise ValueError("Không tìm thấy tài khoản")
        if not verify_password(current_password, row["password_hash"]):
            raise ValueError("Mật khẩu hiện tại không đúng")

        new_hash = hash_password(new_password)
        await db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (new_hash, user_id))
        if current_token:
            keep_hash = hash_token(current_token.strip())
            await db.execute(
                "DELETE FROM user_sessions WHERE user_id = ? AND token_hash != ?",
                (user_id, keep_hash),
            )
        await db.commit()


async def list_users() -> List[Dict[str, Any]]:
    async with get_db() as db:
        async with db.execute("SELECT * FROM users ORDER BY role ASC, id ASC") as cur:
            rows = await cur.fetchall()
    return [_user_row_to_dict(r) for r in rows]


async def create_user(
    username: str,
    password: str,
    full_name: str = "",
    role: str = "viewer",
    enabled: bool = True,
) -> Dict[str, Any]:
    uname = _normalize_username(username)
    if not uname or not re.fullmatch(r"[a-z0-9_.\-]{3,32}", uname):
        raise ValueError("Tên đăng nhập phải từ 3–32 ký tự (chữ thường, số, ., _, -)")
    role_clean = (role or "viewer").strip().lower()
    if role_clean not in VALID_ROLES:
        raise ValueError("Vai trò không hợp lệ (chỉ chấp nhận 'admin' hoặc 'viewer')")

    pwd_hash = hash_password(password)
    async with get_db() as db:
        async with db.execute("SELECT id FROM users WHERE LOWER(username) = ?", (uname,)) as cur:
            if await cur.fetchone():
                raise ValueError(f"Tài khoản '{uname}' đã tồn tại")

        cur = await db.execute(
            "INSERT INTO users (username, full_name, password_hash, role, enabled) VALUES (?, ?, ?, ?, ?)",
            (uname, (full_name or "").strip(), pwd_hash, role_clean, 1 if enabled else 0),
        )
        await db.commit()
        uid = cur.lastrowid
        async with db.execute("SELECT * FROM users WHERE id = ?", (uid,)) as cur2:
            row = await cur2.fetchone()
    return _user_row_to_dict(row)


async def update_user(
    user_id: int,
    actor_user_id: int,
    full_name: Optional[str] = None,
    role: Optional[str] = None,
    enabled: Optional[bool] = None,
    new_password: Optional[str] = None,
) -> Dict[str, Any]:
    async with get_db() as db:
        async with db.execute("SELECT * FROM users WHERE id = ?", (user_id,)) as cur:
            target = await cur.fetchone()
        if not target:
            raise ValueError("Không tìm thấy tài khoản")

        next_role = target["role"]
        if role is not None:
            r_clean = role.strip().lower()
            if r_clean not in VALID_ROLES:
                raise ValueError("Vai trò phải là 'admin' hoặc 'viewer'")
            next_role = r_clean

        next_enabled = bool(target["enabled"])
        if enabled is not None:
            next_enabled = bool(enabled)

        next_full_name = target["full_name"] if full_name is None else full_name.strip()

        # Prevent removing/disabling the last active admin
        if target["role"] == "admin" and bool(target["enabled"]) and (next_role != "admin" or not next_enabled):
            async with db.execute(
                "SELECT COUNT(*) FROM users WHERE role = 'admin' AND enabled = 1 AND id != ?",
                (user_id,),
            ) as cur:
                other_admins = (await cur.fetchone())[0]
            if other_admins == 0:
                raise ValueError("Không thể hạ quyền hoặc khóa tài khoản Admin cuối cùng")

        # Prevent self-demotion or self-lockout explicitly
        if user_id == actor_user_id and (next_role != "admin" or not next_enabled):
            raise ValueError("Không thể tự khóa hoặc hạ quyền tài khoản đang đăng nhập")

        next_hash = target["password_hash"]
        pwd_changed = False
        if new_password is not None and new_password != "":
            next_hash = hash_password(new_password)
            pwd_changed = True

        await db.execute(
            "UPDATE users SET full_name = ?, role = ?, enabled = ?, password_hash = ? WHERE id = ?",
            (next_full_name, next_role, 1 if next_enabled else 0, next_hash, user_id),
        )
        if not next_enabled or pwd_changed or next_role != target["role"]:
            await db.execute("DELETE FROM user_sessions WHERE user_id = ?", (user_id,))
        await db.commit()

        async with db.execute("SELECT * FROM users WHERE id = ?", (user_id,)) as cur:
            fresh = await cur.fetchone()
    return _user_row_to_dict(fresh)


async def delete_user(user_id: int, actor_user_id: int) -> str:
    if user_id == actor_user_id:
        raise ValueError("Không thể xóa tài khoản đang đăng nhập")

    async with get_db() as db:
        async with db.execute("SELECT * FROM users WHERE id = ?", (user_id,)) as cur:
            target = await cur.fetchone()
        if not target:
            raise ValueError("Không tìm thấy tài khoản")

        if target["role"] == "admin" and bool(target["enabled"]):
            async with db.execute(
                "SELECT COUNT(*) FROM users WHERE role = 'admin' AND enabled = 1 AND id != ?",
                (user_id,),
            ) as cur:
                other_admins = (await cur.fetchone())[0]
            if other_admins == 0:
                raise ValueError("Không thể xóa tài khoản Admin cuối cùng")

        await db.execute("DELETE FROM users WHERE id = ?", (user_id,))
        await db.commit()
    return target["username"]
