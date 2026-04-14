import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import JWTError, jwt

from app.config import settings

BCRYPT_ROUNDS = 12

API_KEY_PREFIX = "gpuk_"
API_KEY_RANDOM_BYTES = 24
API_KEY_LOOKUP_PREFIX_LENGTH = 12


def hash_password(plain_password: str) -> str:
    return bcrypt.hashpw(
        plain_password.encode("utf-8"),
        bcrypt.gensalt(rounds=BCRYPT_ROUNDS),
    ).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(
        plain_password.encode("utf-8"),
        hashed_password.encode("utf-8"),
    )


def generate_api_key() -> tuple[str, str, str]:
    """Create a fresh API key. Returns (plaintext, lookup_prefix, bcrypt_hash)."""
    token = API_KEY_PREFIX + secrets.token_urlsafe(API_KEY_RANDOM_BYTES)
    lookup_prefix = token[:API_KEY_LOOKUP_PREFIX_LENGTH]
    key_hash = bcrypt.hashpw(
        token.encode("utf-8"), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)
    ).decode("utf-8")
    return token, lookup_prefix, key_hash


def verify_api_key(plain_key: str, hashed_key: str) -> bool:
    return bcrypt.checkpw(plain_key.encode("utf-8"), hashed_key.encode("utf-8"))


def api_key_lookup_prefix(plain_key: str) -> str:
    return plain_key[:API_KEY_LOOKUP_PREFIX_LENGTH]


def create_access_token(subject: str, expires_delta: timedelta | None = None) -> str:
    if expires_delta is None:
        expires_delta = timedelta(days=settings.jwt_expire_days)
    expire = datetime.now(timezone.utc) + expires_delta
    payload: dict[str, Any] = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None
