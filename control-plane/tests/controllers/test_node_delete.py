from uuid import UUID

from sqlalchemy import select

from app.db import SessionLocal
from app.models.audit_log import AuditLog
from tests.helpers import auth_headers, login, make_active_user, set_user_flags, signup


async def make_host(client, email: str) -> tuple[str, str]:
    user = await signup(client, email)
    await set_user_flags(email, status="active", can_host=True)
    token = await login(client, email)
    return user["id"], token


async def register_node(client, host_token: str, *, name: str | None = None):
    claim = await client.post(
        "/api/nodes/claim-tokens", headers=auth_headers(host_token)
    )
    payload = {
        "claim_token": claim.json()["token"],
        "gpu_model": "A100",
        "gpu_memory_gb": 80,
        "gpu_count": 1,
    }
    if name:
        payload["suggested_name"] = name
    r = await client.post("/api/nodes/register", json=payload)
    return r.json()


async def submit_job(client, owner_token, **overrides):
    body = {
        "docker_image": "ubuntu:latest",
        "command": ["echo"],
        "gpu_count": 1,
        "max_duration_seconds": 60,
    }
    body.update(overrides)
    r = await client.post(
        "/api/jobs", headers=auth_headers(owner_token), json=body
    )
    return r.json()


async def test_delete_without_auth_returns_401(client):
    r = await client.delete("/api/nodes/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 401


async def test_delete_unknown_node_returns_404(client):
    _, host_token = await make_host(client, "host@example.com")
    r = await client.delete(
        "/api/nodes/00000000-0000-0000-0000-000000000000",
        headers=auth_headers(host_token),
    )
    assert r.status_code == 404


async def test_delete_other_users_node_returns_404(client):
    _, alice_token = await make_host(client, "alice@example.com")
    _, bob_token = await make_host(client, "bob@example.com")
    node = await register_node(client, alice_token)
    r = await client.delete(
        f"/api/nodes/{node['node_id']}", headers=auth_headers(bob_token)
    )
    assert r.status_code == 404


async def test_delete_idle_node_succeeds_and_emits_audit(client):
    user_id, host_token = await make_host(client, "host@example.com")
    node = await register_node(client, host_token)
    r = await client.delete(
        f"/api/nodes/{node['node_id']}", headers=auth_headers(host_token)
    )
    assert r.status_code == 204

    # Node should no longer appear in list
    nodes = await client.get("/api/nodes", headers=auth_headers(host_token))
    assert nodes.json() == []

    async with SessionLocal() as session:
        result = await session.execute(
            select(AuditLog)
            .where(AuditLog.user_id == UUID(user_id))
            .where(AuditLog.event_type == "node.removed")
        )
        events = list(result.scalars().all())
    assert len(events) == 1
    assert events[0].event_data["node_id"] == node["node_id"]
    assert events[0].event_data["actor_email"] == "host@example.com"


async def test_delete_drained_node_succeeds(client):
    _, host_token = await make_host(client, "host@example.com")
    node = await register_node(client, host_token)
    await client.post(
        f"/api/nodes/{node['node_id']}/drain",
        headers=auth_headers(host_token),
    )
    r = await client.delete(
        f"/api/nodes/{node['node_id']}", headers=auth_headers(host_token)
    )
    assert r.status_code == 204


async def test_delete_with_running_job_returns_409(client):
    _, owner_token = await make_active_user(
        client, "renter@example.com", credits_gpu_hours=10
    )
    await submit_job(client, owner_token)
    _, host_token = await make_host(client, "host@example.com")
    node = await register_node(client, host_token)
    await client.post(
        "/api/jobs/claim", headers=auth_headers(node["agent_token"])
    )

    r = await client.delete(
        f"/api/nodes/{node['node_id']}", headers=auth_headers(host_token)
    )
    assert r.status_code == 409
    body = r.json()
    assert body["node_id"] == node["node_id"]
    assert "drain" in body["detail"].lower()


async def test_agent_token_after_delete_returns_401(client):
    _, host_token = await make_host(client, "host@example.com")
    node = await register_node(client, host_token)
    agent_token = node["agent_token"]

    # Heartbeat works before delete.
    pre = await client.post(
        f"/api/nodes/{node['node_id']}/heartbeat",
        json={},
        headers=auth_headers(agent_token),
    )
    assert pre.status_code == 200

    await client.delete(
        f"/api/nodes/{node['node_id']}", headers=auth_headers(host_token)
    )

    # After delete, the same token cannot authenticate any agent endpoint.
    after = await client.post(
        f"/api/nodes/{node['node_id']}/heartbeat",
        json={},
        headers=auth_headers(agent_token),
    )
    assert after.status_code == 401

    claim = await client.post(
        "/api/jobs/claim", headers=auth_headers(agent_token)
    )
    assert claim.status_code == 401
