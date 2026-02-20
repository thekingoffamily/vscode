"""
Configuration for Alice IDE backend.
Uses environment variables with sensible defaults.
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    yandex_cloud_api_key: str = ""
    yandex_cloud_folder_id: str = ""
    yandex_gpt_model_uri: str = ""
    yandex_gpt_api_url: str = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion"
    yandex_gpt_stream_url: str = "https://llm.api.cloud.yandex.net/foundationModels/v1/completionWithStream"
    yandex_embeddings_url: str = "https://llm.api.cloud.yandex.net/foundationModels/v1/textEmbedding"
    yandex_embeddings_model_uri: str = ""

    max_context_tokens: int = 8000
    max_completion_tokens: int = 4000
    temperature: float = 0.3

    workspace_root: str = "/workspace"
    vector_store_path: str = "./vector_store"

    host: str = "0.0.0.0"
    port: int = 8090

    cors_origins: list[str] = ["*"]

    model_config = {"env_prefix": "ALICE_", "env_file": ".env"}

    @property
    def effective_model_uri(self) -> str:
        if self.yandex_gpt_model_uri:
            return self.yandex_gpt_model_uri
        if self.yandex_cloud_folder_id:
            return f"gpt://{self.yandex_cloud_folder_id}/yandexgpt/latest"
        return "gpt://demo/yandexgpt/latest"

    @property
    def effective_embeddings_model_uri(self) -> str:
        if self.yandex_embeddings_model_uri:
            return self.yandex_embeddings_model_uri
        if self.yandex_cloud_folder_id:
            return f"emb://{self.yandex_cloud_folder_id}/text-search-doc/latest"
        return "emb://demo/text-search-doc/latest"


settings = Settings()
