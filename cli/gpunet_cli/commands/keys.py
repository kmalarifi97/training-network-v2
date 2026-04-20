import typer

from gpunet_cli.client import ApiError, AuthError, GpuNetClient
from gpunet_cli.config import Config
from gpunet_cli.output import emit, error

app = typer.Typer(help="Manage API keys.")


def _client_or_exit(ctx: typer.Context) -> GpuNetClient:
    try:
        return GpuNetClient(Config.load())
    except AuthError as e:
        error(ctx, str(e))
        raise typer.Exit(1)


@app.command("create")
def create(ctx: typer.Context, name: str = typer.Argument(...)):
    """Generate a new API key. The full key is shown ONCE."""
    with _client_or_exit(ctx) as c:
        try:
            key = c._request("POST", "/api/keys", json={"name": name})
        except ApiError as e:
            error(ctx, str(e))
            raise typer.Exit(1)
    emit(ctx, key)


@app.command("list")
def list_keys(ctx: typer.Context):
    """List your API keys (prefixes only)."""
    with _client_or_exit(ctx) as c:
        try:
            keys = c._request("GET", "/api/keys")
        except ApiError as e:
            error(ctx, str(e))
            raise typer.Exit(1)
    emit(ctx, keys)


@app.command("revoke")
def revoke(ctx: typer.Context, key_id: str = typer.Argument(...)):
    """Revoke an API key by its UUID."""
    with _client_or_exit(ctx) as c:
        try:
            key = c._request("DELETE", f"/api/keys/{key_id}")
        except ApiError as e:
            error(ctx, str(e))
            raise typer.Exit(1)
    emit(ctx, key)
