# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import AsyncIterator

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .assistant import build_messages, parse_chat_result
from .config import Settings
from .filesystem import FileAccessError, WorkspaceFiles
from .rag import RagIndex
from .schemas import ChatRequest, WriteFileRequest
from .yandex_client import YandexGptClient


TOKEN_RE = re.compile(r"\S+\s*")


def _sse_event(payload: dict[str, object]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _tokenize(text: str) -> list[str]:
    tokens = TOKEN_RE.findall(text)
    return tokens if tokens else [text]


settings = Settings.load()

logging.basicConfig(level=logging.DEBUG if settings.enable_debug_logs else logging.INFO)
logger = logging.getLogger("alice-cursor-ide")

workspace_files = WorkspaceFiles(
    root=settings.workspace_root,
    allowed_extensions=settings.rag_extensions,
    max_file_size_bytes=settings.rag_max_file_size_bytes,
)

rag_index = RagIndex(
    workspace_root=settings.workspace_root,
    allowed_extensions=settings.rag_extensions,
    max_file_size_bytes=settings.rag_max_file_size_bytes,
    max_indexed_files=settings.rag_max_indexed_files,
    chunk_lines=settings.rag_chunk_lines,
    chunk_overlap=settings.rag_chunk_overlap,
)

yandex_client = YandexGptClient(settings)
index_lock = asyncio.Lock()

app = FastAPI(
    title="Alice Cursor IDE MVP",
    version="0.1.0",
    description="Cursor-подобный прототип IDE с YandexGPT.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup() -> None:
    logger.info("Building RAG index from %s ...", settings.workspace_root)
    async with index_lock:
        await asyncio.to_thread(rag_index.build)
    logger.info("RAG index ready. chunks=%s", rag_index.total_chunks)


@app.get("/api/health")
async def health() -> dict[str, object]:
    return {
        "ok": True,
        "workspace_root": str(settings.workspace_root),
        "frontend_dir": str(settings.frontend_dir),
        "rag_chunks": rag_index.total_chunks,
        "yandex_configured": yandex_client.is_configured,
    }


@app.get("/api/files")
async def list_files(limit: int = Query(default=1200, ge=1, le=5000)) -> dict[str, object]:
    try:
        files = await asyncio.to_thread(workspace_files.list_files, limit)
    except OSError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    return {"files": files}


@app.get("/api/file")
async def read_file(path: str = Query(min_length=1)) -> dict[str, str]:
    try:
        content = await asyncio.to_thread(workspace_files.read_text_file, path)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (FileAccessError, IsADirectoryError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"path": path, "content": content}


@app.put("/api/file")
async def write_file(payload: WriteFileRequest) -> JSONResponse:
    try:
        await asyncio.to_thread(workspace_files.write_text_file, payload.path, payload.content)
    except FileAccessError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except OSError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    async with index_lock:
        rag_index.refresh_file(payload.path, payload.content)
    return JSONResponse({"saved": True, "path": payload.path})


@app.post("/api/reindex")
async def reindex() -> dict[str, object]:
    async with index_lock:
        await asyncio.to_thread(rag_index.build)
    return {"ok": True, "chunks": rag_index.total_chunks}


@app.post("/api/chat")
async def chat(payload: ChatRequest) -> StreamingResponse:
    async with index_lock:
        rag_chunks = rag_index.query(
            f"{payload.user_message}\n{payload.file_content}",
            top_k=settings.rag_context_chunks,
        )
    model_messages = build_messages(payload, rag_chunks)

    try:
        model_output = await yandex_client.completion(
            model_messages,
            temperature=payload.temperature,
            max_tokens=payload.max_tokens,
        )
    except httpx.HTTPStatusError as error:
        detail = error.response.text
        raise HTTPException(
            status_code=502,
            detail=f"YandexGPT API error: {error.response.status_code}: {detail}",
        ) from error
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail=f"YandexGPT connection error: {error}") from error

    parsed_result = parse_chat_result(model_output)

    async def event_stream() -> AsyncIterator[str]:
        yield _sse_event({"type": "start"})
        for token in _tokenize(parsed_result.assistant_message):
            yield _sse_event({"type": "token", "content": token})
            await asyncio.sleep(0.005)
        yield _sse_event(
            {
                "type": "result",
                "assistant_message": parsed_result.assistant_message,
                "updated_code": parsed_result.updated_code,
                "raw_response": parsed_result.raw_response,
            }
        )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


if settings.frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(settings.frontend_dir), html=True), name="frontend")
else:
    logger.warning("Frontend directory not found: %s", settings.frontend_dir)
