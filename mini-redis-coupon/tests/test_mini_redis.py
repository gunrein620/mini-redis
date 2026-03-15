"""
Mini Redis 서버 단위 테스트
- MiniRedisStore 클래스의 GET/SET/DELETE/INCR/DECR/TTL 기능 검증
"""

import asyncio
import time

import pytest

# 프로젝트 경로 설정
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "mini-redis"))

from server import MiniRedisStore


@pytest.fixture
def store():
    """테스트용 MiniRedisStore 인스턴스 생성"""
    return MiniRedisStore()


@pytest.mark.asyncio
async def test_set_and_get(store):
    """SET 후 GET으로 값을 조회할 수 있는지 테스트"""
    await store.set("key1", "value1")
    result = await store.get("key1")
    assert result == "value1"


@pytest.mark.asyncio
async def test_get_nonexistent_key(store):
    """존재하지 않는 키를 GET하면 None을 반환하는지 테스트"""
    result = await store.get("nonexistent")
    assert result is None


@pytest.mark.asyncio
async def test_set_overwrite(store):
    """같은 키에 SET하면 값이 덮어씌워지는지 테스트"""
    await store.set("key1", "value1")
    await store.set("key1", "value2")
    result = await store.get("key1")
    assert result == "value2"


@pytest.mark.asyncio
async def test_delete_existing_key(store):
    """존재하는 키를 DELETE하면 1을 반환하고 삭제되는지 테스트"""
    await store.set("key1", "value1")
    count = await store.delete("key1")
    assert count == 1
    result = await store.get("key1")
    assert result is None


@pytest.mark.asyncio
async def test_delete_nonexistent_key(store):
    """존재하지 않는 키를 DELETE하면 0을 반환하는지 테스트"""
    count = await store.delete("nonexistent")
    assert count == 0


@pytest.mark.asyncio
async def test_incr_new_key(store):
    """존재하지 않는 키에 INCR하면 1이 되는지 테스트"""
    result = await store.incr("counter")
    assert result == 1


@pytest.mark.asyncio
async def test_incr_existing_key(store):
    """기존 값에 INCR하면 1 증가하는지 테스트"""
    await store.set("counter", "10")
    result = await store.incr("counter")
    assert result == 11


@pytest.mark.asyncio
async def test_decr_new_key(store):
    """존재하지 않는 키에 DECR하면 -1이 되는지 테스트"""
    result = await store.decr("counter")
    assert result == -1


@pytest.mark.asyncio
async def test_decr_existing_key(store):
    """기존 값에 DECR하면 1 감소하는지 테스트"""
    await store.set("counter", "10")
    result = await store.decr("counter")
    assert result == 9


@pytest.mark.asyncio
async def test_incr_non_integer_value(store):
    """정수가 아닌 값에 INCR하면 ValueError 발생하는지 테스트"""
    await store.set("key1", "not_a_number")
    with pytest.raises(ValueError):
        await store.incr("key1")


@pytest.mark.asyncio
async def test_decr_non_integer_value(store):
    """정수가 아닌 값에 DECR하면 ValueError 발생하는지 테스트"""
    await store.set("key1", "not_a_number")
    with pytest.raises(ValueError):
        await store.decr("key1")


@pytest.mark.asyncio
async def test_ttl_expiry(store):
    """TTL이 설정된 키가 만료 후 자동 삭제되는지 테스트"""
    await store.set("temp_key", "temp_value", ttl=1)
    # TTL 전에는 값이 존재
    result = await store.get("temp_key")
    assert result == "temp_value"
    # TTL 만료 대기
    await asyncio.sleep(1.1)
    # 만료 후에는 None 반환
    result = await store.get("temp_key")
    assert result is None


@pytest.mark.asyncio
async def test_ttl_reset_on_set(store):
    """TTL이 있는 키를 TTL 없이 다시 SET하면 만료되지 않는지 테스트"""
    await store.set("key1", "value1", ttl=1)
    await store.set("key1", "value2")  # TTL 없이 덮어쓰기
    await asyncio.sleep(1.1)
    result = await store.get("key1")
    assert result == "value2"  # 만료되지 않아야 함


@pytest.mark.asyncio
async def test_cleanup_expired(store):
    """cleanup_expired가 만료된 키를 정리하는지 테스트"""
    await store.set("temp1", "val1", ttl=1)
    await store.set("temp2", "val2", ttl=1)
    await store.set("permanent", "val3")
    await asyncio.sleep(1.1)
    await store.cleanup_expired()
    assert await store.get("temp1") is None
    assert await store.get("temp2") is None
    assert await store.get("permanent") == "val3"


@pytest.mark.asyncio
async def test_concurrent_incr(store):
    """동시에 여러 INCR 요청이 정확하게 처리되는지 테스트 (동시성 검증)"""
    await store.set("counter", "0")

    async def increment():
        await store.incr("counter")

    # 100개의 동시 INCR 실행
    await asyncio.gather(*[increment() for _ in range(100)])

    result = await store.get("counter")
    assert result == "100"  # 정확히 100이어야 함


@pytest.mark.asyncio
async def test_concurrent_decr(store):
    """동시에 여러 DECR 요청이 정확하게 처리되는지 테스트 (동시성 검증)"""
    await store.set("stock", "100")

    async def decrement():
        await store.decr("stock")

    # 100개의 동시 DECR 실행
    await asyncio.gather(*[decrement() for _ in range(100)])

    result = await store.get("stock")
    assert result == "0"  # 정확히 0이어야 함
