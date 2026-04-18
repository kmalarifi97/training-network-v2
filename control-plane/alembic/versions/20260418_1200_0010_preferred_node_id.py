"""preferred_node_id on jobs — lets a renter pin a job to a specific node

Revision ID: 0010
Revises: 0009
Create Date: 2026-04-18

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column(
            "preferred_node_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("nodes.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_jobs_preferred_node_id", "jobs", ["preferred_node_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_jobs_preferred_node_id", table_name="jobs")
    op.drop_column("jobs", "preferred_node_id")
