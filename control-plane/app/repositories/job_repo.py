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
