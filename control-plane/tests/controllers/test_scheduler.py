import asyncio
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select, update

from app.db import SessionLocal
from app.models.audit_log import AuditLog
from app.models.job import Job
from app.models.node import Node
from tests.helpers import auth_headers, login, make_active_user, set_user_flags, signup


async def make_host(client, email: str) -> tuple[str, str]:
    user = await signup(client, email)
    await set_user_flags(email, status="active", can_host=True)
    token = await login(client, email)
    return user["id"], token


async def register_node_for(
    client,
    host_token: str,
    *,
    gpu_count: int = 1,
    suggested_name: str | None = None,
) -> dict:
    claim = await client.post(
        "/api/nodes/claim-tokens", headers=auth_headers(host_token)
    )
    payload = {
        "claim_token": claim.json()["token"],
        "gpu_model": "A100",
        "gpu_memory_gb": 80,
        "gpu_count": gpu_count,
    }
    if suggested_name:
        payload["suggested_name"] = suggested_name
    r = await client.post("/api/nodes/register", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


async def submit_job(client, renter_token, **overrides):
    body = {
        "docker_image": "ubuntu:latest",
        "command": ["echo", "hi"],
        "gpu_count": 1,
        "max_duration_seconds": 60,
    }
    body.update(overrides)
    r = await client.post(
        "/api/jobs", headers=auth_headers(renter_token), json=body
    )
    assert r.status_code == 201, r.text
    return r.json()


async def test_claim_without_token_returns_401(client):
    r = await client.post("/api/jobs/claim")
    assert r.status_code == 401


async def test_claim_with_user_jwt_returns_401(client):
    _, host_token = await make_host(client, "host@example.com")
    r = await client.post("/api/jobs/claim", headers=auth_headers(host_token))
    assert r.status_code == 401


async def test_claim_returns_204_when_no_jobs(client):
    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token)
    r = await client.post(
        "/api/jobs/claim", headers=auth_headers(body["agent_token"])
    )
    assert r.status_code == 204
    assert r.text == ""


async def test_claim_returns_oldest_queued_job_and_marks_running(client):
    _, renter_token = await make_active_user(
        client, "renter@example.com", credits_gpu_hours=10
    )
    job_a = await submit_job(client, renter_token, command=["echo", "a"])
    await asyncio.sleep(0.01)
    job_b = await submit_job(client, renter_token, command=["echo", "b"])

    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token)

    r = await client.post(
        "/api/jobs/claim", headers=auth_headers(body["agent_token"])
    )
    assert r.status_code == 200, r.text
    assignment = r.json()
    assert assignment["job_id"] == job_a["id"]
    assert assignment["docker_image"] == "ubuntu:latest"
    assert assignment["command"] == ["echo", "a"]
    assert assignment["max_duration_seconds"] == 60

    async with SessionLocal() as session:
        result = await session.execute(
            select(Job).where(Job.id == UUID(job_a["id"]))
        )
        job = result.scalar_one()
        assert job.status == "running"
        assert str(job.assigned_node_id) == body["node_id"]
        assert job.started_at is not None

        # Job B remains queued
        result = await session.execute(
            select(Job).where(Job.id == UUID(job_b["id"]))
        )
        job_b_row = result.scalar_one()
        assert job_b_row.status == "queued"


async def test_claim_skips_jobs_too_big_for_node(client):
    _, renter_token = await make_active_user(
        client, "renter@example.com", credits_gpu_hours=100
    )
    await submit_job(client, renter_token, gpu_count=4, max_duration_seconds=60)

    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token, gpu_count=1)
    r = await client.post(
        "/api/jobs/claim", headers=auth_headers(body["agent_token"])
    )
    assert r.status_code == 204


async def test_claim_skips_when_node_already_running_a_job(client):
    _, renter_token = await make_active_user(
        client, "renter@example.com", credits_gpu_hours=10
    )
    await submit_job(client, renter_token, command=["a"])
    await submit_job(client, renter_token, command=["b"])

    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token)

    first = await client.post(
        "/api/jobs/claim", headers=auth_headers(body["agent_token"])
    )
    assert first.status_code == 200
    second = await client.post(
        "/api/jobs/claim", headers=auth_headers(body["agent_token"])
    )
    assert second.status_code == 204


async def test_claim_skips_draining_nodes(client):
    _, renter_token = await make_active_user(
        client, "renter@example.com", credits_gpu_hours=10
    )
    await submit_job(client, renter_token)

    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token)
    async with SessionLocal() as session:
        await session.execute(
            update(Node)
            .where(Node.id == UUID(body["node_id"]))
            .values(status="draining")
        )
        await session.commit()

    r = await client.post(
        "/api/jobs/claim", headers=auth_headers(body["agent_token"])
    )
    assert r.status_code == 204


