from uuid import UUID

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
