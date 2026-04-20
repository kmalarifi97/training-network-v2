import json as _json
from typing import Iterable

import typer
from rich.console import Console
from rich.table import Table

console = Console()


def _json_mode(ctx: typer.Context) -> bool:
    return bool(ctx.obj and ctx.obj.get("json"))


def emit(ctx: typer.Context, data) -> None:
    """Render data as JSON (if --json) or as a human-friendly view."""
    if _json_mode(ctx):
        typer.echo(_json.dumps(data, indent=2, default=str))
        return

    if isinstance(data, list):
        if not data:
            console.print("(no items)")
            return
        _human_table(data)
    elif isinstance(data, dict):
        for k, v in data.items():
            console.print(f"[bold]{k}[/bold]: {v}")
    else:
        console.print(str(data))


def _human_table(rows: list[dict], columns: Iterable[str] | None = None) -> None:
    cols = list(columns) if columns else list(rows[0].keys())
    table = Table()
    for c in cols:
        table.add_column(c)
    for row in rows:
        table.add_row(*[_short(row.get(c)) for c in cols])
    console.print(table)


def _short(value) -> str:
    if value is None:
        return "-"
    s = str(value)
    return s if len(s) <= 40 else s[:37] + "..."


def error(ctx: typer.Context, message: str) -> None:
    if _json_mode(ctx):
        typer.echo(_json.dumps({"error": message}))
    else:
        console.print(f"[red]✗[/red] {message}")