async def test_complete_marks_completed_and_deducts_credits(client):
    user_id, renter_token = await make_active_user(
        client, "renter@example.com", credits_gpu_hours=10
    )
    job = await submit_job(client, renter_token, max_duration_seconds=3600)

    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token)
    claim = await client.post(
        "/api/jobs/claim", headers=auth_headers(body["agent_token"])
    )
    assert claim.status_code == 200

    r = await client.post(
        f"/api/jobs/{job['id']}/complete",
        headers=auth_headers(body["agent_token"]),
        json={"exit_code": 0},
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "completed"
    assert out["exit_code"] == 0
    assert out["completed_at"] is not None

    me = await client.get("/api/me", headers=auth_headers(renter_token))
    # Job ran <1 hour but bills minimum 1 GPU-hour.
    assert me.json()["credits_gpu_hours"] == 9


async def test_complete_failed_when_exit_code_nonzero(client):
    _, renter_token = await make_active_user(
        client, "renter@example.com", credits_gpu_hours=10
    )
    job = await submit_job(client, renter_token)
    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token)
    await client.post("/api/jobs/claim", headers=auth_headers(body["agent_token"]))

    r = await client.post(
        f"/api/jobs/{job['id']}/complete",
        headers=auth_headers(body["agent_token"]),
        json={"exit_code": 137, "error_message": "OOMKilled"},
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "failed"
    assert out["exit_code"] == 137
    assert out["error_message"] == "OOMKilled"


async def test_complete_by_wrong_node_returns_404(client):
    _, renter_token = await make_active_user(
        client, "renter@example.com", credits_gpu_hours=10
    )
    job = await submit_job(client, renter_token)

    _, host_token = await make_host(client, "host@example.com")
    a = await register_node_for(client, host_token, suggested_name="a")
    b = await register_node_for(client, host_token, suggested_name="b")
    await client.post("/api/jobs/claim", headers=auth_headers(a["agent_token"]))

    r = await client.post(
        f"/api/jobs/{job['id']}/complete",
        headers=auth_headers(b["agent_token"]),
        json={"exit_code": 0},
    )
    assert r.status_code == 404


async def test_complete_unknown_job_returns_404(client):
    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token)
    r = await client.post(
        "/api/jobs/00000000-0000-0000-0000-000000000000/complete",
        headers=auth_headers(body["agent_token"]),
        json={"exit_code": 0},
    )
    assert r.status_code == 404


async def test_complete_already_completed_job_returns_409(client):
    _, renter_token = await make_active_user(
        client, "renter@example.com", credits_gpu_hours=10
    )
    job = await submit_job(client, renter_token)
    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token)
    await client.post("/api/jobs/claim", headers=auth_headers(body["agent_token"]))

    first = await client.post(
        f"/api/jobs/{job['id']}/complete",
        headers=auth_headers(body["agent_token"]),
        json={"exit_code": 0},
    )
    assert first.status_code == 200

    second = await client.post(
        f"/api/jobs/{job['id']}/complete",
        headers=auth_headers(body["agent_token"]),
        json={"exit_code": 0},
    )
    assert second.status_code == 409


async def test_complete_emits_audit_event(client):
    user_id, renter_token = await make_active_user(
        client, "renter@example.com", credits_gpu_hours=10
    )
    job = await submit_job(client, renter_token)
    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token)
    await client.post("/api/jobs/claim", headers=auth_headers(body["agent_token"]))
    await client.post(
        f"/api/jobs/{job['id']}/complete",
        headers=auth_headers(body["agent_token"]),
        json={"exit_code": 0},
    )

    async with SessionLocal() as session:
        result = await session.execute(
            select(AuditLog)
            .where(AuditLog.user_id == UUID(user_id))
            .where(AuditLog.event_type == "job.completed")
        )
        events = list(result.scalars().all())
    assert len(events) == 1
    assert events[0].event_data["job_id"] == job["id"]
    assert events[0].event_data["billed_gpu_hours"] >= 1


async def test_credit_deduction_does_not_go_negative(client):
    _, renter_token = await make_active_user(
        client, "broke-but-has-1@example.com", credits_gpu_hours=1
    )
    job = await submit_job(client, renter_token, max_duration_seconds=60)

    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token)
    await client.post("/api/jobs/claim", headers=auth_headers(body["agent_token"]))

    # Force long elapsed time so billing exceeds available credits.
    async with SessionLocal() as session:
        from datetime import timedelta as _td

        await session.execute(
            update(Job)
            .where(Job.id == UUID(job["id"]))
            .values(started_at=datetime.now(UTC) - _td(hours=10))
        )
        await session.commit()

    r = await client.post(
        f"/api/jobs/{job['id']}/complete",
        headers=auth_headers(body["agent_token"]),
        json={"exit_code": 0},
    )
    assert r.status_code == 200
    me = await client.get("/api/me", headers=auth_headers(renter_token))
    assert me.json()["credits_gpu_hours"] == 0
