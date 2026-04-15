from datetime import datetime
from uuid import UUID

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, func
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class NodeMetric(Base):
    __tablename__ = "node_metrics"

    node_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("nodes.id", ondelete="CASCADE"),
        primary_key=True,
    )
    gpu_index: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilization_pct: Mapped[int] = mapped_column(Integer, nullable=False)
    memory_used_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    memory_total_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    temperature_c: Mapped[int] = mapped_column(Integer, nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
