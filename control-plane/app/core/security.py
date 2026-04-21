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

CLAIM_TOKEN_PREFIX = "gpuclaim_"
CLAIM_TOKEN_RANDOM_BYTES = 24
CLAIM_TOKEN_LOOKUP_PREFIX_LENGTH = 12

AGENT_TOKEN_PREFIX = "gpuagent_"
AGENT_TOKEN_RANDOM_BYTES = 24
AGENT_TOKEN_LOOKUP_PREFIX_LENGTH = 12

POLLING_TOKEN_PREFIX = "gpudev_"
POLLING_TOKEN_RANDOM_BYTES = 24
POLLING_TOKEN_LOOKUP_PREFIX_LENGTH = 12

# Crockford-ish alphabet — excludes 0/O/1/I/L/U so humans can't confuse them
DEVICE_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
DEVICE_CODE_GROUP_LENGTH = 4


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


def generate_claim_token() -> tuple[str, str, str]:
    """Create a fresh node claim token. Returns (plaintext, lookup_prefix, bcrypt_hash)."""
    token = CLAIM_TOKEN_PREFIX + secrets.token_urlsafe(CLAIM_TOKEN_RANDOM_BYTES)
    lookup_prefix = token[:CLAIM_TOKEN_LOOKUP_PREFIX_LENGTH]
    token_hash = bcrypt.hashpw(
        token.encode("utf-8"), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)
    ).decode("utf-8")
    return token, lookup_prefix, token_hash


def verify_claim_token(plain_token: str, hashed_token: str) -> bool:
    return bcrypt.checkpw(plain_token.encode("utf-8"), hashed_token.encode("utf-8"))


def claim_token_lookup_prefix(plain_token: str) -> str:
    return plain_token[:CLAIM_TOKEN_LOOKUP_PREFIX_LENGTH]


def generate_agent_token() -> tuple[str, str, str]:
    """Create a fresh per-node agent token. Returns (plaintext, lookup_prefix, bcrypt_hash)."""
    token = AGENT_TOKEN_PREFIX + secrets.token_urlsafe(AGENT_TOKEN_RANDOM_BYTES)
    lookup_prefix = token[:AGENT_TOKEN_LOOKUP_PREFIX_LENGTH]
    token_hash = bcrypt.hashpw(
        token.encode("utf-8"), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)
    ).decode("utf-8")
    return token, lookup_prefix, token_hash


def verify_agent_token(plain_token: str, hashed_token: str) -> bool:
    return bcrypt.checkpw(plain_token.encode("utf-8"), hashed_token.encode("utf-8"))


def agent_token_lookup_prefix(plain_token: str) -> str:
    return plain_token[:AGENT_TOKEN_LOOKUP_PREFIX_LENGTH]


def generate_polling_token() -> tuple[str, str, str]:
    """Create a fresh device-code polling token. Returns (plaintext, lookup_prefix, bcrypt_hash)."""
    token = POLLING_TOKEN_PREFIX + secrets.token_urlsafe(POLLING_TOKEN_RANDOM_BYTES)
    lookup_prefix = token[:POLLING_TOKEN_LOOKUP_PREFIX_LENGTH]
    token_hash = bcrypt.hashpw(
        token.encode("utf-8"), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)
    ).decode("utf-8")
    return token, lookup_prefix, token_hash


def verify_polling_token(plain_token: str, hashed_token: str) -> bool:
    return bcrypt.checkpw(plain_token.encode("utf-8"), hashed_token.encode("utf-8"))


def polling_token_lookup_prefix(plain_token: str) -> str:
    return plain_token[:POLLING_TOKEN_LOOKUP_PREFIX_LENGTH]


def generate_device_code() -> str:
    """Generate an 8-char human-typeable code formatted as XXXX-XXXX."""
    part1 = "".join(secrets.choice(DEVICE_CODE_ALPHABET) for _ in range(DEVICE_CODE_GROUP_LENGTH))
    part2 = "".join(secrets.choice(DEVICE_CODE_ALPHABET) for _ in range(DEVICE_CODE_GROUP_LENGTH))
    return f"{part1}-{part2}"


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
