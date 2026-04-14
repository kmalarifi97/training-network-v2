from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import and_, desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog
from app.models.user import User


class AuditRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        event_type: str,
        user_id: UUID | None = None,
        event_data: dict[str, Any] | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> AuditLog:
        entry = AuditLog(
            user_id=user_id,
            event_type=event_type,
            event_data=event_data or {},
            ip_address=ip_address,
            user_agent=user_agent,
        )
        self.session.add(entry)
        await self.session.flush()
        return entry

    async def get_signup_ip(self, user_id: UUID) -> str | None:
        stmt = (
            select(AuditLog.ip_address)
            .where(AuditLog.user_id == user_id)
            .where(AuditLog.event_type == "auth.signup")
            .order_by(desc(AuditLog.created_at))
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_filtered(
        self,
        event_type: str | None = None,
        user_email_query: str | None = None,
        ip_address: str | None = None,
        created_from: datetime | None = None,
        created_to: datetime | None = None,
        cursor: tuple[datetime, UUID] | None = None,
        limit: int = 50,
    ) -> list[tuple[AuditLog, str | None]]:
        stmt = select(AuditLog, User.email).outerjoin(User, AuditLog.user_id == User.id)
        if event_type is not None:
            stmt = stmt.where(AuditLog.event_type == event_type)
        if user_email_query:
            stmt = stmt.where(User.email.ilike(f"%{user_email_query}%"))
        if ip_address is not None:
            stmt = stmt.where(AuditLog.ip_address == ip_address)
        if created_from is not None:
            stmt = stmt.where(AuditLog.created_at >= created_from)
        if created_to is not None:
            stmt = stmt.where(AuditLog.created_at <= created_to)
        if cursor is not None:
            ts, last_id = cursor
            stmt = stmt.where(
                or_(
                    AuditLog.created_at < ts,
                    and_(AuditLog.created_at == ts, AuditLog.id < last_id),
                )
            )
        stmt = stmt.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(limit)
        result = await self.session.execute(stmt)
        return [(row[0], row[1]) for row in result.all()]

    async def get_with_email(self, event_id: UUID) -> tuple[AuditLog, str | None] | None:
        stmt = (
            select(AuditLog, User.email)
            .outerjoin(User, AuditLog.user_id == User.id)
            .where(AuditLog.id == event_id)
        )
        result = await self.session.execute(stmt)
        row = result.first()
        if row is None:
            return None
        return row[0], row[1]
