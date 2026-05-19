import hashlib
import hmac
import time
from typing import Any


def build_integrity_signature(
    reference: str,
    amount_in_cents: int,
    currency: str,
    integrity_secret: str,
) -> str:
    raw = f"{reference}{amount_in_cents}{currency}{integrity_secret}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _get_nested(payload: dict[str, Any], path: str) -> str:
    current: Any = payload
    for key in path.split("."):
        if not isinstance(current, dict):
            return ""
        current = current.get(key)
    if current is None:
        return ""
    return str(current)


def validate_wompi_webhook_signature(
    payload: dict[str, Any],
    events_secret: str,
    tolerance_seconds: int = 600,
) -> bool:
    if not events_secret:
        return False

    signature = payload.get("signature") or {}
    expected_checksum = str(signature.get("checksum") or "")
    properties = signature.get("properties") or []
    timestamp = payload.get("timestamp")

    if not expected_checksum or not isinstance(properties, list) or timestamp is None:
        return False

    try:
        ts = int(timestamp)
    except (TypeError, ValueError):
        return False

    if abs(int(time.time()) - ts) > tolerance_seconds:
        return False

    joined = "".join(_get_nested(payload, prop) for prop in properties)
    computed = hashlib.sha256(f"{joined}{ts}{events_secret}".encode("utf-8")).hexdigest()
    return hmac.compare_digest(computed, expected_checksum)
