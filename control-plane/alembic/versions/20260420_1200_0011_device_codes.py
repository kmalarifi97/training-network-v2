"""Device-code onboarding: browser-approved bridge from agent to user.

Revision ID: 0011
Revises: 0010
Create Date: 2026-04-20

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "device_codes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(16), nullable=False),
        sa.Column("polling_prefix", sa.String(12), nullable=False),
        sa.Column("polling_hash", sa.String(255), nullable=False),
        sa.Column("gpu_model", sa.String(100), nullable=False),
        sa.Column("gpu_memory_gb", sa.Integer(), nullable=False),
        sa.Column("gpu_count", sa.Integer(), nullable=False),
        sa.Column(
            "status", sa.String(20), nullable=False, server_default="pending"
        ),
        sa.Column(
            "approved_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "node_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("nodes.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("code", name="uq_device_codes_code"),
        sa.UniqueConstraint("polling_prefix", name="uq_device_codes_polling_prefix"),
    )
    op.create_index(
        "ix_device_codes_approved_by_user_id",
        "device_codes",
        ["approved_by_user_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_device_codes_approved_by_user_id", table_name="device_codes"
    )
    op.drop_table("device_codes")
