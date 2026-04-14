from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AccountNotActive, ApiKeyNotFound, ApiKeyNotOwned
from app.core.security import (
    api_key_lookup_prefix,
    generate_api_key,
    verify_api_key,
)
from app.models.api_key import ApiKey
from app.models.user import User
from app.repositories.api_key_repo import ApiKeyRepository
from app.repositories.audit_repo import AuditRepository
from app.repositories.user_repo import UserRepository


class ApiKeyService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.api_key_repo = ApiKeyRepository(session)
        self.user_repo = UserRepository(session)
        self.audit_repo = AuditRepository(session)

    async def generate(
        self,
        actor: User,
        name: str,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> tuple[ApiKey, str]:
        if actor.status != "active":
            raise AccountNotActive(actor.status)

        plaintext, prefix, key_hash = generate_api_key()
        api_key = await self.api_key_repo.create(
            user_id=actor.id, name=name, prefix=prefix, key_hash=key_hash
        )
        await self.audit_repo.create(
            event_type="apikey.created",
            user_id=actor.id,
            event_data={"api_key_id": str(api_key.id), "name": name, "prefix": prefix},
            ip_address=ip_address,
            user_agent=user_agent,
        )
        await self.session.commit()
        await self.session.refresh(api_key)
        return api_key, plaintext

    async def list_for(self, actor: User) -> list[ApiKey]:
        return await self.api_key_repo.list_for_user(actor.id)

    async def revoke(
        self,
        actor: User,
        api_key_id: UUID,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> ApiKey:
        api_key = await self.api_key_repo.get_by_id(api_key_id)
        if api_key is None:
            raise ApiKeyNotFound(f"api key {api_key_id} not found")
        if api_key.user_id != actor.id:
            raise ApiKeyNotOwned()
        if api_key.revoked_at is None:
            await self.api_key_repo.revoke(api_key)
            await self.audit_repo.create(
                event_type="apikey.revoked",
                user_id=actor.id,
                event_data={"api_key_id": str(api_key.id), "prefix": api_key.prefix},
                ip_address=ip_address,
                user_agent=user_agent,
            )
            await self.session.commit()
            await self.session.refresh(api_key)
        return api_key

    async def authenticate(self, plaintext: str) -> User | None:
        prefix = api_key_lookup_prefix(plaintext)
        api_key = await self.api_key_repo.get_by_prefix(prefix)
        if api_key is None or api_key.revoked_at is not None:
            return None
        if not verify_api_key(plaintext, api_key.hash):
            return None
        return await self.user_repo.get_by_id(api_key.user_id)
