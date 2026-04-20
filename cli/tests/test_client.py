import pytest

from gpunet_cli.client import ApiError, AuthError, GpuNetClient
from gpunet_cli.config import Config


def test_constructor_requires_api_key():
    cfg = Config(control_plane_url="http://test", api_key=None)
    with pytest.raises(AuthError, match="No API key"):
        GpuNetClient(cfg)


def test_sends_bearer_token(httpx_mock, config):
    httpx_mock.add_response(url="http://test/api/me", json={"email": "x@y.z"})
    with GpuNetClient(config) as c:
        c.whoami()
    assert httpx_mock.get_request().headers["authorization"] == "Bearer gpuk_testkey"


def test_401_raises_auth_error(httpx_mock, config):
    httpx_mock.add_response(url="http://test/api/me", status_code=401, json={"detail": "bad key"})
    with GpuNetClient(config) as c, pytest.raises(AuthError, match="invalid or revoked"):
        c.whoami()


def test_4xx_raises_api_error_with_detail(httpx_mock, config):
    httpx_mock.add_response(
        url="http://test/api/jobs/abc", status_code=404, json={"detail": "job not found"}
    )
    with GpuNetClient(config) as c, pytest.raises(ApiError) as exc:
        c.get_job("abc")
    assert exc.value.status == 404
    assert "job not found" in exc.value.detail


def test_submit_job_body_includes_preferred_node(httpx_mock, config):
    httpx_mock.add_response(url="http://test/api/jobs", json={"id": "j1"})
    with GpuNetClient(config) as c:
        c.submit_job(
            docker_image="img:1",
            command=["bash", "-c", "echo hi"],
            gpu_count=2,
            max_duration_seconds=60,
            preferred_node_id="node-1",
        )
    body = httpx_mock.get_request().read()
    assert b'"preferred_node_id":"node-1"' in body
    assert b'"gpu_count":2' in body


def test_submit_job_omits_preferred_node_when_none(httpx_mock, config):
    httpx_mock.add_response(url="http://test/api/jobs", json={"id": "j1"})
    with GpuNetClient(config) as c:
        c.submit_job(
            docker_image="img:1",
            command=["echo"],
            gpu_count=1,
            max_duration_seconds=60,
            preferred_node_id=None,
        )
    body = httpx_mock.get_request().read()
    assert b"preferred_node_id" not in body
