(function attachCouponStorage(globalScope) {
    const STORAGE_KEY = "wg-coupon-storage-v1";

    function readCoupons() {
        try {
            const raw = globalScope.localStorage.getItem(STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }

    function writeCoupons(coupons) {
        globalScope.localStorage.setItem(STORAGE_KEY, JSON.stringify(coupons));
    }

    function normalizeMethod(method) {
        if (!method) {
            return "unknown";
        }

        const lowered = String(method).toLowerCase();
        if (lowered.includes("postgres")) {
            return "postgresql";
        }
        if (lowered.includes("redis")) {
            return "redis";
        }
        return lowered;
    }

    function createCouponId(userId, issuedMethod, issuedAt) {
        const stamp = new Date(issuedAt).getTime().toString(36).toUpperCase();
        return `${normalizeMethod(issuedMethod).slice(0, 3).toUpperCase()}-${userId}-${stamp}`;
    }

    function saveCoupon(payload) {
        const issuedAt = payload.issuedAt || new Date().toISOString();
        const coupon = {
            userId: payload.userId,
            couponId: payload.couponId || createCouponId(payload.userId, payload.issuedMethod, issuedAt),
            issuedMethod: normalizeMethod(payload.issuedMethod),
            issuedAt,
            expiresAt: payload.expiresAt,
        };

        const coupons = readCoupons();
        coupons.push(coupon);
        writeCoupons(coupons);
        return coupon;
    }

    function findLatestCouponByUserId(userId) {
        if (!userId) {
            return null;
        }

        const matched = readCoupons()
            .filter((coupon) => coupon.userId === userId)
            .sort((left, right) => new Date(right.issuedAt) - new Date(left.issuedAt));

        return matched[0] || null;
    }

    function getRemainingMs(coupon) {
        if (!coupon || !coupon.expiresAt) {
            return 0;
        }
        return new Date(coupon.expiresAt).getTime() - Date.now();
    }

    function formatRemainingTime(remainingMs) {
        if (remainingMs <= 0) {
            return "만료됨";
        }

        const totalSeconds = Math.floor(remainingMs / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0) {
            return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
        }

        return [minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
    }

    function buildCheckoutUrl(basePath, userId) {
        const url = new URL(basePath, globalScope.location.href);
        if (userId) {
            url.searchParams.set("userId", userId);
        }
        return url.toString();
    }

    globalScope.WGCouponStorage = {
        buildCheckoutUrl,
        findLatestCouponByUserId,
        formatRemainingTime,
        getRemainingMs,
        readCoupons,
        saveCoupon,
    };
})(window);
