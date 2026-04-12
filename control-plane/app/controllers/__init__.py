from fastapi import APIRouter

from app.controllers import health

api_router = APIRouter()
api_router.include_router(health.router)
