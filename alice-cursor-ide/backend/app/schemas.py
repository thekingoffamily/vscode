# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1)


class ChatRequest(BaseModel):
    file_path: str = Field(min_length=1)
    file_content: str
    user_message: str = Field(min_length=1)
    history: list[ChatMessage] = Field(default_factory=list)
    temperature: float = Field(default=0.2, ge=0.0, le=1.0)
    max_tokens: int = Field(default=1400, ge=128, le=6000)


class ChatResult(BaseModel):
    assistant_message: str
    updated_code: str | None = None
    raw_response: str | None = None


class WriteFileRequest(BaseModel):
    path: str = Field(min_length=1)
    content: str
