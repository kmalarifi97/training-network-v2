from app.core.errors import InvalidJobTransition

QUEUED = "queued"
RUNNING = "running"
COMPLETED = "completed"
FAILED = "failed"
CANCELLED = "cancelled"

TERMINAL_STATUSES = frozenset({COMPLETED, FAILED, CANCELLED})

ALLOWED_TRANSITIONS = frozenset(
    {
        (QUEUED, RUNNING),
        (QUEUED, CANCELLED),
        (RUNNING, COMPLETED),
        (RUNNING, FAILED),
        (RUNNING, CANCELLED),
    }
)


def assert_transition(from_status: str, to_status: str) -> None:
    if (from_status, to_status) not in ALLOWED_TRANSITIONS:
        raise InvalidJobTransition(from_status, to_status)
