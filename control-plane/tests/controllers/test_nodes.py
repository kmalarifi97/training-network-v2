from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select, update

from app.db import SessionLocal
from app.models.audit_log import AuditLog
from app.models.claim_token import ClaimToken
from tests.helpers import (
    auth_headers,
    login,
    make_active_user,
    set_user_flags,
    signup,
)


async def make_host(client, email: str) -> tuple[str, str]:
    user = await signup(client, email)
    await set_user_flags(email, status="active", can_host=True)
    token = await login(client, email)
    return user["id"], token


async def test_create_claim_token_requires_auth(client):
    r = await client.post("/api/nodes/claim-tokens")
    assert r.status_code == 401


async def test_create_claim_token_requires_can_host(client):
    _, token = await make_active_user(client, "norent@example.com", can_host=False)
    r = await client.post("/api/nodes/claim-tokens", headers=auth_headers(token))
    assert r.status_code == 403


async def test_host_creates_claim_token(client):
    host_id, token = await make_host(client, "host@example.com")
    r = await client.post("/api/nodes/claim-tokens", headers=auth_headers(token))

    assert r.status_code == 201, r.text
    body = r.json()
    assert body["token"].startswith("gpuclaim_")
    assert body["prefix"] == body["token"][:12]
    assert "--claim-token=" in body["install_command"]
    assert body["token"] in body["install_command"]
    assert datetime.fromisoformat(body["expires_at"]) > datetime.now(UTC)


async def test_register_node_with_valid_claim_token(client):
    host_id, token = await make_host(client, "host@example.com")
    claim = await client.post(
        "/api/nodes/claim-tokens", headers=auth_headers(token)
    )
    claim_body = claim.json()

    register = await client.post(
        "/api/nodes/register",
        json={
            "claim_token": claim_body["token"],
            "gpu_model": "NVIDIA RTX 4090",
            "gpu_memory_gb": 24,
            "gpu_count": 2,
        },
    )
    assert register.status_code == 201, register.text
    body = register.json()
    assert body["node_id"]
    assert body["config_payload"]["node_id"] == body["node_id"]
    assert "control_plane_url" in body["config_payload"]

    nodes = await client.get("/api/nodes", headers=auth_headers(token))
    assert nodes.status_code == 200
    items = nodes.json()
    assert len(items) == 1
    n = items[0]
    assert n["gpu_model"] == "NVIDIA RTX 4090"
    assert n["gpu_count"] == 2
    assert n["gpu_memory_gb"] == 24
    assert n["status"] == "online"
    assert n["name"].startswith("node-")


async def test_register_node_with_suggested_name(client):
    _, token = await make_host(client, "host@example.com")
    claim = await client.post(
        "/api/nodes/claim-tokens", headers=auth_headers(token)
    )
    await client.post(
        "/api/nodes/register",
        json={
            "claim_token": claim.json()["token"],
            "gpu_model": "A100",
            "gpu_memory_gb": 80,
            "gpu_count": 1,
            "suggested_name": "lab-rig-01",
        },
    )
    nodes = await client.get("/api/nodes", headers=auth_headers(token))
    assert nodes.json()[0]["name"] == "lab-rig-01"


async def test_register_node_consumes_token_single_use(client):
    _, token = await make_host(client, "host@example.com")
    claim = await client.post(
        "/api/nodes/claim-tokens", headers=auth_headers(token)
    )
    plain = claim.json()["token"]

    first = await client.post(
        "/api/nodes/register",
        json={
            "claim_token": plain,
            "gpu_model": "A100",
            "gpu_memory_gb": 80,
            "gpu_count": 1,
        },
    )
    assert first.status_code == 201

    second = await client.post(
        "/api/nodes/register",
        json={
            "claim_token": plain,
            "gpu_model": "A100",
            "gpu_memory_gb": 80,
            "gpu_count": 1,
        },
    )
    assert second.status_code == 400
    assert "already used" in second.json()["detail"].lower()


