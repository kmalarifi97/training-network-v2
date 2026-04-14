from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AuditEventNotFound, UserNotFound
from app.core.pagination import decode_cursor, encode_cursor
from app.models.audit_log import AuditLog
from app.models.user import User
from app.repositories.audit_repo import AuditRepository
from app.repositories.user_repo import UserRepository


class AdminService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.user_repo = UserRepository(session)
        self.audit_repo = AuditRepository(session)

    async def list_users(
        self,
        status: str | None,
        email_query: str | None,
        cursor: str | None,
        limit: int,
    ) -> tuple[list[User], str | None]:
        decoded = decode_cursor(cursor) if cursor else None
        users = await self.user_repo.list_filtered(
            status=status,
            email_query=email_query,
            cursor=decoded,
            limit=limit,
        )
        next_cursor = (
            encode_cursor(users[-1].created_at, users[-1].id) if len(users) == limit else None
        )
        return users, next_cursor

    async def get_user_detail(self, user_id: UUID) -> tuple[User, str | None]:
        user = await self.user_repo.get_by_id(user_id)
        if user is None:
            raise UserNotFound(f"user {user_id} not found")
        signup_ip = await self.audit_repo.get_signup_ip(user_id)
        return user, signup_ip

    async def approve_user(
        self,
        admin: User,
        user_id: UUID,
        can_host: bool,
        credits_gpu_hours: int,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> User:
        user = await self.user_repo.get_by_id(user_id)
        if user is None:
            raise UserNotFound(f"user {user_id} not found")

        user.status = "active"
        user.can_host = can_host
        user.credits_gpu_hours = credits_gpu_hours
        await self.session.flush()

        await self.audit_repo.create(
            event_type="user.approved",
            user_id=user.id,
            event_data={
                "actor_user_id": str(admin.id),
                "actor_email": admin.email,
                "can_host": can_host,
                "credits_gpu_hours": credits_gpu_hours,
            },
            ip_address=ip_address,
            user_agent=user_agent,
        )
        await self.session.commit()
        await self.session.refresh(user)
        return user

    async def suspend_user(
        self,
        admin: User,
        user_id: UUID,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> User:
        user = await self.user_repo.get_by_id(user_id)
        if user is None:
            raise UserNotFound(f"user {user_id} not found")

        user.status = "suspended"
        await self.session.flush()

        await self.audit_repo.create(
            event_type="user.suspended",
            user_id=user.id,
            event_data={
                "actor_user_id": str(admin.id),
                "actor_email": admin.email,
            },
            ip_address=ip_address,
            user_agent=user_agent,
        )
        await self.session.commit()
        await self.session.refresh(user)
        return user

    async def list_audit_events(
        self,
        admin: User,
        event_type: str | None,
        user_email_query: str | None,
        ip_address: str | None,
        created_from: datetime | None,
        created_to: datetime | None,
        cursor: str | None,
        limit: int,
        viewer_ip: str | None = None,
        viewer_user_agent: str | None = None,
    ) -> tuple[list[tuple[AuditLog, str | None]], str | None]:
        decoded = decode_cursor(cursor) if cursor else None
        rows = await self.audit_repo.list_filtered(
            event_type=event_type,
            user_email_query=user_email_query,
            ip_address=ip_address,
            created_from=created_from,
            created_to=created_to,
            cursor=decoded,
            limit=limit,
        )
        next_cursor = (
            encode_cursor(rows[-1][0].created_at, rows[-1][0].id)
            if len(rows) == limit
            else None
        )

        filters: dict[str, object] = {}
        if event_type is not None:
            filters["event_type"] = event_type
        if user_email_query is not None:
            filters["user_email"] = user_email_query
        if ip_address is not None:
            filters["ip_address"] = ip_address
        if created_from is not None:
            filters["from"] = created_from.isoformat()
        if created_to is not None:
            filters["to"] = created_to.isoformat()

        await self.audit_repo.create(
            event_type="audit.viewed",
            user_id=admin.id,
            event_data={
                "actor_email": admin.email,
                "filters": filters,
                "result_count": len(rows),
            },
            ip_address=viewer_ip,
            user_agent=viewer_user_agent,
        )
        await self.session.commit()
        return rows, next_cursor

    async def get_audit_event(
        self, event_id: UUID
    ) -> tuple[AuditLog, str | None]:
        row = await self.audit_repo.get_with_email(event_id)
        if row is None:
            raise AuditEventNotFound(f"audit event {event_id} not found")
        return row
