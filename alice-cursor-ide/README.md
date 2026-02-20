# Alice Cursor IDE MVP (на базе YandexGPT)

Прототип IDE в стиле Cursor с:

- чат-ассистентом для текущего файла;
- RAG-поиском по проекту (локальная индексация чанков кода);
- постепенным выводом ответа через SSE;
- кнопкой `Apply Suggested Change` для применения сгенерированного кода.

> Важно: у «бытовой» Алисы нет публичного API для такого сценария.  
> Поэтому в MVP используется официальный API **YandexGPT** в Yandex Cloud.

## Архитектура

- `backend/app/main.py` — FastAPI сервер, SSE чат, файловые endpoint'ы.
- `backend/app/yandex_client.py` — вызов YandexGPT API.
- `backend/app/rag.py` — локальный RAG (чанкинг + хеш-эмбеддинги + cosine similarity).
- `frontend/` — web UI: список файлов, Monaco editor, чат, применение изменений.

## Быстрый старт (Docker)

```bash
cd alice-cursor-ide
cp .env.example .env
# заполните YANDEX_FOLDER_ID и YANDEX_API_KEY
docker compose up --build
```

Откройте: `http://localhost:8080`

Контейнер монтирует репозиторий как workspace (`../:/workspace`), поэтому IDE видит файлы текущего проекта.

## Локальный запуск без Docker

```bash
cd alice-cursor-ide/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# фронтенд уже статический, отдельной сборки не требует
export ALICE_IDE_WORKSPACE=/workspace
export ALICE_IDE_FRONTEND_DIR=/workspace/alice-cursor-ide/frontend
export YANDEX_FOLDER_ID=<your-folder-id>
export YANDEX_API_KEY=<your-api-key>
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Откройте: `http://localhost:8000`

## Основные API

- `GET /api/files` — список файлов workspace
- `GET /api/file?path=<relativePath>` — чтение файла
- `PUT /api/file` — запись файла
- `POST /api/reindex` — перестроение RAG индекса
- `POST /api/chat` — чат с SSE-стримингом

## Как это похоже на Cursor

1. Берется текущий файл + вопрос пользователя.
2. Из индекса выбираются релевантные чанки проекта (RAG).
3. Контекст отправляется в YandexGPT.
4. Модель возвращает:
   - `assistant_message` (объяснение),
   - `updated_code` (полный обновленный код файла или `null`).
5. По кнопке `Apply Suggested Change` правка вставляется в редактор и сохраняется.

## Ограничения MVP

- Это не форк VS Code, а web-прототип.
- RAG реализован локально (быстрый baseline), без pgvector/внешнего embedding-сервиса.
- Потоковый вывод имитируется на стороне сервера после получения полного ответа от модели.

Для production-версии можно добавить:
- полноценный VS Code extension;
- pgvector + embedding-модель;
- планировщик инструментов (terminal, git, docker actions) с политиками безопасности.
