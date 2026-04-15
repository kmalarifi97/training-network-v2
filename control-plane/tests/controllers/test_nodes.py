from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select, update

from app.db import SessionLocal
from app.models.audit_log import AuditLog
from app.models.claim_token import ClaimToken
from app.models.node import Node
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


async def register_node_for(
    client,
    host_token: str,
    *,
    gpu_model: str = "A100",
    gpu_memory_gb: int = 80,
    gpu_count: int = 1,
    suggested_name: str | None = None,
) -> dict:
    claim = await client.post(
        "/api/nodes/claim-tokens", headers=auth_headers(host_token)
    )
    payload = {
        "claim_token": claim.json()["token"],
        "gpu_model": gpu_model,
        "gpu_memory_gb": gpu_memory_gb,
        "gpu_count": gpu_count,
    }
    if suggested_name is not None:
        payload["suggested_name"] = suggested_name
    register = await client.post("/api/nodes/register", json=payload)
    assert register.status_code == 201, register.text
    return register.json()


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


# --- H3: agent token + heartbeat + node detail ----------------------------------


async def test_register_returns_agent_token_plaintext(client):
    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token)
    assert body["agent_token"].startswith("gpuagent_")
    assert body["config_payload"]["agent_token"] == body["agent_token"]


async def test_node_detail_as_owner_returns_full(client):
    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token, suggested_name="rig-1")
    node_id = body["node_id"]

    detail = await client.get(
        f"/api/nodes/{node_id}", headers=auth_headers(host_token)
    )
    assert detail.status_code == 200, detail.text
    d = detail.json()
    assert d["id"] == node_id
    assert d["name"] == "rig-1"
    assert d["status"] == "online"
    assert d["last_seen_at"] is not None
    assert d["current_job_id"] is None


async def test_node_detail_as_other_user_returns_404(client):
    _, alice_token = await make_host(client, "alice@example.com")
    _, bob_token = await make_host(client, "bob@example.com")
    body = await register_node_for(client, alice_token)
    node_id = body["node_id"]

    detail = await client.get(
        f"/api/nodes/{node_id}", headers=auth_headers(bob_token)
    )
    assert detail.status_code == 404


async def test_node_detail_unknown_returns_404(client):
    _, host_token = await make_host(client, "host@example.com")
    detail = await client.get(
        "/api/nodes/00000000-0000-0000-0000-000000000000",
        headers=auth_headers(host_token),
    )
    assert detail.status_code == 404


async def test_node_detail_without_token_returns_401(client):
    detail = await client.get(
        "/api/nodes/00000000-0000-0000-0000-000000000000"
    )
    assert detail.status_code == 401


async def test_node_status_offline_when_last_seen_is_stale(client):
    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token)
    node_id = body["node_id"]

    async with SessionLocal() as session:
        await session.execute(
            update(Node)
            .where(Node.id == UUID(node_id))
            .values(last_seen_at=datetime.now(UTC) - timedelta(seconds=120))
        )
        await session.commit()

    detail = await client.get(
        f"/api/nodes/{node_id}", headers=auth_headers(host_token)
    )
    assert detail.json()["status"] == "offline"


async def test_heartbeat_without_token_returns_401(client):
    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token)
    r = await client.post(f"/api/nodes/{body['node_id']}/heartbeat", json={})
    assert r.status_code == 401


async def test_heartbeat_with_user_jwt_returns_401(client):
    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token)
    r = await client.post(
        f"/api/nodes/{body['node_id']}/heartbeat",
        json={},
        headers=auth_headers(host_token),
    )
    assert r.status_code == 401


async def test_heartbeat_with_garbage_agent_token_returns_401(client):
    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token)
    r = await client.post(
        f"/api/nodes/{body['node_id']}/heartbeat",
        json={},
        headers=auth_headers("gpuagent_not_a_real_token_at_all_xxxxxx"),
    )
    assert r.status_code == 401


async def test_heartbeat_updates_last_seen_at(client):
    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token)
    node_id = body["node_id"]
    agent_token = body["agent_token"]

    async with SessionLocal() as session:
        await session.execute(
            update(Node)
            .where(Node.id == UUID(node_id))
            .values(last_seen_at=datetime.now(UTC) - timedelta(seconds=300))
        )
        await session.commit()

    r = await client.post(
        f"/api/nodes/{node_id}/heartbeat",
        json={},
        headers=auth_headers(agent_token),
    )
    assert r.status_code == 200, r.text
    received = datetime.fromisoformat(r.json()["received_at"])
    assert received <= datetime.now(UTC)

    detail = await client.get(
        f"/api/nodes/{node_id}", headers=auth_headers(host_token)
    )
    assert detail.json()["status"] == "online"


async def test_heartbeat_with_other_nodes_token_returns_403(client):
    _, host_token = await make_host(client, "host@example.com")
    a = await register_node_for(client, host_token, suggested_name="a")
    b = await register_node_for(client, host_token, suggested_name="b")

    r = await client.post(
        f"/api/nodes/{a['node_id']}/heartbeat",
        json={},
        headers=auth_headers(b["agent_token"]),
    )
    assert r.status_code == 403


async def test_node_detail_includes_current_job_id_when_running(client):
    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token)
    node_id = body["node_id"]

    _, renter_token = await make_active_user(
        client, "renter@example.com", credits_gpu_hours=10
    )
    submit = await client.post(
        "/api/jobs",
        headers=auth_headers(renter_token),
        json={
            "docker_image": "ubuntu:latest",
            "command": ["echo", "hi"],
            "gpu_count": 1,
            "max_duration_seconds": 60,
        },
    )
    job_id = submit.json()["id"]

    # Manually pin the job to this node in 'running' state to simulate the
    # scheduler pre-assignment; the scheduler endpoint itself ships in a later
    # commit but the detail surface should reflect any currently running job.
    from app.models.job import Job

    async with SessionLocal() as session:
        await session.execute(
            update(Job)
            .where(Job.id == UUID(job_id))
            .values(
                status="running",
                assigned_node_id=UUID(node_id),
                started_at=datetime.now(UTC),
            )
        )
        await session.commit()

    detail = await client.get(
        f"/api/nodes/{node_id}", headers=auth_headers(host_token)
    )
    assert detail.json()["current_job_id"] == job_id


async def test_list_nodes_uses_computed_status(client):
    _, host_token = await make_host(client, "host@example.com")
    a = await register_node_for(client, host_token, suggested_name="fresh")
    b = await register_node_for(client, host_token, suggested_name="stale")
    async with SessionLocal() as session:
        await session.execute(
            update(Node)
            .where(Node.id == UUID(b["node_id"]))
            .values(last_seen_at=datetime.now(UTC) - timedelta(seconds=300))
        )
        await session.commit()

    nodes = await client.get("/api/nodes", headers=auth_headers(host_token))
    by_name = {n["name"]: n for n in nodes.json()}
    assert by_name["fresh"]["status"] == "online"
    assert by_name["stale"]["status"] == "offline"
