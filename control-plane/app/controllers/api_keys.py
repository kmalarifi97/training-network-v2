from uuid import UUID

from fastapi import APIRouter, Request, status

from app.deps import ApiKeyServiceDep, CurrentUser
from app.schemas.api_keys import ApiKeyGenerated, ApiKeyPublic, GenerateKeyRequest

router = APIRouter(prefix="/api/keys", tags=["api-keys"])


@router.post("", response_model=ApiKeyGenerated, status_code=status.HTTP_201_CREATED)
async def generate_key(
    payload: GenerateKeyRequest,
    request: Request,
    user: CurrentUser,
    api_key_service: ApiKeyServiceDep,
) -> ApiKeyGenerated:
    api_key, plaintext = await api_key_service.generate(
        actor=user,
        name=payload.name,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return ApiKeyGenerated(
        id=api_key.id,
        name=api_key.name,
        prefix=api_key.prefix,
        full_key=plaintext,
        created_at=api_key.created_at,
    )


@router.get("", response_model=list[ApiKeyPublic])
async def list_keys(
    user: CurrentUser,
    api_key_service: ApiKeyServiceDep,
) -> list[ApiKeyPublic]:
    keys = await api_key_service.list_for(user)
    return [ApiKeyPublic.model_validate(k) for k in keys]


@router.delete("/{api_key_id}", response_model=ApiKeyPublic)
async def revoke_key(
    api_key_id: UUID,
    request: Request,
    user: CurrentUser,
    api_key_service: ApiKeyServiceDep,
) -> ApiKeyPublic:
    api_key = await api_key_service.revoke(
        actor=user,
        api_key_id=api_key_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return ApiKeyPublic.model_validate(api_key)
