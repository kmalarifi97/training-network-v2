from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import update

from app.db import SessionLocal
from app.models.node import Node
from tests.controllers.test_nodes import make_host, register_node_for
from tests.helpers import auth_headers, make_active_user


async def test_marketplace_requires_auth(client):
    r = await client.get("/api/nodes/marketplace")
    assert r.status_code == 401


async def test_marketplace_rejects_agent_token(client):
    # Register a node so we have an agent token, then try to use it on a
    # user-scoped endpoint; CurrentUser dep should reject the gpuagent_ prefix.
    _, host_token = await make_host(client, "host@example.com")
    register_body = await register_node_for(client, host_token)
    agent_token = register_body["agent_token"]

    r = await client.get(
        "/api/nodes/marketplace", headers=auth_headers(agent_token)
    )
    assert r.status_code == 401


async def test_marketplace_empty_when_no_nodes(client):
    _, token = await make_active_user(client, "renter@example.com")
    r = await client.get("/api/nodes/marketplace", headers=auth_headers(token))
    assert r.status_code == 200
    assert r.json() == []


async def test_marketplace_lists_online_node_from_another_host(client):
    # Host A registers a node (becomes online because register sets last_seen_at).
    _, host_a_token = await make_host(client, "ahmad.ml@example.com")
    register_body = await register_node_for(
        client, host_a_token, gpu_model="RTX 4090", gpu_memory_gb=24,
        suggested_name="ahmad-tower",
    )

    # Renter B browses the marketplace and sees Ahmad's node.
    _, renter_token = await make_active_user(client, "renter@example.com")
    r = await client.get(
        "/api/nodes/marketplace", headers=auth_headers(renter_token)
    )
    assert r.status_code == 200

    items = r.json()
    assert len(items) == 1
    node = items[0]
    assert node["id"] == register_body["node_id"]
    assert node["host_handle"] == "@ahmad.ml"
    assert node["status"] == "online"
    assert node["gpu_model"] == "RTX 4090"
    assert node["gpu_memory_gb"] == 24


async def test_marketplace_excludes_offline_nodes(client):
    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token)

    async with SessionLocal() as session:
        await session.execute(
            update(Node)
            .where(Node.id == UUID(body["node_id"]))
            .values(last_seen_at=datetime.now(UTC) - timedelta(seconds=300))
        )
        await session.commit()

    _, renter_token = await make_active_user(client, "renter@example.com")
    r = await client.get(
        "/api/nodes/marketplace", headers=auth_headers(renter_token)
    )
    assert r.status_code == 200
    assert r.json() == []


async def test_marketplace_excludes_draining_nodes(client):
    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token)

    async with SessionLocal() as session:
        await session.execute(
            update(Node)
            .where(Node.id == UUID(body["node_id"]))
            .values(status="draining")
        )
        await session.commit()

    _, renter_token = await make_active_user(client, "renter@example.com")
    r = await client.get(
        "/api/nodes/marketplace", headers=auth_headers(renter_token)
    )
    assert r.status_code == 200
    assert r.json() == []


async def test_marketplace_lists_nodes_from_multiple_hosts(client):
    _, host_a_token = await make_host(client, "ahmad@example.com")
    await register_node_for(
        client, host_a_token, gpu_model="RTX 3090", suggested_name="ahmad-rig"
    )

    _, host_b_token = await make_host(client, "sara.mlops@kaust.edu.sa")
    await register_node_for(
        client, host_b_token, gpu_model="A100", gpu_memory_gb=80,
        suggested_name="sara-lab",
    )

    _, renter_token = await make_active_user(client, "renter@example.com")
    r = await client.get(
        "/api/nodes/marketplace", headers=auth_headers(renter_token)
    )
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 2
    handles = {n["host_handle"] for n in items}
    assert handles == {"@ahmad", "@sara.mlops"}
