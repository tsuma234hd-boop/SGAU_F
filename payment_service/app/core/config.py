import os
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class Settings:
    app_name: str
    auth_secret_key: str
    jwt_algorithm: str
    student_service_url: str
    wompi_public_key: str
    wompi_private_key: str
    wompi_events_secret: str
    wompi_integrity_secret: str
    wompi_base_url: str
    payment_link_redirect_url: str
    payment_expiration_minutes: int
    webhook_tolerance_seconds: int
    request_timeout_seconds: int
    log_level: str


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    wompi_environment = os.getenv("WOMPI_ENV", "sandbox").lower()
    default_base_url = "https://sandbox.wompi.co/v1" if wompi_environment == "sandbox" else "https://production.wompi.co/v1"

    return Settings(
        app_name=os.getenv("APP_NAME", "Payment Service"),
        auth_secret_key=os.environ["AUTH_SECRET_KEY"],
        jwt_algorithm=os.getenv("JWT_ALGORITHM", "HS256"),
        student_service_url=os.getenv("STUDENT_SERVICE_URL", "http://student_service:8000"),
        wompi_public_key=os.getenv("WOMPI_PUBLIC_KEY", ""),
        wompi_private_key=os.getenv("WOMPI_PRIVATE_KEY", ""),
        wompi_events_secret=os.getenv("WOMPI_EVENTS_SECRET", ""),
        wompi_integrity_secret=os.getenv("WOMPI_INTEGRITY_SECRET", ""),
        wompi_base_url=os.getenv("WOMPI_BASE_URL", default_base_url),
        payment_link_redirect_url=os.getenv("PAYMENT_LINK_REDIRECT_URL", "http://localhost:8002/dashboard"),
        payment_expiration_minutes=int(os.getenv("PAYMENT_EXPIRATION_MINUTES", "30")),
        webhook_tolerance_seconds=int(os.getenv("WOMPI_WEBHOOK_TOLERANCE_SECONDS", "600")),
        request_timeout_seconds=int(os.getenv("HTTP_TIMEOUT_SECONDS", "15")),
        log_level=os.getenv("LOG_LEVEL", "INFO"),
    )
