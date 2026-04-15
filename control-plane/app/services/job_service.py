import math
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import (
    AccountNotActive,
    InsufficientCredits,
    JobNotFound,
)
from app.core.pagination import decode_cursor, encode_cursor
from app.models.job import Job
from app.models.node import Node
from app.models.user import User
from app.models.job_log import JobLog
from app.repositories.audit_repo import AuditRepository
from app.repositories.job_log_repo import JobLogRepository
from app.repositories.job_repo import JobRepository
from app.repositories.user_repo import UserRepository
from app.services.job_status import (
    CANCELLED,
    COMPLETED,
    FAILED,
    QUEUED,
    RUNNING,
    TERMINAL_STATUSES,
    assert_transition,
)


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
        self.log_repo = JobLogRepository(session)

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
        # The state-machine guard runs inside the row lock acquired by
        # claim_next_for_node — we only ever observe queued candidates.
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

        # If the user already requested cancel, route to the cancelled state
        # regardless of exit_code so a successful no-op container or a kill
        # signal both land as cancelled in the user's view.
        if job.cancel_requested_at is not None:
            target = CANCELLED
        elif exit_code == 0:
            target = COMPLETED
        else:
            target = FAILED
        assert_transition(job.status, target)

        completed_at = datetime.now(UTC)
        billed = _bill_gpu_hours(job.started_at or completed_at, completed_at, job.gpu_count)
        user = await self.user_repo.get_by_id(job.user_id)
        if user is not None:
            user.credits_gpu_hours = max(0, user.credits_gpu_hours - billed)

        await self.job_repo.mark_terminal(
            job,
            terminal_status=target,
            exit_code=exit_code,
            error_message=error_message,
        )
        await self.audit_repo.create(
            event_type=f"job.{target}",
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

    async def cancel_job(
        self,
        owner: User,
        job_id: UUID,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> Job:
        job = await self.job_repo.get_by_id(job_id)
        if job is None or job.user_id != owner.id:
            raise JobNotFound(f"job {job_id} not found")
        return await self._cancel_or_request_cancel(
            job,
            audit_event="job.cancelled",
            audit_actor=owner,
            audit_user_id=owner.id,
            audit_extra=None,
            ip_address=ip_address,
            user_agent=user_agent,
        )

    async def admin_force_kill(
        self,
        admin: User,
        job_id: UUID,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> Job:
        job = await self.job_repo.get_by_id(job_id)
        if job is None:
            raise JobNotFound(f"job {job_id} not found")
        return await self._cancel_or_request_cancel(
            job,
            audit_event="admin.job.force_killed",
            audit_actor=admin,
            audit_user_id=job.user_id,
            audit_extra={"target_user_id": str(job.user_id)},
            ip_address=ip_address,
            user_agent=user_agent,
        )

    async def _cancel_or_request_cancel(
        self,
        job: Job,
        *,
        audit_event: str,
        audit_actor: User,
        audit_user_id: UUID,
        audit_extra: dict | None,
        ip_address: str | None,
        user_agent: str | None,
    ) -> Job:
        if job.status in TERMINAL_STATUSES:
            # 409 — completed/failed/cancelled jobs are immutable.
            assert_transition(job.status, CANCELLED)

        if job.status == QUEUED:
            await self.job_repo.mark_terminal(
                job,
                terminal_status=CANCELLED,
                exit_code=None,
                error_message="cancelled by user",
            )
            phase = "queued"
        elif job.status == RUNNING:
            if job.cancel_requested_at is None:
                await self.job_repo.request_cancel(job)
            phase = "running"
        else:
            assert_transition(job.status, CANCELLED)  # safety net
            phase = job.status

        event_data: dict = {
            "job_id": str(job.id),
            "phase": phase,
            "actor_user_id": str(audit_actor.id),
            "actor_email": audit_actor.email,
        }
        if audit_extra:
            event_data.update(audit_extra)
        await self.audit_repo.create(
            event_type=audit_event,
            user_id=audit_user_id,
            event_data=event_data,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        await self.session.commit()
        await self.session.refresh(job)
        return job

    async def list_for_user(
        self,
        owner: User,
        status: str | None,
        cursor: str | None,
        limit: int,
    ) -> tuple[list[Job], str | None]:
        decoded = decode_cursor(cursor) if cursor else None
        jobs = await self.job_repo.list_for_user(
            user_id=owner.id, status=status, cursor=decoded, limit=limit
        )
        next_cursor = (
            encode_cursor(jobs[-1].created_at, jobs[-1].id)
            if len(jobs) == limit
            else None
        )
        return jobs, next_cursor

    async def get_for_user(self, owner: User, job_id: UUID) -> Job:
        job = await self.job_repo.get_by_id(job_id)
        if job is None or job.user_id != owner.id:
            raise JobNotFound(f"job {job_id} not found")
        return job

    async def append_logs(
        self, node: Node, job_id: UUID, entries: list[dict]
    ) -> int:
        job = await self.job_repo.get_by_id(job_id)
        if job is None or job.assigned_node_id != node.id:
            raise JobNotFound(f"job {job_id} not found")
        inserted = await self.log_repo.append(job.id, entries)
        await self.session.commit()
        return inserted

    async def get_logs_for_user(
        self,
        owner: User,
        job_id: UUID,
        after_sequence: int,
        limit: int,
    ) -> list[JobLog]:
        job = await self.job_repo.get_by_id(job_id)
        if job is None or job.user_id != owner.id:
            raise JobNotFound(f"job {job_id} not found")
        return await self.log_repo.list_after(job.id, after_sequence, limit)
