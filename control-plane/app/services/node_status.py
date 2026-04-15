from datetime import datetime

from app.models.node import Node

NODE_HEARTBEAT_TIMEOUT_SECONDS = 60


def compute_node_status(node: Node, now: datetime) -> str:
    """Map stored status + last_seen_at into the API-visible state.

    Stored 'draining' is sticky and wins over heartbeat freshness so a draining
    node never silently flips back to 'online' just because its agent kept
    pinging. Otherwise we look at last_seen_at: fresher than 60s means online.
    """
    if node.status == "draining":
        return "draining"
    if node.last_seen_at is None:
        return "offline"
    age = (now - node.last_seen_at).total_seconds()
    if age <= NODE_HEARTBEAT_TIMEOUT_SECONDS:
        return "online"
    return "offline"
