from fastapi import APIRouter, Request, status

from app.deps import CurrentUser, DbSession
from app.schemas.jobs import JobPublic, SubmitJobRequest
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
