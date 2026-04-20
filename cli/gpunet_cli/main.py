import typer

from gpunet_cli import __version__
from gpunet_cli.commands import auth, install, jobs, keys, nodes

app = typer.Typer(
    name="gpunet",
    help="GPU Network CLI — submit jobs, manage nodes, stream logs.",
    no_args_is_help=True,
)


@app.callback()
def root(
    ctx: typer.Context,
    json_output: bool = typer.Option(
        False, "--json", help="Output raw JSON (for scripts and agents)."
    ),
):
    ctx.obj = {"json": json_output}


app.add_typer(auth.app, name="auth")
app.add_typer(nodes.app, name="nodes")
app.add_typer(jobs.app, name="jobs")
app.add_typer(keys.app, name="keys")
app.add_typer(install.app, name="install")


@app.command()
def version():
    """Print the CLI version."""
    typer.echo(f"gpunet-cli {__version__}")


if __name__ == "__main__":
    app()
