from __future__ import annotations

import json
import logging
import time
from typing import Any

import requests

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class WompiClient:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.base_url = self.settings.wompi_base_url.rstrip("/")
        self.timeout = self.settings.request_timeout_seconds

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        use_private_key: bool = False,
        retries: int = 2,
    ) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        headers = {"Content-Type": "application/json"}
        key = self.settings.wompi_private_key if use_private_key else self.settings.wompi_public_key
        if key:
            headers["Authorization"] = f"Bearer {key}"

        last_exc: Exception | None = None
        for attempt in range(retries + 1):
            try:
                response = requests.request(
                    method=method,
                    url=url,
                    headers=headers,
                    data=json.dumps(body) if body is not None else None,
                    timeout=self.timeout,
                )

                if response.status_code >= 500 and attempt < retries:
                    time.sleep(0.5 * (attempt + 1))
                    continue

                payload = response.json() if response.content else {}
                if response.status_code >= 400:
                    raise RuntimeError(
                        f"Wompi {response.status_code}: {payload if payload else response.text}"
                    )
                return payload if isinstance(payload, dict) else {"data": payload}
            except (requests.RequestException, ValueError, RuntimeError) as exc:
                last_exc = exc
                if attempt >= retries:
                    break
                time.sleep(0.5 * (attempt + 1))

        logger.exception("Error invocando Wompi en %s %s", method, url)
        raise RuntimeError(f"Error al consumir Wompi: {last_exc}") from last_exc

    def get_merchant_info(self) -> dict[str, Any]:
        if not self.settings.wompi_public_key:
            raise RuntimeError("WOMPI_PUBLIC_KEY no está configurada")
        return self._request("GET", f"/merchants/{self.settings.wompi_public_key}")

    def create_payment_link(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.settings.wompi_private_key:
            raise RuntimeError("WOMPI_PRIVATE_KEY no está configurada")
        return self._request("POST", "/payment_links", body=payload, use_private_key=True)

    def create_transaction(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.settings.wompi_private_key:
            raise RuntimeError("WOMPI_PRIVATE_KEY no está configurada")
        return self._request("POST", "/transactions", body=payload, use_private_key=True)

    def get_transaction(self, transaction_id: str) -> dict[str, Any]:
        return self._request("GET", f"/transactions/{transaction_id}", use_private_key=True)

    def get_transactions_by_reference(self, reference: str) -> dict[str, Any]:
        return self._request("GET", f"/transactions?reference={reference}", use_private_key=True)

    def create_refund(self, transaction_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/transactions/{transaction_id}/refunds",
            body=payload,
            use_private_key=True,
        )
