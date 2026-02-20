"""
YandexGPT API client with streaming support.
Falls back to a mock response when API keys are not configured.
"""

import json
import logging
from collections.abc import AsyncGenerator

import httpx

from config import settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """Ты — Alice AI, интеллектуальный помощник-программист, встроенный в IDE.
Ты помогаешь разработчикам писать, анализировать, рефакторить и отлаживать код.

Правила:
1. Отвечай точно и по существу.
2. Когда предлагаешь изменения кода, оборачивай их в блоки ```language.
3. Объясняй свои решения кратко.
4. Если пользователь просит изменить код, покажи только изменённые части с достаточным контекстом.
5. Учитывай язык программирования и контекст проекта.
6. Отвечай на том языке, на котором пишет пользователь."""


def _build_messages(messages: list[dict], code_context: str | None = None) -> list[dict]:
    result = []
    system_text = SYSTEM_PROMPT
    if code_context:
        system_text += f"\n\nКонтекст текущего кода:\n{code_context}"

    result.append({"role": "system", "text": system_text})
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "system":
            continue
        result.append({"role": role if role in ("user", "assistant") else "user", "text": content})

    return result


def _is_configured() -> bool:
    return bool(settings.yandex_cloud_api_key and settings.yandex_cloud_folder_id)


async def _mock_stream(messages: list[dict]) -> AsyncGenerator[str, None]:
    """Provide a demo response when YandexGPT credentials aren't configured."""
    user_msg = ""
    for msg in reversed(messages):
        if msg.get("role") == "user":
            user_msg = msg.get("text", msg.get("content", ""))
            break

    demo = (
        "🤖 **Alice AI** (демо-режим)\n\n"
        "YandexGPT API ключи не настроены. Для полноценной работы:\n\n"
        "1. Получите ключ API в [Yandex Cloud](https://cloud.yandex.ru)\n"
        "2. Установите переменные окружения:\n"
        "```bash\n"
        "export ALICE_YANDEX_CLOUD_API_KEY=your-key\n"
        "export ALICE_YANDEX_CLOUD_FOLDER_ID=your-folder-id\n"
        "```\n\n"
        f"Ваш запрос: *{user_msg[:200]}*\n\n"
        "Это демо-ответ. В рабочем режиме здесь будет ответ YandexGPT."
    )
    chunk_size = 15
    for i in range(0, len(demo), chunk_size):
        yield demo[i:i + chunk_size]


async def chat_completion(
    messages: list[dict],
    code_context: str | None = None,
    temperature: float | None = None,
) -> str:
    """Non-streaming completion."""
    if not _is_configured():
        full = ""
        async for chunk in _mock_stream(_build_messages(messages, code_context)):
            full += chunk
        return full

    api_messages = _build_messages(messages, code_context)
    payload = {
        "modelUri": settings.effective_model_uri,
        "completionOptions": {
            "stream": False,
            "temperature": temperature or settings.temperature,
            "maxTokens": str(settings.max_completion_tokens),
        },
        "messages": api_messages,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            settings.yandex_gpt_api_url,
            json=payload,
            headers={
                "Authorization": f"Api-Key {settings.yandex_cloud_api_key}",
                "x-folder-id": settings.yandex_cloud_folder_id,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        alternatives = data.get("result", {}).get("alternatives", [])
        if alternatives:
            return alternatives[0].get("message", {}).get("text", "")
        return ""


async def chat_completion_stream(
    messages: list[dict],
    code_context: str | None = None,
    temperature: float | None = None,
) -> AsyncGenerator[str, None]:
    """Streaming completion via YandexGPT API."""
    if not _is_configured():
        async for chunk in _mock_stream(_build_messages(messages, code_context)):
            yield chunk
        return

    api_messages = _build_messages(messages, code_context)
    payload = {
        "modelUri": settings.effective_model_uri,
        "completionOptions": {
            "stream": True,
            "temperature": temperature or settings.temperature,
            "maxTokens": str(settings.max_completion_tokens),
        },
        "messages": api_messages,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream(
            "POST",
            settings.yandex_gpt_stream_url,
            json=payload,
            headers={
                "Authorization": f"Api-Key {settings.yandex_cloud_api_key}",
                "x-folder-id": settings.yandex_cloud_folder_id,
            },
        ) as response:
            response.raise_for_status()
            buffer = ""
            async for chunk in response.aiter_text():
                buffer += chunk
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        alternatives = data.get("result", {}).get("alternatives", [])
                        if alternatives:
                            text = alternatives[0].get("message", {}).get("text", "")
                            if text:
                                yield text
                    except json.JSONDecodeError:
                        continue


async def get_embeddings(text: str) -> list[float]:
    """Get text embeddings from YandexGPT Embeddings API."""
    if not _is_configured():
        import hashlib
        h = hashlib.md5(text.encode()).hexdigest()
        return [int(c, 16) / 15.0 for c in h[:256].ljust(256, "0")]

    payload = {
        "modelUri": settings.effective_embeddings_model_uri,
        "text": text[:8000],
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            settings.yandex_embeddings_url,
            json=payload,
            headers={
                "Authorization": f"Api-Key {settings.yandex_cloud_api_key}",
                "x-folder-id": settings.yandex_cloud_folder_id,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("embedding", [])


async def inline_completion(
    code_before: str,
    code_after: str,
    language: str,
) -> str:
    """Generate inline code completion."""
    prompt_messages = [
        {
            "role": "user",
            "content": (
                f"Язык: {language}\n"
                f"Допиши код. Верни ТОЛЬКО недостающий код без объяснений.\n\n"
                f"Код до курсора:\n```{language}\n{code_before[-2000:]}\n```\n\n"
                f"Код после курсора:\n```{language}\n{code_after[:1000]}\n```"
            ),
        }
    ]
    return await chat_completion(prompt_messages, temperature=0.1)
