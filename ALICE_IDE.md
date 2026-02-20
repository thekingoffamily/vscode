# Alice IDE — AI-Powered Code Editor

IDE на базе **YandexGPT** (нейросети от Яндекса), аналог Cursor IDE.

## Архитектура

```
┌─────────────────────────────────────────────────────────┐
│                    Alice IDE                             │
├──────────────────┬──────────────────┬───────────────────┤
│   File Explorer  │  Monaco Editor   │   Alice AI Chat   │
│   (Проводник)    │  (Редактор)      │   (Чат с ИИ)      │
├──────────────────┴──────────────────┴───────────────────┤
│                 FastAPI Backend                          │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────────┐  │
│  │ YandexGPT   │ │ RAG Engine   │ │ File Manager     │  │
│  │ API Client  │ │ (Векторный   │ │ (Управление      │  │
│  │ (Стриминг)  │ │  поиск)      │ │  файлами)        │  │
│  └─────────────┘ └──────────────┘ └──────────────────┘  │
├─────────────────────────────────────────────────────────┤
│              Yandex Cloud API                           │
│  YandexGPT Pro  │  Text Embeddings                      │
└─────────────────────────────────────────────────────────┘
```

## Компоненты

### 1. Backend (Python/FastAPI) — `alice-backend/`

- **YandexGPT API клиент** с поддержкой стриминга (SSE)
- **RAG-система** — индексация проекта, векторный поиск релевантного кода
- **Файловый менеджер** — просмотр, чтение, редактирование файлов
- **Применение изменений** — замена кода по предложению ИИ
- **Демо-режим** — работает без API ключей с демо-ответами

### 2. Frontend (HTML/CSS/JS + Monaco Editor) — `alice-backend/frontend/`

- **Monaco Editor** — полноценный редактор кода (движок VS Code)
- **Чат с Alice AI** — боковая панель с потоковыми ответами
- **Проводник файлов** — навигация по проекту
- **Применение кода** — кнопка "Применить" на блоках кода в чате
- **Контекстное меню** — "Объяснить", "Исправить", "Рефакторинг"

### 3. VS Code Extension — `extensions/alice-ai/`

- **Sidebar чат** — встроенный в VS Code чат с Alice AI
- **Контекстное меню** — команды для выделенного кода
- **Inline completion** — автодополнение кода (опционально)
- **Индексация проекта** — команда для RAG-индексации
- **Горячие клавиши** — Ctrl+Shift+A для быстрого доступа

### 4. Docker — `docker-compose.alice.yml`

Контейнеризация бэкенда с монтированием рабочей директории.

## Быстрый старт

### Вариант 1: Standalone (веб-интерфейс)

```bash
# 1. Установите зависимости
cd alice-backend
pip install -r requirements.txt

# 2. (Опционально) Настройте YandexGPT API
export ALICE_YANDEX_CLOUD_API_KEY=your-api-key
export ALICE_YANDEX_CLOUD_FOLDER_ID=your-folder-id

# 3. Запустите сервер
python main.py

# 4. Откройте http://localhost:8090
```

### Вариант 2: Docker

```bash
# С YandexGPT API
ALICE_YANDEX_CLOUD_API_KEY=your-key \
ALICE_YANDEX_CLOUD_FOLDER_ID=your-folder \
docker compose -f docker-compose.alice.yml up --build

# Демо-режим (без API ключей)
docker compose -f docker-compose.alice.yml up --build
```

### Вариант 3: VS Code Extension

```bash
# Сначала запустите бэкенд (Вариант 1 или 2)
# Затем в VS Code:
# 1. Ctrl+Shift+P → "Alice AI: Ask Alice"
# 2. Или используйте боковую панель Alice AI
```

## Настройка YandexGPT

1. Зарегистрируйтесь в [Yandex Cloud](https://cloud.yandex.ru)
2. Создайте сервисный аккаунт с ролью `ai.languageModels.user`
3. Получите API-ключ
4. Найдите Folder ID в консоли Yandex Cloud
5. Установите переменные окружения:

```bash
export ALICE_YANDEX_CLOUD_API_KEY=AQVN...
export ALICE_YANDEX_CLOUD_FOLDER_ID=b1g...
```

## API Endpoints

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/health` | Статус сервера |
| POST | `/api/chat` | Чат с Alice AI (SSE стриминг) |
| POST | `/api/complete` | Inline автодополнение кода |
| POST | `/api/apply-change` | Применить изменения к файлу |
| POST | `/api/index` | Индексировать проект для RAG |
| GET | `/api/index/status` | Статус индексации |
| GET | `/api/files` | Список файлов проекта |
| GET | `/api/file?path=...` | Чтение файла |
| PUT | `/api/file?path=...` | Запись в файл |

## Горячие клавиши

| Комбинация | Действие |
|------------|----------|
| Ctrl+Shift+A | Открыть чат Alice |
| Ctrl+B | Показать/скрыть проводник |
| Ctrl+J | Показать/скрыть чат |
| Ctrl+L | Фокус на ввод чата (в Monaco) |
| Ctrl+Enter | Отправить сообщение |

## Технологический стек

- **Backend**: Python 3.12, FastAPI, httpx, numpy
- **Frontend**: HTML5, CSS3, JavaScript, Monaco Editor
- **AI**: YandexGPT Pro API, Yandex Embeddings
- **RAG**: In-memory vector store (numpy cosine similarity)
- **IDE**: VS Code Extension API (TypeScript)
- **Infra**: Docker, Docker Compose
