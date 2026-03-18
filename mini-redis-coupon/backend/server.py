"""
이 파일은 쿠폰 발급 API의 "실험장"입니다.
같은 쿠폰 발급 문제를 Redis 방식과 DB 방식으로 각각 처리해 비교할 수 있습니다.
핵심 학습 포인트는 동시성 처리 방법의 차이입니다.
- Redis 방식: atomic 연산(DECR/INCR)으로 빠르게 처리
- DB 방식: SELECT ... FOR UPDATE로 순서를 보장하며 처리
"""

from __future__ import annotations

import asyncio
import os
import sys
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Optional

import asyncpg
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Mini Redis를 같은 프로세스에서 직접 import해서 사용한다.
# (HTTP 호출 비용을 빼고, 동시성 제어 로직 비교에 집중하기 위함)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "mini-redis"))
from server import MiniRedisStore

# --- 앱 시작 전 기본 설정 ---
# .env에서 DB 접속 정보를 읽는다.
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://pkw:pkw@localhost:5432/mini_redis_db")

# 전역 리소스: DB 연결 풀 + Mini Redis 저장소
db_pool: Optional[asyncpg.Pool] = None
redis_store = MiniRedisStore()  # 인메모리 직접 호출


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작/종료 시 공통 리소스를 준비하고 정리한다."""
    global db_pool
    # 1) DB 연결 풀 생성: 요청마다 새 연결을 만드는 비용을 줄인다.
    db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=5, max_size=20)

    # 2) Redis 재고 기본값 세팅: 처음 실행 시 coupon_stock=100
    value = await redis_store.get("coupon_stock")
    if value is None:
        await redis_store.set("coupon_stock", "100")

    yield

    # 3) 종료 시 DB 풀을 닫아 리소스를 깔끔하게 정리한다.
    if db_pool:
        await db_pool.close()


app = FastAPI(title="쿠폰 이벤트 API", lifespan=lifespan)

# 프론트엔드(다른 포트)에서 호출할 수 있도록 CORS 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- 응답 모델: 프론트와 약속한 응답 형태 ---

class CouponResponse(BaseModel):
    """쿠폰 1건 발급 요청의 결과."""
    success: bool
    message: str
    user_id: Optional[int] = None       # DB에서 발급된 쿠폰의 고유 ID
    coupon_code: Optional[str] = None
    remaining: Optional[int] = None
    expires_at: Optional[str] = None    # 만료 시각 (HH:MM:SS)
    elapsed_ms: float = 0


class CountResponse(BaseModel):
    """현재 남은 재고 조회 결과(Redis/DB)."""
    redis_count: Optional[int] = None
    db_count: Optional[int] = None
    elapsed_ms: float = 0


class BulkTestResponse(BaseModel):
    """동시 요청 실험 결과(성공/실패/소요시간)."""
    total_requests: int
    # Redis 실험 결과
    redis_success: int = 0       # 발급 성공 수
    redis_sold_out: int = 0      # 재고 소진으로 거절된 수
    redis_error: int = 0         # 서버 에러 수
    redis_elapsed_ms: float = 0
    # DB 실험 결과
    db_success: int = 0          # 발급 성공 수
    db_sold_out: int = 0         # 재고 소진으로 거절된 수 (잠금 대기 후 거절)
    db_error: int = 0            # 서버 에러 수
    db_elapsed_ms: float = 0


# --- Mini Redis 헬퍼 함수 ---
# 엔드포인트 코드에서 "무엇을 하는지"가 더 잘 보이도록 래핑해 둔다.

async def redis_get(key: str) -> Optional[str]:
    """Mini Redis에서 값 조회 (직접 호출)"""
    return await redis_store.get(key)


async def redis_set(key: str, value: str, ttl: Optional[int] = None):
    """Mini Redis에 값 저장 (직접 호출). ttl(초)을 주면 해당 시간 후 자동 만료."""
    await redis_store.set(key, value, ttl)


async def redis_ttl(key: str) -> int:
    """Mini Redis 키의 남은 TTL(초) 반환. 없으면 -2, TTL 없으면 -1."""
    return await redis_store.ttl(key)


async def redis_decr(key: str) -> int:
    """Mini Redis에서 값을 1 감소한다(atomic)."""
    return await redis_store.decr(key)


async def redis_incr(key: str) -> int:
    """Mini Redis에서 값을 1 증가한다(atomic)."""
    return await redis_store.incr(key)


# --- API 엔드포인트 ---
# 읽는 순서: 단건 발급(Redis/DB) -> 재고 조회/초기화 -> 대량 비교 실험

@app.post("/coupon/issue/redis", summary="Redis 방식 쿠폰 발급")
async def issue_coupon_redis() -> CouponResponse:
    """Redis 방식 발급: atomic DECR로 재고를 먼저 줄인 뒤, 성공 시 발급 기록 저장."""
    start = time.perf_counter()
    coupon_code = str(uuid.uuid4())[:8]

    try:
        # 1) 재고를 먼저 1 감소시킨다(동시에 요청이 와도 값이 꼬이지 않음).
        remaining = await redis_decr("coupon_stock")

        if remaining < 0:
            # 2) 0 아래로 내려갔으면 "이미 소진" 상태이므로 바로 1 복구해 정합성을 맞춘다.
            await redis_incr("coupon_stock")
            elapsed = (time.perf_counter() - start) * 1000
            return CouponResponse(
                success=False,
                message="쿠폰이 모두 소진되었습니다",
                remaining=0,
                elapsed_ms=round(elapsed, 2),
            )

        # 3) 실제 발급 성공 건은 DB에 이력으로 남기고, Redis에 TTL 15초로 쿠폰 코드를 등록한다.
        now = datetime.now()
        expires = now.replace(microsecond=0) + timedelta(seconds=15)
        async with db_pool.acquire() as conn:
            row = await conn.fetchrow(
                "INSERT INTO coupons (coupon_code, issued_at, expires_at) VALUES ($1, $2, $3) RETURNING id",
                coupon_code, now, expires,
            )
        # Redis에 coupon_code 키로 "valid" 저장 + TTL 15초 → 15초 후 자동 만료
        await redis_set(coupon_code, "valid", ttl=15)

        elapsed = (time.perf_counter() - start) * 1000
        return CouponResponse(
            success=True,
            message="쿠폰이 발급되었습니다! (Redis)",
            user_id=row["id"],
            coupon_code=coupon_code,
            remaining=remaining,
            expires_at=expires.strftime("%H:%M:%S"),
            elapsed_ms=round(elapsed, 2),
        )
    except Exception as e:
        elapsed = (time.perf_counter() - start) * 1000
        raise HTTPException(status_code=500, detail=f"Redis 쿠폰 발급 실패: {e}")


@app.post("/coupon/issue/db", summary="DB 방식 쿠폰 발급")
async def issue_coupon_db() -> CouponResponse:
    """DB 방식 발급: 트랜잭션 + 행 잠금(FOR UPDATE)으로 재고를 안전하게 감소."""
    start = time.perf_counter()
    coupon_code = str(uuid.uuid4())[:8]

    try:
        async with db_pool.acquire() as conn:
            # 1) 트랜잭션 안에서 처리해 중간 실패 시 롤백 가능하게 한다.
            async with conn.transaction():
                # 2) FOR UPDATE: 같은 재고 행을 다른 요청이 동시에 수정하지 못하게 순서를 세운다.
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

                # 3) 재고 감소 후 저장
                new_count = row["count"] - 1
                await conn.execute(
                    "UPDATE coupon_stock SET count = $1 WHERE id = 1", new_count
                )

                # 4) 발급 이력 저장. RETURNING id로 발급 ID를 받는다.
                now = datetime.now()
                expires = now.replace(microsecond=0) + timedelta(seconds=15)
                issued = await conn.fetchrow(
                    "INSERT INTO coupons (coupon_code, issued_at, expires_at) VALUES ($1, $2, $3) RETURNING id",
                    coupon_code, now, expires,
                )

        # Redis에 coupon_code 키로 "valid" 저장 + TTL 15초
        await redis_set(coupon_code, "valid", ttl=15)

        elapsed = (time.perf_counter() - start) * 1000
        return CouponResponse(
            success=True,
            message="쿠폰이 발급되었습니다! (DB)",
            user_id=issued["id"],
            coupon_code=coupon_code,
            remaining=new_count,
            expires_at=expires.strftime("%H:%M:%S"),
            elapsed_ms=round(elapsed, 2),
        )
    except HTTPException:
        raise
    except Exception as e:
        elapsed = (time.perf_counter() - start) * 1000
        raise HTTPException(status_code=500, detail=f"DB 쿠폰 발급 실패: {e}")


@app.get("/coupon/count", summary="남은 쿠폰 수량 조회")
async def get_coupon_count() -> CountResponse:
    """현재 남은 쿠폰 수를 Redis와 DB에서 각각 조회한다."""
    start = time.perf_counter()
    redis_count = None
    db_count = None

    # Redis 조회 실패가 있어도 전체 API는 동작하도록, 각 저장소 오류는 독립 처리한다.
    try:
        value = await redis_get("coupon_stock")
        if value is not None:
            redis_count = int(value)
    except Exception:
        pass

    # DB 조회도 같은 방식으로 독립 처리한다.
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
    """학습/실험 편의를 위해 쿠폰 재고를 100개로 초기화한다."""
    start = time.perf_counter()

    # 1) Redis 재고 초기화
    try:
        await redis_set("coupon_stock", "100")
    except Exception:
        pass

    # 2) DB 재고 초기화 + 발급 기록 삭제(깨끗한 상태로 리셋)
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
    """1000명 동시 요청으로 Redis 방식과 DB 방식을 같은 조건에서 비교한다."""
    total = 1000

    # A. 실험 준비: 현재 재고를 읽어 두고(음수 방지), 두 방식 모두 같은 시작점으로 맞춘다.
    redis_stock = 100
    try:
        value = await redis_get("coupon_stock")
        if value is not None:
            redis_stock = max(int(value), 0)
    except Exception:
        pass

    # DB 현재 재고도 확인
    db_stock = 100
    try:
        async with db_pool.acquire() as conn:
            row = await conn.fetchrow("SELECT count FROM coupon_stock WHERE id = 1")
            if row:
                db_stock = max(row["count"], 0)
    except Exception:
        pass

    # Redis/DB를 동일 재고로 맞추고, 발급 이력은 삭제
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

    # B. Redis 방식 실험
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
                r_sold_out += 1  # 소진으로 거절된 건은 정상 동작으로 본다.
        except Exception:
            r_error += 1  # 예외는 서버 에러로 집계

    redis_start = time.perf_counter()
    # 동일한 요청 1000개를 동시에 날려 총 소요 시간 측정
    await asyncio.gather(*[redis_request() for _ in range(total)])
    redis_elapsed = (time.perf_counter() - redis_start) * 1000

    # C. DB 방식 실험 전, DB 재고를 같은 시작 상태로 다시 세팅
    try:
        async with db_pool.acquire() as conn:
            await conn.execute("UPDATE coupon_stock SET count = $1 WHERE id = 1", db_stock)
            await conn.execute("DELETE FROM coupons")
    except Exception:
        pass

    # D. DB 방식 실험
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
                d_sold_out += 1  # 잠금 대기 후 재고 0을 확인해 거절
        except Exception:
            d_error += 1  # 예외는 서버 에러로 집계

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


@app.get("/coupon/validate/{coupon_code}", summary="쿠폰 유효성 검증")
async def validate_coupon(coupon_code: str):
    """Redis TTL로 쿠폰 유효 여부를 확인한다.
    - Redis에 키가 있으면 → 유효 (남은 초 반환)
    - Redis에 없으면 → DB에서 만료 여부 확인
    """
    ttl = await redis_ttl(coupon_code)
    if ttl >= 0:
        return {"valid": True, "remaining_seconds": ttl, "source": "redis"}

    # Redis에 없으면 DB에서 기록 확인 (만료됐거나 애초에 없는 쿠폰)
    try:
        async with db_pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT expires_at FROM coupons WHERE coupon_code = $1", coupon_code
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"검증 실패: {e}")

    if row is None:
        return {"valid": False, "reason": "존재하지 않는 쿠폰"}
    return {
        "valid": False,
        "reason": "만료된 쿠폰",
        "expired_at": row["expires_at"].strftime("%H:%M:%S"),
    }


@app.get("/health", summary="헬스 체크")
async def health():
    """서버 상태 확인"""
    return {"status": "ok", "service": "coupon-api"}


if __name__ == "__main__":
    import uvicorn
    # 로컬 학습용 API 서버 실행 포트
    uvicorn.run(app, host="0.0.0.0", port=8000)
