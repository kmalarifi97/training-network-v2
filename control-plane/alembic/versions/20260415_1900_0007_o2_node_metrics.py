"""O2: node_metrics table

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-15

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "node_metrics",
        sa.Column(
            "node_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("nodes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("gpu_index", sa.Integer(), nullable=False),
        sa.Column("utilization_pct", sa.Integer(), nullable=False),
        sa.Column("memory_used_bytes", sa.BigInteger(), nullable=False),
        sa.Column("memory_total_bytes", sa.BigInteger(), nullable=False),
        sa.Column("temperature_c", sa.Integer(), nullable=False),
        sa.Column(
            "recorded_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("node_id", "gpu_index"),
    )


def downgrade() -> None:
    op.drop_table("node_metrics")
