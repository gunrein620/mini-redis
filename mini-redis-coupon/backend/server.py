"""
Backend API 서버
- FastAPI 사용 (포트 8000)
- Mini Redis와 PostgreSQL 두 가지 방식으로 쿠폰 발급
- 동시 요청 시뮬레이션 (bulk-test)
"""

from __future__ import annotations

import asyncio
import os
import sys
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

import asyncpg
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Mini Redis를 같은 프로세스에서 직접 사용 (HTTP 오버헤드 제거)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "mini-redis"))
from server import MiniRedisStore

# 환경 변수 로드
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://pkw:pkw@localhost:5432/mini_redis_db")

# 전역 DB 풀과 Mini Redis 인스턴스
db_pool: Optional[asyncpg.Pool] = None
redis_store = MiniRedisStore()  # 인메모리 직접 호출 (HTTP 없음)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작/종료 시 리소스 관리"""
    global db_pool
    # DB 연결 풀 생성
    db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=5, max_size=20)

    # Mini Redis에 쿠폰 재고 초기화 (없으면 설정)
    value = await redis_store.get("coupon_stock")
    if value is None:
        await redis_store.set("coupon_stock", "100")

    yield

    # 리소스 정리
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
    # Redis 결과 상세
    redis_success: int = 0       # 발급 성공 수
    redis_sold_out: int = 0      # 재고 소진으로 거절된 수
    redis_error: int = 0         # 서버 에러 수
    redis_elapsed_ms: float = 0
    # DB 결과 상세
    db_success: int = 0          # 발급 성공 수
    db_sold_out: int = 0         # 재고 소진으로 거절된 수 (잠금 대기 후 거절)
    db_error: int = 0            # 서버 에러 수
    db_elapsed_ms: float = 0


# --- Mini Redis 헬퍼 함수 (인메모리 직접 호출) ---

async def redis_get(key: str) -> Optional[str]:
    """Mini Redis에서 값 조회 (직접 호출)"""
    return await redis_store.get(key)


async def redis_set(key: str, value: str):
    """Mini Redis에 값 저장 (직접 호출)"""
    await redis_store.set(key, value)


async def redis_decr(key: str) -> int:
    """Mini Redis에서 값 감소 (직접 호출, 원자적 연산)"""
    return await redis_store.decr(key)


async def redis_incr(key: str) -> int:
    """Mini Redis에서 값 증가 (직접 호출, 원자적 연산)"""
    return await redis_store.incr(key)


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

    # 현재 Redis 재고 조회
    redis_stock = 100
    try:
        value = await redis_get("coupon_stock")
        if value is not None:
            redis_stock = max(int(value), 0)
    except Exception:
        pass

    # 현재 DB 재고 조회
    db_stock = 100
    try:
        async with db_pool.acquire() as conn:
            row = await conn.fetchrow("SELECT count FROM coupon_stock WHERE id = 1")
            if row:
                db_stock = max(row["count"], 0)
    except Exception:
        pass

    # 각각의 현재 재고로 초기화 (발급 기록만 삭제)
    try:
        await redis_set("coupon_stock", str(redis_stock))
    except Exception:
        pass
    try:
        async with db_pool.acquire() as conn:
            await conn.execute("UPDATE coupon_stock SET count = $1 WHERE id = 1", db_stock)
            await conn.execute("DELETE FROM coupons")
    except Exception:
        pass

    # --- Redis 방식 테스트 ---
    r_success = 0    # 쿠폰 발급 성공
    r_sold_out = 0   # 재고 소진으로 거절
    r_error = 0      # 서버 에러

    async def redis_request():
        nonlocal r_success, r_sold_out, r_error
        try:
            result = await issue_coupon_redis()
            if result.success:
                r_success += 1
            else:
                r_sold_out += 1  # 재고 소진 = 정상 거절
        except Exception:
            r_error += 1  # 예외 발생 = 서버 에러

    redis_start = time.perf_counter()
    # 동시에 1000개 요청 실행
    await asyncio.gather(*[redis_request() for _ in range(total)])
    redis_elapsed = (time.perf_counter() - redis_start) * 1000

    # DB 재고 다시 초기화 (DB 테스트용 - DB 원래 재고로)
    try:
        async with db_pool.acquire() as conn:
            await conn.execute("UPDATE coupon_stock SET count = $1 WHERE id = 1", db_stock)
            await conn.execute("DELETE FROM coupons")
    except Exception:
        pass

    # --- DB 방식 테스트 ---
    d_success = 0    # 쿠폰 발급 성공
    d_sold_out = 0   # 잠금 대기 후 재고 소진으로 거절
    d_error = 0      # 서버 에러

    async def db_request():
        nonlocal d_success, d_sold_out, d_error
        try:
            result = await issue_coupon_db()
            if result.success:
                d_success += 1
            else:
                d_sold_out += 1  # FOR UPDATE 대기 후 재고 0 확인 → 거절
        except Exception:
            d_error += 1  # 예외 발생 = 서버 에러

    db_start = time.perf_counter()
    await asyncio.gather(*[db_request() for _ in range(total)])
    db_elapsed = (time.perf_counter() - db_start) * 1000

    return BulkTestResponse(
        total_requests=total,
        redis_success=r_success,
        redis_sold_out=r_sold_out,
        redis_error=r_error,
        redis_elapsed_ms=round(redis_elapsed, 2),
        db_success=d_success,
        db_sold_out=d_sold_out,
        db_error=d_error,
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
