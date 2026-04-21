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
    # Where the browser-facing UI lives — used to build verify_url for
    # device-code onboarding (agent prints "visit <ui_public_url>/activate").
    # The UI is served from a different origin than the API in prod
    # (UI :3001, API :8000), so this is separate from control_plane_public_url.
    ui_public_url: str = "http://localhost:3001"
    claim_token_ttl_hours: int = 24


settings = Settings()