async def test_register_node_with_invalid_token(client):
    r = await client.post(
        "/api/nodes/register",
        json={
            "claim_token": "gpuclaim_not_a_real_token_at_all_xxxxxx",
            "gpu_model": "A100",
            "gpu_memory_gb": 80,
            "gpu_count": 1,
        },
    )
    assert r.status_code == 400
    assert "unknown" in r.json()["detail"].lower()


async def test_register_node_with_expired_token(client):
    _, token = await make_host(client, "host@example.com")
    claim = await client.post(
        "/api/nodes/claim-tokens", headers=auth_headers(token)
    )
    plain = claim.json()["token"]
    prefix = claim.json()["prefix"]

    async with SessionLocal() as session:
        await session.execute(
            update(ClaimToken)
            .where(ClaimToken.prefix == prefix)
            .values(expires_at=datetime.now(UTC) - timedelta(hours=1))
        )
        await session.commit()

    r = await client.post(
        "/api/nodes/register",
        json={
            "claim_token": plain,
            "gpu_model": "A100",
            "gpu_memory_gb": 80,
            "gpu_count": 1,
        },
    )
    assert r.status_code == 400
    assert "expired" in r.json()["detail"].lower()


async def test_list_nodes_shows_only_own(client):
    _, alice_token = await make_host(client, "alice@example.com")
    _, bob_token = await make_host(client, "bob@example.com")

    claim_a = await client.post(
        "/api/nodes/claim-tokens", headers=auth_headers(alice_token)
    )
    await client.post(
        "/api/nodes/register",
        json={
            "claim_token": claim_a.json()["token"],
            "gpu_model": "A",
            "gpu_memory_gb": 8,
            "gpu_count": 1,
            "suggested_name": "alice-node",
        },
    )
    claim_b = await client.post(
        "/api/nodes/claim-tokens", headers=auth_headers(bob_token)
    )
    await client.post(
        "/api/nodes/register",
        json={
            "claim_token": claim_b.json()["token"],
            "gpu_model": "B",
            "gpu_memory_gb": 16,
            "gpu_count": 1,
            "suggested_name": "bob-node",
        },
    )

    alice_nodes = await client.get("/api/nodes", headers=auth_headers(alice_token))
    names = [n["name"] for n in alice_nodes.json()]
    assert names == ["alice-node"]


async def test_register_node_emits_audit(client):
    host_id, token = await make_host(client, "host@example.com")
    claim = await client.post(
        "/api/nodes/claim-tokens", headers=auth_headers(token)
    )
    register = await client.post(
        "/api/nodes/register",
        json={
            "claim_token": claim.json()["token"],
            "gpu_model": "A100",
            "gpu_memory_gb": 80,
            "gpu_count": 4,
        },
    )
    node_id = register.json()["node_id"]

    async with SessionLocal() as session:
        result = await session.execute(
            select(AuditLog)
            .where(AuditLog.event_type == "node.registered")
            .where(AuditLog.user_id == UUID(host_id))
        )
        events = list(result.scalars().all())

    assert len(events) == 1
    ev = events[0]
    assert ev.event_data["node_id"] == node_id
    assert ev.event_data["gpu_model"] == "A100"
    assert ev.event_data["gpu_count"] == 4


async def test_claim_token_can_be_used_by_anyone_who_has_it(client):
    """Registration endpoint is unauthenticated — the token itself is the auth."""
    _, host_token = await make_host(client, "host@example.com")
    claim = await client.post(
        "/api/nodes/claim-tokens", headers=auth_headers(host_token)
    )
    plain = claim.json()["token"]

    r = await client.post(
        "/api/nodes/register",
        json={
            "claim_token": plain,
            "gpu_model": "X",
            "gpu_memory_gb": 8,
            "gpu_count": 1,
        },
    )
    assert r.status_code == 201


async def test_claim_token_register_rejects_invalid_prefix(client):
    r = await client.post(
        "/api/nodes/register",
        json={
            "claim_token": "wrong_prefix_xxxxxxxxxxx",
            "gpu_model": "X",
            "gpu_memory_gb": 8,
            "gpu_count": 1,
        },
    )
    assert r.status_code == 400
