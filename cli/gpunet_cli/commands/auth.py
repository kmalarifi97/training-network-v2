import typer
from rich.console import Console

from gpunet_cli.client import ApiError, AuthError, GpuNetClient
from gpunet_cli.config import Config
from gpunet_cli.output import emit, error

app = typer.Typer(help="Authenticate with the GPU Network.")
console = Console()


@app.command("set-key")
def set_key(
    ctx: typer.Context,
    api_key: str = typer.Argument(..., help="Your gpuk_… API key"),
    url: str = typer.Option(
        None, "--url", help="Control plane URL (overrides default)"
    ),
):
    """Save an API key to ~/.gpunet/config.yaml."""
    config = Config.load()
    config.api_key = api_key
    if url:
        config.control_plane_url = url
    config.save()
    emit(
        ctx,
        {"saved": True, "control_plane_url": config.control_plane_url},
    )


@app.command("whoami")
def whoami(ctx: typer.Context):
    """Show the current user."""
    config = Config.load()
    try:
        with GpuNetClient(config) as client:
            me = client.whoami()
    except (AuthError, ApiError) as e:
        error(ctx, str(e))
        raise typer.Exit(1)
    emit(ctx, me)


@app.command("logout")
def logout(ctx: typer.Context):
    """Remove the stored API key."""
    config = Config.load()
    config.api_key = None
    config.save()
    emit(ctx, {"logged_out": True})
