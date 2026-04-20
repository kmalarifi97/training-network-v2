import yaml

from gpunet_cli import config as config_module
from gpunet_cli.config import Config


def _write_config_file(data: dict) -> None:
    config_module.CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    config_module.CONFIG_PATH.write_text(yaml.safe_dump(data))


def test_env_beats_file(monkeypatch):
    _write_config_file({"api_key": "from-file", "control_plane_url": "http://file"})
    monkeypatch.setenv("GPUNET_API_KEY", "from-env")
    monkeypatch.setenv("GPUNET_URL", "http://env")
    cfg = Config.load()
    assert cfg.api_key == "from-env"
    assert cfg.control_plane_url == "http://env"


def test_file_when_no_env():
    _write_config_file({"api_key": "from-file", "control_plane_url": "http://file"})
    cfg = Config.load()
    assert cfg.api_key == "from-file"
    assert cfg.control_plane_url == "http://file"


def test_default_url_when_nothing_set():
    cfg = Config.load()
    assert cfg.api_key is None
    assert cfg.control_plane_url == "http://localhost:8000"


def test_save_writes_yaml_with_tight_perms():
    Config(control_plane_url="http://test", api_key="gpuk_x").save()
    assert config_module.CONFIG_PATH.exists()
    data = yaml.safe_load(config_module.CONFIG_PATH.read_text())
    assert data == {"control_plane_url": "http://test", "api_key": "gpuk_x"}
    assert (config_module.CONFIG_PATH.stat().st_mode & 0o777) == 0o600
