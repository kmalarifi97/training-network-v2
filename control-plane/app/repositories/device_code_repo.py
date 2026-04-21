from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.device_code import DeviceCode


class DeviceCodeRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        *,
        code: str,
        polling_prefix: str,
        polling_hash: str,
        gpu_model: str,
        gpu_memory_gb: int,
        gpu_count: int,
        expires_at: datetime,
    ) -> DeviceCode:
        record = DeviceCode(
            code=code,
            polling_prefix=polling_prefix,
            polling_hash=polling_hash,
            gpu_model=gpu_model,
            gpu_memory_gb=gpu_memory_gb,
            gpu_count=gpu_count,
            expires_at=expires_at,
        )
        self.session.add(record)
        await self.session.flush()
        return record

    async def get_by_code(self, code: str) -> DeviceCode | None:
        result = await self.session.execute(
            select(DeviceCode).where(DeviceCode.code == code)
        )
        return result.scalar_one_or_none()

    async def get_by_polling_prefix(self, prefix: str) -> DeviceCode | None:
        result = await self.session.execute(
            select(DeviceCode).where(DeviceCode.polling_prefix == prefix)
        )
        return result.scalar_one_or_none()

    async def mark_approved(
        self, record: DeviceCode, user_id: UUID
    ) -> DeviceCode:
        record.status = "approved"
        record.approved_by_user_id = user_id
        record.approved_at = datetime.now(UTC)
        await self.session.flush()
        return record

    async def mark_consumed(
        self, record: DeviceCode, node_id: UUID
    ) -> DeviceCode:
        record.status = "consumed"
        record.node_id = node_id
        record.consumed_at = datetime.now(UTC)
        await self.session.flush()
        return record
