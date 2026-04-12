from fastapi import FastAPI

from app.config import settings
from app.controllers import api_router

app = FastAPI(title=settings.app_name, version=settings.app_version)
app.include_router(api_router)
