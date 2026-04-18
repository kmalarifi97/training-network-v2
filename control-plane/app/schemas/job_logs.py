from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class JobLogEntryIn(BaseModel):
    stream: Literal["stdout", "stderr", "system"]
    content: str = Field(min_length=1, max_length=64 * 1024)
    sequence: int = Field(ge=0)


class JobLogEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    stream: str
    content: str
    sequence: int
    received_at: datetime


class JobLogListResponse(BaseModel):
    items: list[JobLogEntryOut]
