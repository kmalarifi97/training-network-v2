import asyncio
import sys

from sqlalchemy import update

from app.db import SessionLocal
from app.models.user import User


async def _grant_admin(email: str) -> None:
    async with SessionLocal() as session:
        result = await session.execute(
            update(User)
            .where(User.email == email)
            .values(is_admin=True, status="active")
            .returning(User.id)
        )
        row = result.first()
        if row is None:
            print(f"error: no user with email {email!r}", file=sys.stderr)
            sys.exit(1)
        await session.commit()
        print(f"granted admin + active to {email} (id={row[0]})")


def main() -> None:
    argv = sys.argv[1:]
    if len(argv) != 2 or argv[0] != "grant-admin":
        print("usage: python -m app.cli grant-admin <email>", file=sys.stderr)
        sys.exit(2)
    asyncio.run(_grant_admin(argv[1]))


if __name__ == "__main__":
    main()
