from fastapi import APIRouter, Request, Response, status
from fastapi.responses import JSONResponse

from app.config import settings
from app.deps import CurrentUser, DbSession
from app.schemas.devices import (
    ActivateDeviceCodeRequest,
    ActivateDeviceCodeResponse,
    CreateDeviceCodeRequest,
    CreateDeviceCodeResponse,
    PollApprovedResponse,
)
from app.services.device_code_service import DeviceCodeService

router = APIRouter(prefix="/api/devices", tags=["devices"])


@router.post(
    "/code",
    response_model=CreateDeviceCodeResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_device_code(
    payload: CreateDeviceCodeRequest, session: DbSession
) -> CreateDeviceCodeResponse:
    """Agent-initiated: ask for a code to bind this host to a user."""
    service = DeviceCodeService(session)
    record, polling_token, verify_url = await service.create_code(
        gpu_model=payload.gpu_model,
        gpu_memory_gb=payload.gpu_memory_gb,
        gpu_count=payload.gpu_count,
    )
    return CreateDeviceCodeResponse(
        code=record.code,
        polling_token=polling_token,
        verify_url=verify_url,
        expires_at=record.expires_at,
    )


@router.get("/code/{polling_token}")
async def poll_device_code(polling_token: str, session: DbSession):
    """Agent polls this until the user has approved the code in a browser.

    202 while pending; 200 (with agent_token) once a user has approved.
    """
    service = DeviceCodeService(session)
    claimed = await service.claim_approved(polling_token)
    if claimed is None:
        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,
            content={"status": "pending"},
        )
    node, agent_token = claimed
    response = PollApprovedResponse(
        status="approved",
        node_id=node.id,
        node_name=node.name,
        agent_token=agent_token,
        control_plane_url=settings.control_plane_public_url,
    )
    return Response(
        content=response.model_dump_json(),
        media_type="application/json",
        status_code=status.HTTP_200_OK,
    )


@router.post(
    "/activate",
    response_model=ActivateDeviceCodeResponse,
)
async def activate_device_code(
    payload: ActivateDeviceCodeRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> ActivateDeviceCodeResponse:
    """User-initiated: approve a code displayed on a host terminal."""
    service = DeviceCodeService(session)
    record = await service.activate(
        user=user,
        code=payload.code,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    # At approval time no Node exists yet — it's minted when the agent polls.
    return ActivateDeviceCodeResponse(
        gpu_model=record.gpu_model,
        gpu_memory_gb=record.gpu_memory_gb,
        gpu_count=record.gpu_count,
    )
