from tests.helpers import (
    audit_events_for_user,
    auth_headers,
    login,
    make_active_user,
    make_admin,
    set_user_flags,
    signup,
)


async def test_list_users_without_token_returns_401(client):
    r = await client.get("/api/admin/users")
    assert r.status_code == 401


async def test_list_users_as_non_admin_returns_403(client):
    _, user_token = await make_active_user(client, "plain@example.com")
    r = await client.get("/api/admin/users", headers=auth_headers(user_token))
    assert r.status_code == 403


async def test_admin_lists_all_users(client):
    _, token = await make_admin(client, "root@example.com")
    await signup(client, "alpha@example.com")
    await signup(client, "beta@example.com")

    r = await client.get("/api/admin/users", headers=auth_headers(token))

    assert r.status_code == 200
    body = r.json()
    emails = {u["email"] for u in body["items"]}
    assert {"root@example.com", "alpha@example.com", "beta@example.com"} <= emails


async def test_admin_filter_by_status(client):
    await make_admin(client, "root@example.com")
    await signup(client, "pending1@example.com")
    await signup(client, "pending2@example.com")
    await signup(client, "active1@example.com")
    await set_user_flags("active1@example.com", status="active")

    token = await login(client, "root@example.com")
    r = await client.get(
        "/api/admin/users?status=pending", headers=auth_headers(token)
    )

    assert r.status_code == 200
    body = r.json()
    statuses = {u["status"] for u in body["items"]}
    assert statuses == {"pending"}
    emails = {u["email"] for u in body["items"]}
    assert "active1@example.com" not in emails


async def test_admin_search_by_email_is_case_insensitive_substring(client):
    await make_admin(client, "root@example.com")
    await signup(client, "Carol@Company.com")
    await signup(client, "dave@other.com")

    token = await login(client, "root@example.com")
    r = await client.get("/api/admin/users?email=carol", headers=auth_headers(token))

    assert r.status_code == 200
    emails = [u["email"] for u in r.json()["items"]]
    assert emails == ["Carol@company.com"]


async def test_admin_list_paginates_with_cursor(client):
    await make_admin(client, "root@example.com")
    for i in range(6):
        await signup(client, f"u{i}@example.com")
    token = await login(client, "root@example.com")

    page1 = await client.get("/api/admin/users?limit=3", headers=auth_headers(token))
    assert page1.status_code == 200
    body1 = page1.json()
    assert len(body1["items"]) == 3
    assert body1["next_cursor"] is not None

    page2 = await client.get(
        f"/api/admin/users?limit=3&cursor={body1['next_cursor']}",
        headers=auth_headers(token),
    )
    assert page2.status_code == 200
    body2 = page2.json()
    assert len(body2["items"]) == 3
    ids1 = {u["id"] for u in body1["items"]}
    ids2 = {u["id"] for u in body2["items"]}
    assert ids1.isdisjoint(ids2)


async def test_admin_list_invalid_cursor_returns_400(client):
    await make_admin(client, "root@example.com")
    token = await login(client, "root@example.com")
    r = await client.get(
        "/api/admin/users?cursor=not-a-real-cursor", headers=auth_headers(token)
    )
    assert r.status_code == 400


async def test_admin_get_user_detail_includes_signup_ip(client):
    await make_admin(client, "root@example.com")
    alice = await signup(client, "alice@example.com")
    token = await login(client, "root@example.com")

    r = await client.get(
        f"/api/admin/users/{alice['id']}", headers=auth_headers(token)
    )
    assert r.status_code == 200
    body = r.json()
    assert body["email"] == "alice@example.com"
    assert body["status"] == "pending"
    assert "signup_ip_address" in body


async def test_admin_get_unknown_user_returns_404(client):
    await make_admin(client, "root@example.com")
    token = await login(client, "root@example.com")
    r = await client.get(
        "/api/admin/users/00000000-0000-0000-0000-000000000000",
        headers=auth_headers(token),
    )
    assert r.status_code == 404


