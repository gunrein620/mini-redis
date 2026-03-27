# Mini Redis 기반 선착순 쿠폰 이벤트

Python으로 직접 구현한 Mini Redis 서버를 활용하여 선착순 쿠폰 발급 이벤트를 시뮬레이션하는 프로젝트입니다.
Redis(인메모리) 방식과 PostgreSQL(DB) 방식의 성능 차이를 비교할 수 있습니다.

## 디렉토리 구조

```
mini-redis-coupon/
├── frontend/          # 프론트엔드 (순수 HTML/CSS/JS)
│   ├── index.html     # 메인 페이지
│   ├── style.css      # 스타일시트
│   └── app.js         # API 통신 및 UI 로직
├── backend/           # FastAPI API 서버 (포트 8000)
│   ├── server.py      # API 엔드포인트
│   ├── .env           # DB 접속 정보
│   └── requirements.txt
├── mini-redis/        # Mini Redis 서버 (포트 6379)
│   ├── server.py      # 해시 테이블 기반 키-값 저장소
│   └── requirements.txt
├── database/          # PostgreSQL 초기화 SQL
│   ├── init.sql       # 테이블 생성
│   └── seed.sql       # 초기 데이터 (재고 100개)
├── tests/             # pytest 단위 테스트
│   ├── test_mini_redis.py  # Mini Redis 테스트
│   └── test_api.py         # API 서버 테스트
└── README.md
```

## 사전 요구사항

- Python 3.11+
- PostgreSQL 14
- pip

## PostgreSQL 세팅

```bash
# 1. 데이터베이스 생성
createdb mini_redis_db

# 2. 테이블 생성
psql -U pkw -d mini_redis_db -f database/init.sql

# 3. 초기 데이터 삽입 (재고 100개)
psql -U pkw -d mini_redis_db -f database/seed.sql
```

## 서버 실행 한번에 하기(터미널 1개)
```bash
cd mini-redis-coupon
./start.sh
```

```cmd(윈도우)
cd mini-redis-coupon
./start-windows.cmd
```

## 서버 실행 방법 (터미널 3개)

### 터미널 1: Mini Redis 서버 (포트 6379)

```bash
cd mini-redis
pip install -r requirements.txt
python server.py
```

### 터미널 2: Backend API 서버 (포트 8000)

```bash
cd backend
pip install -r requirements.txt
python server.py
```

### 터미널 3: Frontend (정적 파일 서빙)

```bash
cd frontend
python -m http.server 3000
```

브라우저에서 `http://localhost:3000` 접속

## API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/coupon/issue/redis` | Mini Redis로 쿠폰 발급 |
| POST | `/coupon/issue/db` | PostgreSQL DB로 쿠폰 발급 |
| GET | `/coupon/count` | 남은 쿠폰 수량 조회 |
| POST | `/coupon/reset` | 쿠폰 재고 100개로 초기화 |
| POST | `/coupon/bulk-test` | 1000명 동시 요청 시뮬레이션 |

## 테스트 방법

```bash
# 의존성 설치
pip install pytest pytest-asyncio

# Mini Redis 단위 테스트 실행
cd mini-redis-coupon
pytest tests/test_mini_redis.py -v

# 전체 테스트 실행
pytest -v
```

## 기능 설명

### Mini Redis 서버
- 해시 테이블 기반 키-값 저장소
- TTL 지원 (만료된 키 자동 삭제)
- GET / SET / DELETE / INCR / DECR 명령어
- asyncio.Lock()으로 동시성 제어

### 쿠폰 발급 방식 비교
- **Redis 방식**: DECR 원자적 연산으로 재고 감소 → 빠른 처리
- **DB 방식**: SELECT FOR UPDATE로 행 잠금 후 재고 감소 → 정확하지만 느림
- **재고 동기화**: 어떤 방식으로 발급하든 Redis/DB 재고가 항상 함께 감소 → 두 숫자는 항상 일치

### 1000명 동시 테스트
- asyncio.gather로 1000개 비동기 요청을 동시 실행
- 각 방식 실험 전 Redis/DB 재고를 모두 100으로 독립 리셋 → 순수하게 처리 속도만 비교
- Redis 방식 1000명 → 리셋 → DB 방식 1000명 순으로 진행

---

## 환경 설정 가이드

### 필수 환경

| 항목 | 버전 | 비고 |
|------|------|------|
| Python | 3.9 이상 (3.11 권장) | `python3 --version`으로 확인 |
| pip | 최신 | `pip install --upgrade pip` |
| PostgreSQL | 14 이상 | `psql --version`으로 확인 |

