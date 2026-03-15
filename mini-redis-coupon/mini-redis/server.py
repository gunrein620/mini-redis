"""
Mini Redis 서버
- Python으로 직접 구현한 해시 테이블 기반 키-값 저장소
- TTL 지원 (만료된 키 자동 삭제)
- GET / SET / DELETE / INCR / DECR API 제공
- FastAPI HTTP 서버 (포트 6379)
- asyncio.Lock()으로 동시성 제어
"""

from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager
from typing import Dict, Optional, Union

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel


class MiniRedisStore:
    """해시 테이블 기반 키-값 저장소"""

    def __init__(self):
        # 데이터 저장소 (해시 테이블)
        self._data: Dict[str, str] = {}
        # TTL 저장소 (키 -> 만료 시각)
        self._ttl: Dict[str, float] = {}
        # 동시성 제어를 위한 락
        self._lock = asyncio.Lock()

    def _is_expired(self, key: str) -> bool:
        """키가 만료되었는지 확인"""
        if key in self._ttl:
            if time.time() > self._ttl[key]:
                # 만료된 키 삭제
                del self._data[key]
                del self._ttl[key]
                return True
        return False

    async def get(self, key: str) -> str | None:
        """키에 해당하는 값을 조회"""
        async with self._lock:
            if self._is_expired(key):
                return None
            return self._data.get(key)

    async def set(self, key: str, value: str, ttl: int | None = None) -> str:
        """키-값 쌍을 저장 (TTL 옵션)"""
        async with self._lock:
            self._data[key] = value
            if ttl is not None and ttl > 0:
                # TTL(초) 후 만료되도록 설정
                self._ttl[key] = time.time() + ttl
            elif key in self._ttl:
                # TTL 없이 SET하면 기존 TTL 제거
                del self._ttl[key]
            return "OK"

    async def delete(self, key: str) -> int:
        """키를 삭제하고 삭제된 키 수를 반환"""
        async with self._lock:
            self._is_expired(key)
            if key in self._data:
                del self._data[key]
                self._ttl.pop(key, None)
                return 1
            return 0

    async def incr(self, key: str) -> int:
        """키의 값을 1 증가 (없으면 0에서 시작)"""
        async with self._lock:
            self._is_expired(key)
            current = self._data.get(key, "0")
            try:
                new_value = int(current) + 1
            except ValueError:
                raise ValueError(f"'{key}'의 값이 정수가 아닙니다: {current}")
            self._data[key] = str(new_value)
            return new_value

    async def decr(self, key: str) -> int:
        """키의 값을 1 감소 (없으면 0에서 시작)"""
        async with self._lock:
            self._is_expired(key)
            current = self._data.get(key, "0")
            try:
                new_value = int(current) - 1
            except ValueError:
                raise ValueError(f"'{key}'의 값이 정수가 아닙니다: {current}")
            self._data[key] = str(new_value)
            return new_value

    async def cleanup_expired(self):
        """만료된 키들을 일괄 정리"""
        async with self._lock:
            now = time.time()
            expired_keys = [k for k, v in self._ttl.items() if now > v]
            for key in expired_keys:
                self._data.pop(key, None)
                self._ttl.pop(key, None)


# 전역 Mini Redis 인스턴스
store = MiniRedisStore()


async def cleanup_task():
    """주기적으로 만료된 키를 정리하는 백그라운드 태스크"""
    while True:
        await store.cleanup_expired()
        await asyncio.sleep(1)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작 시 백그라운드 정리 태스크 실행"""
    task = asyncio.create_task(cleanup_task())
    yield
    task.cancel()


app = FastAPI(title="Mini Redis Server", lifespan=lifespan)


# --- 요청/응답 모델 ---

class SetRequest(BaseModel):
    """SET 요청 모델"""
    key: str
    value: str
    ttl: Optional[int] = None  # TTL(초), 생략 시 만료 없음


class KeyRequest(BaseModel):
    """키 기반 요청 모델"""
    key: str


class RedisResponse(BaseModel):
    """공통 응답 모델"""
    success: bool
    data: Union[str, int, None] = None
    message: str = ""


# --- API 엔드포인트 ---

@app.get("/get/{key}", summary="GET - 키 조회")
async def api_get(key: str) -> RedisResponse:
    """키에 해당하는 값을 조회"""
    value = await store.get(key)
    if value is None:
        return RedisResponse(success=True, data=None, message="키가 존재하지 않습니다")
    return RedisResponse(success=True, data=value)


@app.post("/set", summary="SET - 키-값 저장")
async def api_set(req: SetRequest) -> RedisResponse:
    """키-값 쌍을 저장"""
    result = await store.set(req.key, req.value, req.ttl)
    return RedisResponse(success=True, data=result, message=f"'{req.key}' 저장 완료")


@app.delete("/delete/{key}", summary="DELETE - 키 삭제")
async def api_delete(key: str) -> RedisResponse:
    """키를 삭제"""
    count = await store.delete(key)
    if count == 0:
        return RedisResponse(success=True, data=0, message="삭제할 키가 없습니다")
    return RedisResponse(success=True, data=count, message=f"'{key}' 삭제 완료")


@app.post("/incr/{key}", summary="INCR - 값 1 증가")
async def api_incr(key: str) -> RedisResponse:
    """키의 값을 1 증가"""
    try:
        new_value = await store.incr(key)
        return RedisResponse(success=True, data=new_value)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/decr/{key}", summary="DECR - 값 1 감소")
async def api_decr(key: str) -> RedisResponse:
    """키의 값을 1 감소"""
    try:
        new_value = await store.decr(key)
        return RedisResponse(success=True, data=new_value)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/health", summary="헬스 체크")
async def health():
    """서버 상태 확인"""
    return {"status": "ok", "service": "mini-redis"}


if __name__ == "__main__":
    import uvicorn
    # 포트 6379에서 Mini Redis 서버 실행
    uvicorn.run(app, host="0.0.0.0", port=6379)
