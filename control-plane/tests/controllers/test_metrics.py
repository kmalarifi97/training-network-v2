from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import update

from app.db import SessionLocal
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


async def test_metrics_endpoint_returns_text_exposition(client):
    r = await client.get("/metrics")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain")
    body = r.text
    assert "# HELP http_requests_total" in body
    assert "# TYPE http_requests_total counter" in body
    assert "# HELP http_request_duration_seconds" in body
    assert "# HELP jobs_in_status" in body
    assert "# HELP nodes_in_status" in body


async def test_http_requests_counter_increments(client):
    await client.get("/health")
    await client.get("/health")
    r = await client.get("/metrics")
    assert "http_requests_total" in r.text
    # We hit /health twice, so the counter for that path/200 should be >=2
    assert 'http_requests_total{method="GET",path="/health",status="200"}' in r.text


async def test_jobs_in_status_reflects_db(client):
    _, renter_token = await make_active_user(
        client, "renter@example.com", credits_gpu_hours=10
    )
    for _ in range(3):
        await client.post(
            "/api/jobs",
            headers=auth_headers(renter_token),
            json={
                "docker_image": "ubuntu:latest",
                "command": ["echo"],
                "gpu_count": 1,
                "max_duration_seconds": 60,
            },
        )

    r = await client.get("/metrics")
    assert 'jobs_in_status{status="queued"} 3.0' in r.text
    assert 'jobs_in_status{status="running"} 0.0' in r.text


async def test_nodes_in_status_uses_computed_status(client):
    _, host_token = await make_host(client, "host@example.com")
    fresh = await register_node_for(client, host_token, suggested_name="fresh")
    stale = await register_node_for(client, host_token, suggested_name="stale")
    async with SessionLocal() as session:
        await session.execute(
            update(Node)
            .where(Node.id == UUID(stale["node_id"]))
            .values(last_seen_at=datetime.now(UTC) - timedelta(seconds=300))
        )
        await session.commit()

    r = await client.get("/metrics")
    assert 'nodes_in_status{status="online"} 1.0' in r.text
    assert 'nodes_in_status{status="offline"} 1.0' in r.text


async def test_push_metrics_requires_agent_auth(client):
    r = await client.post(
        "/api/nodes/00000000-0000-0000-0000-000000000000/metrics",
        json=[
            {
                "gpu_index": 0,
                "utilization_pct": 50,
                "memory_used_bytes": 1000,
                "memory_total_bytes": 8000,
                "temperature_c": 60,
            }
        ],
    )
    assert r.status_code == 401


async def test_push_metrics_with_user_jwt_returns_401(client):
    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token)
    r = await client.post(
        f"/api/nodes/{body['node_id']}/metrics",
        json=[
            {
                "gpu_index": 0,
                "utilization_pct": 50,
                "memory_used_bytes": 1000,
                "memory_total_bytes": 8000,
                "temperature_c": 60,
            }
        ],
        headers=auth_headers(host_token),
    )
    assert r.status_code == 401


async def test_push_metrics_with_mismatched_node_returns_403(client):
    _, host_token = await make_host(client, "host@example.com")
    a = await register_node_for(client, host_token, suggested_name="a")
    b = await register_node_for(client, host_token, suggested_name="b")
    r = await client.post(
        f"/api/nodes/{a['node_id']}/metrics",
        json=[
            {
                "gpu_index": 0,
                "utilization_pct": 50,
                "memory_used_bytes": 1000,
                "memory_total_bytes": 8000,
                "temperature_c": 60,
            }
        ],
        headers=auth_headers(b["agent_token"]),
    )
    assert r.status_code == 403


async def test_push_metrics_appears_at_metrics_endpoint(client):
    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token, gpu_count=2)
    push = await client.post(
        f"/api/nodes/{body['node_id']}/metrics",
        json=[
            {
                "gpu_index": 0,
                "utilization_pct": 75,
                "memory_used_bytes": 4_000_000_000,
                "memory_total_bytes": 8_000_000_000,
                "temperature_c": 65,
            },
            {
                "gpu_index": 1,
                "utilization_pct": 30,
                "memory_used_bytes": 1_000_000_000,
                "memory_total_bytes": 8_000_000_000,
                "temperature_c": 50,
            },
        ],
        headers=auth_headers(body["agent_token"]),
    )
    assert push.status_code == 204

    metrics = await client.get("/metrics")
    text = metrics.text
    nid = body["node_id"]
    assert f'gpu_utilization_pct{{gpu_index="0",node_id="{nid}"}} 75.0' in text
    assert f'gpu_utilization_pct{{gpu_index="1",node_id="{nid}"}} 30.0' in text
    assert f'gpu_memory_used_bytes{{gpu_index="0",node_id="{nid}"}} 4e+09' in text
    assert f'gpu_temperature_celsius{{gpu_index="1",node_id="{nid}"}} 50.0' in text


async def test_push_metrics_upserts_overwrites_previous_sample(client):
    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token)

    sample = {
        "gpu_index": 0,
        "utilization_pct": 50,
        "memory_used_bytes": 1000,
        "memory_total_bytes": 8000,
        "temperature_c": 60,
    }
    await client.post(
        f"/api/nodes/{body['node_id']}/metrics",
        json=[sample],
        headers=auth_headers(body["agent_token"]),
    )
    sample["utilization_pct"] = 95
    sample["temperature_c"] = 80
    await client.post(
        f"/api/nodes/{body['node_id']}/metrics",
        json=[sample],
        headers=auth_headers(body["agent_token"]),
    )

    metrics = await client.get("/metrics")
    nid = body["node_id"]
    assert f'gpu_utilization_pct{{gpu_index="0",node_id="{nid}"}} 95.0' in metrics.text
    assert f'gpu_temperature_celsius{{gpu_index="0",node_id="{nid}"}} 80.0' in metrics.text


async def test_push_metrics_validates_ranges(client):
    _, host_token = await make_host(client, "host@example.com")
    body = await register_node_for(client, host_token)
    r = await client.post(
        f"/api/nodes/{body['node_id']}/metrics",
        json=[
            {
                "gpu_index": 0,
                "utilization_pct": 200,
                "memory_used_bytes": 1000,
                "memory_total_bytes": 8000,
                "temperature_c": 60,
            }
        ],
        headers=auth_headers(body["agent_token"]),
    )
    assert r.status_code == 422
