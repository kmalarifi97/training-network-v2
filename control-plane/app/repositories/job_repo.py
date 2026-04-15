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
    ) -> Job:
        job = Job(
            user_id=user_id,
            docker_image=docker_image,
            command=command,
            gpu_count=gpu_count,
            max_duration_seconds=max_duration_seconds,
            status="queued",
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

    async def claim_next_for_node(
        self, node_id: UUID, gpu_capacity: int
    ) -> Job | None:
        """Atomically claim the oldest queued job that fits this node.

        SELECT ... FOR UPDATE SKIP LOCKED so two agents racing through this
        path never both pick the same job; the loser silently gets the next
        candidate or None. Caller commits the transaction.
        """
        stmt = (
            select(Job)
            .where(Job.status == "queued")
            .where(Job.gpu_count <= gpu_capacity)
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

    async def mark_completed(
        self, job: Job, exit_code: int, error_message: str | None
    ) -> Job:
        job.status = "completed" if exit_code == 0 else "failed"
        job.exit_code = exit_code
        job.error_message = error_message
        job.completed_at = datetime.now(UTC)
        await self.session.flush()
        return job
