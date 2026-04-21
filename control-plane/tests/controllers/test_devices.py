from datetime import UTC, datetime, timedelta

from sqlalchemy import update

from app.db import SessionLocal
from app.models.device_code import DeviceCode
from tests.helpers import (
    DEFAULT_PASSWORD,
    auth_headers,
    login,
    make_active_user,
    set_user_flags,
    signup,
)


async def make_host(client, email: str = "host@example.com") -> tuple[str, str]:
    user = await signup(client, email)
    await set_user_flags(email, status="active", can_host=True)
    token = await login(client, email)
    return user["id"], token


async def request_code(
    client,
    *,
    gpu_model: str = "NVIDIA RTX 3080",
    gpu_memory_gb: int = 10,
    gpu_count: int = 1,
) -> dict:
    r = await client.post(
        "/api/devices/code",
        json={
            "gpu_model": gpu_model,
            "gpu_memory_gb": gpu_memory_gb,
            "gpu_count": gpu_count,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def test_create_code_needs_no_auth(client):
    body = await request_code(client)
    assert body["code"]
    assert body["polling_token"].startswith("gpudev_")
    assert body["verify_url"].endswith("/activate")
    assert datetime.fromisoformat(body["expires_at"]) > datetime.now(UTC)


async def test_code_is_formatted_xxxx_xxxx(client):
    body = await request_code(client)
    assert len(body["code"]) == 9
    assert body["code"][4] == "-"
    # Alphabet excludes ambiguous chars
    for char in body["code"].replace("-", ""):
        assert char in "23456789ABCDEFGHJKMNPQRSTVWXYZ"


async def test_poll_pending_returns_202(client):
    body = await request_code(client)
    r = await client.get(f"/api/devices/code/{body['polling_token']}")
    assert r.status_code == 202
    assert r.json()["status"] == "pending"


async def test_poll_unknown_token_returns_400(client):
    r = await client.get("/api/devices/code/gpudev_totallybogus")
    assert r.status_code == 400
    assert r.json()["reason"] == "unknown token"


async def test_activate_requires_auth(client):
    body = await request_code(client)
    r = await client.post("/api/devices/activate", json={"code": body["code"]})
    assert r.status_code == 401


async def test_activate_requires_can_host(client):
    _, token = await make_active_user(client, "renter@example.com", can_host=False)
    body = await request_code(client)
    r = await client.post(
        "/api/devices/activate",
        json={"code": body["code"]},
        headers=auth_headers(token),
    )
    assert r.status_code == 403


async def test_activate_happy_path_then_poll_mints_agent_token(client):
    _, token = await make_host(client)
    code_body = await request_code(client, gpu_model="RTX 3080", gpu_count=1)

    # 1. User approves
    approve = await client.post(
        "/api/devices/activate",
        json={"code": code_body["code"]},
        headers=auth_headers(token),
    )
    assert approve.status_code == 200, approve.text
    approve_body = approve.json()
    assert approve_body["status"] == "approved"
    assert approve_body["gpu_model"] == "RTX 3080"

    # 2. Agent polls again — now gets agent_token + node
    poll = await client.get(f"/api/devices/code/{code_body['polling_token']}")
    assert poll.status_code == 200, poll.text
    poll_body = poll.json()
    assert poll_body["status"] == "approved"
    assert poll_body["agent_token"].startswith("gpuagent_")
    assert poll_body["node_id"]
    assert poll_body["control_plane_url"]

    # 3. Node is visible to the host via the normal nodes endpoint
    nodes = await client.get("/api/nodes", headers=auth_headers(token))
    assert nodes.status_code == 200
    ids = [n["id"] for n in nodes.json()]
    assert poll_body["node_id"] in ids

    # 4. Second poll after consumption → 400 (already consumed)
    second = await client.get(f"/api/devices/code/{code_body['polling_token']}")
    assert second.status_code == 400
    assert second.json()["reason"] == "already consumed"


async def test_activate_unknown_code(client):
    _, token = await make_host(client)
    r = await client.post(
        "/api/devices/activate",
        json={"code": "ZZZZ-ZZZZ"},
        headers=auth_headers(token),
    )
    assert r.status_code == 400
    assert r.json()["reason"] == "unknown code"


async def test_activate_is_idempotent_for_same_user(client):
    _, token = await make_host(client)
    code_body = await request_code(client)
    for _ in range(2):
        r = await client.post(
            "/api/devices/activate",
            json={"code": code_body["code"]},
            headers=auth_headers(token),
        )
        assert r.status_code == 200


async def test_activate_by_different_user_rejected(client):
    _, host_token = await make_host(client, "host1@example.com")
    await signup(client, "host2@example.com")
    await set_user_flags("host2@example.com", status="active", can_host=True)
    other_token = await login(client, "host2@example.com")

    code_body = await request_code(client)

    first = await client.post(
        "/api/devices/activate",
        json={"code": code_body["code"]},
        headers=auth_headers(host_token),
    )
    assert first.status_code == 200

    second = await client.post(
        "/api/devices/activate",
        json={"code": code_body["code"]},
        headers=auth_headers(other_token),
    )
    assert second.status_code == 400
    assert second.json()["reason"] == "approved by a different user"


async def test_expired_code_cannot_be_activated(client):
    _, token = await make_host(client)
    code_body = await request_code(client)

    async with SessionLocal() as session:
        await session.execute(
            update(DeviceCode)
            .where(DeviceCode.code == code_body["code"])
            .values(expires_at=datetime.now(UTC) - timedelta(minutes=1))
        )
        await session.commit()

    r = await client.post(
        "/api/devices/activate",
        json={"code": code_body["code"]},
        headers=auth_headers(token),
    )
    assert r.status_code == 400
    assert r.json()["reason"] == "expired"


async def test_expired_code_cannot_be_polled(client):
    code_body = await request_code(client)
    async with SessionLocal() as session:
        await session.execute(
            update(DeviceCode)
            .where(DeviceCode.code == code_body["code"])
            .values(expires_at=datetime.now(UTC) - timedelta(minutes=1))
        )
        await session.commit()

    r = await client.get(f"/api/devices/code/{code_body['polling_token']}")
    assert r.status_code == 400
    assert r.json()["reason"] == "expired"
