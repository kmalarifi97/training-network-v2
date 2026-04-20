import os
from dataclasses import dataclass
from pathlib import Path

import yaml

CONFIG_DIR = Path.home() / ".gpunet"
CONFIG_PATH = CONFIG_DIR / "config.yaml"

DEFAULT_CONTROL_PLANE = "http://localhost:8000"


@dataclass
class Config:
    control_plane_url: str
    api_key: str | None

    @classmethod
    def load(cls) -> "Config":
        file_data: dict = {}
        if CONFIG_PATH.exists():
            file_data = yaml.safe_load(CONFIG_PATH.read_text()) or {}

        return cls(
            control_plane_url=os.environ.get("GPUNET_URL")
            or file_data.get("control_plane_url")
            or DEFAULT_CONTROL_PLANE,
            api_key=os.environ.get("GPUNET_API_KEY") or file_data.get("api_key"),
        )

    def save(self) -> None:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        CONFIG_PATH.write_text(
            yaml.safe_dump(
                {"control_plane_url": self.control_plane_url, "api_key": self.api_key}
            )
        )
        CONFIG_PATH.chmod(0o600)
