"""Application configuration loaded from environment variables."""

from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings for the Musabe backend.

    Values are read from environment variables (and a local ``.env`` file).

    The database connection is assembled from the ``POSTGRES_*`` variables.
    An explicit ``DATABASE_URL`` always wins, so a developer can still point
    at SQLite (``sqlite+pysqlite:///./dev.db``) when Postgres is unavailable.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "Musabe Schools Management System"
    environment: str = "development"
    debug: bool = False

    database_url: str = ""
    database_echo: bool = False

    postgres_user: str = "musabe"
    postgres_password: str = "musabe"
    postgres_db: str = "musabe"
    postgres_host: str = "localhost"
    postgres_port: int = 5432

    jwt_secret_key: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7

    #: Comma-separated list of allowed web origins. ``*`` means "any origin"
    #: (development only) and disables credentialed CORS for safety.
    cors_origins: str = "*"

    @model_validator(mode="after")
    def _assemble_database_url(self) -> "Settings":
        """Build a PostgreSQL URL from parts when ``DATABASE_URL`` is not set."""
        if not self.database_url:
            self.database_url = (
                f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
                f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
            )
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        """Return the configured CORS origins as a list."""
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """Return a cached :class:`Settings` instance."""
    return Settings()


settings = get_settings()
