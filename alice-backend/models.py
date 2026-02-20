"""
Pydantic models for Alice IDE backend API.
"""

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str = Field(..., description="Message role: system, user, or assistant")
    content: str = Field(..., description="Message content")


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(..., description="Conversation history")
    current_file: str | None = Field(None, description="Path to currently open file")
    current_code: str | None = Field(None, description="Content of currently open file")
    selected_code: str | None = Field(None, description="Currently selected code fragment")
    language: str | None = Field(None, description="Programming language of current file")
    workspace_path: str | None = Field(None, description="Root path of the workspace")
    use_rag: bool = Field(True, description="Whether to use RAG for context enrichment")
    stream: bool = Field(True, description="Whether to stream the response")


class InlineCompletionRequest(BaseModel):
    file_path: str = Field(..., description="Path to the file")
    code_before: str = Field(..., description="Code before cursor position")
    code_after: str = Field("", description="Code after cursor position")
    language: str = Field("python", description="Programming language")


class ApplyChangeRequest(BaseModel):
    file_path: str = Field(..., description="Path to the file to modify")
    original_code: str = Field(..., description="Original code block")
    new_code: str = Field(..., description="New code to replace the original")


class IndexRequest(BaseModel):
    workspace_path: str = Field(..., description="Path to the workspace to index")
    file_extensions: list[str] = Field(
        default=[".py", ".js", ".ts", ".vue", ".html", ".css", ".json", ".md", ".yaml", ".yml", ".go", ".rs", ".java", ".cpp", ".c", ".h"],
        description="File extensions to index"
    )


class IndexStatus(BaseModel):
    indexed_files: int
    total_chunks: int
    workspace_path: str
    status: str


class FileNode(BaseModel):
    name: str
    path: str
    is_directory: bool
    children: list["FileNode"] | None = None


class ErrorResponse(BaseModel):
    error: str
    detail: str | None = None
