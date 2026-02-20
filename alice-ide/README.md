# Alice IDE

IDE-помощник на базе **YandexGPT** (технологии «Алисы»), работающий по аналогии с Cursor IDE.

## Возможности

- **Чат с AI** — общайтесь с Алисой о коде на русском языке
- **Контекст кода** — передавайте содержимое редактора или выделенный фрагмент в запрос
- **Применение изменений** — кнопка «Применить изменения» для вставки сгенерированного кода
- **Стриминг ответов** — ответы отображаются постепенно, как в Cursor

---

## Требования для установки

Перед началом убедитесь, что у вас установлено:

| Компонент | Версия | Проверка |
|-----------|--------|----------|
| Python | 3.10+ | `python3 --version` |
| Node.js | 18+ | `node --version` |
| npm | 9+ | `npm --version` |
| Docker (опционально) | 20+ | `docker --version` |

---

## Пошаговая установка

### Шаг 1. Получение ключей Yandex Cloud

1. Зарегистрируйтесь в [Yandex Cloud](https://console.cloud.yandex.ru/)
2. Создайте **каталог** (folder) в консоли
3. Перейдите в раздел **IAM** → **Сервисные аккаунты** → создайте аккаунт
4. Выдайте роль `ai.editor` сервисному аккаунту
5. Создайте **API-ключ** для этого аккаунта — сохраните ключ и ID каталога
6. Включите [YandexGPT API](https://cloud.yandex.ru/docs/ai/llm/quickstart) для каталога

### Шаг 2. Клонирование и настройка проекта

```bash
# Перейдите в каталог проекта
cd alice-ide

# Скопируйте пример конфигурации
cp .env.example .env

# Отредактируйте файл .env (nano, vim или любой редактор)
nano .env
```

В файле `.env` укажите:

```
YANDEX_API_KEY=ваш_api_ключ_из_шага_1
YANDEX_FOLDER_ID=идентификатор_вашего_каталога
```

Сохраните файл и закройте редактор.

---

## Запуск проекта

### Вариант A: Локальный запуск (два терминала)

**Терминал 1 — бэкенд:**

```bash
cd alice-ide/backend

# Установка зависимостей Python
pip install -r requirements.txt
# или: pip3 install -r requirements.txt

# Запуск сервера (порт 8000)
python3 main.py
```

Увидите сообщение: `Uvicorn running on http://0.0.0.0:8000`

**Терминал 2 — фронтенд:**

```bash
cd alice-ide/frontend

# Установка зависимостей Node.js
npm install

# Запуск dev-сервера (порт 5173)
npm run dev
```

В браузере откройте: **http://localhost:5173**

---

### Вариант B: Запуск через Docker

```bash
cd alice-ide

# Сборка и запуск контейнеров
docker compose up --build

# Или в фоновом режиме:
docker compose up -d --build
```

После запуска откройте: **http://localhost:5173**

Остановка: `docker compose down`

---

### Вариант C: Скрипт для разработки (Linux/macOS)

```bash
cd alice-ide
chmod +x scripts/run-dev.sh
./scripts/run-dev.sh
```

Скрипт запустит бэкенд и фронтенд в одном окне. Остановка — Ctrl+C.

---

## Расширение для VS Code / Code-OSS

Чтобы использовать Alice IDE прямо внутри редактора кода:

1. **Запустите бэкенд** (см. выше, терминал 1)

2. **Соберите расширение:**

```bash
cd alice-ide/extensions/vscode-alice-ide

npm install
npm run compile
```

3. **Загрузите расширение в VS Code:**
   - Откройте папку `alice-ide` в VS Code
   - Нажмите F5 или Run → Start Debugging (запустится новое окно с расширением)

4. **Использование:**
   - Откройте палитру команд: `Ctrl+Shift+P` (или `Cmd+Shift+P` на macOS)
   - Введите: **Alice: Открыть чат**
   - Откроется панель чата справа
   - Контекст текущего файла или выделенного кода передаётся автоматически

5. **Настройка URL бэкенда** (если запущен не на localhost:8000):
   - Настройки → расширить Alice IDE
   - Или в `settings.json`: `"aliceIde.apiUrl": "http://ваш-адрес:8000"`

---

## Структура проекта

```
alice-ide/
├── backend/          # Python FastAPI сервер
│   ├── main.py       # Эндпоинты /chat, /chat/stream
│   ├── yandex_client.py
│   └── requirements.txt
├── frontend/         # Vue.js + Monaco Editor
│   └── src/
├── extensions/
│   └── vscode-alice-ide/   # Расширение для VS Code
├── .env.example      # Шаблон переменных окружения
├── docker-compose.yml
└── README.md
```

---

## Устранение проблем

| Проблема | Решение |
|----------|---------|
| `YANDEX_API_KEY is required` | Проверьте, что `.env` создан и содержит ключи |
| Ошибка 503 при запросе | Бэкенд не запущен — запустите `python3 main.py` в папке backend |
| CORS / сетевые ошибки | При локальном запуске фронтенд проксирует запросы на бэкенд автоматически |
| Порт занят | Измените порт в `backend/main.py` (uvicorn) или `frontend/vite.config.js` |

---

## Лицензия

MIT
