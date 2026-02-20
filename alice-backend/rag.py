"""
RAG (Retrieval-Augmented Generation) engine for code context.
Uses in-memory vector store with numpy for similarity search.
"""

import json
import logging
import os
from pathlib import Path

import numpy as np

from config import settings
from yandex_gpt import get_embeddings

logger = logging.getLogger(__name__)

IGNORED_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv",
    "dist", "build", ".next", ".nuxt", "vendor", ".tox",
    "egg-info", ".eggs", ".mypy_cache", ".pytest_cache",
    "coverage", ".nyc_output", "target", "out",
}

CHUNK_SIZE = 1500
CHUNK_OVERLAP = 200


class VectorStore:
    """Simple in-memory vector store backed by numpy."""

    def __init__(self):
        self.embeddings: list[np.ndarray] = []
        self.documents: list[dict] = []
        self.indexed_files: set[str] = set()

    @property
    def size(self) -> int:
        return len(self.documents)

    def add(self, embedding: list[float], document: dict):
        self.embeddings.append(np.array(embedding, dtype=np.float32))
        self.documents.append(document)

    def search(self, query_embedding: list[float], top_k: int = 5) -> list[dict]:
        if not self.embeddings:
            return []

        query_vec = np.array(query_embedding, dtype=np.float32)
        query_norm = np.linalg.norm(query_vec)
        if query_norm == 0:
            return []
        query_vec = query_vec / query_norm

        scores = []
        for i, emb in enumerate(self.embeddings):
            emb_norm = np.linalg.norm(emb)
            if emb_norm == 0:
                scores.append(0.0)
                continue
            similarity = float(np.dot(query_vec, emb / emb_norm))
            scores.append(similarity)

        indices = np.argsort(scores)[::-1][:top_k]
        results = []
        for idx in indices:
            if scores[idx] > 0.1:
                doc = self.documents[idx].copy()
                doc["score"] = scores[idx]
                results.append(doc)

        return results

    def clear(self):
        self.embeddings.clear()
        self.documents.clear()
        self.indexed_files.clear()

    def save(self, path: str):
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        data = {
            "documents": self.documents,
            "embeddings": [e.tolist() for e in self.embeddings],
            "indexed_files": list(self.indexed_files),
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        logger.info(f"Vector store saved: {len(self.documents)} chunks")

    def load(self, path: str) -> bool:
        if not os.path.exists(path):
            return False
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.documents = data["documents"]
            self.embeddings = [np.array(e, dtype=np.float32) for e in data["embeddings"]]
            self.indexed_files = set(data.get("indexed_files", []))
            logger.info(f"Vector store loaded: {len(self.documents)} chunks")
            return True
        except Exception as e:
            logger.error(f"Failed to load vector store: {e}")
            return False


vector_store = VectorStore()


def _chunk_code(content: str, file_path: str) -> list[dict]:
    """Split code into overlapping chunks with metadata."""
    lines = content.split("\n")
    chunks = []
    current_chunk_lines = []
    current_size = 0

    for i, line in enumerate(lines):
        current_chunk_lines.append(line)
        current_size += len(line) + 1

        if current_size >= CHUNK_SIZE:
            chunk_text = "\n".join(current_chunk_lines)
            start_line = i - len(current_chunk_lines) + 2
            chunks.append({
                "content": chunk_text,
                "file_path": file_path,
                "start_line": start_line,
                "end_line": i + 1,
                "language": _detect_language(file_path),
            })
            overlap_lines = max(1, CHUNK_OVERLAP // max(1, (current_size // len(current_chunk_lines))))
            current_chunk_lines = current_chunk_lines[-overlap_lines:]
            current_size = sum(len(l) + 1 for l in current_chunk_lines)

    if current_chunk_lines:
        chunk_text = "\n".join(current_chunk_lines)
        start_line = len(lines) - len(current_chunk_lines) + 1
        chunks.append({
            "content": chunk_text,
            "file_path": file_path,
            "start_line": start_line,
            "end_line": len(lines),
            "language": _detect_language(file_path),
        })

    return chunks


def _detect_language(file_path: str) -> str:
    ext_map = {
        ".py": "python", ".js": "javascript", ".ts": "typescript",
        ".vue": "vue", ".html": "html", ".css": "css",
        ".json": "json", ".md": "markdown", ".yaml": "yaml",
        ".yml": "yaml", ".go": "go", ".rs": "rust",
        ".java": "java", ".cpp": "cpp", ".c": "c",
        ".h": "c", ".rb": "ruby", ".php": "php",
        ".sh": "bash", ".sql": "sql", ".xml": "xml",
    }
    ext = Path(file_path).suffix.lower()
    return ext_map.get(ext, "text")


async def index_workspace(
    workspace_path: str,
    file_extensions: list[str] | None = None,
) -> dict:
    """Index all code files in a workspace directory."""
    if file_extensions is None:
        file_extensions = [".py", ".js", ".ts", ".vue", ".html", ".css", ".json"]

    vector_store.clear()
    total_files = 0
    total_chunks = 0

    for root, dirs, files in os.walk(workspace_path):
        dirs[:] = [d for d in dirs if d not in IGNORED_DIRS]

        for filename in files:
            ext = Path(filename).suffix.lower()
            if ext not in file_extensions:
                continue

            file_path = os.path.join(root, filename)
            rel_path = os.path.relpath(file_path, workspace_path)

            try:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()

                if len(content) > 100_000:
                    continue

                chunks = _chunk_code(content, rel_path)
                for chunk in chunks:
                    embedding = await get_embeddings(chunk["content"][:2000])
                    vector_store.add(embedding, chunk)
                    total_chunks += 1

                vector_store.indexed_files.add(rel_path)
                total_files += 1

            except Exception as e:
                logger.warning(f"Failed to index {file_path}: {e}")

    store_path = os.path.join(settings.vector_store_path, "index.json")
    vector_store.save(store_path)

    return {
        "indexed_files": total_files,
        "total_chunks": total_chunks,
        "workspace_path": workspace_path,
        "status": "completed",
    }


async def search_relevant_code(query: str, top_k: int = 5) -> list[dict]:
    """Search for code chunks relevant to the query."""
    if vector_store.size == 0:
        return []

    query_embedding = await get_embeddings(query)
    return vector_store.search(query_embedding, top_k=top_k)


def build_code_context(
    relevant_chunks: list[dict],
    current_file: str | None = None,
    current_code: str | None = None,
    selected_code: str | None = None,
) -> str:
    """Build a context string from relevant code chunks and current file info."""
    parts = []

    if current_file:
        parts.append(f"Текущий файл: {current_file}")
    if selected_code:
        parts.append(f"Выделенный код:\n```\n{selected_code}\n```")
    if current_code:
        truncated = current_code[:4000]
        if len(current_code) > 4000:
            truncated += "\n... (файл обрезан)"
        parts.append(f"Содержимое текущего файла:\n```\n{truncated}\n```")

    if relevant_chunks:
        parts.append("\nРелевантные фрагменты из проекта:")
        for i, chunk in enumerate(relevant_chunks[:5], 1):
            score = chunk.get("score", 0)
            parts.append(
                f"\n--- Фрагмент {i} (файл: {chunk['file_path']}, "
                f"строки {chunk['start_line']}-{chunk['end_line']}, "
                f"релевантность: {score:.2f}) ---\n"
                f"```{chunk['language']}\n{chunk['content']}\n```"
            )

    return "\n".join(parts)
