from typing import Any

import httpx

from gpunet_cli.config import Config


class AuthError(Exception):
    pass


class ApiError(Exception):
    def __init__(self, status: int, detail: str):
        self.status = status
        self.detail = detail
        super().__init__(f"HTTP {status}: {detail}")


class GpuNetClient:
    def __init__(self, config: Config):
        if not config.api_key:
            raise AuthError(
                "No API key configured. Run `gpunet auth set-key <key>` first."
            )
        self._http = httpx.Client(
            base_url=config.control_plane_url,
            headers={"Authorization": f"Bearer {config.api_key}"},
            timeout=30.0,
        )

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "GpuNetClient":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        response = self._http.request(method, path, **kwargs)
        if response.status_code == 401:
            raise AuthError("API key is invalid or revoked.")
        if response.status_code >= 400:
            try:
                detail = response.json().get("detail", response.text)
            except Exception:
                detail = response.text
            raise ApiError(response.status_code, str(detail))
        if response.status_code == 204:
            return None
        return response.json()

    def whoami(self) -> dict:
        return self._request("GET", "/api/me")

    def list_nodes(self) -> list[dict]:
        return self._request("GET", "/api/nodes")

    def list_marketplace(self) -> list[dict]:
        return self._request("GET", "/api/nodes/marketplace")

    def get_node(self, node_id: str) -> dict:
        return self._request("GET", f"/api/nodes/{node_id}")

    def submit_job(
        self,
        docker_image: str,
        command: list[str],
        gpu_count: int,
        max_duration_seconds: int,
        preferred_node_id: str | None = None,
    ) -> dict:
        body = {
            "docker_image": docker_image,
            "command": command,
            "gpu_count": gpu_count,
            "max_duration_seconds": max_duration_seconds,
        }
        if preferred_node_id:
            body["preferred_node_id"] = preferred_node_id
        return self._request("POST", "/api/jobs", json=body)

    def list_jobs(self, status: str | None = None, limit: int = 50) -> dict:
        params: dict[str, Any] = {"limit": limit}
        if status:
            params["status"] = status
        return self._request("GET", "/api/jobs", params=params)

    def get_job(self, job_id: str) -> dict:
        return self._request("GET", f"/api/jobs/{job_id}")

    def cancel_job(self, job_id: str) -> dict:
        return self._request("POST", f"/api/jobs/{job_id}/cancel")

    def get_logs(self, job_id: str, after_sequence: int = -1, limit: int = 500) -> dict:
        return self._request(
            "GET",
            f"/api/jobs/{job_id}/logs",
            params={"after_sequence": after_sequence, "limit": limit},
        )
