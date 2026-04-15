from fastapi import APIRouter

from app.deps import DbSession
from app.observability import refresh_platform_gauges, render_metrics

router = APIRouter(tags=["metrics"])


@router.get("/metrics", include_in_schema=False)
async def metrics(session: DbSession):
    await refresh_platform_gauges(session)
    return render_metrics()
