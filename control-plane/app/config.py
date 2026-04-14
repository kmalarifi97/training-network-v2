from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False, extra="ignore")

    app_name: str = "GPU Network Control Plane"
    app_version: str = "0.1.0"
    environment: str = "development"

    database_url: str = "postgresql+asyncpg://gpu:gpu@db:5432/gpu_network"

    jwt_secret: str = "dev-secret-change-in-prod"
    jwt_algorithm: str = "HS256"
    jwt_expire_days: int = 7

    control_plane_public_url: str = "http://localhost:8000"
    claim_token_ttl_hours: int = 24


settings = Settings()
