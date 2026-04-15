from uuid import UUID

from fastapi import APIRouter, Query, Request, Response, status

from app.core.errors import InvalidPaginationCursor
from app.core.pagination import InvalidCursorError
from app.deps import CurrentNode, CurrentUser, DbSession
from app.schemas.job_logs import JobLogEntryIn, JobLogEntryOut, JobLogListResponse
from app.schemas.jobs import (
    CompleteJobRequest,
    JobAssignment,
    JobListResponse,
    JobPublic,
    SubmitJobRequest,
)
from app.services.job_service import JobService

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.post("", response_model=JobPublic, status_code=status.HTTP_201_CREATED)
async def submit_job(
    payload: SubmitJobRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> JobPublic:
    service = JobService(session)
    job = await service.submit(
        actor=user,
        docker_image=payload.docker_image,
        command=payload.command,
        gpu_count=payload.gpu_count,
        max_duration_seconds=payload.max_duration_seconds,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return JobPublic.model_validate(job)


@router.get("", response_model=JobListResponse)
async def list_jobs(
    user: CurrentUser,
    session: DbSession,
    job_status: str | None = Query(default=None, alias="status"),
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
) -> JobListResponse:
    service = JobService(session)
    try:
        jobs, next_cursor = await service.list_for_user(
            owner=user, status=job_status, cursor=cursor, limit=limit
        )
    except InvalidCursorError as exc:
        raise InvalidPaginationCursor() from exc
    return JobListResponse(
        items=[JobPublic.model_validate(j) for j in jobs],
        next_cursor=next_cursor,
    )


@router.post(
    "/claim",
    response_model=JobAssignment,
    responses={204: {"description": "No queued work fits this node right now"}},
)
async def claim_job(node: CurrentNode, session: DbSession):
    service = JobService(session)
    job = await service.claim_for_node(node)
    if job is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return JobAssignment(
        job_id=job.id,
        docker_image=job.docker_image,
        command=job.command,
        max_duration_seconds=job.max_duration_seconds,
    )


@router.get("/{job_id}", response_model=JobPublic)
async def get_job(
    job_id: UUID, user: CurrentUser, session: DbSession
) -> JobPublic:
    service = JobService(session)
    job = await service.get_for_user(user, job_id)
    return JobPublic.model_validate(job)


@router.post("/{job_id}/complete", response_model=JobPublic)
async def complete_job(
    job_id: UUID,
    payload: CompleteJobRequest,
    node: CurrentNode,
    session: DbSession,
) -> JobPublic:
    service = JobService(session)
    job = await service.complete_job(
        node=node,
        job_id=job_id,
        exit_code=payload.exit_code,
        error_message=payload.error_message,
    )
    return JobPublic.model_validate(job)


@router.post("/{job_id}/logs", status_code=status.HTTP_204_NO_CONTENT)
async def push_logs(
    job_id: UUID,
    entries: list[JobLogEntryIn],
    node: CurrentNode,
    session: DbSession,
):
    if not entries:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    service = JobService(session)
    await service.append_logs(
        node, job_id, [e.model_dump() for e in entries]
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{job_id}/logs", response_model=JobLogListResponse)
async def get_logs(
    job_id: UUID,
    user: CurrentUser,
    session: DbSession,
    after_sequence: int = Query(default=-1, ge=-1),
    limit: int = Query(default=500, ge=1, le=2000),
) -> JobLogListResponse:
    service = JobService(session)
    rows = await service.get_logs_for_user(
        owner=user, job_id=job_id, after_sequence=after_sequence, limit=limit
    )
    return JobLogListResponse(
        items=[JobLogEntryOut.model_validate(r) for r in rows]
    )
