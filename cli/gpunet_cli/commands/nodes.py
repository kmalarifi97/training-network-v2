import typer

from gpunet_cli.client import ApiError, AuthError, GpuNetClient
from gpunet_cli.config import Config
from gpunet_cli.output import emit, error

app = typer.Typer(help="Browse GPU nodes on the network.")


def _client_or_exit(ctx: typer.Context) -> GpuNetClient:
    try:
        return GpuNetClient(Config.load())
    except AuthError as e:
        error(ctx, str(e))
        raise typer.Exit(1)


@app.command("list")
def list_nodes(ctx: typer.Context):
    """List GPU nodes you own."""
    with _client_or_exit(ctx) as c:
        try:
            nodes = c.list_nodes()
        except ApiError as e:
            error(ctx, str(e))
            raise typer.Exit(1)
    emit(ctx, nodes)


@app.command("marketplace")
def marketplace(ctx: typer.Context):
    """Browse all online nodes on the network (host handle visible)."""
    with _client_or_exit(ctx) as c:
        try:
            nodes = c.list_marketplace()
        except ApiError as e:
            error(ctx, str(e))
            raise typer.Exit(1)
    emit(ctx, nodes)


@app.command("show")
def show(ctx: typer.Context, node_id: str = typer.Argument(...)):
    """Show detailed info for a single node."""
    with _client_or_exit(ctx) as c:
        try:
            node = c.get_node(node_id)
        except ApiError as e:
            error(ctx, str(e))
            raise typer.Exit(1)
    emit(ctx, node)
