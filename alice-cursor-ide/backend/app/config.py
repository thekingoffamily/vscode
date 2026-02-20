# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _get_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _get_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    return int(value)


@dataclass(frozen=True)
class Settings:
    workspace_root: Path
    frontend_dir: Path
    yandex_api_url: str
    yandex_folder_id: str
    yandex_api_key: str
    yandex_iam_token: str
    yandex_model_uri: str
    yandex_timeout_seconds: int
    rag_chunk_lines: int
    rag_chunk_overlap: int
    rag_context_chunks: int
    rag_max_indexed_files: int
    rag_max_file_size_bytes: int
    rag_extensions: tuple[str, ...]
    enable_debug_logs: bool

    @staticmethod
    def load() -> "Settings":
        workspace_root = Path(os.getenv("ALICE_IDE_WORKSPACE", "/workspace")).resolve()
        frontend_dir = Path(os.getenv("ALICE_IDE_FRONTEND_DIR", "/app/frontend")).resolve()
        folder_id = os.getenv("YANDEX_FOLDER_ID", "").strip()
        default_model_uri = (
            f"gpt://{folder_id}/yandexgpt-lite/latest"
            if folder_id
            else "gpt://<FOLDER_ID>/yandexgpt-lite/latest"
        )
        extensions_env = os.getenv(
            "ALICE_IDE_RAG_EXTENSIONS",
            ".py,.ts,.tsx,.js,.jsx,.json,.yml,.yaml,.toml,.md,.go,.rs,.java,.kt,.cpp,.c,.h,.hpp,.cs,.php,.rb,.swift,.sql,.sh",
        )
        extensions = tuple(
            ext if ext.startswith(".") else f".{ext}"
            for ext in (item.strip().lower() for item in extensions_env.split(","))
            if ext
        )
        return Settings(
            workspace_root=workspace_root,
            frontend_dir=frontend_dir,
            yandex_api_url=os.getenv(
                "YANDEX_API_URL",
                "https://llm.api.cloud.yandex.net/foundationModels/v1/completion",
            ).strip(),
            yandex_folder_id=folder_id,
            yandex_api_key=os.getenv("YANDEX_API_KEY", "").strip(),
            yandex_iam_token=os.getenv("YANDEX_IAM_TOKEN", "").strip(),
            yandex_model_uri=os.getenv("YANDEX_MODEL_URI", default_model_uri).strip(),
            yandex_timeout_seconds=_get_int("YANDEX_TIMEOUT_SECONDS", 120),
            rag_chunk_lines=_get_int("ALICE_IDE_RAG_CHUNK_LINES", 80),
            rag_chunk_overlap=_get_int("ALICE_IDE_RAG_CHUNK_OVERLAP", 12),
            rag_context_chunks=_get_int("ALICE_IDE_RAG_CONTEXT_CHUNKS", 5),
            rag_max_indexed_files=_get_int("ALICE_IDE_RAG_MAX_FILES", 1200),
            rag_max_file_size_bytes=_get_int("ALICE_IDE_RAG_MAX_FILE_SIZE_BYTES", 350_000),
            rag_extensions=extensions,
            enable_debug_logs=_get_bool("ALICE_IDE_DEBUG", False),
        )
