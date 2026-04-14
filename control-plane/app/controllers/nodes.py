from fastapi import APIRouter, Request, status

from app.config import settings
from app.deps import CurrentUser, DbSession
from app.schemas.nodes import (
    ClaimTokenResponse,
    NodePublic,
    RegisterNodeRequest,
    RegisterNodeResponse,
)
from app.services.node_service import NodeService

router = APIRouter(prefix="/api/nodes", tags=["nodes"])


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
    node = await service.register_node(
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
        config_payload={
            "control_plane_url": settings.control_plane_public_url,
            "node_id": str(node.id),
        },
    )


@router.get("", response_model=list[NodePublic])
async def list_nodes(user: CurrentUser, session: DbSession) -> list[NodePublic]:
    service = NodeService(session)
    nodes = await service.list_for_user(user)
    return [NodePublic.model_validate(n) for n in nodes]
