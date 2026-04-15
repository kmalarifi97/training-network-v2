from uuid import UUID

from sqlalchemy import select

from app.db import SessionLocal
from app.models.audit_log import AuditLog
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


# --- force-kill ----------------------------------------------------------------


async def test_force_kill_without_auth_returns_401(client):
    r = await client.post(
        "/api/admin/jobs/00000000-0000-0000-0000-000000000000/force-kill"
    )
    assert r.status_code == 401


async def test_force_kill_as_non_admin_returns_403(client):
    _, user_token = await make_active_user(client, "plain@example.com")
    r = await client.post(
        "/api/admin/jobs/00000000-0000-0000-0000-000000000000/force-kill",
        headers=auth_headers(user_token),
    )
    assert r.status_code == 403


async def test_force_kill_unknown_job_returns_404(client):
    _, admin_token = await make_admin(client, "root@example.com")
    r = await client.post(
        "/api/admin/jobs/00000000-0000-0000-0000-000000000000/force-kill",
        headers=auth_headers(admin_token),
    )
    assert r.status_code == 404


async def test_force_kill_other_users_queued_job(client):
    admin_id, admin_token = await make_admin(client, "root@example.com")
    user_id, owner_token = await make_active_user(
        client, "victim@example.com", credits_gpu_hours=10
    )
    job = await submit_job(client, owner_token)

    r = await client.post(
        f"/api/admin/jobs/{job['id']}/force-kill",
        headers=auth_headers(admin_token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "cancelled"

    async with SessionLocal() as session:
        result = await session.execute(
            select(AuditLog)
            .where(AuditLog.event_type == "admin.job.force_killed")
        )
        events = list(result.scalars().all())
    assert len(events) == 1
    ev = events[0]
    assert ev.event_data["actor_user_id"] == admin_id
    assert ev.event_data["actor_email"] == "root@example.com"
    assert ev.event_data["target_user_id"] == user_id
    assert ev.user_id == UUID(user_id)


async def test_force_kill_other_users_running_job(client):
    _, admin_token = await make_admin(client, "root@example.com")
    _, owner_token = await make_active_user(
        client, "victim@example.com", credits_gpu_hours=10
    )
    job = await submit_job(client, owner_token)
    _, host_token = await make_host(client, "host@example.com")
    node = await register_node(client, host_token)
    await client.post(
        "/api/jobs/claim", headers=auth_headers(node["agent_token"])
    )

    r = await client.post(
        f"/api/admin/jobs/{job['id']}/force-kill",
        headers=auth_headers(admin_token),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "running"

    async with SessionLocal() as session:
        result = await session.execute(select(Job).where(Job.id == UUID(job["id"])))
        row = result.scalar_one()
    assert row.cancel_requested_at is not None


async def test_force_kill_terminal_job_returns_409(client):
    _, admin_token = await make_admin(client, "root@example.com")
    _, owner_token = await make_active_user(
        client, "victim@example.com", credits_gpu_hours=10
    )
    job = await submit_job(client, owner_token)
    await client.post(
        f"/api/jobs/{job['id']}/cancel", headers=auth_headers(owner_token)
    )

    r = await client.post(
        f"/api/admin/jobs/{job['id']}/force-kill",
        headers=auth_headers(admin_token),
    )
    assert r.status_code == 409


# --- force-drain ---------------------------------------------------------------


async def test_force_drain_without_auth_returns_401(client):
    r = await client.post(
        "/api/admin/nodes/00000000-0000-0000-0000-000000000000/force-drain"
    )
    assert r.status_code == 401


async def test_force_drain_as_non_admin_returns_403(client):
    _, user_token = await make_active_user(client, "plain@example.com")
    r = await client.post(
        "/api/admin/nodes/00000000-0000-0000-0000-000000000000/force-drain",
        headers=auth_headers(user_token),
    )
    assert r.status_code == 403


async def test_force_drain_unknown_node_returns_404(client):
    _, admin_token = await make_admin(client, "root@example.com")
    r = await client.post(
        "/api/admin/nodes/00000000-0000-0000-0000-000000000000/force-drain",
        headers=auth_headers(admin_token),
    )
    assert r.status_code == 404


async def test_force_drain_other_hosts_node(client):
    admin_id, admin_token = await make_admin(client, "root@example.com")
    user_id, host_token = await make_host(client, "host@example.com")
    node = await register_node(client, host_token)

    r = await client.post(
        f"/api/admin/nodes/{node['node_id']}/force-drain",
        headers=auth_headers(admin_token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "draining"

    async with SessionLocal() as session:
        result = await session.execute(
            select(AuditLog).where(AuditLog.event_type == "admin.node.force_drained")
        )
        events = list(result.scalars().all())
    assert len(events) == 1
    ev = events[0]
    assert ev.event_data["actor_user_id"] == admin_id
    assert ev.event_data["target_user_id"] == user_id
    assert ev.user_id == UUID(user_id)


async def test_force_drain_idempotent(client):
    _, admin_token = await make_admin(client, "root@example.com")
    _, host_token = await make_host(client, "host@example.com")
    node = await register_node(client, host_token)

    a = await client.post(
        f"/api/admin/nodes/{node['node_id']}/force-drain",
        headers=auth_headers(admin_token),
    )
    b = await client.post(
        f"/api/admin/nodes/{node['node_id']}/force-drain",
        headers=auth_headers(admin_token),
    )
    assert a.status_code == 200
    assert b.status_code == 200
    assert b.json()["status"] == "draining"

    async with SessionLocal() as session:
        result = await session.execute(
            select(AuditLog).where(AuditLog.event_type == "admin.node.force_drained")
        )
        events = list(result.scalars().all())
    assert len(events) == 1
