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


class AccountNotActive(DomainError):
    def __init__(self, status: str) -> None:
        super().__init__(f"Account is {status}; contact an administrator")
        self.status = status


class InvalidPaginationCursor(DomainError):
    def __init__(self) -> None:
        super().__init__("Invalid pagination cursor")
