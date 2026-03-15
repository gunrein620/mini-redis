#!/bin/bash
BASE_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Mini Redis Coupon 서버 시작 ==="

PIDS=()

# Mini Redis 서버 (포트 6379)
echo "[1/3] Mini Redis 서버 시작 (포트 6379)..."
(cd "$BASE_DIR/mini-redis" && python3 server.py) &
PIDS+=($!)

# Backend API 서버 (포트 8000)
echo "[2/3] Backend API 서버 시작 (포트 8000)..."
(cd "$BASE_DIR/backend" && python3 server.py) &
PIDS+=($!)

# Frontend 정적 서버 (포트 3000)
echo "[3/3] Frontend 서버 시작 (포트 3000)..."
(cd "$BASE_DIR/frontend" && python3 -m http.server 3000) &
PIDS+=($!)

echo ""
echo "모든 서버가 시작되었습니다!"
echo "  - Mini Redis: localhost:6379"
echo "  - Backend:    http://localhost:8000"
echo "  - Frontend:   http://localhost:3000"
echo ""
echo "종료하려면 Ctrl+C를 누르세요."

# Ctrl+C로 전체 종료
cleanup() {
    echo ""
    echo "서버 종료 중..."
    kill "${PIDS[@]}" 2>/dev/null
    exit
}
trap cleanup INT TERM

# 자식 프로세스 대기
wait
