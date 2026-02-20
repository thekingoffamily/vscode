"""
Alice IDE Backend — FastAPI server providing YandexGPT-powered AI assistance.
"""

import json
import logging
import os
from pathlib import Path

import aiofiles
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from config import settings
from models import (
    ApplyChangeRequest,
    ChatRequest,
    FileNode,
    IndexRequest,
    IndexStatus,
    InlineCompletionRequest,
)
from rag import build_code_context, index_workspace, search_relevant_code, vector_store
from yandex_gpt import chat_completion, chat_completion_stream, inline_completion

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Alice IDE Backend",
    description="AI-powered IDE backend using YandexGPT",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "frontend")
if os.path.exists(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/", response_class=HTMLResponse)
async def root():
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        async with aiofiles.open(index_path, "r") as f:
            return await f.read()
    return HTMLResponse("<h1>Alice IDE Backend</h1><p>Frontend not found. Place files in ./frontend/</p>")


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "configured": bool(settings.yandex_cloud_api_key),
        "model": settings.effective_model_uri,
        "indexed_chunks": vector_store.size,
    }


@app.post("/api/chat")
async def chat(request: ChatRequest):
    """Chat with Alice AI. Supports streaming via SSE."""
    try:
        code_context = None
        if request.use_rag:
            user_query = ""
            for msg in reversed(request.messages):
                if msg.role == "user":
                    user_query = msg.content
                    break

            relevant = await search_relevant_code(user_query) if user_query else []
            code_context = build_code_context(
                relevant,
                current_file=request.current_file,
                current_code=request.current_code,
                selected_code=request.selected_code,
            )

        messages = [{"role": m.role, "content": m.content} for m in request.messages]

        if request.stream:
            async def event_generator():
                try:
                    async for chunk in chat_completion_stream(messages, code_context):
                        yield f"data: {json.dumps({'content': chunk}, ensure_ascii=False)}\n\n"
                    yield "data: [DONE]\n\n"
                except Exception as e:
                    logger.error(f"Stream error: {e}")
                    yield f"data: {json.dumps({'error': str(e)})}\n\n"

            return StreamingResponse(
                event_generator(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",
                },
            )
        else:
            response_text = await chat_completion(messages, code_context)
            return {"content": response_text}

    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/complete")
async def complete(request: InlineCompletionRequest):
    """Generate inline code completion."""
    try:
        result = await inline_completion(
            request.code_before,
            request.code_after,
            request.language,
        )
        return {"completion": result}
    except Exception as e:
        logger.error(f"Completion error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/apply-change")
async def apply_change(request: ApplyChangeRequest):
    """Apply a code change to a file."""
    try:
        file_path = request.file_path
        if not os.path.isabs(file_path):
            file_path = os.path.join(settings.workspace_root, file_path)

        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

        async with aiofiles.open(file_path, "r", encoding="utf-8") as f:
            content = await f.read()

        if request.original_code not in content:
            raise HTTPException(
                status_code=400,
                detail="Original code block not found in file. The file may have been modified."
            )

        new_content = content.replace(request.original_code, request.new_code, 1)

        async with aiofiles.open(file_path, "w", encoding="utf-8") as f:
            await f.write(new_content)

        return {"status": "applied", "file_path": file_path}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Apply change error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/index", response_model=IndexStatus)
async def index(request: IndexRequest):
    """Index workspace files for RAG."""
    try:
        result = await index_workspace(request.workspace_path, request.file_extensions)
        return IndexStatus(**result)
    except Exception as e:
        logger.error(f"Index error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/index/status", response_model=IndexStatus)
async def index_status():
    """Get current index status."""
    return IndexStatus(
        indexed_files=len(vector_store.indexed_files),
        total_chunks=vector_store.size,
        workspace_path=settings.workspace_root,
        status="ready" if vector_store.size > 0 else "empty",
    )


@app.get("/api/files")
async def list_files(path: str = ""):
    """List files in the workspace."""
    try:
        base = settings.workspace_root
        target = os.path.join(base, path) if path else base
        target = os.path.normpath(target)

        if not target.startswith(os.path.normpath(base)):
            raise HTTPException(status_code=403, detail="Access denied")

        if not os.path.exists(target):
            raise HTTPException(status_code=404, detail="Path not found")

        return _build_file_tree(target, base, depth=2)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"File listing error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/file")
async def read_file(path: str):
    """Read a file's content."""
    try:
        base = settings.workspace_root
        file_path = os.path.join(base, path)
        file_path = os.path.normpath(file_path)

        if not file_path.startswith(os.path.normpath(base)):
            raise HTTPException(status_code=403, detail="Access denied")

        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="File not found")

        if os.path.getsize(file_path) > 1_000_000:
            raise HTTPException(status_code=400, detail="File too large")

        async with aiofiles.open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            content = await f.read()

        ext = Path(file_path).suffix.lower()
        lang_map = {
            ".py": "python", ".js": "javascript", ".ts": "typescript",
            ".vue": "vue", ".html": "html", ".css": "css",
            ".json": "json", ".md": "markdown", ".yaml": "yaml",
            ".yml": "yaml", ".go": "go", ".rs": "rust",
        }

        return {
            "path": path,
            "content": content,
            "language": lang_map.get(ext, "plaintext"),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"File read error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/file")
async def write_file(path: str, data: dict):
    """Write content to a file."""
    try:
        base = settings.workspace_root
        file_path = os.path.join(base, path)
        file_path = os.path.normpath(file_path)

        if not file_path.startswith(os.path.normpath(base)):
            raise HTTPException(status_code=403, detail="Access denied")

        os.makedirs(os.path.dirname(file_path), exist_ok=True)

        content = data.get("content", "")
        async with aiofiles.open(file_path, "w", encoding="utf-8") as f:
            await f.write(content)

        return {"status": "saved", "path": path}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"File write error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


IGNORED_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv",
    "dist", "build", ".next", ".nuxt", "out", "target",
}


def _build_file_tree(path: str, base: str, depth: int = 2) -> list[dict]:
    if depth <= 0:
        return []

    result = []
    try:
        entries = sorted(os.listdir(path))
    except PermissionError:
        return []

    dirs = []
    files = []

    for entry in entries:
        if entry.startswith("."):
            continue
        full_path = os.path.join(path, entry)
        rel_path = os.path.relpath(full_path, base)

        if os.path.isdir(full_path):
            if entry in IGNORED_DIRS:
                continue
            children = _build_file_tree(full_path, base, depth - 1) if depth > 1 else None
            dirs.append({
                "name": entry,
                "path": rel_path,
                "is_directory": True,
                "children": children,
            })
        else:
            files.append({
                "name": entry,
                "path": rel_path,
                "is_directory": False,
            })

    return dirs + files


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
    )
