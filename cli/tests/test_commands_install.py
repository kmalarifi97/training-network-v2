import json
from pathlib import Path

from typer.testing import CliRunner

from gpunet_cli.main import app


def test_install_skill_copies_to_home(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    result = CliRunner().invoke(app, ["--json", "install", "skill"])
    assert result.exit_code == 0, result.output
    out = json.loads(result.output)
    expected = tmp_path / ".claude" / "skills" / "gpu-network"
    assert Path(out["installed"]) == expected
    assert (expected / "SKILL.md").exists()


def test_install_skill_refuses_to_overwrite(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    dst = tmp_path / ".claude" / "skills" / "gpu-network"
    dst.mkdir(parents=True)
    (dst / "SKILL.md").write_text("old content")

    result = CliRunner().invoke(app, ["--json", "install", "skill"])
    assert result.exit_code == 1
    assert "already exists" in json.loads(result.output)["error"]
    assert (dst / "SKILL.md").read_text() == "old content"  # untouched


def test_install_skill_force_overwrites(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    dst = tmp_path / ".claude" / "skills" / "gpu-network"
    dst.mkdir(parents=True)
    (dst / "SKILL.md").write_text("old content")

    result = CliRunner().invoke(app, ["--json", "install", "skill", "--force"])
    assert result.exit_code == 0, result.output
    assert (dst / "SKILL.md").read_text() != "old content"
