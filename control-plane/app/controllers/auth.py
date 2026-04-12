from datetime import timedelta

from fastapi import APIRouter, Request, status

from app.config import settings
from app.deps import AuthServiceDep
from app.schemas.auth import LoginRequest, SignupRequest, TokenResponse, UserResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/signup", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def signup(
    payload: SignupRequest,
    request: Request,
    auth_service: AuthServiceDep,
) -> UserResponse:
    user = await auth_service.signup(
        email=payload.email,
        password=payload.password,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return UserResponse.model_validate(user)


@router.post("/login", response_model=TokenResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    auth_service: AuthServiceDep,
) -> TokenResponse:
    token = await auth_service.login(
        email=payload.email,
        password=payload.password,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return TokenResponse(
        access_token=token,
        expires_in_seconds=int(timedelta(days=settings.jwt_expire_days).total_seconds()),
    )
