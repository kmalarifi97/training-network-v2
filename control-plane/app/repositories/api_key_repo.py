from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.api_key import ApiKey


class ApiKeyRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self, user_id: UUID, name: str, prefix: str, key_hash: str
    ) -> ApiKey:
        api_key = ApiKey(user_id=user_id, name=name, prefix=prefix, hash=key_hash)
        self.session.add(api_key)
        await self.session.flush()
        return api_key

    async def list_for_user(self, user_id: UUID) -> list[ApiKey]:
        result = await self.session.execute(
            select(ApiKey)
            .where(ApiKey.user_id == user_id)
            .order_by(ApiKey.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_by_id(self, api_key_id: UUID) -> ApiKey | None:
        result = await self.session.execute(
            select(ApiKey).where(ApiKey.id == api_key_id)
        )
        return result.scalar_one_or_none()

    async def get_by_prefix(self, prefix: str) -> ApiKey | None:
        result = await self.session.execute(
            select(ApiKey).where(ApiKey.prefix == prefix)
        )
        return result.scalar_one_or_none()

    async def revoke(self, api_key: ApiKey) -> ApiKey:
        api_key.revoked_at = datetime.now(UTC)
        await self.session.flush()
        return api_key
