"""
Backend API 서버
- FastAPI 사용 (포트 8000)
- Mini Redis와 PostgreSQL 두 가지 방식으로 쿠폰 발급
- 동시 요청 시뮬레이션 (bulk-test)
"""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

import asyncpg
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# 환경 변수 로드
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://pkw:pkw@localhost:5432/mini_redis_db")
MINI_REDIS_URL = os.getenv("MINI_REDIS_URL", "http://localhost:6379")

# 전역 DB 풀과 HTTP 클라이언트
db_pool: Optional[asyncpg.Pool] = None
http_client: Optional[httpx.AsyncClient] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작/종료 시 리소스 관리"""
    global db_pool, http_client
    # DB 연결 풀 생성
    db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=5, max_size=20)
    # Mini Redis 통신용 HTTP 클라이언트
    http_client = httpx.AsyncClient(base_url=MINI_REDIS_URL, timeout=10.0)

    # Mini Redis에 쿠폰 재고 초기화 (없으면 설정)
    try:
        resp = await http_client.get("/get/coupon_stock")
        data = resp.json()
        if data.get("data") is None:
            await http_client.post("/set", json={"key": "coupon_stock", "value": "100"})
    except Exception:
        pass  # Mini Redis가 아직 시작되지 않았을 수 있음

    yield

    # 리소스 정리
    if http_client:
        await http_client.aclose()
    if db_pool:
        await db_pool.close()


app = FastAPI(title="쿠폰 이벤트 API", lifespan=lifespan)

# CORS 설정 (프론트엔드 연결용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- 응답 모델 ---

class CouponResponse(BaseModel):
    """쿠폰 발급 응답"""
    success: bool
    message: str
    user_id: Optional[str] = None
    remaining: Optional[int] = None
    elapsed_ms: float = 0


class CountResponse(BaseModel):
    """재고 조회 응답"""
    redis_count: Optional[int] = None
    db_count: Optional[int] = None
    elapsed_ms: float = 0


class BulkTestResponse(BaseModel):
    """동시 테스트 응답"""
    total_requests: int
    success_count: int
    fail_count: int
    redis_elapsed_ms: float = 0
    db_elapsed_ms: float = 0


# --- Mini Redis 헬퍼 함수 ---

async def redis_get(key: str) -> Optional[str]:
    """Mini Redis에서 값 조회"""
    resp = await http_client.get(f"/get/{key}")
    return resp.json().get("data")


async def redis_set(key: str, value: str):
    """Mini Redis에 값 저장"""
    await http_client.post("/set", json={"key": key, "value": value})


async def redis_decr(key: str) -> int:
    """Mini Redis에서 값 감소"""
    resp = await http_client.post(f"/decr/{key}")
    return resp.json().get("data")


async def redis_incr(key: str) -> int:
    """Mini Redis에서 값 증가"""
    resp = await http_client.post(f"/incr/{key}")
    return resp.json().get("data")


# --- API 엔드포인트 ---

@app.post("/coupon/issue/redis", summary="Redis 방식 쿠폰 발급")
async def issue_coupon_redis() -> CouponResponse:
    """Mini Redis로 재고를 관리하여 쿠폰 발급"""
    start = time.perf_counter()
    user_id = str(uuid.uuid4())[:8]

    try:
        # Mini Redis에서 재고 감소 (원자적 연산)
        remaining = await redis_decr("coupon_stock")

        if remaining < 0:
            # 재고 부족 - 다시 복구
            await redis_incr("coupon_stock")
            elapsed = (time.perf_counter() - start) * 1000
            return CouponResponse(
                success=False,
                message="쿠폰이 모두 소진되었습니다",
                remaining=0,
                elapsed_ms=round(elapsed, 2),
            )

        # DB에 발급 기록 저장
        async with db_pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO coupons (user_id, issued_at) VALUES ($1, $2)",
                user_id, datetime.now(),
            )

        elapsed = (time.perf_counter() - start) * 1000
        return CouponResponse(
            success=True,
            message="쿠폰이 발급되었습니다! (Redis)",
            user_id=user_id,
            remaining=remaining,
            elapsed_ms=round(elapsed, 2),
        )
    except Exception as e:
        elapsed = (time.perf_counter() - start) * 1000
        raise HTTPException(status_code=500, detail=f"Redis 쿠폰 발급 실패: {e}")


@app.post("/coupon/issue/db", summary="DB 방식 쿠폰 발급")
async def issue_coupon_db() -> CouponResponse:
    """PostgreSQL DB로 직접 재고를 관리하여 쿠폰 발급"""
    start = time.perf_counter()
    user_id = str(uuid.uuid4())[:8]

    try:
        async with db_pool.acquire() as conn:
            # 트랜잭션으로 재고 확인 및 감소 (행 잠금)
            async with conn.transaction():
                row = await conn.fetchrow(
                    "SELECT count FROM coupon_stock WHERE id = 1 FOR UPDATE"
                )
                if row is None or row["count"] <= 0:
                    elapsed = (time.perf_counter() - start) * 1000
                    return CouponResponse(
                        success=False,
                        message="쿠폰이 모두 소진되었습니다",
                        remaining=0,
                        elapsed_ms=round(elapsed, 2),
                    )

                # 재고 감소
                new_count = row["count"] - 1
                await conn.execute(
                    "UPDATE coupon_stock SET count = $1 WHERE id = 1", new_count
                )

                # 발급 기록 저장
                await conn.execute(
                    "INSERT INTO coupons (user_id, issued_at) VALUES ($1, $2)",
                    user_id, datetime.now(),
                )

        elapsed = (time.perf_counter() - start) * 1000
        return CouponResponse(
            success=True,
            message="쿠폰이 발급되었습니다! (DB)",
            user_id=user_id,
            remaining=new_count,
            elapsed_ms=round(elapsed, 2),
        )
    except HTTPException:
        raise
    except Exception as e:
        elapsed = (time.perf_counter() - start) * 1000
        raise HTTPException(status_code=500, detail=f"DB 쿠폰 발급 실패: {e}")


@app.get("/coupon/count", summary="남은 쿠폰 수량 조회")
async def get_coupon_count() -> CountResponse:
    """Redis와 DB 양쪽의 남은 쿠폰 수량을 조회"""
    start = time.perf_counter()
    redis_count = None
    db_count = None

    # Redis 재고 조회
    try:
        value = await redis_get("coupon_stock")
        if value is not None:
            redis_count = int(value)
    except Exception:
        pass

    # DB 재고 조회
    try:
        async with db_pool.acquire() as conn:
            row = await conn.fetchrow("SELECT count FROM coupon_stock WHERE id = 1")
            if row:
                db_count = row["count"]
    except Exception:
        pass

    elapsed = (time.perf_counter() - start) * 1000
    return CountResponse(
        redis_count=redis_count,
        db_count=db_count,
        elapsed_ms=round(elapsed, 2),
    )


@app.post("/coupon/reset", summary="쿠폰 재고 초기화")
async def reset_coupon() -> CouponResponse:
    """쿠폰 재고를 100개로 초기화"""
    start = time.perf_counter()

    # Redis 재고 초기화
    try:
        await redis_set("coupon_stock", "100")
    except Exception:
        pass

    # DB 재고 초기화 + 발급 기록 삭제
    try:
        async with db_pool.acquire() as conn:
            await conn.execute("UPDATE coupon_stock SET count = 100 WHERE id = 1")
            await conn.execute("DELETE FROM coupons")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"초기화 실패: {e}")

    elapsed = (time.perf_counter() - start) * 1000
    return CouponResponse(
        success=True,
        message="쿠폰 재고가 100개로 초기화되었습니다",
        remaining=100,
        elapsed_ms=round(elapsed, 2),
    )


@app.post("/coupon/bulk-test", summary="1000명 동시 요청 시뮬레이션")
async def bulk_test() -> BulkTestResponse:
    """1000명 동시 요청을 시뮬레이션하여 Redis vs DB 성능 비교"""
    total = 1000

    # 먼저 재고 초기화
    try:
        await redis_set("coupon_stock", "100")
    except Exception:
        pass
    try:
        async with db_pool.acquire() as conn:
            await conn.execute("UPDATE coupon_stock SET count = 100 WHERE id = 1")
            await conn.execute("DELETE FROM coupons")
    except Exception:
        pass

    # --- Redis 방식 테스트 ---
    redis_success = 0
    redis_fail = 0

    async def redis_request():
        nonlocal redis_success, redis_fail
        try:
            result = await issue_coupon_redis()
            if result.success:
                redis_success += 1
            else:
                redis_fail += 1
        except Exception:
            redis_fail += 1

    redis_start = time.perf_counter()
    # 동시에 1000개 요청 실행
    await asyncio.gather(*[redis_request() for _ in range(total)])
    redis_elapsed = (time.perf_counter() - redis_start) * 1000

    redis_total_success = redis_success

    # 재고 다시 초기화 (DB 테스트용)
    try:
        async with db_pool.acquire() as conn:
            await conn.execute("UPDATE coupon_stock SET count = 100 WHERE id = 1")
            await conn.execute("DELETE FROM coupons")
    except Exception:
        pass

    # --- DB 방식 테스트 ---
    db_success = 0
    db_fail = 0

    async def db_request():
        nonlocal db_success, db_fail
        try:
            result = await issue_coupon_db()
            if result.success:
                db_success += 1
            else:
                db_fail += 1
        except Exception:
            db_fail += 1

    db_start = time.perf_counter()
    await asyncio.gather(*[db_request() for _ in range(total)])
    db_elapsed = (time.perf_counter() - db_start) * 1000

    return BulkTestResponse(
        total_requests=total,
        success_count=redis_total_success,
        fail_count=total - redis_total_success,
        redis_elapsed_ms=round(redis_elapsed, 2),
        db_elapsed_ms=round(db_elapsed, 2),
    )


@app.get("/health", summary="헬스 체크")
async def health():
    """서버 상태 확인"""
    return {"status": "ok", "service": "coupon-api"}


if __name__ == "__main__":
    import uvicorn
    # 포트 8000에서 API 서버 실행
    uvicorn.run(app, host="0.0.0.0", port=8000)
