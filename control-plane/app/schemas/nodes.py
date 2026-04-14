from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


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
    config_payload: dict[str, Any]


class NodePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    gpu_model: str
    gpu_memory_gb: int
    gpu_count: int
    status: str
    last_seen_at: datetime | None
    created_at: datetime
