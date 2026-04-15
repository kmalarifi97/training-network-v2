import math
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import (
    AccountNotActive,
    InsufficientCredits,
    InvalidJobTransition,
    JobNotFound,
)
from app.models.job import Job
from app.models.node import Node
from app.models.user import User
from app.repositories.audit_repo import AuditRepository
from app.repositories.job_repo import JobRepository
from app.repositories.user_repo import UserRepository


def _bill_gpu_hours(started_at: datetime, completed_at: datetime, gpu_count: int) -> int:
    """Round elapsed seconds × gpu_count up to whole GPU-hours, never below 1.

    v1 keeps billing simple: any job that ran at all is billed at least one
    GPU-hour, and partial hours round up. Refining to fractional billing is a
    future story.
    """
    elapsed = max(0.0, (completed_at - started_at).total_seconds())
    return max(1, math.ceil(elapsed * gpu_count / 3600.0))


class JobService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.job_repo = JobRepository(session)
        self.audit_repo = AuditRepository(session)
        self.user_repo = UserRepository(session)

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

    async def claim_for_node(self, node: Node) -> Job | None:
        if node.status == "draining":
            return None
        existing = await self.job_repo.get_running_for_node(node.id)
        if existing is not None:
            return None
        job = await self.job_repo.claim_next_for_node(node.id, node.gpu_count)
        if job is None:
            await self.session.rollback()
            return None
        await self.audit_repo.create(
            event_type="job.assigned",
            user_id=job.user_id,
            event_data={
                "job_id": str(job.id),
                "node_id": str(node.id),
                "gpu_count": job.gpu_count,
            },
        )
        await self.session.commit()
        await self.session.refresh(job)
        return job

    async def complete_job(
        self,
        node: Node,
        job_id: UUID,
        exit_code: int,
        error_message: str | None,
    ) -> Job:
        job = await self.job_repo.get_by_id(job_id)
        if job is None or job.assigned_node_id != node.id:
            raise JobNotFound(f"job {job_id} not found")
        if job.status != "running":
            raise InvalidJobTransition(job.status, "completed")

        completed_at = datetime.now(UTC)
        billed = _bill_gpu_hours(job.started_at or completed_at, completed_at, job.gpu_count)
        user = await self.user_repo.get_by_id(job.user_id)
        if user is not None:
            user.credits_gpu_hours = max(0, user.credits_gpu_hours - billed)

        await self.job_repo.mark_completed(
            job, exit_code=exit_code, error_message=error_message
        )
        await self.audit_repo.create(
            event_type=f"job.{job.status}",
            user_id=job.user_id,
            event_data={
                "job_id": str(job.id),
                "node_id": str(node.id),
                "exit_code": exit_code,
                "billed_gpu_hours": billed,
                "error_message": error_message,
            },
        )
        await self.session.commit()
        await self.session.refresh(job)
        return job
