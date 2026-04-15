from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import update

from app.db import SessionLocal
from app.models.job import Job
from tests.helpers import auth_headers, login, make_active_user, set_user_flags, signup


async def make_host(client, email: str) -> tuple[str, str]:
    user = await signup(client, email)
    await set_user_flags(email, status="active", can_host=True)
    token = await login(client, email)
    return user["id"], token


async def register_node(client, host_token: str, *, suggested_name: str | None = None):
    claim = await client.post(
        "/api/nodes/claim-tokens", headers=auth_headers(host_token)
    )
    payload = {
        "claim_token": claim.json()["token"],
        "gpu_model": "A100",
        "gpu_memory_gb": 80,
        "gpu_count": 1,
    }
    if suggested_name:
        payload["suggested_name"] = suggested_name
    r = await client.post("/api/nodes/register", json=payload)
    return r.json()


async def setup_running_job(client) -> tuple[dict, dict, str, str]:
    """Returns (job, agent_node, agent_token, owner_token)."""
    user_id, owner_token = await make_active_user(
        client, "owner@example.com", credits_gpu_hours=10
    )
    submit = await client.post(
        "/api/jobs",
        headers=auth_headers(owner_token),
        json={
            "docker_image": "ubuntu:latest",
            "command": ["echo"],
            "gpu_count": 1,
            "max_duration_seconds": 60,
        },
    )
    job = submit.json()

    _, host_token = await make_host(client, "host@example.com")
    node = await register_node(client, host_token)
    claim = await client.post(
        "/api/jobs/claim", headers=auth_headers(node["agent_token"])
    )
    assert claim.status_code == 200, claim.text
    return job, node, node["agent_token"], owner_token


async def test_push_logs_requires_agent_auth(client):
    r = await client.post(
        "/api/jobs/00000000-0000-0000-0000-000000000000/logs",
        json=[{"stream": "stdout", "content": "hi", "sequence": 0}],
    )
    assert r.status_code == 401


async def test_push_logs_with_user_jwt_returns_401(client):
    job, _, _, owner_token = await setup_running_job(client)
    r = await client.post(
        f"/api/jobs/{job['id']}/logs",
        json=[{"stream": "stdout", "content": "hi", "sequence": 0}],
        headers=auth_headers(owner_token),
    )
    assert r.status_code == 401


async def test_push_logs_by_unrelated_node_returns_404(client):
    job, _, _, _ = await setup_running_job(client)

    _, other_host = await make_host(client, "other@example.com")
    other_node = await register_node(client, other_host, suggested_name="other")
    r = await client.post(
        f"/api/jobs/{job['id']}/logs",
        json=[{"stream": "stdout", "content": "hi", "sequence": 0}],
        headers=auth_headers(other_node["agent_token"]),
    )
    assert r.status_code == 404


async def test_push_logs_to_unknown_job_returns_404(client):
    _, host_token = await make_host(client, "host@example.com")
    node = await register_node(client, host_token)
    r = await client.post(
        "/api/jobs/00000000-0000-0000-0000-000000000000/logs",
        json=[{"stream": "stdout", "content": "hi", "sequence": 0}],
        headers=auth_headers(node["agent_token"]),
    )
    assert r.status_code == 404


async def test_push_then_owner_reads_in_order(client):
    job, _, agent_token, owner_token = await setup_running_job(client)
    push = await client.post(
        f"/api/jobs/{job['id']}/logs",
        headers=auth_headers(agent_token),
        json=[
            {"stream": "stdout", "content": "first", "sequence": 0},
            {"stream": "stdout", "content": "second", "sequence": 1},
            {"stream": "stderr", "content": "warn", "sequence": 2},
        ],
    )
    assert push.status_code == 204

    r = await client.get(
        f"/api/jobs/{job['id']}/logs", headers=auth_headers(owner_token)
    )
    assert r.status_code == 200
    items = r.json()["items"]
    assert [i["sequence"] for i in items] == [0, 1, 2]
    assert [i["content"] for i in items] == ["first", "second", "warn"]
    assert [i["stream"] for i in items] == ["stdout", "stdout", "stderr"]


async def test_owner_can_filter_after_sequence(client):
    job, _, agent_token, owner_token = await setup_running_job(client)
    await client.post(
        f"/api/jobs/{job['id']}/logs",
        headers=auth_headers(agent_token),
        json=[
            {"stream": "stdout", "content": f"line-{i}", "sequence": i}
            for i in range(5)
        ],
    )
    r = await client.get(
        f"/api/jobs/{job['id']}/logs?after_sequence=2",
        headers=auth_headers(owner_token),
    )
    seqs = [i["sequence"] for i in r.json()["items"]]
    assert seqs == [3, 4]


async def test_owner_limit_caps_response(client):
    job, _, agent_token, owner_token = await setup_running_job(client)
    await client.post(
        f"/api/jobs/{job['id']}/logs",
        headers=auth_headers(agent_token),
        json=[
            {"stream": "stdout", "content": str(i), "sequence": i}
            for i in range(10)
        ],
    )
    r = await client.get(
        f"/api/jobs/{job['id']}/logs?limit=3",
        headers=auth_headers(owner_token),
    )
    items = r.json()["items"]
    assert len(items) == 3
    assert [i["sequence"] for i in items] == [0, 1, 2]


async def test_duplicate_sequences_are_idempotent(client):
    job, _, agent_token, owner_token = await setup_running_job(client)
    payload = [
        {"stream": "stdout", "content": "first", "sequence": 0},
        {"stream": "stdout", "content": "second", "sequence": 1},
    ]
    a = await client.post(
        f"/api/jobs/{job['id']}/logs",
        headers=auth_headers(agent_token),
        json=payload,
    )
    b = await client.post(
        f"/api/jobs/{job['id']}/logs",
        headers=auth_headers(agent_token),
        json=payload,
    )
    assert a.status_code == 204
    assert b.status_code == 204

    r = await client.get(
        f"/api/jobs/{job['id']}/logs", headers=auth_headers(owner_token)
    )
    items = r.json()["items"]
    assert len(items) == 2  # no duplicates
    assert [i["sequence"] for i in items] == [0, 1]


async def test_non_owner_cannot_read_logs(client):
    job, _, agent_token, _ = await setup_running_job(client)
    await client.post(
        f"/api/jobs/{job['id']}/logs",
        headers=auth_headers(agent_token),
        json=[{"stream": "stdout", "content": "secret", "sequence": 0}],
    )

    _, intruder_token = await make_active_user(
        client, "intruder@example.com", credits_gpu_hours=1
    )
    r = await client.get(
        f"/api/jobs/{job['id']}/logs",
        headers=auth_headers(intruder_token),
    )
    assert r.status_code == 404


async def test_get_logs_unknown_job_returns_404(client):
    _, token = await make_active_user(
        client, "alice@example.com", credits_gpu_hours=1
    )
    r = await client.get(
        "/api/jobs/00000000-0000-0000-0000-000000000000/logs",
        headers=auth_headers(token),
    )
    assert r.status_code == 404


async def test_log_entry_validates_stream(client):
    job, _, agent_token, _ = await setup_running_job(client)
    r = await client.post(
        f"/api/jobs/{job['id']}/logs",
        headers=auth_headers(agent_token),
        json=[{"stream": "weird", "content": "hi", "sequence": 0}],
    )
    assert r.status_code == 422
