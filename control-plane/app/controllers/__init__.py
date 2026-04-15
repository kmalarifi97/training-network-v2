from fastapi import APIRouter

from app.controllers import (
    admin,
    api_keys,
    auth,
    health,
    jobs,
    metrics,
    nodes,
    users,
)

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(admin.router)
api_router.include_router(api_keys.router)
api_router.include_router(nodes.router)
api_router.include_router(jobs.router)
api_router.include_router(metrics.router)
