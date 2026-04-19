from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class ClaimTokenResponse(BaseModel):
    token: str
    prefix: str
    install_command: str
    expires_at: datetime


class RegisterNodeRequest(BaseModel):
    claim_token: str = Field(min_length=1, max_length=128)
    gpu_model: str = Field(min_length=1, max_length=100)
    gpu_memory_gb: int = Field(ge=1)
    gpu_count: int = Field(ge=1)
    suggested_name: str | None = Field(default=None, max_length=100)


class RegisterNodeResponse(BaseModel):
    node_id: UUID
    agent_token: str
    config_payload: dict[str, Any]


class NodePublic(BaseModel):
    id: UUID
    name: str
    gpu_model: str
    gpu_memory_gb: int
    gpu_count: int
    status: str
    last_seen_at: datetime | None
    created_at: datetime


class NodeDetail(NodePublic):
    current_job_id: UUID | None = None


class NodeMarketplaceView(NodePublic):
    host_handle: str


class HeartbeatRequest(BaseModel):
    job_progress: dict[str, Any] | None = None


class HeartbeatResponse(BaseModel):
    received_at: datetime
    cancel_job_id: UUID | None = None


class NodeMetricSample(BaseModel):
    gpu_index: int = Field(ge=0, le=63)
    utilization_pct: int = Field(ge=0, le=100)
    memory_used_bytes: int = Field(ge=0)
    memory_total_bytes: int = Field(ge=0)
    temperature_c: int = Field(ge=-50, le=200)
