from typing import Any
from uuid import UUID

from httpx import AsyncClient
from sqlalchemy import select, update

from app.db import SessionLocal
from app.models.audit_log import AuditLog
from app.models.user import User

DEFAULT_PASSWORD = "password1234"


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def signup(
    client: AsyncClient, email: str, password: str = DEFAULT_PASSWORD
) -> dict[str, Any]:
    r = await client.post("/api/auth/signup", json={"email": email, "password": password})
    assert r.status_code == 201, r.text
    return r.json()


async def login(
    client: AsyncClient, email: str, password: str = DEFAULT_PASSWORD
) -> str:
    r = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def set_user_flags(
    email: str,
    *,
    status: str | None = None,
    is_admin: bool | None = None,
    can_host: bool | None = None,
    credits_gpu_hours: int | None = None,
) -> None:
    values: dict[str, Any] = {}
    if status is not None:
        values["status"] = status
    if is_admin is not None:
        values["is_admin"] = is_admin
    if can_host is not None:
        values["can_host"] = can_host
    if credits_gpu_hours is not None:
        values["credits_gpu_hours"] = credits_gpu_hours
    if not values:
        return
    async with SessionLocal() as session:
        await session.execute(update(User).where(User.email == email).values(**values))
        await session.commit()


async def make_admin(client: AsyncClient, email: str = "admin@example.com") -> tuple[str, str]:
    """Sign up, promote to admin + active, and log in. Returns (user_id, token)."""
    user = await signup(client, email)
    await set_user_flags(email, is_admin=True, status="active")
    token = await login(client, email)
    return user["id"], token


async def make_active_user(
    client: AsyncClient,
    email: str,
    can_host: bool = False,
    credits_gpu_hours: int = 0,
) -> tuple[str, str]:
    user = await signup(client, email)
    await set_user_flags(
        email,
        status="active",
        can_host=can_host,
        credits_gpu_hours=credits_gpu_hours,
    )
    token = await login(client, email)
    return user["id"], token


async def audit_events_for_user(user_id: str, event_type: str | None = None) -> list[AuditLog]:
    async with SessionLocal() as session:
        stmt = select(AuditLog).where(AuditLog.user_id == UUID(user_id))
        if event_type is not None:
            stmt = stmt.where(AuditLog.event_type == event_type)
        stmt = stmt.order_by(AuditLog.created_at)
        result = await session.execute(stmt)
        return list(result.scalars().all())
