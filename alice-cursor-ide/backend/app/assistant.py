# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from __future__ import annotations

import json
import re
from json import JSONDecodeError

from .rag import Chunk
from .schemas import ChatRequest, ChatResult


SYSTEM_PROMPT = """\
Ты работаешь как AI-ассистент внутри IDE в стиле Cursor.
Тебе дают текущий файл и релевантные фрагменты проекта.
Твоя задача:
1) Кратко объяснить решение.
2) Если нужно изменить текущий файл — вернуть полный обновленный код файла.

ВАЖНО:
- Отвечай строго JSON-объектом без Markdown и без дополнительных полей.
- Формат:
{
  "assistant_message": "краткое объяснение",
  "updated_code": "полный текст файла после изменений или null, если менять файл не нужно"
}
- Если правка не нужна, обязательно поставь "updated_code": null.
- Сохраняй существующую функциональность и стиль кода.
"""


def build_messages(request: ChatRequest, chunks: list[Chunk]) -> list[dict[str, str]]:
    context_parts = []
    for chunk in chunks:
        context_parts.append(
            f"[{chunk.path}:{chunk.start_line}-{chunk.end_line}]\n{chunk.content}"
        )
    rag_context = "\n\n".join(context_parts) if context_parts else "(релевантный контекст не найден)"

    user_payload = (
        "Запрос пользователя:\n"
        f"{request.user_message.strip()}\n\n"
        "Текущий файл:\n"
        f"path: {request.file_path}\n"
        "```file\n"
        f"{request.file_content}\n"
        "```\n\n"
        "Релевантный контекст проекта:\n"
        f"{rag_context}\n"
    )

    messages: list[dict[str, str]] = [{"role": "system", "text": SYSTEM_PROMPT}]
    for item in request.history[-8:]:
        role = "assistant" if item.role == "assistant" else "user"
        messages.append({"role": role, "text": item.content})
    messages.append({"role": "user", "text": user_payload})
    return messages


def _extract_json_payload(raw_text: str) -> dict[str, object]:
    stripped = raw_text.strip()
    if not stripped:
        raise JSONDecodeError("Empty model response", raw_text, 0)

    if stripped.startswith("```"):
        code_block_match = re.search(r"```(?:json)?\s*(\{.*\})\s*```", stripped, flags=re.S)
        if code_block_match:
            stripped = code_block_match.group(1).strip()

    try:
        return json.loads(stripped)
    except JSONDecodeError:
        first_brace = stripped.find("{")
        last_brace = stripped.rfind("}")
        if first_brace == -1 or last_brace == -1 or first_brace >= last_brace:
            raise
        return json.loads(stripped[first_brace:last_brace + 1])


def parse_chat_result(raw_text: str) -> ChatResult:
    fallback_message = raw_text.strip() or "Модель вернула пустой ответ."
    try:
        payload = _extract_json_payload(raw_text)
    except JSONDecodeError:
        return ChatResult(assistant_message=fallback_message, updated_code=None, raw_response=raw_text)

    assistant_message = str(payload.get("assistant_message") or "").strip()
    updated_code = payload.get("updated_code")
    normalized_updated_code: str | None
    if updated_code is None:
        normalized_updated_code = None
    else:
        normalized_updated_code = str(updated_code)

    if not assistant_message:
        assistant_message = "Готово."

    return ChatResult(
        assistant_message=assistant_message,
        updated_code=normalized_updated_code,
        raw_response=raw_text,
    )
