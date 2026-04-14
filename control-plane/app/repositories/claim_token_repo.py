from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.claim_token import ClaimToken


class ClaimTokenRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        user_id,
        prefix: str,
        token_hash: str,
        expires_at: datetime,
    ) -> ClaimToken:
        claim = ClaimToken(
            user_id=user_id,
            prefix=prefix,
            token_hash=token_hash,
            expires_at=expires_at,
        )
        self.session.add(claim)
        await self.session.flush()
        return claim

    async def get_by_prefix(self, prefix: str) -> ClaimToken | None:
        result = await self.session.execute(
            select(ClaimToken).where(ClaimToken.prefix == prefix)
        )
        return result.scalar_one_or_none()

    async def mark_consumed(self, claim: ClaimToken) -> ClaimToken:
        claim.consumed_at = datetime.now(UTC)
        await self.session.flush()
        return claim
