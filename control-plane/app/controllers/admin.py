from datetime import datetime
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
from app.schemas.admin_audit import (
    AdminAuditEvent,
    AdminAuditEventDetail,
    AdminAuditListResponse,
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


def _audit_event_to_schema(event, email: str | None) -> AdminAuditEvent:
    return AdminAuditEvent(
        id=event.id,
        event_type=event.event_type,
        user_id=event.user_id,
        user_email=email,
        ip_address=event.ip_address,
        created_at=event.created_at,
    )


@router.get("/audit", response_model=AdminAuditListResponse)
async def list_audit_events(
    request: Request,
    admin: AdminUser,
    admin_service: AdminServiceDep,
    event_type: str | None = None,
    user_email: str | None = None,
    ip: str | None = None,
    created_from: datetime | None = Query(default=None, alias="from"),
    created_to: datetime | None = Query(default=None, alias="to"),
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
) -> AdminAuditListResponse:
    try:
        rows, next_cursor = await admin_service.list_audit_events(
            admin=admin,
            event_type=event_type,
            user_email_query=user_email,
            ip_address=ip,
            created_from=created_from,
            created_to=created_to,
            cursor=cursor,
            limit=limit,
            viewer_ip=request.client.host if request.client else None,
            viewer_user_agent=request.headers.get("user-agent"),
        )
    except InvalidCursorError as exc:
        raise InvalidPaginationCursor() from exc

    return AdminAuditListResponse(
        items=[_audit_event_to_schema(ev, email) for ev, email in rows],
        next_cursor=next_cursor,
    )


@router.get("/audit/{event_id}", response_model=AdminAuditEventDetail)
async def get_audit_event(
    event_id: UUID,
    admin: AdminUser,
    admin_service: AdminServiceDep,
) -> AdminAuditEventDetail:
    event, email = await admin_service.get_audit_event(event_id)
    return AdminAuditEventDetail(
        id=event.id,
        event_type=event.event_type,
        user_id=event.user_id,
        user_email=email,
        ip_address=event.ip_address,
        created_at=event.created_at,
        user_agent=event.user_agent,
        event_data=event.event_data,
    )
