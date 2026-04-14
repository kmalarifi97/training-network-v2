# Operator scripts

One-shot admin utilities. Run inside the control-plane container (never on the host).

## Grant the first admin

The `is_admin` flag is set only from trusted scripts, not via the API. To promote
the first operator after they sign up, run:

```bash
docker compose exec -T control-plane python -m app.cli grant-admin ops@example.com
```

The script also flips the user to `status=active`, so the promoted admin can log
in immediately without waiting for a separate approval.

Exit code `0` on success, `1` if the email is unknown, `2` on bad arguments.
