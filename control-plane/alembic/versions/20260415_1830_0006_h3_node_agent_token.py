"""H3: agent token + heartbeat fields on nodes

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-15

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "nodes",
        sa.Column("agent_token_hash", sa.String(255), nullable=True),
    )
    op.add_column(
        "nodes",
        sa.Column("agent_token_prefix", sa.String(12), nullable=True),
    )
    op.create_unique_constraint(
        "uq_nodes_agent_token_prefix", "nodes", ["agent_token_prefix"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_nodes_agent_token_prefix", "nodes", type_="unique")
    op.drop_column("nodes", "agent_token_prefix")
    op.drop_column("nodes", "agent_token_hash")
