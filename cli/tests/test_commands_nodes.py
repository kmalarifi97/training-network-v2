import json

import pytest
from typer.testing import CliRunner

from gpunet_cli.main import app


@pytest.fixture
def runner(monkeypatch) -> CliRunner:
    monkeypatch.setenv("GPUNET_API_KEY", "gpuk_testkey")
    monkeypatch.setenv("GPUNET_URL", "http://test")
    return CliRunner()


def test_list_hits_nodes_endpoint(runner, httpx_mock):
    httpx_mock.add_response(
        url="http://test/api/nodes",
        json=[{"id": "n1", "handle": "@me", "status": "online"}],
    )
    result = runner.invoke(app, ["--json", "nodes", "list"])
    assert result.exit_code == 0, result.output
    assert json.loads(result.output)[0]["handle"] == "@me"


def test_marketplace_hits_marketplace_endpoint(runner, httpx_mock):
    httpx_mock.add_response(
        url="http://test/api/nodes/marketplace",
        json=[{"id": "n1", "handle": "@ahmad.ml", "gpu_model": "RTX 4090"}],
    )
    result = runner.invoke(app, ["--json", "nodes", "marketplace"])
    assert result.exit_code == 0, result.output
    assert json.loads(result.output)[0]["handle"] == "@ahmad.ml"


def test_show_hits_node_detail_endpoint(runner, httpx_mock):
    httpx_mock.add_response(
        url="http://test/api/nodes/node-abc",
        json={"id": "node-abc", "gpu_count": 2},
    )
    result = runner.invoke(app, ["--json", "nodes", "show", "node-abc"])
    assert result.exit_code == 0, result.output
    assert json.loads(result.output)["gpu_count"] == 2


def test_show_404_is_reported(runner, httpx_mock):
    httpx_mock.add_response(
        url="http://test/api/nodes/missing",
        status_code=404,
        json={"detail": "node not found"},
    )
    result = runner.invoke(app, ["--json", "nodes", "show", "missing"])
    assert result.exit_code == 1
    assert "HTTP 404" in json.loads(result.output)["error"]


def test_marketplace_empty_list(runner, httpx_mock):
    httpx_mock.add_response(url="http://test/api/nodes/marketplace", json=[])
    result = runner.invoke(app, ["--json", "nodes", "marketplace"])
    assert result.exit_code == 0, result.output
    assert json.loads(result.output) == []
