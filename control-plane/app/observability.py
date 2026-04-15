"""Prometheus instrumentation: HTTP middleware, gauges populated on scrape.

Counters/histograms accumulate naturally over the process lifetime. Gauges
that reflect DB-derived state (jobs/nodes by status, GPU telemetry) are
recomputed inside the /metrics handler from the latest rows so a process
restart returns to consistent values without a warm-up window.
"""
from __future__ import annotations

from datetime import UTC, datetime
from time import perf_counter

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    REGISTRY,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.models.job import Job
from app.models.node import Node
from app.models.node_metric import NodeMetric
from app.services.node_status import compute_node_status

NODE_STATUSES = ("online", "offline", "draining")
JOB_STATUSES = ("queued", "running", "completed", "failed", "cancelled")

http_requests_total = Counter(
    "http_requests_total",
    "Count of HTTP requests by method, path template, and status code",
    ["method", "path", "status"],
)
http_request_duration_seconds = Histogram(
    "http_request_duration_seconds",
    "HTTP request duration in seconds, labelled by method and path template",
    ["method", "path"],
)
jobs_in_status = Gauge(
    "jobs_in_status",
    "Number of jobs in each status",
    ["status"],
)
nodes_in_status = Gauge(
    "nodes_in_status",
    "Number of nodes in each computed status",
    ["status"],
)
gpu_utilization_pct = Gauge(
    "gpu_utilization_pct",
    "Per-GPU utilization, last reported sample",
    ["node_id", "gpu_index"],
)
gpu_memory_used_bytes = Gauge(
    "gpu_memory_used_bytes",
    "Per-GPU memory used in bytes, last reported sample",
    ["node_id", "gpu_index"],
)
gpu_memory_total_bytes = Gauge(
    "gpu_memory_total_bytes",
    "Per-GPU memory total in bytes, last reported sample",
    ["node_id", "gpu_index"],
)
gpu_temperature_celsius = Gauge(
    "gpu_temperature_celsius",
    "Per-GPU temperature in Celsius, last reported sample",
    ["node_id", "gpu_index"],
)


class HTTPMetricsMiddleware(BaseHTTPMiddleware):
    """Records request count and latency, labelled by route template (not raw
    path) so URL parameters don't explode label cardinality. /metrics is
    excluded so a Prometheus scrape doesn't pollute the metrics it scrapes."""

    async def dispatch(self, request: Request, call_next):
        start = perf_counter()
        response = await call_next(request)
        elapsed = perf_counter() - start
        path = _route_template(request)
        if path == "/metrics":
            return response
        http_requests_total.labels(
            method=request.method, path=path, status=str(response.status_code)
        ).inc()
        http_request_duration_seconds.labels(
            method=request.method, path=path
        ).observe(elapsed)
        return response


def _route_template(request: Request) -> str:
    route = request.scope.get("route")
    template = getattr(route, "path", None)
    return template or request.url.path


async def refresh_platform_gauges(session: AsyncSession) -> None:
    jobs_in_status.clear()
    nodes_in_status.clear()
    gpu_utilization_pct.clear()
    gpu_memory_used_bytes.clear()
    gpu_memory_total_bytes.clear()
    gpu_temperature_celsius.clear()

    job_rows = await session.execute(
        select(Job.status, func.count(Job.id)).group_by(Job.status)
    )
    job_counts = {s: 0 for s in JOB_STATUSES}
    for status, count in job_rows.all():
        if status in job_counts:
            job_counts[status] = count
    for status, count in job_counts.items():
        jobs_in_status.labels(status=status).set(count)

    nodes_result = await session.execute(select(Node))
    nodes = list(nodes_result.scalars().all())
    now = datetime.now(UTC)
    node_counts = {s: 0 for s in NODE_STATUSES}
    for n in nodes:
        node_counts[compute_node_status(n, now)] += 1
    for status, count in node_counts.items():
        nodes_in_status.labels(status=status).set(count)

    metric_rows = await session.execute(select(NodeMetric))
    for m in metric_rows.scalars().all():
        labels = {"node_id": str(m.node_id), "gpu_index": str(m.gpu_index)}
        gpu_utilization_pct.labels(**labels).set(m.utilization_pct)
        gpu_memory_used_bytes.labels(**labels).set(m.memory_used_bytes)
        gpu_memory_total_bytes.labels(**labels).set(m.memory_total_bytes)
        gpu_temperature_celsius.labels(**labels).set(m.temperature_c)


def render_metrics(registry: CollectorRegistry = REGISTRY) -> Response:
    return Response(content=generate_latest(registry), media_type=CONTENT_TYPE_LATEST)
