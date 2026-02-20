#!/bin/bash
# Run Alice IDE in development mode

set -e
cd "$(dirname "$0")/.."

echo "=== Alice IDE Dev ==="

# Check .env
if [ ! -f .env ]; then
    echo "Copy .env.example to .env and set YANDEX_API_KEY, YANDEX_FOLDER_ID"
    cp .env.example .env
fi

# Start backend in background
echo "Starting backend..."
cd backend
pip install -q -r requirements.txt
python3 main.py &
BACKEND_PID=$!
cd ..

# Start frontend
echo "Starting frontend..."
cd frontend
npm install
npm run dev &
FRONTEND_PID=$!
cd ..

echo "Backend: http://localhost:8000"
echo "Frontend: http://localhost:5173"
echo "Press Ctrl+C to stop"
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait
