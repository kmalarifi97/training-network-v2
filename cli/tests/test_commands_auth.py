import json

import yaml
from typer.testing import CliRunner

from gpunet_cli import config as config_module
from gpunet_cli.main import app


def test_set_key_writes_yaml_with_url():
    result = CliRunner().invoke(
        app,
        ["--json", "auth", "set-key", "gpuk_newkey", "--url", "http://my-cp:8000"],
    )
    assert result.exit_code == 0, result.output
    data = yaml.safe_load(config_module.CONFIG_PATH.read_text())
    assert data == {"api_key": "gpuk_newkey", "control_plane_url": "http://my-cp:8000"}


def test_set_key_without_url_keeps_default():
    result = CliRunner().invoke(app, ["--json", "auth", "set-key", "gpuk_x"])
    assert result.exit_code == 0, result.output
    data = yaml.safe_load(config_module.CONFIG_PATH.read_text())
    assert data["api_key"] == "gpuk_x"
    assert data["control_plane_url"] == "http://localhost:8000"


def test_logout_clears_key():
    config_module.CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    config_module.CONFIG_PATH.write_text(
        yaml.safe_dump({"api_key": "gpuk_x", "control_plane_url": "http://x"})
    )
    result = CliRunner().invoke(app, ["--json", "auth", "logout"])
    assert result.exit_code == 0, result.output
    assert json.loads(result.output) == {"logged_out": True}
    data = yaml.safe_load(config_module.CONFIG_PATH.read_text())
    assert data["api_key"] is None
    assert data["control_plane_url"] == "http://x"  # URL preserved
