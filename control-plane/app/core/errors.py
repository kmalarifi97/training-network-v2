class DomainError(Exception):
    pass


class EmailAlreadyExists(DomainError):
    def __init__(self, email: str) -> None:
        super().__init__(f"Email already registered: {email}")
        self.email = email


class InvalidCredentials(DomainError):
    def __init__(self) -> None:
        super().__init__("Invalid email or password")


class UserNotFound(DomainError):
    pass


class AuditEventNotFound(DomainError):
    pass


class ApiKeyNotFound(DomainError):
    pass


class ApiKeyNotOwned(DomainError):
    def __init__(self) -> None:
        super().__init__("API key does not belong to the current user")


class NotAHost(DomainError):
    def __init__(self) -> None:
        super().__init__("User is not authorized to host GPU nodes")


class NodeNotFound(DomainError):
    pass


class NodeBusy(DomainError):
    def __init__(self, node_id: str) -> None:
        super().__init__(
            f"Node {node_id} has a running job; drain it before disconnecting"
        )
        self.node_id = node_id


class NodeNotDraining(DomainError):
    def __init__(self, node_id: str, current_status: str) -> None:
        super().__init__(
            f"Node {node_id} is not draining (status={current_status})"
        )
        self.node_id = node_id
        self.current_status = current_status


class ClaimTokenInvalid(DomainError):
    def __init__(self, reason: str) -> None:
        super().__init__(f"Claim token is invalid: {reason}")
        self.reason = reason


class AccountNotActive(DomainError):
    def __init__(self, status: str) -> None:
        super().__init__(f"Account is {status}; contact an administrator")
        self.status = status


class InvalidPaginationCursor(DomainError):
    def __init__(self) -> None:
        super().__init__("Invalid pagination cursor")


class InsufficientCredits(DomainError):
    def __init__(self, required_hours: float, available_hours: int) -> None:
        super().__init__(
            f"Insufficient GPU-hour credits: requires {required_hours:.4f}, "
            f"have {available_hours}"
        )
        self.required_hours = required_hours
        self.available_hours = available_hours


class JobNotFound(DomainError):
    pass


class JobNotOwned(DomainError):
    def __init__(self) -> None:
        super().__init__("Job does not belong to the current user")


class InvalidJobTransition(DomainError):
    def __init__(self, from_status: str, to_status: str) -> None:
        super().__init__(f"Cannot transition job from {from_status} to {to_status}")
        self.from_status = from_status
        self.to_status = to_status
