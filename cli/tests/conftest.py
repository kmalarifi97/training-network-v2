import pytest

from gpunet_cli.config import Config


@pytest.fixture
def config() -> Config:
    return Config(control_plane_url="http://test", api_key="gpuk_testkey")


@pytest.fixture(autouse=True)
def isolate_config(tmp_path, monkeypatch):
    """Redirect ~/.gpunet to a tmp dir so tests never touch the real config."""
    monkeypatch.setattr(
        "gpunet_cli.config.CONFIG_DIR", tmp_path / ".gpunet"
    )
    monkeypatch.setattr(
        "gpunet_cli.config.CONFIG_PATH", tmp_path / ".gpunet" / "config.yaml"
    )
    monkeypatch.delenv("GPUNET_API_KEY", raising=False)
    monkeypatch.delenv("GPUNET_URL", raising=False)
