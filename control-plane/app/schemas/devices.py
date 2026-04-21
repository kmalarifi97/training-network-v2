from datetime import datetime
from uuid import UUID  # noqa: F401 — kept for PollApprovedResponse

from pydantic import BaseModel, Field


class CreateDeviceCodeRequest(BaseModel):
    gpu_model: str = Field(min_length=1, max_length=100)
    gpu_memory_gb: int = Field(ge=1)
    gpu_count: int = Field(ge=1)


class CreateDeviceCodeResponse(BaseModel):
    code: str
    polling_token: str
    verify_url: str
    expires_at: datetime


class PollPendingResponse(BaseModel):
    status: str = "pending"


class PollApprovedResponse(BaseModel):
    status: str = "approved"
    node_id: UUID
    node_name: str
    agent_token: str
    control_plane_url: str


class ActivateDeviceCodeRequest(BaseModel):
    code: str = Field(min_length=1, max_length=16)


class ActivateDeviceCodeResponse(BaseModel):
    status: str = "approved"
    gpu_model: str
    gpu_memory_gb: int
    gpu_count: int
