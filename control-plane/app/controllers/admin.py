from uuid import UUID

from fastapi import APIRouter, Query, Request

from app.core.errors import InvalidPaginationCursor
from app.core.pagination import InvalidCursorError
from app.deps import AdminServiceDep, AdminUser
from app.schemas.admin import (
    AdminActionResponse,
    AdminUserDetail,
    AdminUserListItem,
    AdminUserListResponse,
    ApproveRequest,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/users", response_model=AdminUserListResponse)
async def list_users(
    admin: AdminUser,
    admin_service: AdminServiceDep,
    user_status: str | None = Query(default=None, alias="status"),
    email: str | None = None,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
) -> AdminUserListResponse:
    try:
        users, next_cursor = await admin_service.list_users(
            status=user_status,
            email_query=email,
            cursor=cursor,
            limit=limit,
        )
    except InvalidCursorError as exc:
        raise InvalidPaginationCursor() from exc

    return AdminUserListResponse(
        items=[AdminUserListItem.model_validate(u) for u in users],
        next_cursor=next_cursor,
    )


@router.get("/users/{user_id}", response_model=AdminUserDetail)
async def get_user_detail(
    user_id: UUID,
    admin: AdminUser,
    admin_service: AdminServiceDep,
) -> AdminUserDetail:
    user, signup_ip = await admin_service.get_user_detail(user_id)
    return AdminUserDetail(
        **AdminUserListItem.model_validate(user).model_dump(),
        signup_ip_address=signup_ip,
    )


@router.post("/users/{user_id}/approve", response_model=AdminActionResponse)
async def approve_user(
    user_id: UUID,
    payload: ApproveRequest,
    request: Request,
    admin: AdminUser,
    admin_service: AdminServiceDep,
) -> AdminActionResponse:
    user = await admin_service.approve_user(
        admin=admin,
        user_id=user_id,
        can_host=payload.can_host,
        credits_gpu_hours=payload.credits_gpu_hours,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return AdminActionResponse(
        message="User approved",
        user=AdminUserListItem.model_validate(user),
    )


@router.post("/users/{user_id}/suspend", response_model=AdminActionResponse)
async def suspend_user(
    user_id: UUID,
    request: Request,
    admin: AdminUser,
    admin_service: AdminServiceDep,
) -> AdminActionResponse:
    user = await admin_service.suspend_user(
        admin=admin,
        user_id=user_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return AdminActionResponse(
        message="User suspended",
        user=AdminUserListItem.model_validate(user),
    )
