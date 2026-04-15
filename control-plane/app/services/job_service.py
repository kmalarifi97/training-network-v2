from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AccountNotActive, InsufficientCredits
from app.models.job import Job
from app.models.user import User
from app.repositories.audit_repo import AuditRepository
from app.repositories.job_repo import JobRepository


class JobService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.job_repo = JobRepository(session)
        self.audit_repo = AuditRepository(session)

    async def submit(
        self,
        actor: User,
        docker_image: str,
        command: list[str],
        gpu_count: int,
        max_duration_seconds: int,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> Job:
        if actor.status != "active":
            raise AccountNotActive(actor.status)

        required_hours = gpu_count * max_duration_seconds / 3600.0
        if actor.credits_gpu_hours < required_hours:
            raise InsufficientCredits(required_hours, actor.credits_gpu_hours)

        job = await self.job_repo.create(
            user_id=actor.id,
            docker_image=docker_image,
            command=command,
            gpu_count=gpu_count,
            max_duration_seconds=max_duration_seconds,
        )
        await self.audit_repo.create(
            event_type="job.submitted",
            user_id=actor.id,
            event_data={
                "job_id": str(job.id),
                "docker_image": docker_image,
                "gpu_count": gpu_count,
                "max_duration_seconds": max_duration_seconds,
            },
            ip_address=ip_address,
            user_agent=user_agent,
        )
        await self.session.commit()
        await self.session.refresh(job)
        return job
