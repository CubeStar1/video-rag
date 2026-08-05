from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    video_db_api_key: str = ""
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    allowed_origins: str = "http://localhost:3000"
    log_level: str = "INFO"

    # Suffix on every index name. An index name is a schema contract that VideoDB keeps
    # at collection level *and never releases* — deleting the indexes and the videos
    # does not free the name, so a name whose shape has changed is burned for good.
    # Bump this to claim a fresh set. Must match INDEX_GENERATION in the frontend.
    index_generation: str = "v2"

    # Understanding pipeline tuning. Lower = cheaper/faster, higher = better retrieval.
    vlm_model: str = "basic"
    vlm_frame_count: int = 4
    # Object detection samples on a clock instead of a frame budget, and takes a
    # detection model rather than a VLM tier. Leave the model at "default": naming
    # `rtdetr-v2-r50vd` requires a running sandbox and fails without one.
    object_detection_model: str = "default"
    object_interval_seconds: int = 1
    transform_resolution: str = "480p"
    # Defaults for whichever segmentation type the caller picks at ingest time.
    segmentation_type: str = "shot"
    shot_threshold: int = 30
    min_scene_len: int = 15
    time_segment_seconds: int = 10

    # How long a background indexing job may run before it is marked failed.
    index_timeout_seconds: int = 3600
    index_poll_seconds: int = 15

    @property
    def origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
