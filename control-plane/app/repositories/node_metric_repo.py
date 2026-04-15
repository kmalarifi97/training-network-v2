from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.node_metric import NodeMetric


class NodeMetricRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def upsert_samples(
        self, node_id: UUID, samples: list[dict]
    ) -> None:
        if not samples:
            return
        now = datetime.now(UTC)
        rows = [
            {
                "node_id": node_id,
                "gpu_index": s["gpu_index"],
                "utilization_pct": s["utilization_pct"],
                "memory_used_bytes": s["memory_used_bytes"],
                "memory_total_bytes": s["memory_total_bytes"],
                "temperature_c": s["temperature_c"],
                "recorded_at": now,
            }
            for s in samples
        ]
        stmt = pg_insert(NodeMetric).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=["node_id", "gpu_index"],
            set_={
                "utilization_pct": stmt.excluded.utilization_pct,
                "memory_used_bytes": stmt.excluded.memory_used_bytes,
                "memory_total_bytes": stmt.excluded.memory_total_bytes,
                "temperature_c": stmt.excluded.temperature_c,
                "recorded_at": stmt.excluded.recorded_at,
            },
        )
        await self.session.execute(stmt)
        await self.session.flush()

    async def list_all(self) -> list[NodeMetric]:
        result = await self.session.execute(select(NodeMetric))
        return list(result.scalars().all())