### 의존성 설치 (한번에)

```bash
cd mini-redis-coupon
pip install -r requirements.txt
```

설치되는 패키지 목록:

| 패키지 | 용도 |
|--------|------|
| fastapi | 웹 프레임워크 (Backend + Mini Redis) |
| uvicorn | ASGI 서버 |
| pydantic | 데이터 검증 |
| asyncpg | PostgreSQL 비동기 드라이버 |
| httpx | HTTP 클라이언트 (테스트용) |
| python-dotenv | `.env` 파일 로드 |
| pytest | 테스트 프레임워크 |
| pytest-asyncio | 비동기 테스트 지원 |

### PostgreSQL 설정

```bash
# 1. PostgreSQL 실행 확인
pg_isready

# 2. 사용자 생성 (필요 시)
createuser -s pkw

# 3. 데이터베이스 생성
createdb -U pkw mini_redis_db

# 4. 테이블 생성
psql -U pkw -d mini_redis_db -f database/init.sql

# 5. 초기 데이터 삽입 (쿠폰 재고 100개)
psql -U pkw -d mini_redis_db -f database/seed.sql
```

### 환경변수 (.env)

`backend/.env` 파일에 DB 접속 정보가 설정되어 있습니다:

```
DATABASE_URL=postgresql://pkw:pkw@localhost:5432/mini_redis_db
MINI_REDIS_URL=http://localhost:6379
```

자신의 PostgreSQL 설정에 맞게 유저명/비밀번호를 수정하세요.

---

## Backend API curl 명령어

Backend API 서버(포트 8000)를 curl로 호출하면 실제 쿠폰 발급/조회가 동작합니다.

### 쿠폰 발급

```bash
# Redis 방식 쿠폰 발급
curl -X POST localhost:8000/coupon/issue/redis
```
```json
{
  "success": true,
  "message": "쿠폰이 발급되었습니다! (Redis)",
  "user_id": 1,
  "coupon_code": "a1b2c3d4",
  "remaining": 99,
  "expires_at": "12:30:15",
  "elapsed_ms": 3.45
}
```

```bash
# DB 방식 쿠폰 발급
curl -X POST localhost:8000/coupon/issue/db
```
```json
{
  "success": true,
  "message": "쿠폰이 발급되었습니다! (DB)",
  "user_id": 2,
  "coupon_code": "e5f6g7h8",
  "remaining": 98,
  "expires_at": "12:30:16",
  "elapsed_ms": 5.12
}
```

### 재고 조회 / 초기화

```bash
# 남은 쿠폰 수량 조회 (Redis + DB 동시)
curl localhost:8000/coupon/count
```
```json
{"redis_count": 98, "db_count": 98, "elapsed_ms": 1.23}
```

```bash
# 쿠폰 재고 100개로 초기화
curl -X POST localhost:8000/coupon/reset
```
```json
{
  "success": true,
  "message": "쿠폰 재고가 100개로 초기화되었습니다",
  "remaining": 100,
  "elapsed_ms": 2.34
}
```

### 1000명 동시 테스트

```bash
curl -X POST localhost:8000/coupon/bulk-test
```
```json
{
  "total_requests": 1000,
  "redis_success": 100, "redis_sold_out": 900, "redis_error": 0, "redis_elapsed_ms": 250.5,
  "db_success": 100, "db_sold_out": 900, "db_error": 0, "db_elapsed_ms": 1200.3
}
```

### 유효 쿠폰 조회 / 검증

```bash
# 현재 유효한 쿠폰 목록 (Redis vs DB 비교)
curl localhost:8000/coupon/valid-coupons
```
```json
{
  "redis_coupons": [{"coupon_code": "a1b2c3d4", "remaining_seconds": 12}],
  "redis_count": 1,
  "redis_elapsed_ms": 0.15,
  "db_coupons": [{"id": 1, "coupon_code": "a1b2c3d4", "expires_at": "12:30:15"}],
  "db_count": 1,
  "db_elapsed_ms": 1.02
}
```

```bash
# 특정 쿠폰 유효성 검증
curl localhost:8000/coupon/validate/a1b2c3d4
```
```json
{"valid": true, "remaining_seconds": 10, "source": "redis"}
```

### 헬스 체크

```bash
curl localhost:8000/health
```
```json
{"status": "ok", "service": "coupon-api"}
```

---

## Mini Redis curl 명령어

Mini Redis 서버(포트 6379)를 직접 curl로 조작할 수 있습니다.

