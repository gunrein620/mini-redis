-- 쿠폰 이벤트 데이터베이스 초기화 SQL
-- PostgreSQL 14 사용

-- 기존 테이블이 있으면 삭제
DROP TABLE IF EXISTS coupons;
DROP TABLE IF EXISTS coupon_stock;

-- 쿠폰 발급 기록 테이블
CREATE TABLE coupons (
    id SERIAL PRIMARY KEY,              -- 쿠폰 발급 ID (자동 증가)
    coupon_code VARCHAR(50) NOT NULL,   -- 발급된 쿠폰 코드 (UUID 기반 랜덤 코드)
    issued_at TIMESTAMP NOT NULL DEFAULT NOW()  -- 발급 시각
);

-- 쿠폰 재고 테이블
CREATE TABLE coupon_stock (
    id SERIAL PRIMARY KEY,   -- 재고 ID
    count INTEGER NOT NULL DEFAULT 0  -- 남은 쿠폰 수량
);

-- 인덱스 생성 (쿠폰 코드별 조회 성능 향상)
CREATE INDEX idx_coupons_coupon_code ON coupons(coupon_code);
CREATE INDEX idx_coupons_issued_at ON coupons(issued_at);
