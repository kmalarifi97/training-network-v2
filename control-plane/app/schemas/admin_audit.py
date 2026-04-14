from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr


class AdminAuditEvent(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    event_type: str
    user_id: UUID | None
    user_email: EmailStr | None
    ip_address: str | None
    created_at: datetime


class AdminAuditEventDetail(AdminAuditEvent):
    user_agent: str | None
    event_data: dict[str, Any]


class AdminAuditListResponse(BaseModel):
    items: list[AdminAuditEvent]
    next_cursor: str | None = None
