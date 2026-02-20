"""
Alice IDE - FastAPI Backend
YandexGPT-powered coding assistant with streaming support.
"""

import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse
from pydantic import BaseModel
from dotenv import load_dotenv

from yandex_client import YandexGPTClient

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize YandexGPT client on startup."""
    try:
        app.state.yandex = YandexGPTClient()
    except ValueError as e:
        app.state.yandex = None
        print(f"Warning: YandexGPT not configured: {e}")
    yield
    app.state.yandex = None


app = FastAPI(
    title="Alice IDE API",
    description="AI-powered coding assistant based on YandexGPT (Алиса)",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    code_context: str | None = None
    chat_history: list[dict] | None = None


class ChatResponse(BaseModel):
    response: str


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "ok",
        "yandex_configured": os.getenv("YANDEX_API_KEY") is not None,
    }


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """Non-streaming chat endpoint."""
    if not app.state.yandex:
        raise HTTPException(
            status_code=503,
            detail="YandexGPT not configured. Set YANDEX_API_KEY and YANDEX_FOLDER_ID.",
        )
    try:
        response = await app.state.yandex.chat(
            message=req.message,
            code_context=req.code_context,
            chat_history=req.chat_history,
        )
        return ChatResponse(response=response)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    """Streaming chat endpoint (SSE)."""
    if not app.state.yandex:
        raise HTTPException(
            status_code=503,
            detail="YandexGPT not configured. Set YANDEX_API_KEY and YANDEX_FOLDER_ID.",
        )

    async def generate():
        try:
            async for chunk in app.state.yandex.chat_stream(
                message=req.message,
                code_context=req.code_context,
                chat_history=req.chat_history,
            ):
                yield {"data": chunk}
        except Exception as e:
            yield {"event": "error", "data": str(e)}

    return EventSourceResponse(generate())


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
