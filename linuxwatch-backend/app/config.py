import os


def _bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


class Settings:
    database_url: str = os.environ.get("DATABASE_URL", "postgresql://linuxwatch:linuxwatch@localhost:5432/linuxwatch")
    secret_key: str = os.environ.get("LW_SECRET_KEY", "")
    encryption_key: str = os.environ.get("LW_ENCRYPTION_KEY", "")
    cors_origins: list = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
    access_token_hours: int = int(os.environ.get("ACCESS_TOKEN_HOURS", "12"))
    remember_me_days: int = int(os.environ.get("REMEMBER_ME_DAYS", "30"))
    offline_after_sec: int = int(os.environ.get("OFFLINE_AFTER_SEC", "90"))
    metric_retention_days: int = int(os.environ.get("METRIC_RETENTION_DAYS", "30"))
    log_retention_days: int = int(os.environ.get("LOG_RETENTION_DAYS", "14"))
    allow_private_webhooks: bool = _bool("ALLOW_PRIVATE_WEBHOOKS", False)
    public_url: str = os.environ.get("PUBLIC_URL", "http://localhost:8000").rstrip("/")
    agent_dir: str = os.environ.get("AGENT_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "agent"))
    schema_path: str = os.environ.get("SCHEMA_PATH", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "db", "schema.sql"))

    def validate(self) -> None:
        if len(self.secret_key) < 32 or self.secret_key.startswith("change-me"):
            raise RuntimeError("LW_SECRET_KEY must be set to a random string of at least 32 characters.")


settings = Settings()
