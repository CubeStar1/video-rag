from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    video_db_api_key: str = ""
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    allowed_origins: str = "http://localhost:3000"

    # Understanding pipeline tuning. Lower = cheaper/faster, higher = better retrieval.
    vlm_model: str = "basic"
    vlm_frame_count: int = 4
    transform_resolution: str = "480p"
    shot_threshold: int = 30
    min_scene_len: int = 15

    # How long a background indexing job may run before it is marked failed.
    index_timeout_seconds: int = 3600
    index_poll_seconds: int = 15

    @property
    def origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
