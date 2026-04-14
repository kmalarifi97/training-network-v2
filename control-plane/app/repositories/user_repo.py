from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


class UserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self, email: str, password_hash: str) -> User:
        user = User(email=email, password_hash=password_hash)
        self.session.add(user)
        await self.session.flush()
        return user

    async def get_by_email(self, email: str) -> User | None:
        result = await self.session.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    async def get_by_id(self, user_id: UUID) -> User | None:
        result = await self.session.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def list_filtered(
        self,
        status: str | None = None,
        email_query: str | None = None,
        cursor: tuple[datetime, UUID] | None = None,
        limit: int = 50,
    ) -> list[User]:
        stmt = select(User)
        if status is not None:
            stmt = stmt.where(User.status == status)
        if email_query:
            stmt = stmt.where(User.email.ilike(f"%{email_query}%"))
        if cursor is not None:
            ts, last_id = cursor
            stmt = stmt.where(
                or_(
                    User.created_at < ts,
                    and_(User.created_at == ts, User.id < last_id),
                )
            )
        stmt = stmt.order_by(User.created_at.desc(), User.id.desc()).limit(limit)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
