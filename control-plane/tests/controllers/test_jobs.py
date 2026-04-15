from uuid import UUID

from sqlalchemy import select

from app.db import SessionLocal
from app.models.audit_log import AuditLog
from tests.helpers import (
    auth_headers,
    login,
    make_active_user,
    set_user_flags,
    signup,
)


async def test_submit_job_requires_auth(client):
    r = await client.post(
        "/api/jobs",
        json={
            "docker_image": "ubuntu:latest",
            "command": ["echo", "hi"],
            "gpu_count": 1,
            "max_duration_seconds": 60,
        },
    )
    assert r.status_code == 401


async def test_submit_job_as_pending_user_returns_403(client):
    await signup(client, "pending@example.com")
    token = await login(client, "pending@example.com")
    r = await client.post(
        "/api/jobs",
        headers=auth_headers(token),
        json={
            "docker_image": "ubuntu:latest",
            "command": ["echo", "hi"],
            "gpu_count": 1,
            "max_duration_seconds": 60,
        },
    )
    assert r.status_code == 403
    assert "pending" in r.json()["detail"].lower()


async def test_submit_job_as_suspended_user_returns_403(client):
    await signup(client, "bad@example.com")
    await set_user_flags("bad@example.com", status="suspended")
    token = await login(client, "bad@example.com")
    r = await client.post(
        "/api/jobs",
        headers=auth_headers(token),
        json={
            "docker_image": "ubuntu:latest",
            "command": ["echo", "hi"],
            "gpu_count": 1,
            "max_duration_seconds": 60,
        },
    )
    assert r.status_code == 403


async def test_submit_job_with_no_credits_returns_402(client):
    _, token = await make_active_user(
        client, "broke@example.com", credits_gpu_hours=0
    )
    r = await client.post(
        "/api/jobs",
        headers=auth_headers(token),
        json={
            "docker_image": "ubuntu:latest",
            "command": ["echo", "hi"],
            "gpu_count": 1,
            "max_duration_seconds": 3600,
        },
    )
    assert r.status_code == 402
    body = r.json()
    assert body["required_gpu_hours"] == 1.0
    assert body["available_gpu_hours"] == 0


async def test_submit_job_when_request_exceeds_credits_returns_402(client):
    _, token = await make_active_user(
        client, "alice@example.com", credits_gpu_hours=1
    )
    r = await client.post(
        "/api/jobs",
        headers=auth_headers(token),
        json={
            "docker_image": "ubuntu:latest",
            "command": ["echo", "hi"],
            "gpu_count": 2,
            "max_duration_seconds": 3600,
        },
    )
    assert r.status_code == 402
    assert r.json()["required_gpu_hours"] == 2.0


