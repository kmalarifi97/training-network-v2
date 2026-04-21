from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.errors import DeviceCodeInvalid, DeviceCodeNotApproved, NotAHost
from app.core.security import (
    generate_agent_token,
    generate_device_code,
    generate_polling_token,
    polling_token_lookup_prefix,
    verify_polling_token,
)
from app.models.device_code import DeviceCode
from app.models.node import Node
from app.models.user import User
from app.repositories.audit_repo import AuditRepository
from app.repositories.device_code_repo import DeviceCodeRepository
from app.repositories.node_repo import NodeRepository

DEVICE_CODE_TTL_MINUTES = 10


def _default_node_name() -> str:
    return f"node-{uuid4().hex[:6]}"


class DeviceCodeService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.device_repo = DeviceCodeRepository(session)
        self.node_repo = NodeRepository(session)
        self.audit_repo = AuditRepository(session)

    async def create_code(
        self,
        *,
        gpu_model: str,
        gpu_memory_gb: int,
        gpu_count: int,
    ) -> tuple[DeviceCode, str, str]:
        polling_plaintext, polling_prefix, polling_hash = generate_polling_token()
        code = generate_device_code()
        expires_at = datetime.now(UTC) + timedelta(minutes=DEVICE_CODE_TTL_MINUTES)
        record = await self.device_repo.create(
            code=code,
            polling_prefix=polling_prefix,
            polling_hash=polling_hash,
            gpu_model=gpu_model,
            gpu_memory_gb=gpu_memory_gb,
            gpu_count=gpu_count,
            expires_at=expires_at,
        )
        verify_url = f"{settings.ui_public_url.rstrip('/')}/activate"
        await self.session.commit()
        await self.session.refresh(record)
        return record, polling_plaintext, verify_url

    async def activate(
        self,
        *,
        user: User,
        code: str,
        ip_address: str | None,
        user_agent: str | None,
    ) -> DeviceCode:
        if not user.can_host:
            raise NotAHost()

        record = await self.device_repo.get_by_code(code.strip().upper())
        if record is None:
            raise DeviceCodeInvalid("unknown code")
        if record.status == "consumed":
            raise DeviceCodeInvalid("already used")
        if record.expires_at <= datetime.now(UTC):
            raise DeviceCodeInvalid("expired")

        if record.status == "pending":
            await self.device_repo.mark_approved(record, user.id)
            await self.audit_repo.create(
                event_type="device.code.approved",
                user_id=user.id,
                event_data={
                    "code": record.code,
                    "gpu_model": record.gpu_model,
                    "gpu_count": record.gpu_count,
                    "gpu_memory_gb": record.gpu_memory_gb,
                },
                ip_address=ip_address,
                user_agent=user_agent,
            )
            await self.session.commit()
            await self.session.refresh(record)
        elif record.approved_by_user_id != user.id:
            raise DeviceCodeInvalid("approved by a different user")

        return record

    async def claim_approved(
        self, polling_token: str
    ) -> tuple[Node, str] | None:
        """Called by the agent polling with its polling_token.

        Returns (node, agent_token_plaintext) on successful consumption.
        Returns None while still pending.
        Raises DeviceCodeInvalid on expired / unknown / already-consumed.
        """
        prefix = polling_token_lookup_prefix(polling_token)
        record = await self.device_repo.get_by_polling_prefix(prefix)
        if record is None or not verify_polling_token(polling_token, record.polling_hash):
            raise DeviceCodeInvalid("unknown token")
        if record.status == "consumed":
            raise DeviceCodeInvalid("already consumed")
        if record.expires_at <= datetime.now(UTC):
            raise DeviceCodeInvalid("expired")
        if record.status == "pending":
            return None
        if record.approved_by_user_id is None:
            raise DeviceCodeInvalid("approval is missing an owner")

        agent_token, agent_prefix, agent_hash = generate_agent_token()
        node = await self.node_repo.create(
            user_id=record.approved_by_user_id,
            name=_default_node_name(),
            gpu_model=record.gpu_model,
            gpu_memory_gb=record.gpu_memory_gb,
            gpu_count=record.gpu_count,
            status="online",
            agent_token_prefix=agent_prefix,
            agent_token_hash=agent_hash,
            last_seen_at=datetime.now(UTC),
        )
        await self.device_repo.mark_consumed(record, node.id)
        await self.audit_repo.create(
            event_type="node.registered",
            user_id=record.approved_by_user_id,
            event_data={
                "node_id": str(node.id),
                "gpu_model": record.gpu_model,
                "gpu_memory_gb": record.gpu_memory_gb,
                "gpu_count": record.gpu_count,
                "device_code": record.code,
                "onboarding": "device_code",
            },
            ip_address=None,
            user_agent=None,
        )
        await self.session.commit()
        await self.session.refresh(node)
        return node, agent_token
