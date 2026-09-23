"""API key generation/hashing and the two auth checks (bearer key, admin secret)."""
import hashlib
import hmac
import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from .errors import HubError
from .models import ApiKey

KEY_PREFIX = "lk_"


def generate_key() -> str:
    return KEY_PREFIX + secrets.token_hex(24)  # 48 hex chars


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def display_prefix(key: str) -> str:
    return key[:11]  # "lk_" + 8 hex chars


def bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HubError(401, "unauthorized", "missing Authorization header; use 'Authorization: Bearer <key>'")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HubError(401, "unauthorized", "Authorization header must be 'Bearer <key>'")
    return token.strip()


def authenticate(db: Session, authorization: str | None) -> ApiKey:
    token = bearer_token(authorization)
    key = db.scalar(select(ApiKey).where(ApiKey.key_hash == hash_key(token)))
    if key is None:
        raise HubError(401, "unauthorized", "invalid API key")
    if not key.is_active:
        raise HubError(403, "key_inactive", "this API key is deactivated")
    return key


def check_admin(secret: str | None, expected: str) -> None:
    if not expected:
        raise HubError(503, "admin_disabled", "ADMIN_SECRET is not set on the server")
    if not secret or not hmac.compare_digest(secret.encode(), expected.encode()):
        raise HubError(401, "unauthorized", "invalid or missing X-Admin-Secret")
