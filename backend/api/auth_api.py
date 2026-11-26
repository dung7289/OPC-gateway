"""
Authentication & User Management API endpoints (/api/auth).
"""

from __future__ import annotations

import logging
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from api.logs import add_log
from core.auth_service import (
    authenticate_user,
    change_own_password,
    create_user,
    delete_user,
    list_users,
    revoke_token,
    update_user,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=128)
    remember: bool = True


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=4, max_length=128)


class UserCreateRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=32)
    password: str = Field(..., min_length=4, max_length=128)
    full_name: str = Field(default="", max_length=100)
    role: Literal["admin", "viewer"] = "viewer"
    enabled: bool = True


class UserUpdateRequest(BaseModel):
    full_name: Optional[str] = Field(default=None, max_length=100)
    role: Optional[Literal["admin", "viewer"]] = None
    enabled: Optional[bool] = None
    new_password: Optional[str] = Field(default=None, max_length=128)


def _require_admin(request: Request) -> dict:
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập để tiếp tục.")
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Chỉ tài khoản Admin mới được phép thực hiện thao tác này.")
    return user


@router.post("/login")
@router.post("/login/")
async def login_endpoint(payload: LoginRequest):
    """Authenticate username + password and issue a Bearer session token."""
    res = await authenticate_user(payload.username, payload.password, remember=payload.remember)
    if not res:
        await add_log("WARNING", "auth", f"Đăng nhập thất bại cho tài khoản '{payload.username.strip()}'")
        raise HTTPException(status_code=401, detail="Tên đăng nhập hoặc mật khẩu không đúng (hoặc tài khoản đã bị khóa).")

    token, expires_in, user = res
    await add_log("INFO", "auth", f"Người dùng '{user['username']}' ({user['role']}) đã đăng nhập")
    return {
        "token": token,
        "expires_in": expires_in,
        "user": user,
    }


@router.post("/logout")
@router.post("/logout/")
async def logout_endpoint(request: Request):
    """Revoke current session token."""
    token = getattr(request.state, "token", None)
    user = getattr(request.state, "user", None)
    await revoke_token(token)
    if user:
        await add_log("INFO", "auth", f"Người dùng '{user['username']}' đã đăng xuất")
    return {"message": "Đã đăng xuất an toàn"}


@router.get("/me")
@router.get("/me/")
async def get_current_user(request: Request):
    """Return authenticated user profile for current Bearer token."""
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Phiên đăng nhập không hợp lệ hoặc đã hết hạn.")
    return user


@router.post("/change-password")
@router.post("/change-password/")
async def change_password_endpoint(payload: ChangePasswordRequest, request: Request):
    """Allow logged-in user (Admin or Viewer) to change their own password."""
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập để tiếp tục.")
    token = getattr(request.state, "token", None)
    try:
        await change_own_password(
            user_id=user["id"],
            current_password=payload.current_password,
            new_password=payload.new_password,
            current_token=token,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    await add_log("INFO", "auth", f"Tài khoản '{user['username']}' đã đổi mật khẩu")
    return {"message": "Đã đổi mật khẩu thành công"}


@router.get("/users")
@router.get("/users/")
async def list_users_endpoint(request: Request):
    """List all users (Admin only)."""
    _require_admin(request)
    return await list_users()


@router.post("/users", status_code=201)
@router.post("/users/", status_code=201)
async def create_user_endpoint(payload: UserCreateRequest, request: Request):
    """Create a new Admin or Viewer account (Admin only)."""
    actor = _require_admin(request)
    try:
        user = await create_user(
            username=payload.username,
            password=payload.password,
            full_name=payload.full_name,
            role=payload.role,
            enabled=payload.enabled,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    await add_log("INFO", "auth", f"Admin '{actor['username']}' đã tạo tài khoản '{user['username']}' ({user['role']})")
    return user


@router.put("/users/{user_id}")
async def update_user_endpoint(user_id: int, payload: UserUpdateRequest, request: Request):
    """Update user profile, role, active state, or reset password (Admin only)."""
    actor = _require_admin(request)
    try:
        updated = await update_user(
            user_id=user_id,
            actor_user_id=actor["id"],
            full_name=payload.full_name,
            role=payload.role,
            enabled=payload.enabled,
            new_password=payload.new_password,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    await add_log("INFO", "auth", f"Admin '{actor['username']}' đã cập nhật tài khoản '{updated['username']}' ({updated['role']})")
    return updated


@router.delete("/users/{user_id}")
async def delete_user_endpoint(user_id: int, request: Request):
    """Delete a user account (Admin only)."""
    actor = _require_admin(request)
    try:
        deleted_name = await delete_user(user_id=user_id, actor_user_id=actor["id"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    await add_log("INFO", "auth", f"Admin '{actor['username']}' đã xóa tài khoản '{deleted_name}'")
    return {"message": f"Đã xóa tài khoản '{deleted_name}'"}
