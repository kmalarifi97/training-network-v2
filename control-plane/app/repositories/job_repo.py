from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import Job


class JobRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        user_id: UUID,
        docker_image: str,
        command: list[str],
        gpu_count: int,
        max_duration_seconds: int,
        preferred_node_id: UUID | None = None,
    ) -> Job:
        job = Job(
            user_id=user_id,
            docker_image=docker_image,
            command=command,
            gpu_count=gpu_count,
            max_duration_seconds=max_duration_seconds,
            status="queued",
            preferred_node_id=preferred_node_id,
        )
        self.session.add(job)
        await self.session.flush()
        return job

    async def get_by_id(self, job_id: UUID) -> Job | None:
        result = await self.session.execute(select(Job).where(Job.id == job_id))
        return result.scalar_one_or_none()

    async def get_running_for_node(self, node_id: UUID) -> Job | None:
        result = await self.session.execute(
            select(Job)
            .where(Job.assigned_node_id == node_id)
            .where(Job.status == "running")
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def list_for_user(
        self,
        user_id: UUID,
        status: str | None = None,
        cursor: tuple[datetime, UUID] | None = None,
        limit: int = 50,
    ) -> list[Job]:
        from sqlalchemy import and_, or_

        stmt = select(Job).where(Job.user_id == user_id)
        if status is not None:
            stmt = stmt.where(Job.status == status)
        if cursor is not None:
            ts, last_id = cursor
            stmt = stmt.where(
                or_(
                    Job.created_at < ts,
                    and_(Job.created_at == ts, Job.id < last_id),
                )
            )
        stmt = stmt.order_by(Job.created_at.desc(), Job.id.desc()).limit(limit)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def claim_next_for_node(
        self, node_id: UUID, gpu_capacity: int
    ) -> Job | None:
        """Atomically claim the oldest queued job that fits this node.

        SELECT ... FOR UPDATE SKIP LOCKED so two agents racing through this
        path never both pick the same job; the loser silently gets the next
        candidate or None. Caller commits the transaction.
        """
        # A job with preferred_node_id set is only claimable by that node; a
        # null preferred_node_id means any capable node may take it.
        from sqlalchemy import or_

        stmt = (
            select(Job)
            .where(Job.status == "queued")
            .where(Job.gpu_count <= gpu_capacity)
            .where(
                or_(
                    Job.preferred_node_id.is_(None),
                    Job.preferred_node_id == node_id,
                )
            )
            .order_by(Job.created_at.asc(), Job.id.asc())
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        result = await self.session.execute(stmt)
        job = result.scalar_one_or_none()
        if job is None:
            return None
        job.status = "running"
        job.assigned_node_id = node_id
        job.started_at = datetime.now(UTC)
        await self.session.flush()
        return job

    async def mark_terminal(
        self,
        job: Job,
        terminal_status: str,
        exit_code: int | None,
        error_message: str | None,
    ) -> Job:
        job.status = terminal_status
        job.exit_code = exit_code
        job.error_message = error_message
        job.completed_at = datetime.now(UTC)
        await self.session.flush()
        return job

    async def request_cancel(self, job: Job) -> Job:
        job.cancel_requested_at = datetime.now(UTC)
        await self.session.flush()
        return job