async def test_admin_approve_sets_active_and_flags(client):
    admin_id, admin_token = await make_admin(client, "root@example.com")
    target = await signup(client, "bob@example.com")

    r = await client.post(
        f"/api/admin/users/{target['id']}/approve",
        headers=auth_headers(admin_token),
        json={"can_host": True, "credits_gpu_hours": 10},
    )
    assert r.status_code == 200, r.text
    user = r.json()["user"]
    assert user["status"] == "active"
    assert user["can_host"] is True
    assert user["credits_gpu_hours"] == 10

    token = await login(client, "bob@example.com")
    me = await client.get("/api/me", headers=auth_headers(token))
    assert me.status_code == 200
    body = me.json()
    assert body["status"] == "active"
    assert body["can_host"] is True
    assert body["credits_gpu_hours"] == 10


async def test_admin_approve_emits_audit_event_with_actor(client):
    admin_id, admin_token = await make_admin(client, "root@example.com")
    target = await signup(client, "carol@example.com")

    await client.post(
        f"/api/admin/users/{target['id']}/approve",
        headers=auth_headers(admin_token),
        json={"can_host": False, "credits_gpu_hours": 5},
    )

    events = await audit_events_for_user(target["id"], event_type="user.approved")
    assert len(events) == 1
    ev = events[0]
    assert ev.event_data["actor_user_id"] == admin_id
    assert ev.event_data["actor_email"] == "root@example.com"
    assert ev.event_data["can_host"] is False
    assert ev.event_data["credits_gpu_hours"] == 5


async def test_admin_approve_unknown_user_returns_404(client):
    _, admin_token = await make_admin(client, "root@example.com")
    r = await client.post(
        "/api/admin/users/00000000-0000-0000-0000-000000000000/approve",
        headers=auth_headers(admin_token),
        json={"can_host": False, "credits_gpu_hours": 0},
    )
    assert r.status_code == 404


async def test_approve_as_non_admin_returns_403(client):
    _, user_token = await make_active_user(client, "joe@example.com")
    target = await signup(client, "victim@example.com")
    r = await client.post(
        f"/api/admin/users/{target['id']}/approve",
        headers=auth_headers(user_token),
        json={"can_host": True, "credits_gpu_hours": 100},
    )
    assert r.status_code == 403


async def test_admin_approve_is_idempotent_on_already_active(client):
    _, admin_token = await make_admin(client, "root@example.com")
    target = await signup(client, "eva@example.com")

    r1 = await client.post(
        f"/api/admin/users/{target['id']}/approve",
        headers=auth_headers(admin_token),
        json={"can_host": False, "credits_gpu_hours": 1},
    )
    assert r1.status_code == 200
    r2 = await client.post(
        f"/api/admin/users/{target['id']}/approve",
        headers=auth_headers(admin_token),
        json={"can_host": True, "credits_gpu_hours": 99},
    )
    assert r2.status_code == 200
    assert r2.json()["user"]["can_host"] is True
    assert r2.json()["user"]["credits_gpu_hours"] == 99

    events = await audit_events_for_user(target["id"], event_type="user.approved")
    assert len(events) == 2


async def test_admin_suspend_sets_suspended_and_emits_audit(client):
    admin_id, admin_token = await make_admin(client, "root@example.com")
    target_id, _ = await make_active_user(client, "bad@example.com")

    r = await client.post(
        f"/api/admin/users/{target_id}/suspend",
        headers=auth_headers(admin_token),
    )
    assert r.status_code == 200
    assert r.json()["user"]["status"] == "suspended"

    events = await audit_events_for_user(target_id, event_type="user.suspended")
    assert len(events) == 1
    assert events[0].event_data["actor_user_id"] == admin_id


async def test_suspend_as_non_admin_returns_403(client):
    _, user_token = await make_active_user(client, "joe@example.com")
    target = await signup(client, "victim@example.com")
    r = await client.post(
        f"/api/admin/users/{target['id']}/suspend",
        headers=auth_headers(user_token),
    )
    assert r.status_code == 403


async def test_admin_suspend_unknown_user_returns_404(client):
    _, admin_token = await make_admin(client, "root@example.com")
    r = await client.post(
        "/api/admin/users/00000000-0000-0000-0000-000000000000/suspend",
        headers=auth_headers(admin_token),
    )
    assert r.status_code == 404
