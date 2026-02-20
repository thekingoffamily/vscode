# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from __future__ import annotations

import json
from typing import Any

import httpx

from .config import Settings


class YandexGptClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    @property
    def is_configured(self) -> bool:
        has_auth = bool(self._settings.yandex_api_key or self._settings.yandex_iam_token)
        return has_auth and bool(self._settings.yandex_folder_id)

    def _build_headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._settings.yandex_api_key:
            headers["Authorization"] = f"Api-Key {self._settings.yandex_api_key}"
        elif self._settings.yandex_iam_token:
            headers["Authorization"] = f"Bearer {self._settings.yandex_iam_token}"
        return headers

    async def completion(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float,
        max_tokens: int,
    ) -> str:
        if not self.is_configured:
            fallback = {
                "assistant_message": (
                    "YandexGPT не настроен. Добавьте YANDEX_FOLDER_ID и YANDEX_API_KEY "
                    "или YANDEX_IAM_TOKEN в .env, затем повторите запрос."
                ),
                "updated_code": None,
            }
            return json.dumps(fallback, ensure_ascii=False)

        payload: dict[str, Any] = {
            "modelUri": self._settings.yandex_model_uri,
            "completionOptions": {
                "stream": False,
                "temperature": temperature,
                "maxTokens": str(max_tokens),
            },
            "messages": [{"role": msg["role"], "text": msg["text"]} for msg in messages],
        }

        async with httpx.AsyncClient(timeout=self._settings.yandex_timeout_seconds) as client:
            response = await client.post(
                self._settings.yandex_api_url,
                headers=self._build_headers(),
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        alternatives = data.get("result", {}).get("alternatives", [])
        if not alternatives:
            return json.dumps(
                {
                    "assistant_message": "Модель не вернула ответ. Повторите попытку.",
                    "updated_code": None,
                },
                ensure_ascii=False,
            )

        return str(alternatives[0].get("message", {}).get("text", "")).strip()
