import re
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

# registry/path[:tag] — lowercase name, optional dotted/slashed segments, optional tag
_IMAGE_RE = re.compile(
    r"^[a-z0-9]+([_.\-/][a-z0-9]+)*(:[a-zA-Z0-9_.\-]+)?$"
)

# 1 second to 7 days; v1 keeps a hard ceiling so an over-credited user can't
# pin a node forever on a single job.
MAX_JOB_DURATION_SECONDS = 86400 * 7


class SubmitJobRequest(BaseModel):
    docker_image: str = Field(min_length=1, max_length=255)
    command: list[str] = Field(min_length=1, max_length=64)
    gpu_count: int = Field(ge=1, le=64)
    max_duration_seconds: int = Field(ge=1, le=MAX_JOB_DURATION_SECONDS)

    @field_validator("docker_image")
    @classmethod
    def _validate_image(cls, v: str) -> str:
        if not _IMAGE_RE.fullmatch(v):
            raise ValueError("invalid docker image reference")
        return v

    @field_validator("command")
    @classmethod
    def _validate_command(cls, v: list[str]) -> list[str]:
        if any((not isinstance(x, str)) or x == "" for x in v):
            raise ValueError("command items must be non-empty strings")
        return v


class JobPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    docker_image: str
    command: list[str]
    gpu_count: int
    max_duration_seconds: int
    status: str
    exit_code: int | None
    error_message: str | None
    assigned_node_id: UUID | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class JobAssignment(BaseModel):
    job_id: UUID
    docker_image: str
    command: list[str]
    max_duration_seconds: int


class CompleteJobRequest(BaseModel):
    exit_code: int = Field(ge=-1024, le=1024)
    error_message: str | None = Field(default=None, max_length=4000)
