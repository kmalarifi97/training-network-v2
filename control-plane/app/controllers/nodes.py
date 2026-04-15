from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.config import settings
from app.deps import CurrentNode, CurrentUser, DbSession
from app.schemas.nodes import (
    ClaimTokenResponse,
    HeartbeatRequest,
    HeartbeatResponse,
    NodeDetail,
    NodeMetricSample,
    NodePublic,
    RegisterNodeRequest,
    RegisterNodeResponse,
)
from app.services.node_service import NodeService
from app.services.node_status import compute_node_status

router = APIRouter(prefix="/api/nodes", tags=["nodes"])


def _public_view(node, computed_status: str) -> NodePublic:
    return NodePublic(
        id=node.id,
        name=node.name,
        gpu_model=node.gpu_model,
        gpu_memory_gb=node.gpu_memory_gb,
        gpu_count=node.gpu_count,
        status=computed_status,
        last_seen_at=node.last_seen_at,
        created_at=node.created_at,
    )


@router.post(
    "/claim-tokens",
    response_model=ClaimTokenResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_claim_token(
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> ClaimTokenResponse:
    service = NodeService(session)
    claim, plaintext, install_command = await service.create_claim_token(
        host=user,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return ClaimTokenResponse(
        token=plaintext,
        prefix=claim.prefix,
        install_command=install_command,
        expires_at=claim.expires_at,
    )


@router.post(
    "/register",
    response_model=RegisterNodeResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register_node(
    payload: RegisterNodeRequest,
    request: Request,
    session: DbSession,
) -> RegisterNodeResponse:
    service = NodeService(session)
    node, agent_token = await service.register_node(
        claim_token=payload.claim_token,
        gpu_model=payload.gpu_model,
        gpu_memory_gb=payload.gpu_memory_gb,
        gpu_count=payload.gpu_count,
        suggested_name=payload.suggested_name,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return RegisterNodeResponse(
        node_id=node.id,
        agent_token=agent_token,
        config_payload={
            "control_plane_url": settings.control_plane_public_url,
            "node_id": str(node.id),
            "agent_token": agent_token,
        },
    )


@router.get("", response_model=list[NodePublic])
async def list_nodes(user: CurrentUser, session: DbSession) -> list[NodePublic]:
    service = NodeService(session)
    nodes = await service.list_for_user(user)
    now = datetime.now(UTC)
    return [_public_view(n, compute_node_status(n, now)) for n in nodes]


@router.get("/{node_id}", response_model=NodeDetail)
async def get_node(
    node_id: UUID,
    user: CurrentUser,
    session: DbSession,
) -> NodeDetail:
    service = NodeService(session)
    node = await service.get_owned_node(user, node_id)
    current_job = await service.get_current_job(node)
    now = datetime.now(UTC)
    base = _public_view(node, compute_node_status(node, now))
    return NodeDetail(
        **base.model_dump(),
        current_job_id=current_job.id if current_job else None,
    )


@router.post("/{node_id}/heartbeat", response_model=HeartbeatResponse)
async def heartbeat(
    node_id: UUID,
    payload: HeartbeatRequest,
    node: CurrentNode,
    session: DbSession,
) -> HeartbeatResponse:
    if node.id != node_id:
        # Authenticated agent does not match the path id — reject so a leaked
        # token can't be used to spoof another node's status.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Agent token does not match node",
        )
    service = NodeService(session)
    await service.record_heartbeat(node)
    current = await service.get_current_job(node)
    cancel_job_id = (
        current.id
        if current is not None and current.cancel_requested_at is not None
        else None
    )
    return HeartbeatResponse(
        received_at=datetime.now(UTC), cancel_job_id=cancel_job_id
    )


@router.post("/{node_id}/drain", response_model=NodeDetail)
async def drain_node(
    node_id: UUID,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> NodeDetail:
    service = NodeService(session)
    node = await service.drain_node(
        owner=user,
        node_id=node_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    current = await service.get_current_job(node)
    base = _public_view(node, compute_node_status(node, datetime.now(UTC)))
    return NodeDetail(
        **base.model_dump(),
        current_job_id=current.id if current else None,
    )


@router.post("/{node_id}/undrain", response_model=NodeDetail)
async def undrain_node(
    node_id: UUID,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> NodeDetail:
    service = NodeService(session)
    node = await service.undrain_node(
        owner=user,
        node_id=node_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    current = await service.get_current_job(node)
    base = _public_view(node, compute_node_status(node, datetime.now(UTC)))
    return NodeDetail(
        **base.model_dump(),
        current_job_id=current.id if current else None,
    )


@router.delete("/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_node(
    node_id: UUID,
    request: Request,
    user: CurrentUser,
    session: DbSession,
):
    service = NodeService(session)
    await service.delete_node(
        owner=user,
        node_id=node_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{node_id}/metrics", status_code=status.HTTP_204_NO_CONTENT)
async def push_metrics(
    node_id: UUID,
    samples: list[NodeMetricSample],
    node: CurrentNode,
    session: DbSession,
):
    if node.id != node_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Agent token does not match node",
        )
    service = NodeService(session)
    await service.record_metrics(
        node, [s.model_dump() for s in samples]
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
