# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


class FileAccessError(ValueError):
    pass


def _normalize_relative_path(value: str) -> str:
    if Path(value).is_absolute():
        raise FileAccessError("Absolute paths are not allowed.")
    cleaned = value.replace("\\", "/").lstrip("/")
    if cleaned.startswith("../") or cleaned == "..":
        raise FileAccessError("Path traversal is not allowed.")
    return cleaned


@dataclass
class WorkspaceFiles:
    root: Path
    allowed_extensions: tuple[str, ...]
    max_file_size_bytes: int

    def resolve_path(self, relative_path: str) -> Path:
        safe_relative_path = _normalize_relative_path(relative_path)
        absolute_path = (self.root / safe_relative_path).resolve()
        if self.root not in absolute_path.parents and absolute_path != self.root:
            raise FileAccessError("Path is outside of the workspace root.")
        return absolute_path

    def list_files(self, limit: int = 3000) -> list[str]:
        files: list[str] = []
        skip_dirs = {".git", "node_modules", ".venv", "venv", "dist", "out", "__pycache__"}

        for current_root, dir_names, file_names in os.walk(self.root):
            dir_names[:] = [name for name in dir_names if name not in skip_dirs and not name.startswith(".cache")]
            for file_name in file_names:
                file_path = Path(current_root, file_name)
                try:
                    size = file_path.stat().st_size
                except OSError:
                    continue
                if (
                    file_path.suffix.lower() not in self.allowed_extensions
                    or size > self.max_file_size_bytes
                ):
                    continue
                files.append(file_path.relative_to(self.root).as_posix())
                if len(files) >= limit:
                    return sorted(files)

        return sorted(files)

    def read_text_file(self, relative_path: str) -> str:
        file_path = self.resolve_path(relative_path)
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {relative_path}")
        if file_path.is_dir():
            raise IsADirectoryError(f"Expected file but got directory: {relative_path}")
        if file_path.stat().st_size > self.max_file_size_bytes:
            raise FileAccessError(f"File is too large: {relative_path}")
        return file_path.read_text(encoding="utf-8")

    def write_text_file(self, relative_path: str, content: str) -> None:
        file_path = self.resolve_path(relative_path)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(content, encoding="utf-8")
