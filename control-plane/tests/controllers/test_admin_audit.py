from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select, update

from app.db import SessionLocal
from app.models.audit_log import AuditLog
from tests.helpers import (
    auth_headers,
    login,
    make_active_user,
    make_admin,
    signup,
)


async def test_audit_list_without_token_returns_401(client):
    r = await client.get("/api/admin/audit")
    assert r.status_code == 401


async def test_audit_list_as_non_admin_returns_403(client):
    _, token = await make_active_user(client, "plain@example.com")
    r = await client.get("/api/admin/audit", headers=auth_headers(token))
    assert r.status_code == 403


async def test_audit_list_returns_recent_events_with_user_email(client):
    _, admin_token = await make_admin(client, "root@example.com")
    await signup(client, "alice@example.com")

    r = await client.get("/api/admin/audit", headers=auth_headers(admin_token))
    assert r.status_code == 200
    body = r.json()
    events = body["items"]
    types = [e["event_type"] for e in events]
    assert "auth.signup" in types
    signup_events = [e for e in events if e["event_type"] == "auth.signup"]
    alice_signup = next(
        e for e in signup_events if e["user_email"] == "alice@example.com"
    )
    assert alice_signup["user_id"] is not None


async def test_audit_list_is_sorted_most_recent_first(client):
    _, admin_token = await make_admin(client, "root@example.com")
    await signup(client, "first@example.com")
    await signup(client, "second@example.com")

    r = await client.get("/api/admin/audit", headers=auth_headers(admin_token))
    assert r.status_code == 200
    timestamps = [e["created_at"] for e in r.json()["items"]]
    assert timestamps == sorted(timestamps, reverse=True)


async def test_audit_list_filter_by_event_type(client):
    _, admin_token = await make_admin(client, "root@example.com")
    await signup(client, "alice@example.com")
    await login(client, "alice@example.com")

    r = await client.get(
        "/api/admin/audit?event_type=auth.login.success",
        headers=auth_headers(admin_token),
    )
    assert r.status_code == 200
    types = {e["event_type"] for e in r.json()["items"]}
    assert types == {"auth.login.success"}


async def test_audit_list_filter_by_user_email_substring(client):
    _, admin_token = await make_admin(client, "root@example.com")
    await signup(client, "carol@example.com")
    await signup(client, "dave@example.com")

    r = await client.get(
        "/api/admin/audit?user_email=carol",
        headers=auth_headers(admin_token),
    )
    assert r.status_code == 200
    emails = {e["user_email"] for e in r.json()["items"]}
    assert emails == {"carol@example.com"}


async def test_audit_list_filter_by_ip_address(client):
    _, admin_token = await make_admin(client, "root@example.com")
    await signup(client, "alice@example.com")

    async with SessionLocal() as session:
        await session.execute(
            update(AuditLog)
            .where(AuditLog.event_type == "auth.signup")
            .values(ip_address="203.0.113.42")
        )
        await session.commit()

    r = await client.get(
        "/api/admin/audit?ip=203.0.113.42",
        headers=auth_headers(admin_token),
    )
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) >= 1
    assert all(e["ip_address"] == "203.0.113.42" for e in items)


async def test_audit_list_filter_by_date_range(client):
    _, admin_token = await make_admin(client, "root@example.com")
    await signup(client, "alice@example.com")

    future = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    r = await client.get(
        "/api/admin/audit",
        params={"from": future},
        headers=auth_headers(admin_token),
    )
    assert r.status_code == 200
    assert r.json()["items"] == []

    past = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    r = await client.get(
        "/api/admin/audit",
        params={"from": past},
        headers=auth_headers(admin_token),
    )
    assert r.status_code == 200
    assert len(r.json()["items"]) >= 1


async def test_audit_list_paginates_with_cursor(client):
    _, admin_token = await make_admin(client, "root@example.com")
    for i in range(5):
        await signup(client, f"u{i}@example.com")

    page1 = await client.get(
        "/api/admin/audit?limit=3", headers=auth_headers(admin_token)
    )
    assert page1.status_code == 200
    b1 = page1.json()
    assert len(b1["items"]) == 3
    assert b1["next_cursor"] is not None

    page2 = await client.get(
        f"/api/admin/audit?limit=3&cursor={b1['next_cursor']}",
        headers=auth_headers(admin_token),
    )
    assert page2.status_code == 200
    b2 = page2.json()
    ids1 = {e["id"] for e in b1["items"]}
    ids2 = {e["id"] for e in b2["items"]}
    assert ids1.isdisjoint(ids2)


async def test_audit_list_invalid_cursor_returns_400(client):
    _, admin_token = await make_admin(client, "root@example.com")
    r = await client.get(
        "/api/admin/audit?cursor=not-a-real-cursor",
        headers=auth_headers(admin_token),
    )
    assert r.status_code == 400


async def test_audit_list_emits_audit_viewed_self_audit(client):
    admin_id, admin_token = await make_admin(client, "root@example.com")
    await signup(client, "alice@example.com")

    await client.get(
        "/api/admin/audit?event_type=auth.signup",
        headers=auth_headers(admin_token),
    )

    async with SessionLocal() as session:
        result = await session.execute(
            select(AuditLog)
            .where(AuditLog.event_type == "audit.viewed")
            .where(AuditLog.user_id == UUID(admin_id))
        )
        events = list(result.scalars().all())

    assert len(events) == 1
    ev = events[0]
    assert ev.event_data["actor_email"] == "root@example.com"
    assert ev.event_data["filters"] == {"event_type": "auth.signup"}
    assert ev.event_data["result_count"] >= 1


async def test_audit_detail_returns_user_agent_and_event_data(client):
    _, admin_token = await make_admin(client, "root@example.com")
    alice = await signup(client, "alice@example.com")

    async with SessionLocal() as session:
        result = await session.execute(
            select(AuditLog)
            .where(AuditLog.event_type == "auth.signup")
            .where(AuditLog.user_id == UUID(alice["id"]))
        )
        event = result.scalar_one()
        event_id = str(event.id)

    r = await client.get(
        f"/api/admin/audit/{event_id}", headers=auth_headers(admin_token)
    )
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == event_id
    assert body["user_email"] == "alice@example.com"
    assert "user_agent" in body
    assert "event_data" in body
    assert isinstance(body["event_data"], dict)


async def test_audit_detail_unknown_returns_404(client):
    _, admin_token = await make_admin(client, "root@example.com")
    r = await client.get(
        "/api/admin/audit/00000000-0000-0000-0000-000000000000",
        headers=auth_headers(admin_token),
    )
    assert r.status_code == 404


async def test_audit_detail_as_non_admin_returns_403(client):
    _, user_token = await make_active_user(client, "joe@example.com")
    _, admin_token = await make_admin(client, "root@example.com")
    await signup(client, "alice@example.com")

    list_resp = await client.get(
        "/api/admin/audit", headers=auth_headers(admin_token)
    )
    event_id = list_resp.json()["items"][0]["id"]

    r = await client.get(
        f"/api/admin/audit/{event_id}", headers=auth_headers(user_token)
    )
    assert r.status_code == 403


async def test_audit_list_event_has_no_user_has_null_email(client):
    _, admin_token = await make_admin(client, "root@example.com")
    await client.post(
        "/api/auth/login",
        json={"email": "ghost@example.com", "password": "password1234"},
    )

    r = await client.get(
        "/api/admin/audit?event_type=auth.login.failed",
        headers=auth_headers(admin_token),
    )
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) >= 1
    ghost_event = items[0]
    assert ghost_event["user_email"] is None
    assert ghost_event["user_id"] is None
