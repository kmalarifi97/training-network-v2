from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.node import Node
from app.models.user import User


class NodeRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        user_id: UUID,
        name: str,
        gpu_model: str,
        gpu_memory_gb: int,
        gpu_count: int,
        status: str = "online",
        agent_token_prefix: str | None = None,
        agent_token_hash: str | None = None,
        last_seen_at: datetime | None = None,
    ) -> Node:
        node = Node(
            user_id=user_id,
            name=name,
            gpu_model=gpu_model,
            gpu_memory_gb=gpu_memory_gb,
            gpu_count=gpu_count,
            status=status,
            agent_token_prefix=agent_token_prefix,
            agent_token_hash=agent_token_hash,
            last_seen_at=last_seen_at,
        )
        self.session.add(node)
        await self.session.flush()
        return node

    async def list_for_user(self, user_id: UUID) -> list[Node]:
        result = await self.session.execute(
            select(Node)
            .where(Node.user_id == user_id)
            .order_by(Node.created_at.desc())
        )
        return list(result.scalars().all())

    async def list_all_with_owner_email(self) -> list[tuple[Node, str]]:
        result = await self.session.execute(
            select(Node, User.email)
            .join(User, Node.user_id == User.id)
            .order_by(Node.created_at.desc())
        )
        return [(row[0], row[1]) for row in result.all()]

    async def get_by_id(self, node_id: UUID) -> Node | None:
        result = await self.session.execute(select(Node).where(Node.id == node_id))
        return result.scalar_one_or_none()

    async def get_by_agent_prefix(self, prefix: str) -> Node | None:
        result = await self.session.execute(
            select(Node).where(Node.agent_token_prefix == prefix)
        )
        return result.scalar_one_or_none()

    async def update_last_seen(self, node: Node) -> Node:
        node.last_seen_at = datetime.now(UTC)
        await self.session.flush()
        return node

    async def set_status(self, node: Node, status: str) -> Node:
        node.status = status
        await self.session.flush()
        return node

    async def revoke_agent_token(self, node: Node) -> Node:
        node.agent_token_hash = None
        await self.session.flush()
        return node

    async def delete(self, node: Node) -> None:
        await self.session.delete(node)
        await self.session.flush()
