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

### 1000명 동시 테스트
- asyncio.gather로 1000개 비동기 요청을 동시 실행
- Redis 방식과 DB 방식의 처리 시간을 비교

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
