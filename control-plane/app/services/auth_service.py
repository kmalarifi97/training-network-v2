from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import EmailAlreadyExists, InvalidCredentials, UserNotFound
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.repositories.audit_repo import AuditRepository
from app.repositories.user_repo import UserRepository


class AuthService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.user_repo = UserRepository(session)
        self.audit_repo = AuditRepository(session)

    async def signup(
        self,
        email: str,
        password: str,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> User:
        existing = await self.user_repo.get_by_email(email)
        if existing is not None:
            raise EmailAlreadyExists(email)

        user = await self.user_repo.create(
            email=email, password_hash=hash_password(password)
        )
        await self.audit_repo.create(
            event_type="auth.signup",
            user_id=user.id,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        await self.session.commit()
        await self.session.refresh(user)
        return user

    async def login(
        self,
        email: str,
        password: str,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> str:
        user = await self.user_repo.get_by_email(email)
        if user is None or not verify_password(password, user.password_hash):
            await self.audit_repo.create(
                event_type="auth.login.failed",
                user_id=user.id if user else None,
                event_data={"email": email},
                ip_address=ip_address,
                user_agent=user_agent,
            )
            await self.session.commit()
            raise InvalidCredentials()

        await self.audit_repo.create(
            event_type="auth.login.success",
            user_id=user.id,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        await self.session.commit()
        return create_access_token(subject=str(user.id))

    async def get_user_by_id(self, user_id: UUID) -> User:
        user = await self.user_repo.get_by_id(user_id)
        if user is None:
            raise UserNotFound(f"user {user_id} not found")
        return user
