"""
이 파일은 "Mini Redis 서버"의 핵심을 담고 있습니다.
큰 흐름은 단순합니다: 메모리(dict)에 값을 저장하고, 필요하면 TTL로 만료를 관리합니다.
여러 요청이 동시에 와도 값이 꼬이지 않도록 asyncio Lock으로 한 번에 하나씩 처리합니다.
마지막으로 FastAPI 엔드포인트를 통해 GET/SET/INCR/DECR 같은 기능을 HTTP로 제공합니다.
"""

from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager
from typing import Dict, Optional, Union

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel


class MiniRedisStore:
    """메모리(dict) 기반 키-값 저장소"""

    def __init__(self):
        # 1) 실제 값을 저장하는 공간
        self._data: Dict[str, str] = {}
        # 2) 만료 시간을 저장하는 공간 (key -> 만료 시각)
        self._ttl: Dict[str, float] = {}
        # 3) 동시에 들어오는 요청을 안전하게 순서대로 처리하기 위한 Lock
        self._lock = asyncio.Lock()

    def _is_expired(self, key: str) -> bool:
        """키 만료 여부를 확인하고, 만료되었으면 즉시 정리한다."""
        if key in self._ttl:
            if time.time() > self._ttl[key]:
                # 만료된 키는 조회 전에 바로 삭제해서 데이터 일관성을 유지한다.
                del self._data[key]
                del self._ttl[key]
                return True
        return False

    async def get(self, key: str) -> str | None:
        """GET 흐름: Lock 획득 -> 만료 확인 -> 값 반환(None 가능)."""
        async with self._lock:
            if self._is_expired(key):
                return None
            return self._data.get(key)

    async def set(self, key: str, value: str, ttl: int | None = None) -> str:
        """SET 흐름: 값 저장 -> TTL 옵션 처리 -> 'OK' 반환."""
        async with self._lock:
            self._data[key] = value
            if ttl is not None and ttl > 0:
                # TTL(초)만큼 지난 뒤 자동 만료되도록 절대 시각을 기록한다.
                self._ttl[key] = time.time() + ttl
            elif key in self._ttl:
                # TTL 없이 덮어쓰면 "영구 저장"으로 간주하여 기존 만료 시간을 지운다.
                del self._ttl[key]
            return "OK"

    async def delete(self, key: str) -> int:
        """DELETE 흐름: 만료 정리 -> 키 삭제 -> 삭제 개수(0/1) 반환."""
        async with self._lock:
            self._is_expired(key)
            if key in self._data:
                del self._data[key]
                self._ttl.pop(key, None)
                return 1
            return 0

    async def incr(self, key: str) -> int:
        """INCR 흐름: 문자열 숫자를 1 증가해서 저장하고 새 값을 반환한다."""
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
        """DECR 흐름: 문자열 숫자를 1 감소해서 저장하고 새 값을 반환한다."""
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
        """백그라운드에서 만료된 키를 주기적으로 일괄 삭제한다."""
        async with self._lock:
            now = time.time()
            expired_keys = [k for k, v in self._ttl.items() if now > v]
            for key in expired_keys:
                self._data.pop(key, None)
                self._ttl.pop(key, None)


# 전체 API가 공유해서 쓰는 단일 저장소 인스턴스
store = MiniRedisStore()


async def cleanup_task():
    """서버가 살아있는 동안 1초마다 만료 키 정리 작업을 수행한다."""
    while True:
        await store.cleanup_expired()
        await asyncio.sleep(1)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작 시 정리 태스크를 띄우고, 종료 시 안전하게 중단한다."""
    task = asyncio.create_task(cleanup_task())
    yield
    task.cancel()


app = FastAPI(title="Mini Redis Server", lifespan=lifespan)


# --- 요청/응답 데이터 모델: API 입력과 출력을 일정한 형태로 맞춘다. ---

class SetRequest(BaseModel):
    """SET 요청 본문: 어떤 key에 어떤 value를 저장할지 표현한다."""
    key: str
    value: str
    ttl: Optional[int] = None  # TTL(초). 비우면 만료되지 않는다.


class KeyRequest(BaseModel):
    """키 기반 요청 모델(현재 코드에서는 확장용으로 남겨둔 형태)."""
    key: str


class RedisResponse(BaseModel):
    """공통 응답 모델: 성공 여부 + 데이터 + 설명 메시지."""
    success: bool
    data: Union[str, int, None] = None
    message: str = ""


# --- API 엔드포인트: 외부 요청을 받아 Store 메서드로 연결한다. ---

@app.get("/get/{key}", summary="GET - 키 조회")
async def api_get(key: str) -> RedisResponse:
    """GET /get/{key}: key의 현재 값을 조회한다."""
    value = await store.get(key)
    if value is None:
        return RedisResponse(success=True, data=None, message="키가 존재하지 않습니다")
    return RedisResponse(success=True, data=value)


@app.post("/set", summary="SET - 키-값 저장")
async def api_set(req: SetRequest) -> RedisResponse:
    """POST /set: key-value 저장(필요하면 TTL도 함께 설정)."""
    result = await store.set(req.key, req.value, req.ttl)
    return RedisResponse(success=True, data=result, message=f"'{req.key}' 저장 완료")


@app.delete("/delete/{key}", summary="DELETE - 키 삭제")
async def api_delete(key: str) -> RedisResponse:
    """DELETE /delete/{key}: key 삭제 결과를 0/1로 반환한다."""
    count = await store.delete(key)
    if count == 0:
        return RedisResponse(success=True, data=0, message="삭제할 키가 없습니다")
    return RedisResponse(success=True, data=count, message=f"'{key}' 삭제 완료")


@app.post("/incr/{key}", summary="INCR - 값 1 증가")
async def api_incr(key: str) -> RedisResponse:
    """POST /incr/{key}: 숫자 값을 1 증가(atomic)시킨다."""
    try:
        new_value = await store.incr(key)
        return RedisResponse(success=True, data=new_value)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/decr/{key}", summary="DECR - 값 1 감소")
async def api_decr(key: str) -> RedisResponse:
    """POST /decr/{key}: 숫자 값을 1 감소(atomic)시킨다."""
    try:
        new_value = await store.decr(key)
        return RedisResponse(success=True, data=new_value)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/health", summary="헬스 체크")
async def health():
    """GET /health - 서버 상태 확인"""
    return {"status": "ok", "service": "mini-redis"}


if __name__ == "__main__":
    import uvicorn
    # 로컬 학습용 실행 포트: 6379 (Redis 기본 포트와 동일)
    uvicorn.run(app, host="0.0.0.0", port=6379)
