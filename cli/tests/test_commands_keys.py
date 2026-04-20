import json

import pytest
from typer.testing import CliRunner

from gpunet_cli.main import app


@pytest.fixture
def runner(monkeypatch) -> CliRunner:
    monkeypatch.setenv("GPUNET_API_KEY", "gpuk_testkey")
    monkeypatch.setenv("GPUNET_URL", "http://test")
    return CliRunner()


def test_create_posts_name(runner, httpx_mock):
    httpx_mock.add_response(
        url="http://test/api/keys",
        method="POST",
        json={
            "id": "k1",
            "name": "laptop",
            "prefix": "gpuk_ab",
            "full_key": "gpuk_abcdef",
        },
    )
    result = runner.invoke(app, ["--json", "keys", "create", "laptop"])
    assert result.exit_code == 0, result.output
    body = json.loads(httpx_mock.get_request().read())
    assert body == {"name": "laptop"}
    assert json.loads(result.output)["full_key"] == "gpuk_abcdef"


def test_list_returns_prefixes_only(runner, httpx_mock):
    httpx_mock.add_response(
        url="http://test/api/keys",
        json=[
            {"id": "k1", "name": "laptop", "prefix": "gpuk_ab"},
            {"id": "k2", "name": "ci", "prefix": "gpuk_cd"},
        ],
    )
    result = runner.invoke(app, ["--json", "keys", "list"])
    assert result.exit_code == 0, result.output
    out = json.loads(result.output)
    assert len(out) == 2
    assert all("full_key" not in k for k in out)


def test_revoke_deletes_by_id(runner, httpx_mock):
    httpx_mock.add_response(
        url="http://test/api/keys/k1",
        method="DELETE",
        json={"id": "k1", "revoked": True},
    )
    result = runner.invoke(app, ["--json", "keys", "revoke", "k1"])
    assert result.exit_code == 0, result.output
    assert json.loads(result.output)["revoked"] is True
