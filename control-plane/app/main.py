from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

from app.config import settings
from app.controllers import api_router
from app.core.errors import (
    AccountNotActive,
    ApiKeyNotFound,
    ApiKeyNotOwned,
    AuditEventNotFound,
    ClaimTokenInvalid,
    EmailAlreadyExists,
    InsufficientCredits,
    InvalidCredentials,
    InvalidJobTransition,
    InvalidPaginationCursor,
    JobNotFound,
    JobNotOwned,
    NodeBusy,
    NodeNotDraining,
    NodeNotFound,
    NotAHost,
    UserNotFound,
)

app = FastAPI(title=settings.app_name, version=settings.app_version)
from app.observability import HTTPMetricsMiddleware  # noqa: E402

app.add_middleware(HTTPMetricsMiddleware)
app.include_router(api_router)


@app.exception_handler(EmailAlreadyExists)
async def email_already_exists_handler(
    _: Request, exc: EmailAlreadyExists
) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={"detail": str(exc)},
    )


@app.exception_handler(InvalidCredentials)
async def invalid_credentials_handler(
    _: Request, exc: InvalidCredentials
) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_401_UNAUTHORIZED,
        content={"detail": str(exc)},
        headers={"WWW-Authenticate": "Bearer"},
    )


@app.exception_handler(AccountNotActive)
async def account_not_active_handler(
    _: Request, exc: AccountNotActive
) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_403_FORBIDDEN,
        content={"detail": str(exc)},
    )


@app.exception_handler(UserNotFound)
async def user_not_found_handler(_: Request, exc: UserNotFound) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_404_NOT_FOUND,
        content={"detail": str(exc)},
    )


@app.exception_handler(InvalidPaginationCursor)
async def invalid_pagination_cursor_handler(
    _: Request, exc: InvalidPaginationCursor
) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={"detail": str(exc)},
    )


@app.exception_handler(AuditEventNotFound)
async def audit_event_not_found_handler(
    _: Request, exc: AuditEventNotFound
) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_404_NOT_FOUND,
        content={"detail": str(exc)},
    )


@app.exception_handler(ApiKeyNotFound)
async def api_key_not_found_handler(_: Request, exc: ApiKeyNotFound) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_404_NOT_FOUND,
        content={"detail": str(exc)},
    )


@app.exception_handler(ApiKeyNotOwned)
async def api_key_not_owned_handler(_: Request, exc: ApiKeyNotOwned) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_403_FORBIDDEN,
        content={"detail": str(exc)},
    )


@app.exception_handler(NotAHost)
async def not_a_host_handler(_: Request, exc: NotAHost) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_403_FORBIDDEN,
        content={"detail": str(exc)},
    )


@app.exception_handler(ClaimTokenInvalid)
async def claim_token_invalid_handler(
    _: Request, exc: ClaimTokenInvalid
) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={"detail": str(exc), "reason": exc.reason},
    )


@app.exception_handler(InsufficientCredits)
async def insufficient_credits_handler(
    _: Request, exc: InsufficientCredits
) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_402_PAYMENT_REQUIRED,
        content={
            "detail": str(exc),
            "required_gpu_hours": exc.required_hours,
            "available_gpu_hours": exc.available_hours,
        },
    )


@app.exception_handler(JobNotFound)
async def job_not_found_handler(_: Request, exc: JobNotFound) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_404_NOT_FOUND,
        content={"detail": str(exc)},
    )


@app.exception_handler(JobNotOwned)
async def job_not_owned_handler(_: Request, exc: JobNotOwned) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_404_NOT_FOUND,
        content={"detail": "Job not found"},
    )


@app.exception_handler(InvalidJobTransition)
async def invalid_job_transition_handler(
    _: Request, exc: InvalidJobTransition
) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={
            "detail": str(exc),
            "from_status": exc.from_status,
            "to_status": exc.to_status,
        },
    )


@app.exception_handler(NodeNotFound)
async def node_not_found_handler(_: Request, exc: NodeNotFound) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_404_NOT_FOUND,
        content={"detail": str(exc)},
    )


@app.exception_handler(NodeBusy)
async def node_busy_handler(_: Request, exc: NodeBusy) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": str(exc), "node_id": exc.node_id},
    )


@app.exception_handler(NodeNotDraining)
async def node_not_draining_handler(
    _: Request, exc: NodeNotDraining
) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={
            "detail": str(exc),
            "node_id": exc.node_id,
            "current_status": exc.current_status,
        },
    )
