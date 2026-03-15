"""
Backend API 서버 단위 테스트
- FastAPI 엔드포인트 테스트 (httpx + TestClient)
- Mini Redis 서버와 PostgreSQL이 실행 중이어야 함
"""

import pytest
from httpx import ASGITransport, AsyncClient

# 프로젝트 경로 설정
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))


@pytest.mark.asyncio
async def test_health_check():
    """헬스 체크 엔드포인트 테스트"""
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["service"] == "coupon-api"
