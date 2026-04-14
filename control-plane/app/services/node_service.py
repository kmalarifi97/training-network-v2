from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.errors import ClaimTokenInvalid, NotAHost
from app.core.security import (
    claim_token_lookup_prefix,
    generate_claim_token,
    verify_claim_token,
)
from app.models.claim_token import ClaimToken
from app.models.node import Node
from app.models.user import User
from app.repositories.audit_repo import AuditRepository
from app.repositories.claim_token_repo import ClaimTokenRepository
from app.repositories.node_repo import NodeRepository


def _default_node_name() -> str:
    suffix = uuid4().hex[:6]
    return f"node-{suffix}"


class NodeService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.claim_repo = ClaimTokenRepository(session)
        self.node_repo = NodeRepository(session)
        self.audit_repo = AuditRepository(session)

    async def create_claim_token(
        self,
        host: User,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> tuple[ClaimToken, str, str]:
        if not host.can_host:
            raise NotAHost()

        plaintext, prefix, token_hash = generate_claim_token()
        expires_at = datetime.now(UTC) + timedelta(hours=settings.claim_token_ttl_hours)
        claim = await self.claim_repo.create(
            user_id=host.id,
            prefix=prefix,
            token_hash=token_hash,
            expires_at=expires_at,
        )
        install_command = (
            f"gpu-agent init --control-plane={settings.control_plane_public_url} "
            f"--claim-token={plaintext}"
        )
        await self.audit_repo.create(
            event_type="node.claim_token.created",
            user_id=host.id,
            event_data={"prefix": prefix, "expires_at": expires_at.isoformat()},
            ip_address=ip_address,
            user_agent=user_agent,
        )
        await self.session.commit()
        await self.session.refresh(claim)
        return claim, plaintext, install_command

    async def register_node(
        self,
        claim_token: str,
        gpu_model: str,
        gpu_memory_gb: int,
        gpu_count: int,
        suggested_name: str | None,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> Node:
        prefix = claim_token_lookup_prefix(claim_token)
        claim = await self.claim_repo.get_by_prefix(prefix)
        if claim is None or not verify_claim_token(claim_token, claim.token_hash):
            raise ClaimTokenInvalid("unknown token")
        if claim.consumed_at is not None:
            raise ClaimTokenInvalid("already used")
        if claim.expires_at <= datetime.now(UTC):
            raise ClaimTokenInvalid("expired")

        node = await self.node_repo.create(
            user_id=claim.user_id,
            name=suggested_name or _default_node_name(),
            gpu_model=gpu_model,
            gpu_memory_gb=gpu_memory_gb,
            gpu_count=gpu_count,
            status="online",
        )
        await self.claim_repo.mark_consumed(claim)
        await self.audit_repo.create(
            event_type="node.registered",
            user_id=claim.user_id,
            event_data={
                "node_id": str(node.id),
                "gpu_model": gpu_model,
                "gpu_memory_gb": gpu_memory_gb,
                "gpu_count": gpu_count,
                "claim_token_prefix": prefix,
            },
            ip_address=ip_address,
            user_agent=user_agent,
        )
        await self.session.commit()
        await self.session.refresh(node)
        return node

    async def list_for_user(self, host: User) -> list[Node]:
        return await self.node_repo.list_for_user(host.id)
