from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

from app.config import settings
from app.controllers import api_router
from app.core.errors import (
    AccountNotActive,
    EmailAlreadyExists,
    InvalidCredentials,
    InvalidPaginationCursor,
    UserNotFound,
)

app = FastAPI(title=settings.app_name, version=settings.app_version)
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
