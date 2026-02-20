"""
YandexGPT API Client for Alice IDE.
Uses Yandex Cloud Foundational Models API (YandexGPT).
Documentation: https://cloud.yandex.ru/docs/ai/llm/api-ref/TextGeneration/
"""

import os
import json
import httpx
from typing import AsyncGenerator


class YandexGPTClient:
    """Client for YandexGPT API with streaming support."""

    def __init__(
        self,
        api_key: str | None = None,
        folder_id: str | None = None,
        model: str = "yandexgpt/latest",
    ):
        self.api_key = api_key or os.getenv("YANDEX_API_KEY")
        self.folder_id = folder_id or os.getenv("YANDEX_FOLDER_ID")
        self.model = model
        self.base_url = "https://llm.api.cloud.yandex.net/foundationModels/v1"

        if not self.api_key:
            raise ValueError("YANDEX_API_KEY is required")
        if not self.folder_id:
            raise ValueError("YANDEX_FOLDER_ID is required")

    def _get_headers(self) -> dict:
        return {
            "Authorization": f"Api-Key {self.api_key}",
            "Content-Type": "application/json",
            "x-folder-id": self.folder_id,
        }

    def _build_messages(
        self,
        user_message: str,
        code_context: str | None = None,
        chat_history: list[dict] | None = None,
    ) -> list[dict]:
        """Build messages for the API including system prompt."""
        system_content = """Ты — Алиса, опытный senior-разработчик и AI-помощник в IDE.
Твоя задача — помогать пользователю писать, анализировать и рефакторить код.
Отвечай на русском языке, если вопрос на русском. Для кода используй markdown с указанием языка.
При генерации кода возвращай ТОЛЬКО код без пояснений, если пользователь просит "применить" или "заменить".
Используй точный формат: ```language\\nкод\\n``` для блоков кода."""

        if code_context:
            system_content += f"\n\nКонтекст текущего файла:\n```\n{code_context}\n```"

        messages = [
            {"role": "system", "text": system_content},
        ]

        if chat_history:
            for msg in chat_history[-10:]:  # Last 10 messages for context
                role = "user" if msg.get("role") == "user" else "model"
                messages.append({"role": role, "text": msg.get("content", "")})

        messages.append({"role": "user", "text": user_message})
        return messages

    async def chat(
        self,
        message: str,
        code_context: str | None = None,
        chat_history: list[dict] | None = None,
    ) -> str:
        """Send a chat message and get full response."""
        messages = self._build_messages(message, code_context, chat_history)
        # Yandex API uses "model" and "messages" in different format
        payload = {
            "modelUri": f"gpt://{self.folder_id}/{self.model}",
            "completionOptions": {
                "stream": False,
                "temperature": 0.3,
                "maxTokens": 2000,
            },
            "messages": [{"role": m["role"], "text": m["text"]} for m in messages],
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{self.base_url}/completion",
                headers=self._get_headers(),
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            return data.get("result", {}).get("alternatives", [{}])[0].get("message", {}).get("text", "")

    async def chat_stream(
        self,
        message: str,
        code_context: str | None = None,
        chat_history: list[dict] | None = None,
    ) -> AsyncGenerator[str, None]:
        """Stream chat response token by token."""
        messages = self._build_messages(message, code_context, chat_history)
        payload = {
            "modelUri": f"gpt://{self.folder_id}/{self.model}",
            "completionOptions": {
                "stream": True,
                "temperature": 0.3,
                "maxTokens": 2000,
            },
            "messages": [{"role": m["role"], "text": m["text"]} for m in messages],
        }

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/completion",
                    headers=self._get_headers(),
                    json=payload,
                ) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if line.startswith("data:"):
                            data_str = line[5:].strip()
                            if data_str == "[DONE]" or not data_str:
                                continue
                            try:
                                data = json.loads(data_str)
                                text = (
                                    data.get("result", {})
                                    .get("alternatives", [{}])[0]
                                    .get("message", {})
                                    .get("text", "")
                                )
                                if text:
                                    yield text
                            except json.JSONDecodeError:
                                continue
        except Exception:
            # Fallback: use non-streaming and yield full response
            full = await self.chat(message, code_context, chat_history)
            if full:
                yield full
