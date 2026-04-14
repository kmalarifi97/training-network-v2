from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class AdminUserListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    status: str
    can_host: bool
    can_rent: bool
    is_admin: bool
    credits_gpu_hours: int
    created_at: datetime


class AdminUserListResponse(BaseModel):
    items: list[AdminUserListItem]
    next_cursor: str | None = None


class AdminUserDetail(AdminUserListItem):
    signup_ip_address: str | None = None


class ApproveRequest(BaseModel):
    can_host: bool = False
    credits_gpu_hours: int = Field(default=0, ge=0)


class AdminActionResponse(BaseModel):
    message: str
    user: AdminUserListItem
