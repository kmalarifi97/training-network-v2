from uuid import UUID

from fastapi import APIRouter, Request, Response, status

from app.deps import CurrentNode, CurrentUser, DbSession
from app.schemas.jobs import (
    CompleteJobRequest,
    JobAssignment,
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
