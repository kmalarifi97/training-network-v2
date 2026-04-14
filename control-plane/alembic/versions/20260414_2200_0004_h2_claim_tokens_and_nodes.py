"""H2: claim_tokens and nodes

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-14

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "claim_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("prefix", sa.String(12), nullable=False),
        sa.Column("token_hash", sa.String(255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("prefix", name="uq_claim_tokens_prefix"),
    )
    op.create_index("ix_claim_tokens_user_id", "claim_tokens", ["user_id"])

    op.create_table(
        "nodes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("gpu_model", sa.String(100), nullable=False),
        sa.Column("gpu_memory_gb", sa.Integer(), nullable=False),
        sa.Column("gpu_count", sa.Integer(), nullable=False),
        sa.Column(
            "status", sa.String(20), nullable=False, server_default="offline"
        ),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_nodes_user_id", "nodes", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_nodes_user_id", table_name="nodes")
    op.drop_table("nodes")
    op.drop_index("ix_claim_tokens_user_id", table_name="claim_tokens")
    op.drop_table("claim_tokens")
