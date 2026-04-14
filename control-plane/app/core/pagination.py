import base64
import json
from datetime import datetime
from uuid import UUID


class InvalidCursorError(ValueError):
    pass


def encode_cursor(created_at: datetime, row_id: UUID) -> str:
    payload = {"ts": created_at.isoformat(), "id": str(row_id)}
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, UUID]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("ascii"))
        payload = json.loads(raw.decode("utf-8"))
        return datetime.fromisoformat(payload["ts"]), UUID(payload["id"])
    except (ValueError, KeyError, TypeError) as exc:
        raise InvalidCursorError(f"invalid cursor: {cursor!r}") from exc
