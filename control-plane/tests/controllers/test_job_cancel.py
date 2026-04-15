from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select, update

from app.db import SessionLocal
from app.models.audit_log import AuditLog
from app.models.job import Job
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
    assert r.status_code == 201
    return r.json()


async def test_cancel_without_auth_returns_401(client):
    r = await client.post(
        "/api/jobs/00000000-0000-0000-0000-000000000000/cancel"
    )
    assert r.status_code == 401


async def test_cancel_as_non_owner_returns_404(client):
    _, alice_token = await make_active_user(
        client, "alice@example.com", credits_gpu_hours=10
    )
    _, bob_token = await make_active_user(
        client, "bob@example.com", credits_gpu_hours=10
    )
    job = await submit_job(client, alice_token)
    r = await client.post(
        f"/api/jobs/{job['id']}/cancel",
        headers=auth_headers(bob_token),
    )
    assert r.status_code == 404


async def test_cancel_unknown_job_returns_404(client):
    _, token = await make_active_user(
        client, "alice@example.com", credits_gpu_hours=10
    )
    r = await client.post(
        "/api/jobs/00000000-0000-0000-0000-000000000000/cancel",
        headers=auth_headers(token),
    )
    assert r.status_code == 404


async def test_cancel_queued_job_immediately_cancels(client):
    user_id, token = await make_active_user(
        client, "alice@example.com", credits_gpu_hours=10
    )
    job = await submit_job(client, token)
    r = await client.post(
        f"/api/jobs/{job['id']}/cancel", headers=auth_headers(token)
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "cancelled"
    assert body["completed_at"] is not None
    assert body["error_message"] == "cancelled by user"

    async with SessionLocal() as session:
        result = await session.execute(
            select(AuditLog)
            .where(AuditLog.user_id == UUID(user_id))
            .where(AuditLog.event_type == "job.cancelled")
        )
        events = list(result.scalars().all())
    assert len(events) == 1
    assert events[0].event_data["phase"] == "queued"


async def test_cancel_running_job_marks_request_only(client):
    user_id, owner_token = await make_active_user(
        client, "alice@example.com", credits_gpu_hours=10
    )
    job = await submit_job(client, owner_token)
    _, host_token = await make_host(client, "host@example.com")
    node = await register_node(client, host_token)
    await client.post("/api/jobs/claim", headers=auth_headers(node["agent_token"]))

    r = await client.post(
        f"/api/jobs/{job['id']}/cancel", headers=auth_headers(owner_token)
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "running"  # still running until agent acks

    async with SessionLocal() as session:
        result = await session.execute(select(Job).where(Job.id == UUID(job["id"])))
        row = result.scalar_one()
    assert row.cancel_requested_at is not None


async def test_heartbeat_returns_cancel_job_id_when_requested(client):
    _, owner_token = await make_active_user(
        client, "alice@example.com", credits_gpu_hours=10
    )
    job = await submit_job(client, owner_token)
    _, host_token = await make_host(client, "host@example.com")
    node = await register_node(client, host_token)
    await client.post("/api/jobs/claim", headers=auth_headers(node["agent_token"]))
    await client.post(
        f"/api/jobs/{job['id']}/cancel", headers=auth_headers(owner_token)
    )

    r = await client.post(
        f"/api/nodes/{node['node_id']}/heartbeat",
        json={},
        headers=auth_headers(node["agent_token"]),
    )
    assert r.status_code == 200
    assert r.json()["cancel_job_id"] == job["id"]


async def test_heartbeat_no_cancel_signal_when_no_request(client):
    _, owner_token = await make_active_user(
        client, "alice@example.com", credits_gpu_hours=10
    )
    await submit_job(client, owner_token)
    _, host_token = await make_host(client, "host@example.com")
    node = await register_node(client, host_token)
    await client.post("/api/jobs/claim", headers=auth_headers(node["agent_token"]))

    r = await client.post(
        f"/api/nodes/{node['node_id']}/heartbeat",
        json={},
        headers=auth_headers(node["agent_token"]),
    )
    assert r.status_code == 200
    assert r.json()["cancel_job_id"] is None


async def test_complete_after_cancel_request_marks_cancelled(client):
    _, owner_token = await make_active_user(
        client, "alice@example.com", credits_gpu_hours=10
    )
    job = await submit_job(client, owner_token)
    _, host_token = await make_host(client, "host@example.com")
    node = await register_node(client, host_token)
    await client.post("/api/jobs/claim", headers=auth_headers(node["agent_token"]))
    await client.post(
        f"/api/jobs/{job['id']}/cancel", headers=auth_headers(owner_token)
    )
    r = await client.post(
        f"/api/jobs/{job['id']}/complete",
        headers=auth_headers(node["agent_token"]),
        json={"exit_code": -1, "error_message": "cancelled by user"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"


async def test_cancel_already_completed_job_returns_409(client):
    _, owner_token = await make_active_user(
        client, "alice@example.com", credits_gpu_hours=10
    )
    job = await submit_job(client, owner_token)
    _, host_token = await make_host(client, "host@example.com")
    node = await register_node(client, host_token)
    await client.post("/api/jobs/claim", headers=auth_headers(node["agent_token"]))
    await client.post(
        f"/api/jobs/{job['id']}/complete",
        headers=auth_headers(node["agent_token"]),
        json={"exit_code": 0},
    )

    r = await client.post(
        f"/api/jobs/{job['id']}/cancel", headers=auth_headers(owner_token)
    )
    assert r.status_code == 409


async def test_cancel_already_cancelled_returns_409(client):
    _, owner_token = await make_active_user(
        client, "alice@example.com", credits_gpu_hours=10
    )
    job = await submit_job(client, owner_token)
    await client.post(
        f"/api/jobs/{job['id']}/cancel", headers=auth_headers(owner_token)
    )
    r = await client.post(
        f"/api/jobs/{job['id']}/cancel", headers=auth_headers(owner_token)
    )
    assert r.status_code == 409
