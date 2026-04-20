import shlex
import time

import typer

from gpunet_cli.client import ApiError, AuthError, GpuNetClient
from gpunet_cli.config import Config
from gpunet_cli.output import emit, error

app = typer.Typer(help="Submit, inspect, and control GPU jobs.")


def _client_or_exit(ctx: typer.Context) -> GpuNetClient:
    try:
        return GpuNetClient(Config.load())
    except AuthError as e:
        error(ctx, str(e))
        raise typer.Exit(1)


@app.command("submit")
def submit(
    ctx: typer.Context,
    image: str = typer.Option(..., "--image", help="Docker image, e.g. user/llm:v1"),
    cmd: str = typer.Option(..., "--cmd", help="Shell command to run inside the container"),
    gpus: int = typer.Option(1, "--gpus", min=1, help="GPU count"),
    max_seconds: int = typer.Option(600, "--max-seconds", min=1),
    node: str | None = typer.Option(None, "--node", help="Preferred node UUID"),
):
    """Submit a raw job (image + shell command)."""
    with _client_or_exit(ctx) as c:
        try:
            job = c.submit_job(
                docker_image=image,
                command=["bash", "-c", cmd],
                gpu_count=gpus,
                max_duration_seconds=max_seconds,
                preferred_node_id=node,
            )
        except ApiError as e:
            error(ctx, str(e))
            raise typer.Exit(1)
    emit(ctx, job)


@app.command("run")
def run(
    ctx: typer.Context,
    repo: str = typer.Option(..., "--repo", help="Git URL to clone inside the container"),
    entrypoint: str = typer.Option(
        ..., "--entrypoint", help="Command to execute after cloning the repo"
    ),
    image: str = typer.Option(..., "--image", help="Docker image"),
    gpus: int = typer.Option(1, "--gpus", min=1),
    max_seconds: int = typer.Option(600, "--max-seconds", min=1),
    node: str | None = typer.Option(None, "--node"),
    wait: bool = typer.Option(False, "--wait", help="Block until the job finishes"),
):
    """High-level: clone a repo and run a command inside the container."""
    glue = f"git clone {shlex.quote(repo)} repo && cd repo && {entrypoint}"
    with _client_or_exit(ctx) as c:
        try:
            job = c.submit_job(
                docker_image=image,
                command=["bash", "-c", glue],
                gpu_count=gpus,
                max_duration_seconds=max_seconds,
                preferred_node_id=node,
            )
        except ApiError as e:
            error(ctx, str(e))
            raise typer.Exit(1)
        if not wait:
            emit(ctx, job)
            return
        final = _wait_for_terminal(c, job["id"])
    emit(ctx, final)


@app.command("list")
def list_jobs(
    ctx: typer.Context,
    status: str | None = typer.Option(None, "--status"),
    limit: int = typer.Option(50, "--limit", min=1, max=200),
):
    """List your jobs."""
    with _client_or_exit(ctx) as c:
        try:
            page = c.list_jobs(status=status, limit=limit)
        except ApiError as e:
            error(ctx, str(e))
            raise typer.Exit(1)
    emit(ctx, page.get("items", []))


@app.command("status")
def status_cmd(ctx: typer.Context, job_id: str = typer.Argument(...)):
    """Show a single job."""
    with _client_or_exit(ctx) as c:
        try:
            job = c.get_job(job_id)
        except ApiError as e:
            error(ctx, str(e))
            raise typer.Exit(1)
    emit(ctx, job)


@app.command("cancel")
def cancel(ctx: typer.Context, job_id: str = typer.Argument(...)):
    """Cancel a queued or running job."""
    with _client_or_exit(ctx) as c:
        try:
            job = c.cancel_job(job_id)
        except ApiError as e:
            error(ctx, str(e))
            raise typer.Exit(1)
    emit(ctx, job)


@app.command("logs")
def logs(
    ctx: typer.Context,
    job_id: str = typer.Argument(...),
    follow: bool = typer.Option(False, "--follow", "-f", help="Poll until terminal"),
    interval: float = typer.Option(2.0, "--interval"),
):
    """Fetch job logs. With --follow, polls until the job reaches a terminal state."""
    after = -1
    with _client_or_exit(ctx) as c:
        while True:
            try:
                page = c.get_logs(job_id, after_sequence=after, limit=500)
            except ApiError as e:
                error(ctx, str(e))
                raise typer.Exit(1)
            for entry in page.get("items", []):
                typer.echo(entry["content"])
                after = entry["sequence"]
            if not follow:
                return
            job = c.get_job(job_id)
            if job["status"] in {"completed", "failed", "cancelled"}:
                return
            time.sleep(interval)


def _wait_for_terminal(client: GpuNetClient, job_id: str, interval: float = 3.0) -> dict:
    while True:
        job = client.get_job(job_id)
        if job["status"] in {"completed", "failed", "cancelled"}:
            return job
        time.sleep(interval)