### 키 조회

```bash
# 유효한 키 전체 + 남은 TTL 조회
curl localhost:6379/keys
```
```json
{
  "count": 3,
  "keys": [
    {"key": "coupon_stock", "ttl": -1},
    {"key": "a1b2c3d4e5", "ttl": 12},
    {"key": "f6g7h8i9j0", "ttl": 7}
  ]
}
```

```bash
# 특정 키의 값 조회
curl localhost:6379/get/coupon_stock
```
```json
{"success": true, "data": "97", "message": ""}
```

```bash
# 특정 키의 남은 TTL(초) 조회
curl localhost:6379/ttl/coupon_stock
```
```json
{"success": true, "data": -1, "message": ""}
```
> TTL 값 의미: `-1` 영구 저장 / `-2` 키 없음 또는 만료됨 / `N` 남은 초

### 값 저장 / 삭제

```bash
# 키-값 저장 (TTL 없음, 영구 저장)
curl -X POST localhost:6379/set \
  -H "Content-Type: application/json" \
  -d '{"key": "foo", "value": "bar"}'
```
```json
{"success": true, "data": "OK", "message": "'foo' 저장 완료"}
```

```bash
# 키-값 저장 + TTL 30초 설정
curl -X POST localhost:6379/set \
  -H "Content-Type: application/json" \
  -d '{"key": "foo", "value": "bar", "ttl": 30}'

# 키 삭제
curl -X DELETE localhost:6379/delete/foo
```
```json
{"success": true, "data": 1, "message": "'foo' 삭제 완료"}
```

### 숫자 증가 / 감소

```bash
# 재고 1 감소 (쿠폰 발급 시뮬레이션)
curl -X POST localhost:6379/decr/coupon_stock
```
```json
{"success": true, "data": 96, "message": ""}
```

```bash
# 재고 1 증가
curl -X POST localhost:6379/incr/coupon_stock
```
```json
{"success": true, "data": 97, "message": ""}
```

### 헬스 체크

```bash
curl localhost:6379/health
```
```json
{"status": "ok", "service": "mini-redis"}
```

> **주의: 포트 6379 서버와 Backend는 별도 프로세스입니다.**
>
> Backend(포트 8000)는 `MiniRedisStore` 클래스를 직접 import해서 **같은 프로세스 메모리** 안에서 사용합니다.
> 포트 6379 Mini Redis 서버는 자체적으로 별도의 `MiniRedisStore` 인스턴스를 가진 **독립된 프로세스**입니다.
> 따라서 Backend에서 쿠폰을 발급해도 `curl localhost:6379/keys`에는 해당 데이터가 나타나지 않습니다.
>
> 이 서버는 Redis 명령어(GET/SET/INCR/DECR 등)를 HTTP로 직접 실험해보는 **학습용**입니다.
> 쿠폰 발급은 이 서버를 띄우지 않아도 정상 동작합니다.

---

## 아키텍처 설계 배경

### 현재 구조

```
Backend (포트 8000)
├── MiniRedisStore  ← 직접 import (in-process, 네트워크 비용 없음)
└── asyncpg         ← TCP 직접 연결 (PostgreSQL 프로토콜)

Mini Redis 서버 (포트 6379)  ← 독립된 학습용 서버 (Backend와 데이터 공유 안 됨)
```

### 왜 이 구조인가?

Mini Redis는 6379 포트로 별도 HTTP 서버를 띄웠지만, Backend에서는 in-process(직접 import) 방식으로 사용합니다.
이유는 PostgreSQL과의 비교 조건을 맞추기 위함입니다.

- **PostgreSQL**은 자체 TCP 프로토콜만 지원하며, HTTP를 기본적으로 지원하지 않습니다.
  PostgreSQL을 HTTP로 호출하려면 별도의 프록시 서버를 만들어야 합니다.
- 프록시 없이 두 방식을 비교하기 위해, Redis도 동일하게 **프로세스 내부에서 직접 호출**하는 구조를 선택했습니다.

이는 상용 서비스에서의 패턴과 유사합니다:
- **실제 Redis**: 애플리케이션이 redis-py 등 클라이언트 라이브러리로 Redis 서버에 TCP 연결
- **실제 PostgreSQL**: 애플리케이션이 asyncpg/psycopg2 등 드라이버로 PostgreSQL에 TCP 연결
- 본 프로젝트에서는 Redis 대신 in-process MiniRedisStore를, PostgreSQL은 asyncpg로 직접 연결하여 비교합니다.
