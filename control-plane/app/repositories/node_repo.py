from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.node import Node


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
    ) -> Node:
        node = Node(
            user_id=user_id,
            name=name,
            gpu_model=gpu_model,
            gpu_memory_gb=gpu_memory_gb,
            gpu_count=gpu_count,
            status=status,
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
