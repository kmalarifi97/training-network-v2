from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class GenerateKeyRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class ApiKeyPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    prefix: str
    created_at: datetime
    revoked_at: datetime | None


class ApiKeyGenerated(BaseModel):
    id: UUID
    name: str
    prefix: str
    full_key: str
    created_at: datetime
