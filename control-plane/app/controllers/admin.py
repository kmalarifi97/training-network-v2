from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Query, Request

from app.core.errors import InvalidPaginationCursor
from app.core.pagination import InvalidCursorError
from app.deps import AdminServiceDep, AdminUser, DbSession
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
from app.schemas.admin_dashboard import AdminDashboardResponse
from app.schemas.jobs import JobPublic
from app.schemas.nodes import NodeDetail, NodePublic
from app.services.job_service import JobService
from app.services.node_service import NodeService
from app.services.node_status import compute_node_status

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


@router.get("/dashboard", response_model=AdminDashboardResponse)
async def dashboard(
    admin: AdminUser,
    admin_service: AdminServiceDep,
) -> AdminDashboardResponse:
    data = await admin_service.dashboard()
    return AdminDashboardResponse(**data)


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


@router.post("/jobs/{job_id}/force-kill", response_model=JobPublic)
async def force_kill_job(
    job_id: UUID,
    request: Request,
    admin: AdminUser,
    session: DbSession,
) -> JobPublic:
    service = JobService(session)
    job = await service.admin_force_kill(
        admin=admin,
        job_id=job_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return JobPublic.model_validate(job)


@router.post("/nodes/{node_id}/force-drain", response_model=NodeDetail)
async def force_drain_node(
    node_id: UUID,
    request: Request,
    admin: AdminUser,
    session: DbSession,
) -> NodeDetail:
    service = NodeService(session)
    node = await service.admin_force_drain(
        admin=admin,
        node_id=node_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    current = await service.get_current_job(node)
    base = NodePublic(
        id=node.id,
        name=node.name,
        gpu_model=node.gpu_model,
        gpu_memory_gb=node.gpu_memory_gb,
        gpu_count=node.gpu_count,
        status=compute_node_status(node, datetime.now(UTC)),
        last_seen_at=node.last_seen_at,
        created_at=node.created_at,
    )
    return NodeDetail(
        **base.model_dump(),
        current_job_id=current.id if current else None,
    )
