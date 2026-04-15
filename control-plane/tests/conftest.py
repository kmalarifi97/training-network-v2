from collections.abc import AsyncGenerator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete

from app.db import SessionLocal
from app.main import app
from app.models.api_key import ApiKey
from app.models.audit_log import AuditLog
from app.models.claim_token import ClaimToken
from app.models.job import Job
from app.models.job_log import JobLog
from app.models.node import Node
from app.models.node_metric import NodeMetric
from app.models.user import User


@pytest_asyncio.fixture(autouse=True)
async def clean_db() -> AsyncGenerator[None, None]:
    yield
    async with SessionLocal() as session:
        await session.execute(delete(JobLog))
        await session.execute(delete(NodeMetric))
        await session.execute(delete(Job))
        await session.execute(delete(Node))
        await session.execute(delete(ClaimToken))
        await session.execute(delete(ApiKey))
        await session.execute(delete(AuditLog))
        await session.execute(delete(User))
        await session.commit()


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c
