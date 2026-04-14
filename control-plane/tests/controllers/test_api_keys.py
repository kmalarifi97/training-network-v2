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


async def test_generate_key_requires_authentication(client):
    r = await client.post("/api/keys", json={"name": "test"})
    assert r.status_code == 401


async def test_generate_key_as_pending_user_returns_403(client):
    await signup(client, "pending@example.com")
    token = await login(client, "pending@example.com")
    r = await client.post(
        "/api/keys", json={"name": "test"}, headers=auth_headers(token)
    )
    assert r.status_code == 403
    assert "pending" in r.json()["detail"].lower()


async def test_generate_key_as_suspended_user_returns_403(client):
    await signup(client, "bad@example.com")
    await set_user_flags("bad@example.com", status="suspended")
    token = await login(client, "bad@example.com")
    r = await client.post(
        "/api/keys", json={"name": "test"}, headers=auth_headers(token)
    )
    assert r.status_code == 403


async def test_generate_key_as_active_user_returns_full_key_once(client):
    _, token = await make_active_user(client, "alice@example.com")
    r = await client.post(
        "/api/keys",
        json={"name": "Laptop runner"},
        headers=auth_headers(token),
    )
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Laptop runner"
    assert body["full_key"].startswith("gpuk_")
    assert body["prefix"] == body["full_key"][:12]
    assert "id" in body

    list_resp = await client.get("/api/keys", headers=auth_headers(token))
    assert list_resp.status_code == 200
    items = list_resp.json()
    assert len(items) == 1
    assert items[0]["prefix"] == body["prefix"]
    assert "full_key" not in items[0]
    assert "hash" not in items[0]


async def test_generate_key_rejects_empty_name(client):
    _, token = await make_active_user(client, "alice@example.com")
    r = await client.post(
        "/api/keys", json={"name": ""}, headers=auth_headers(token)
    )
    assert r.status_code == 422


async def test_generated_key_authenticates_on_me(client):
    await make_active_user(client, "alice@example.com")
    jwt_token = await login(client, "alice@example.com")

    gen = await client.post(
        "/api/keys",
        json={"name": "prod"},
        headers=auth_headers(jwt_token),
    )
    full_key = gen.json()["full_key"]

    me = await client.get("/api/me", headers=auth_headers(full_key))
    assert me.status_code == 200
    assert me.json()["email"] == "alice@example.com"


async def test_user_only_sees_own_keys(client):
    _, alice_token = await make_active_user(client, "alice@example.com")
    _, bob_token = await make_active_user(client, "bob@example.com")
    await client.post(
        "/api/keys", json={"name": "alice-k1"}, headers=auth_headers(alice_token)
    )
    await client.post(
        "/api/keys", json={"name": "bob-k1"}, headers=auth_headers(bob_token)
    )

    alice_list = await client.get("/api/keys", headers=auth_headers(alice_token))
    names = [k["name"] for k in alice_list.json()]
    assert names == ["alice-k1"]


async def test_revoke_key_prevents_further_authentication(client):
    await make_active_user(client, "alice@example.com")
    jwt_token = await login(client, "alice@example.com")
    gen = await client.post(
        "/api/keys",
        json={"name": "throwaway"},
        headers=auth_headers(jwt_token),
    )
    key_id = gen.json()["id"]
    full_key = gen.json()["full_key"]

    me_before = await client.get("/api/me", headers=auth_headers(full_key))
    assert me_before.status_code == 200

    rev = await client.delete(
        f"/api/keys/{key_id}", headers=auth_headers(jwt_token)
    )
    assert rev.status_code == 200
    assert rev.json()["revoked_at"] is not None

    me_after = await client.get("/api/me", headers=auth_headers(full_key))
    assert me_after.status_code == 401


async def test_revoke_other_users_key_returns_403(client):
    _, alice_token = await make_active_user(client, "alice@example.com")
    _, bob_token = await make_active_user(client, "bob@example.com")

    alice_gen = await client.post(
        "/api/keys",
        json={"name": "alice-key"},
        headers=auth_headers(alice_token),
    )
    alice_key_id = alice_gen.json()["id"]

    r = await client.delete(
        f"/api/keys/{alice_key_id}", headers=auth_headers(bob_token)
    )
    assert r.status_code == 403


async def test_revoke_unknown_key_returns_404(client):
    _, token = await make_active_user(client, "alice@example.com")
    r = await client.delete(
        "/api/keys/00000000-0000-0000-0000-000000000000",
        headers=auth_headers(token),
    )
    assert r.status_code == 404


async def test_generate_and_revoke_emit_audit_events(client):
    user_id, token = await make_active_user(client, "alice@example.com")
    gen = await client.post(
        "/api/keys", json={"name": "audit"}, headers=auth_headers(token)
    )
    key_id = gen.json()["id"]
    await client.delete(f"/api/keys/{key_id}", headers=auth_headers(token))

    async with SessionLocal() as session:
        result = await session.execute(
            select(AuditLog)
            .where(AuditLog.user_id == UUID(user_id))
            .order_by(AuditLog.created_at)
        )
        events = list(result.scalars().all())
    event_types = [e.event_type for e in events]
    assert "apikey.created" in event_types
    assert "apikey.revoked" in event_types

    created = next(e for e in events if e.event_type == "apikey.created")
    assert created.event_data["name"] == "audit"
    assert created.event_data["api_key_id"] == key_id


async def test_garbage_gpuk_token_returns_401(client):
    r = await client.get(
        "/api/me", headers=auth_headers("gpuk_not_a_real_key_at_all_xxxxxxxxxxx")
    )
    assert r.status_code == 401


async def test_revoke_twice_is_idempotent(client):
    _, token = await make_active_user(client, "alice@example.com")
    gen = await client.post(
        "/api/keys", json={"name": "x"}, headers=auth_headers(token)
    )
    key_id = gen.json()["id"]

    r1 = await client.delete(f"/api/keys/{key_id}", headers=auth_headers(token))
    assert r1.status_code == 200
    first_revoked_at = r1.json()["revoked_at"]

    r2 = await client.delete(f"/api/keys/{key_id}", headers=auth_headers(token))
    assert r2.status_code == 200
    assert r2.json()["revoked_at"] == first_revoked_at
