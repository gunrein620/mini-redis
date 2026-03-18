const lookupForm = document.getElementById("lookup-form");
const userIdInput = document.getElementById("user-id-input");
const emptyState = document.getElementById("empty-state");
const couponResult = document.getElementById("coupon-result");
const statusBadge = document.getElementById("status-badge");
const methodChip = document.getElementById("method-chip");
const resultUserId = document.getElementById("result-user-id");
const resultCouponId = document.getElementById("result-coupon-id");
const resultIssuedAt = document.getElementById("result-issued-at");
const resultRemaining = document.getElementById("result-remaining");
const useCouponButton = document.getElementById("use-coupon-button");
const couponModal = document.getElementById("coupon-modal");
const closeModalButton = document.getElementById("close-modal-button");

let currentCoupon = null;
let countdownTimer = null;

function formatIssuedMethod(method) {
    if (method === "postgresql") {
        return "PostgreSQL";
    }
    if (method === "redis") {
        return "Redis";
    }
    return "알 수 없음";
}

function stopCountdown() {
    if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
    }
}

function showEmptyState(message) {
    currentCoupon = null;
    stopCountdown();
    couponResult.classList.add("hidden");
    emptyState.classList.remove("hidden");
    emptyState.textContent = message;
}

function syncStatus() {
    if (!currentCoupon || !window.WGCouponStorage) {
        return;
    }

    const remainingMs = window.WGCouponStorage.getRemainingMs(currentCoupon);
    const expired = remainingMs <= 0;

    statusBadge.textContent = expired ? "만료됨" : "사용 가능";
    statusBadge.className = `status-badge ${expired ? "expired" : "available"}`;

    resultRemaining.textContent = expired
        ? "만료됨"
        : window.WGCouponStorage.formatRemainingTime(remainingMs);
    resultRemaining.classList.toggle("expired-text", expired);
}

function startCountdown() {
    stopCountdown();
    syncStatus();

    countdownTimer = window.setInterval(() => {
        syncStatus();
        if (!currentCoupon || window.WGCouponStorage.getRemainingMs(currentCoupon) <= 0) {
            stopCountdown();
        }
    }, 1000);
}

function renderCoupon(coupon) {
    currentCoupon = coupon;
    emptyState.classList.add("hidden");
    couponResult.classList.remove("hidden");

    resultUserId.textContent = coupon.userId;
    resultCouponId.textContent = coupon.couponId;
    resultIssuedAt.textContent = new Date(coupon.issuedAt).toLocaleString("ko-KR");
    methodChip.textContent = `발급 방식: ${formatIssuedMethod(coupon.issuedMethod)}`;

    startCountdown();
}

function lookupCoupon(userId) {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
        showEmptyState("사용자 ID를 입력해주세요.");
        return;
    }

    const coupon = window.WGCouponStorage
        ? window.WGCouponStorage.findLatestCouponByUserId(normalizedUserId)
        : null;

    if (!coupon) {
        showEmptyState("보관된 쿠폰이 없습니다.");
        return;
    }

    renderCoupon(coupon);
}

function openModal() {
    couponModal.classList.remove("hidden");
}

function closeModal() {
    couponModal.classList.add("hidden");
}

lookupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    lookupCoupon(userIdInput.value);
});

useCouponButton.addEventListener("click", () => {
    if (!currentCoupon || !window.WGCouponStorage) {
        alert("보관된 쿠폰이 없습니다.");
        return;
    }

    const remainingMs = window.WGCouponStorage.getRemainingMs(currentCoupon);
    if (remainingMs >= 1000) {
        openModal();
        return;
    }

    syncStatus();
    alert("사용기간이 만료된 쿠폰입니다");
});

closeModalButton.addEventListener("click", closeModal);
couponModal.addEventListener("click", (event) => {
    if (event.target === couponModal) {
        closeModal();
    }
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !couponModal.classList.contains("hidden")) {
        closeModal();
    }
});

const params = new URLSearchParams(window.location.search);
const presetUserId = params.get("userId");
if (presetUserId) {
    userIdInput.value = presetUserId;
    lookupCoupon(presetUserId);
}
