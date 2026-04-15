from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import update

from app.db import SessionLocal
from app.models.job import Job
from tests.helpers import (
    auth_headers,
    login,
    make_active_user,
    make_admin,
    set_user_flags,
    signup,
)


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


async def test_dashboard_requires_auth(client):
    r = await client.get("/api/admin/dashboard")
    assert r.status_code == 401


async def test_dashboard_as_non_admin_returns_403(client):
    _, user_token = await make_active_user(client, "plain@example.com")
    r = await client.get(
        "/api/admin/dashboard", headers=auth_headers(user_token)
    )
    assert r.status_code == 403


async def test_dashboard_user_counts_match(client):
    _, admin_token = await make_admin(client, "root@example.com")
    await signup(client, "p1@example.com")
    await signup(client, "p2@example.com")
    await signup(client, "act@example.com")
    await set_user_flags("act@example.com", status="active")
    await signup(client, "sus@example.com")
    await set_user_flags("sus@example.com", status="suspended")

    r = await client.get(
        "/api/admin/dashboard", headers=auth_headers(admin_token)
    )
    assert r.status_code == 200
    users = r.json()["users"]
    assert users["pending"] == 2
    assert users["active"] == 2  # admin (root) + act
    assert users["suspended"] == 1
    assert users["total"] == 5


async def test_dashboard_node_counts_match(client):
    _, admin_token = await make_admin(client, "root@example.com")
    _, host_token = await make_host(client, "host@example.com")
    fresh = await register_node(client, host_token, name="fresh")
    stale = await register_node(client, host_token, name="stale")
    drain = await register_node(client, host_token, name="drain")

    from app.models.node import Node

    async with SessionLocal() as session:
        await session.execute(
            update(Node)
            .where(Node.id == UUID(stale["node_id"]))
            .values(last_seen_at=datetime.now(UTC) - timedelta(seconds=300))
        )
        await session.execute(
            update(Node)
            .where(Node.id == UUID(drain["node_id"]))
            .values(status="draining")
        )
        await session.commit()

    r = await client.get(
        "/api/admin/dashboard", headers=auth_headers(admin_token)
    )
    nodes = r.json()["nodes"]
    assert nodes["online"] == 1
    assert nodes["offline"] == 1
    assert nodes["draining"] == 1


async def test_dashboard_job_counts_match(client):
    _, admin_token = await make_admin(client, "root@example.com")
    _, owner_token = await make_active_user(
        client, "renter@example.com", credits_gpu_hours=10
    )
    await submit_job(client, owner_token)
    await submit_job(client, owner_token)
    running = await submit_job(client, owner_token)

    async with SessionLocal() as session:
        await session.execute(
            update(Job).where(Job.id == UUID(running["id"])).values(status="running")
        )
        await session.commit()

    r = await client.get(
        "/api/admin/dashboard", headers=auth_headers(admin_token)
    )
    jobs = r.json()["jobs"]
    assert jobs["queued"] == 2
    assert jobs["running"] == 1


async def test_dashboard_24h_counts_and_compute(client):
    _, admin_token = await make_admin(client, "root@example.com")
    _, owner_token = await make_active_user(
        client, "renter@example.com", credits_gpu_hours=100
    )
    job = await submit_job(client, owner_token, max_duration_seconds=3600)
    _, host_token = await make_host(client, "host@example.com")
    node = await register_node(client, host_token)
    await client.post(
        "/api/jobs/claim", headers=auth_headers(node["agent_token"])
    )
    await client.post(
        f"/api/jobs/{job['id']}/complete",
        headers=auth_headers(node["agent_token"]),
        json={"exit_code": 0},
    )

    r = await client.get(
        "/api/admin/dashboard", headers=auth_headers(admin_token)
    )
    body = r.json()
    assert body["jobs"]["completed_24h"] == 1
    assert body["jobs"]["failed_24h"] == 0
    assert body["jobs"]["cancelled_24h"] == 0
    # Sub-hour run rounds up to 1 GPU-hour.
    assert body["compute"]["gpu_hours_served_24h"] >= 1


async def test_dashboard_excludes_old_completions_from_24h(client):
    _, admin_token = await make_admin(client, "root@example.com")
    _, owner_token = await make_active_user(
        client, "renter@example.com", credits_gpu_hours=10
    )
    job = await submit_job(client, owner_token)
    _, host_token = await make_host(client, "host@example.com")
    node = await register_node(client, host_token)
    await client.post(
        "/api/jobs/claim", headers=auth_headers(node["agent_token"])
    )
    await client.post(
        f"/api/jobs/{job['id']}/complete",
        headers=auth_headers(node["agent_token"]),
        json={"exit_code": 0},
    )

    async with SessionLocal() as session:
        await session.execute(
            update(Job)
            .where(Job.id == UUID(job["id"]))
            .values(completed_at=datetime.now(UTC) - timedelta(days=2))
        )
        await session.commit()

    r = await client.get(
        "/api/admin/dashboard", headers=auth_headers(admin_token)
    )
    assert r.json()["jobs"]["completed_24h"] == 0
    assert r.json()["compute"]["gpu_hours_served_24h"] == 0
