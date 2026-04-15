from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AuditEventNotFound, UserNotFound
from app.core.pagination import decode_cursor, encode_cursor
from app.models.audit_log import AuditLog
from app.models.job import Job
from app.models.node import Node
from app.models.user import User
from app.repositories.audit_repo import AuditRepository
from app.repositories.user_repo import UserRepository
from app.services.job_service import _bill_gpu_hours
from app.services.node_status import compute_node_status


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

    async def dashboard(self) -> dict:
        now = datetime.now(UTC)
        cutoff = now - timedelta(hours=24)

        user_rows = (
            await self.session.execute(
                select(User.status, func.count()).group_by(User.status)
            )
        ).all()
        user_counts = {"pending": 0, "active": 0, "suspended": 0}
        total_users = 0
        for status, count in user_rows:
            total_users += count
            if status in user_counts:
                user_counts[status] = count

        node_rows = (
            await self.session.execute(select(Node))
        ).scalars().all()
        node_counts = {"online": 0, "offline": 0, "draining": 0}
        for n in node_rows:
            node_counts[compute_node_status(n, now)] += 1

        job_rows = (
            await self.session.execute(
                select(Job.status, func.count()).group_by(Job.status)
            )
        ).all()
        queued = running = 0
        for status, count in job_rows:
            if status == "queued":
                queued = count
            elif status == "running":
                running = count

        completed_24h = await self.session.scalar(
            select(func.count())
            .select_from(Job)
            .where(Job.status == "completed")
            .where(Job.completed_at >= cutoff)
        ) or 0
        failed_24h = await self.session.scalar(
            select(func.count())
            .select_from(Job)
            .where(Job.status == "failed")
            .where(Job.completed_at >= cutoff)
        ) or 0
        cancelled_24h = await self.session.scalar(
            select(func.count())
            .select_from(Job)
            .where(Job.status == "cancelled")
            .where(Job.completed_at >= cutoff)
        ) or 0

        completed_jobs = (
            await self.session.execute(
                select(Job)
                .where(Job.completed_at >= cutoff)
                .where(Job.status.in_(["completed", "failed", "cancelled"]))
            )
        ).scalars().all()
        gpu_hours = 0
        for j in completed_jobs:
            if j.started_at is None or j.completed_at is None:
                continue
            gpu_hours += _bill_gpu_hours(j.started_at, j.completed_at, j.gpu_count)

        return {
            "users": {"total": total_users, **user_counts},
            "nodes": node_counts,
            "jobs": {
                "queued": queued,
                "running": running,
                "completed_24h": completed_24h,
                "failed_24h": failed_24h,
                "cancelled_24h": cancelled_24h,
            },
            "compute": {"gpu_hours_served_24h": gpu_hours},
        }
