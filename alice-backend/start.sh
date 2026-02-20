#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

echo "============================================"
echo "  Alice IDE — AI-Powered Code Editor"
echo "  Backend powered by YandexGPT"
echo "============================================"
echo ""

if [ -z "${ALICE_YANDEX_CLOUD_API_KEY:-}" ]; then
    echo "[!] Running in DEMO mode (no YandexGPT API key set)"
    echo "    Set ALICE_YANDEX_CLOUD_API_KEY for production use"
else
    echo "[OK] YandexGPT API key configured"
fi

echo ""
echo "Starting server on http://0.0.0.0:${ALICE_PORT:-8090}"
echo "Open http://localhost:${ALICE_PORT:-8090} in your browser"
echo ""

exec python3 -m uvicorn main:app \
    --host "${ALICE_HOST:-0.0.0.0}" \
    --port "${ALICE_PORT:-8090}" \
    --reload
