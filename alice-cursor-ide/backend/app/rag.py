# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from __future__ import annotations

import math
import os
import re
from dataclasses import dataclass
from pathlib import Path


TOKEN_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]{1,}|[А-Яа-я_][А-Яа-я0-9_]{1,}")


@dataclass(frozen=True)
class Chunk:
    path: str
    start_line: int
    end_line: int
    content: str
    vector: dict[int, float]


def _cosine_similarity(a: dict[int, float], b: dict[int, float]) -> float:
    if not a or not b:
        return 0.0
    if len(a) > len(b):
        a, b = b, a
    return sum(weight * b.get(token_id, 0.0) for token_id, weight in a.items())


class RagIndex:
    def __init__(
        self,
        workspace_root: Path,
        allowed_extensions: tuple[str, ...],
        max_file_size_bytes: int,
        max_indexed_files: int,
        chunk_lines: int,
        chunk_overlap: int,
        vector_size: int = 1024,
    ) -> None:
        self._workspace_root = workspace_root
        self._allowed_extensions = set(allowed_extensions)
        self._max_file_size_bytes = max_file_size_bytes
        self._max_indexed_files = max_indexed_files
        self._chunk_lines = max(20, chunk_lines)
        self._chunk_overlap = max(0, min(chunk_overlap, self._chunk_lines // 2))
        self._vector_size = vector_size
        self._chunks: list[Chunk] = []

    @property
    def total_chunks(self) -> int:
        return len(self._chunks)

    def _embed(self, text: str) -> dict[int, float]:
        counts: dict[int, float] = {}
        for token in TOKEN_RE.findall(text.lower()):
            token_id = hash(token) % self._vector_size
            counts[token_id] = counts.get(token_id, 0.0) + 1.0

        norm = math.sqrt(sum(value * value for value in counts.values()))
        if norm == 0.0:
            return {}
        return {token_id: value / norm for token_id, value in counts.items()}

    def _chunk_file(self, relative_path: str, text: str) -> list[Chunk]:
        lines = text.splitlines()
        if not lines:
            return []

        chunks: list[Chunk] = []
        step = max(1, self._chunk_lines - self._chunk_overlap)
        start = 0
        while start < len(lines):
            end = min(len(lines), start + self._chunk_lines)
            chunk_text = "\n".join(lines[start:end]).strip()
            if chunk_text:
                chunks.append(
                    Chunk(
                        path=relative_path,
                        start_line=start + 1,
                        end_line=end,
                        content=chunk_text,
                        vector=self._embed(chunk_text),
                    )
                )
            if end >= len(lines):
                break
            start += step
        return chunks

    def build(self) -> None:
        skip_dirs = {".git", "node_modules", ".venv", "venv", "dist", "out", "__pycache__"}
        files_seen = 0
        chunks: list[Chunk] = []

        for current_root, dir_names, file_names in os.walk(self._workspace_root):
            dir_names[:] = [name for name in dir_names if name not in skip_dirs and not name.startswith(".cache")]
            for file_name in file_names:
                file_path = Path(current_root, file_name)
                if file_path.suffix.lower() not in self._allowed_extensions:
                    continue
                try:
                    size = file_path.stat().st_size
                except OSError:
                    continue
                if size > self._max_file_size_bytes:
                    continue

                try:
                    content = file_path.read_text(encoding="utf-8")
                except (UnicodeDecodeError, OSError):
                    continue

                relative_path = file_path.relative_to(self._workspace_root).as_posix()
                chunks.extend(self._chunk_file(relative_path, content))
                files_seen += 1
                if files_seen >= self._max_indexed_files:
                    self._chunks = chunks
                    return

        self._chunks = chunks

    def refresh_file(self, relative_path: str, content: str) -> None:
        normalized = relative_path.replace("\\", "/")
        self._chunks = [chunk for chunk in self._chunks if chunk.path != normalized]
        self._chunks.extend(self._chunk_file(normalized, content))

    def query(self, text: str, top_k: int = 5) -> list[Chunk]:
        query_vector = self._embed(text)
        if not query_vector or not self._chunks:
            return []

        scored_chunks = [
            (chunk, _cosine_similarity(query_vector, chunk.vector))
            for chunk in self._chunks
        ]
        scored_chunks = [item for item in scored_chunks if item[1] > 0]
        scored_chunks.sort(key=lambda item: item[1], reverse=True)
        return [chunk for chunk, _ in scored_chunks[:top_k]]
