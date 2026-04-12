async def test_signup_returns_201_and_pending_user(client):
    response = await client.post(
        "/api/auth/signup",
        json={"email": "alice@example.com", "password": "password123"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["email"] == "alice@example.com"
    assert data["status"] == "pending"
    assert data["can_host"] is False
    assert data["can_rent"] is True
    assert "id" in data


async def test_signup_duplicate_email_returns_400(client):
    payload = {"email": "bob@example.com", "password": "password123"}
    first = await client.post("/api/auth/signup", json=payload)
    assert first.status_code == 201

    second = await client.post("/api/auth/signup", json=payload)
    assert second.status_code == 400


async def test_signup_short_password_returns_422(client):
    response = await client.post(
        "/api/auth/signup",
        json={"email": "short@example.com", "password": "abc"},
    )
    assert response.status_code == 422


async def test_signup_invalid_email_returns_422(client):
    response = await client.post(
        "/api/auth/signup",
        json={"email": "not-an-email", "password": "password123"},
    )
    assert response.status_code == 422


async def test_login_returns_bearer_token(client):
    signup = await client.post(
        "/api/auth/signup",
        json={"email": "carol@example.com", "password": "password123"},
    )
    assert signup.status_code == 201

    login = await client.post(
        "/api/auth/login",
        json={"email": "carol@example.com", "password": "password123"},
    )
    assert login.status_code == 200
    data = login.json()
    assert data["token_type"] == "bearer"
    assert isinstance(data["access_token"], str)
    assert data["expires_in_seconds"] > 0


async def test_login_wrong_password_returns_401(client):
    signup = await client.post(
        "/api/auth/signup",
        json={"email": "dave@example.com", "password": "password123"},
    )
    assert signup.status_code == 201

    login = await client.post(
        "/api/auth/login",
        json={"email": "dave@example.com", "password": "wrongpassword"},
    )
    assert login.status_code == 401


async def test_login_unknown_email_returns_401(client):
    login = await client.post(
        "/api/auth/login",
        json={"email": "ghost@example.com", "password": "password123"},
    )
    assert login.status_code == 401


async def test_me_returns_current_user(client):
    await client.post(
        "/api/auth/signup",
        json={"email": "eve@example.com", "password": "password123"},
    )
    login = await client.post(
        "/api/auth/login",
        json={"email": "eve@example.com", "password": "password123"},
    )
    token = login.json()["access_token"]

    me = await client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    body = me.json()
    assert body["email"] == "eve@example.com"
    assert body["status"] == "pending"


async def test_me_without_token_returns_401(client):
    me = await client.get("/api/me")
    assert me.status_code == 401


async def test_me_with_invalid_token_returns_401(client):
    me = await client.get("/api/me", headers={"Authorization": "Bearer garbage"})
    assert me.status_code == 401