async def test_submit_job_happy_path_returns_queued(client):
    user_id, token = await make_active_user(
        client, "alice@example.com", credits_gpu_hours=10
    )
    r = await client.post(
        "/api/jobs",
        headers=auth_headers(token),
        json={
            "docker_image": "nvidia/cuda:12.0-runtime-ubuntu22.04",
            "command": ["python", "train.py"],
            "gpu_count": 1,
            "max_duration_seconds": 600,
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["docker_image"] == "nvidia/cuda:12.0-runtime-ubuntu22.04"
    assert body["command"] == ["python", "train.py"]
    assert body["gpu_count"] == 1
    assert body["max_duration_seconds"] == 600
    assert body["status"] == "queued"
    assert body["exit_code"] is None
    assert body["error_message"] is None
    assert body["assigned_node_id"] is None
    assert body["started_at"] is None
    assert body["completed_at"] is None
    assert UUID(body["id"])

    async with SessionLocal() as session:
        result = await session.execute(
            select(AuditLog)
            .where(AuditLog.event_type == "job.submitted")
            .where(AuditLog.user_id == UUID(user_id))
        )
        events = list(result.scalars().all())
    assert len(events) == 1
    assert events[0].event_data["job_id"] == body["id"]
    assert events[0].event_data["docker_image"].startswith("nvidia/cuda")
    assert events[0].event_data["gpu_count"] == 1


async def test_submit_job_invalid_image_returns_422(client):
    _, token = await make_active_user(
        client, "alice@example.com", credits_gpu_hours=10
    )
    for bad in ["bad image", "@nope", ":only-tag", "bad@@image", ""]:
        r = await client.post(
            "/api/jobs",
            headers=auth_headers(token),
            json={
                "docker_image": bad,
                "command": ["echo", "hi"],
                "gpu_count": 1,
                "max_duration_seconds": 60,
            },
        )
        assert r.status_code == 422, f"image {bad!r} should be rejected: {r.text}"


async def test_submit_job_gpu_count_zero_returns_422(client):
    _, token = await make_active_user(
        client, "alice@example.com", credits_gpu_hours=10
    )
    r = await client.post(
        "/api/jobs",
        headers=auth_headers(token),
        json={
            "docker_image": "ubuntu:latest",
            "command": ["echo", "hi"],
            "gpu_count": 0,
            "max_duration_seconds": 60,
        },
    )
    assert r.status_code == 422


async def test_submit_job_empty_command_returns_422(client):
    _, token = await make_active_user(
        client, "alice@example.com", credits_gpu_hours=10
    )
    r = await client.post(
        "/api/jobs",
        headers=auth_headers(token),
        json={
            "docker_image": "ubuntu:latest",
            "command": [],
            "gpu_count": 1,
            "max_duration_seconds": 60,
        },
    )
    assert r.status_code == 422


async def test_submit_job_command_with_empty_string_returns_422(client):
    _, token = await make_active_user(
        client, "alice@example.com", credits_gpu_hours=10
    )
    r = await client.post(
        "/api/jobs",
        headers=auth_headers(token),
        json={
            "docker_image": "ubuntu:latest",
            "command": ["echo", ""],
            "gpu_count": 1,
            "max_duration_seconds": 60,
        },
    )
    assert r.status_code == 422


async def test_submit_job_max_duration_too_long_returns_422(client):
    _, token = await make_active_user(
        client, "alice@example.com", credits_gpu_hours=10_000_000
    )
    r = await client.post(
        "/api/jobs",
        headers=auth_headers(token),
        json={
            "docker_image": "ubuntu:latest",
            "command": ["echo", "hi"],
            "gpu_count": 1,
            "max_duration_seconds": 86400 * 10,
        },
    )
    assert r.status_code == 422


# --- R5: list / detail jobs ----------------------------------------------------


async def _submit(client, token, **overrides):
    body = {
        "docker_image": "ubuntu:latest",
        "command": ["echo", "hi"],
        "gpu_count": 1,
        "max_duration_seconds": 60,
    }
    body.update(overrides)
    r = await client.post("/api/jobs", headers=auth_headers(token), json=body)
    assert r.status_code == 201, r.text
    return r.json()


async def test_list_jobs_requires_auth(client):
    r = await client.get("/api/jobs")
    assert r.status_code == 401


async def test_list_jobs_returns_only_own(client):
    _, alice_token = await make_active_user(
        client, "alice@example.com", credits_gpu_hours=10
    )
    _, bob_token = await make_active_user(
        client, "bob@example.com", credits_gpu_hours=10
    )
    a = await _submit(client, alice_token, command=["alice"])
    await _submit(client, bob_token, command=["bob"])

    r = await client.get("/api/jobs", headers=auth_headers(alice_token))
    assert r.status_code == 200
    items = r.json()["items"]
    assert [item["id"] for item in items] == [a["id"]]


async def test_list_jobs_filter_by_status(client):
    _, token = await make_active_user(
        client, "alice@example.com", credits_gpu_hours=10
    )
    queued = await _submit(client, token, command=["q"])
    running = await _submit(client, token, command=["r"])

    from sqlalchemy import update

    from app.models.job import Job

    async with SessionLocal() as session:
        await session.execute(
            update(Job).where(Job.id == UUID(running["id"])).values(status="running")
        )
        await session.commit()

    r = await client.get(
        "/api/jobs?status=running", headers=auth_headers(token)
    )
    assert {i["id"] for i in r.json()["items"]} == {running["id"]}

    r = await client.get(
        "/api/jobs?status=queued", headers=auth_headers(token)
    )
    assert {i["id"] for i in r.json()["items"]} == {queued["id"]}


async def test_list_jobs_paginates_with_cursor(client):
    _, token = await make_active_user(
        client, "alice@example.com", credits_gpu_hours=20
    )
    for i in range(6):
        await _submit(client, token, command=[f"job-{i}"])

    page1 = await client.get(
        "/api/jobs?limit=3", headers=auth_headers(token)
    )
    assert page1.status_code == 200
    body1 = page1.json()
    assert len(body1["items"]) == 3
    assert body1["next_cursor"] is not None

    page2 = await client.get(
        f"/api/jobs?limit=3&cursor={body1['next_cursor']}",
        headers=auth_headers(token),
    )
    body2 = page2.json()
    assert len(body2["items"]) == 3
    ids1 = {i["id"] for i in body1["items"]}
    ids2 = {i["id"] for i in body2["items"]}
    assert ids1.isdisjoint(ids2)


async def test_list_jobs_invalid_cursor_returns_400(client):
    _, token = await make_active_user(
        client, "alice@example.com", credits_gpu_hours=1
    )
    r = await client.get(
        "/api/jobs?cursor=not-a-real-cursor",
        headers=auth_headers(token),
    )
    assert r.status_code == 400


async def test_get_job_detail_as_owner_returns_full(client):
    _, token = await make_active_user(
        client, "alice@example.com", credits_gpu_hours=10
    )
    j = await _submit(client, token, command=["echo"])

    r = await client.get(
        f"/api/jobs/{j['id']}", headers=auth_headers(token)
    )
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == j["id"]
    assert body["status"] == "queued"
    assert body["docker_image"] == "ubuntu:latest"


async def test_get_job_detail_as_other_user_returns_404(client):
    _, alice_token = await make_active_user(
        client, "alice@example.com", credits_gpu_hours=10
    )
    _, bob_token = await make_active_user(
        client, "bob@example.com", credits_gpu_hours=10
    )
    j = await _submit(client, alice_token)

    r = await client.get(
        f"/api/jobs/{j['id']}", headers=auth_headers(bob_token)
    )
    assert r.status_code == 404


async def test_get_job_unknown_returns_404(client):
    _, token = await make_active_user(
        client, "alice@example.com", credits_gpu_hours=10
    )
    r = await client.get(
        "/api/jobs/00000000-0000-0000-0000-000000000000",
        headers=auth_headers(token),
    )
    assert r.status_code == 404
