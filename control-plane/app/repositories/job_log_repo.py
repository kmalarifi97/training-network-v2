from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job_log import JobLog


class JobLogRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def append(
        self, job_id: UUID, entries: list[dict]
    ) -> int:
        """Insert a batch, deduping on (job_id, sequence). Returns count of
        rows actually persisted (entries with previously-seen sequences are
        silently dropped)."""
        if not entries:
            return 0
        rows = [
            {
                "id": uuid4(),
                "job_id": job_id,
                "stream": e["stream"],
                "content": e["content"],
                "sequence": e["sequence"],
            }
            for e in entries
        ]
        stmt = pg_insert(JobLog).values(rows)
        stmt = stmt.on_conflict_do_nothing(index_elements=["job_id", "sequence"])
        result = await self.session.execute(stmt)
        await self.session.flush()
        return result.rowcount or 0

    async def list_after(
        self, job_id: UUID, after_sequence: int, limit: int
    ) -> list[JobLog]:
        result = await self.session.execute(
            select(JobLog)
            .where(JobLog.job_id == job_id)
            .where(JobLog.sequence > after_sequence)
            .order_by(JobLog.sequence.asc())
            .limit(limit)
        )
        return list(result.scalars().all())
