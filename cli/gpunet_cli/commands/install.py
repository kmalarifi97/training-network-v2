import shutil
from pathlib import Path

import typer

from gpunet_cli.output import emit, error

app = typer.Typer(help="Install agent integrations (Claude Code skill, etc.).")


def _skill_source() -> Path:
    # skills/ is shipped next to the package dir, via pyproject include
    here = Path(__file__).resolve().parent.parent.parent
    return here / "skills" / "gpu-network"


@app.command("skill")
def install_skill(
    ctx: typer.Context,
    force: bool = typer.Option(False, "--force", help="Overwrite existing skill"),
):
    """Install the Claude Code skill to ~/.claude/skills/gpu-network/."""
    src = _skill_source()
    if not src.exists():
        error(ctx, f"Skill source not found at {src}")
        raise typer.Exit(1)

    dst = Path.home() / ".claude" / "skills" / "gpu-network"
    if dst.exists() and not force:
        error(
            ctx,
            f"{dst} already exists. Re-run with --force to overwrite.",
        )
        raise typer.Exit(1)

    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    emit(ctx, {"installed": str(dst)})
