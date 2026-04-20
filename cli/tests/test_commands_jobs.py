import json

import pytest
from typer.testing import CliRunner

from gpunet_cli.main import app


@pytest.fixture
def runner(monkeypatch) -> CliRunner:
    """CLI runner with env-based auth so no config file is read."""
    monkeypatch.setenv("GPUNET_API_KEY", "gpuk_testkey")
    monkeypatch.setenv("GPUNET_URL", "http://test")
    return CliRunner()


def test_submit_wraps_cmd_in_bash_c(runner, httpx_mock):
    """Raw shell string gets wrapped as ['bash', '-c', <cmd>] for the API."""
    httpx_mock.add_response(url="http://test/api/jobs", json={"id": "j1", "status": "queued"})
    result = runner.invoke(
        app,
        [
            "--json", "jobs", "submit",
            "--image", "nvidia/cuda:12.2",
            "--cmd", "nvidia-smi",
            "--gpus", "1",
            "--max-seconds", "120",
        ],
    )
    assert result.exit_code == 0, result.output
    body = json.loads(httpx_mock.get_request().read())
    assert body["command"] == ["bash", "-c", "nvidia-smi"]
    assert body["docker_image"] == "nvidia/cuda:12.2"
    assert body["gpu_count"] == 1


def test_json_flag_emits_valid_json(runner, httpx_mock):
    httpx_mock.add_response(url="http://test/api/me", json={"email": "x@y.z", "is_admin": False})
    result = runner.invoke(app, ["--json", "auth", "whoami"])
    assert result.exit_code == 0
    parsed = json.loads(result.output)
    assert parsed["email"] == "x@y.z"


def test_run_builds_git_clone_glue(runner, httpx_mock):
    httpx_mock.add_response(url="http://test/api/jobs", json={"id": "j1", "status": "queued"})
    result = runner.invoke(
        app,
        [
            "--json", "jobs", "run",
            "--repo", "https://github.com/user/repo.git",
            "--entrypoint", "python train.py",
            "--image", "pytorch/pytorch:latest",
            "--gpus", "1",
            "--max-seconds", "600",
        ],
    )
    assert result.exit_code == 0, result.output
    body = json.loads(httpx_mock.get_request().read())
    assert body["command"][0] == "bash"
    assert body["command"][1] == "-c"
    glue = body["command"][2]
    assert "git clone" in glue
    assert "https://github.com/user/repo.git" in glue
    assert "cd repo" in glue
    assert "python train.py" in glue
    assert "&&" in glue  # sequential, not ; (don't run entrypoint if clone fails)


def test_submit_passes_preferred_node(runner, httpx_mock):
    httpx_mock.add_response(url="http://test/api/jobs", json={"id": "j1"})
    result = runner.invoke(
        app,
        [
            "--json", "jobs", "submit",
            "--image", "img:1", "--cmd", "echo hi",
            "--gpus", "1", "--max-seconds", "60",
            "--node", "node-uuid-123",
        ],
    )
    assert result.exit_code == 0, result.output
    body = json.loads(httpx_mock.get_request().read())
    assert body["preferred_node_id"] == "node-uuid-123"


def test_list_jobs_uses_status_filter(runner, httpx_mock):
    httpx_mock.add_response(
        url="http://test/api/jobs?limit=50&status=running",
        json={"items": [{"id": "j1", "status": "running"}]},
    )
    result = runner.invoke(app, ["--json", "jobs", "list", "--status", "running"])
    assert result.exit_code == 0, result.output
    assert json.loads(result.output)[0]["id"] == "j1"


def test_cancel_posts_to_cancel_endpoint(runner, httpx_mock):
    httpx_mock.add_response(
        url="http://test/api/jobs/abc/cancel",
        method="POST",
        json={"id": "abc", "status": "cancelled"},
    )
    result = runner.invoke(app, ["--json", "jobs", "cancel", "abc"])
    assert result.exit_code == 0, result.output
    assert json.loads(result.output)["status"] == "cancelled"


def test_api_error_is_reported_as_json_error(runner, httpx_mock):
    httpx_mock.add_response(
        url="http://test/api/jobs/missing",
        status_code=404,
        json={"detail": "job not found"},
    )
    result = runner.invoke(app, ["--json", "jobs", "status", "missing"])
    assert result.exit_code == 1
    assert json.loads(result.output)["error"].startswith("HTTP 404")


def test_auth_error_when_no_key(monkeypatch, httpx_mock):
    """No key → AuthError before any HTTP happens; --json emits {error: ...}."""
    monkeypatch.delenv("GPUNET_API_KEY", raising=False)
    monkeypatch.delenv("GPUNET_URL", raising=False)
    result = CliRunner().invoke(app, ["--json", "auth", "whoami"])
    assert result.exit_code == 1
    assert "No API key" in json.loads(result.output)["error"]


def test_logs_single_page_prints_content(runner, httpx_mock):
    httpx_mock.add_response(
        url="http://test/api/jobs/j1/logs?after_sequence=-1&limit=500",
        json={"items": [
            {"sequence": 0, "content": "line 1"},
            {"sequence": 1, "content": "line 2"},
        ]},
    )
    result = runner.invoke(app, ["jobs", "logs", "j1"])
    assert result.exit_code == 0, result.output
    assert "line 1" in result.output
    assert "line 2" in result.output


def test_logs_follow_polls_until_terminal(runner, httpx_mock, monkeypatch):
    """--follow loops: fetch logs, check status, sleep, repeat — until terminal."""
    monkeypatch.setattr("gpunet_cli.commands.jobs.time.sleep", lambda _: None)

    # iter 1: logs then status=running
    httpx_mock.add_response(
        url="http://test/api/jobs/j1/logs?after_sequence=-1&limit=500",
        json={"items": [{"sequence": 0, "content": "first"}]},
    )
    httpx_mock.add_response(url="http://test/api/jobs/j1", json={"id": "j1", "status": "running"})
    # iter 2: more logs, status=completed → exit
    httpx_mock.add_response(
        url="http://test/api/jobs/j1/logs?after_sequence=0&limit=500",
        json={"items": [{"sequence": 1, "content": "second"}]},
    )
    httpx_mock.add_response(url="http://test/api/jobs/j1", json={"id": "j1", "status": "completed"})

    result = runner.invoke(app, ["jobs", "logs", "j1", "--follow"])
    assert result.exit_code == 0, result.output
    assert "first" in result.output
    assert "second" in result.output


def test_run_wait_polls_until_terminal(runner, httpx_mock, monkeypatch):
    monkeypatch.setattr("gpunet_cli.commands.jobs.time.sleep", lambda _: None)
    httpx_mock.add_response(
        url="http://test/api/jobs",
        method="POST",
        json={"id": "j1", "status": "queued"},
    )
    httpx_mock.add_response(url="http://test/api/jobs/j1", json={"id": "j1", "status": "running"})
    httpx_mock.add_response(
        url="http://test/api/jobs/j1",
        json={"id": "j1", "status": "completed", "exit_code": 0},
    )

    result = runner.invoke(
        app,
        [
            "--json", "jobs", "run",
            "--repo", "https://x/y.git",
            "--entrypoint", "echo hi",
            "--image", "img:1",
            "--gpus", "1", "--max-seconds", "60",
            "--wait",
        ],
    )
    assert result.exit_code == 0, result.output
    # Final emit is the completed job, not the queued submit
    out = json.loads(result.output)
    assert out["status"] == "completed"
    assert out["exit_code"] == 0
