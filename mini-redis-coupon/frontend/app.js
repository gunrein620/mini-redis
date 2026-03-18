const API_BASE = "http://localhost:8000";
const DEMO_EXPIRY_MINUTES = 3;

let logs = [];

function showResult(html) {
    document.getElementById("result-box").innerHTML = html;
}

function addLog(message, type, elapsedMs) {
    logs.unshift({ message, type, elapsedMs, time: new Date() });
    if (logs.length > 10) {
        logs.pop();
    }
    renderLogs();
}

function renderLogs() {
    const logList = document.getElementById("log-list");
    document.getElementById("log-count").textContent = `(${logs.length}/10)`;

    if (logs.length === 0) {
        logList.innerHTML = '<p class="placeholder">아직 요청 기록이 없습니다.</p>';
        return;
    }

    logList.innerHTML = logs
        .map(
            (log) => `
                <div class="log-item ${log.type}">
                    <span class="log-msg">${log.message}</span>
                    <span class="log-time">${log.elapsedMs}ms</span>
                </div>
            `
        )
        .join("");
}

function setButtonsDisabled(disabled) {
    document.querySelectorAll(".btn").forEach((button) => {
        button.disabled = disabled;
    });
}

function buildCheckoutHref(userId) {
    if (window.WGCouponStorage && typeof window.WGCouponStorage.buildCheckoutUrl === "function") {
        return window.WGCouponStorage.buildCheckoutUrl("/coupon-checkout/", userId);
    }

    const url = new URL("/coupon-checkout/", window.location.origin);
    if (userId) {
        url.searchParams.set("userId", userId);
    }
    return url.toString();
}

function persistCouponIssue(method, response) {
    if (!window.WGCouponStorage || typeof window.WGCouponStorage.saveCoupon !== "function") {
        return null;
    }

    return window.WGCouponStorage.saveCoupon({
        userId: response.user_id,
        issuedMethod: method,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + DEMO_EXPIRY_MINUTES * 60 * 1000).toISOString(),
    });
}

function renderIssueResult(response, methodLabel) {
    const checkoutHref = buildCheckoutHref(response.user_id);
    const savedCoupon = persistCouponIssue(methodLabel.toLowerCase(), response);
    const couponIdMarkup = savedCoupon
        ? `<p>쿠폰 번호: <strong>${savedCoupon.couponId}</strong></p>`
        : "";

    showResult(`
        <p class="result-success">${response.message}</p>
        <p>사용자 ID: <strong>${response.user_id}</strong></p>
        ${couponIdMarkup}
        <p>남은 재고: ${response.remaining}개</p>
        <p class="result-time">처리 시간: ${response.elapsed_ms}ms</p>
        <div class="result-actions">
            <a class="inline-link" href="${checkoutHref}">쿠폰 보관함으로 이동</a>
        </div>
    `);

    addLog(`[${methodLabel}] 발급 성공 (${response.user_id})`, "success", response.elapsed_ms);
}

function renderFailureResult(response, methodLabel) {
    showResult(`
        <p class="result-fail">${response.message}</p>
        <p class="result-time">처리 시간: ${response.elapsed_ms}ms</p>
    `);

    addLog(`[${methodLabel}] ${response.message}`, "fail", response.elapsed_ms);
}

async function refreshCount() {
    try {
        const response = await fetch(`${API_BASE}/coupon/count`);
        const data = await response.json();

        document.getElementById("redis-count").textContent =
            data.redis_count !== null ? data.redis_count : "-";
        document.getElementById("db-count").textContent =
            data.db_count !== null ? data.db_count : "-";
    } catch (error) {
        // Ignore initial count loading failures so the page still renders.
    }
}

async function issueCouponRedis() {
    setButtonsDisabled(true);
    showResult('<span class="loading"></span>Redis 방식으로 쿠폰을 발급하는 중입니다...');

    try {
        const response = await fetch(`${API_BASE}/coupon/issue/redis`, { method: "POST" });
        const data = await response.json();

        if (data.success) {
            renderIssueResult(data, "Redis");
        } else {
            renderFailureResult(data, "Redis");
        }
    } catch (error) {
        showResult(`<p class="result-fail">서버 연결에 실패했습니다: ${error.message}</p>`);
        addLog("[Redis] 서버 연결 실패", "fail", 0);
    }

    await refreshCount();
    setButtonsDisabled(false);
}

async function issueCouponDB() {
    setButtonsDisabled(true);
    showResult('<span class="loading"></span>PostgreSQL 방식으로 쿠폰을 발급하는 중입니다...');

    try {
        const response = await fetch(`${API_BASE}/coupon/issue/db`, { method: "POST" });
        const data = await response.json();

        if (data.success) {
            renderIssueResult(data, "PostgreSQL");
        } else {
            renderFailureResult(data, "PostgreSQL");
        }
    } catch (error) {
        showResult(`<p class="result-fail">서버 연결에 실패했습니다: ${error.message}</p>`);
        addLog("[PostgreSQL] 서버 연결 실패", "fail", 0);
    }

    await refreshCount();
    setButtonsDisabled(false);
}

async function bulkTest() {
    setButtonsDisabled(true);
    showResult('<span class="loading"></span>1000명 동시 요청 테스트를 실행하는 중입니다...');

    try {
        const response = await fetch(`${API_BASE}/coupon/bulk-test`, { method: "POST" });
        const data = await response.json();
        const faster = data.redis_elapsed_ms < data.db_elapsed_ms ? "Redis" : "PostgreSQL";

        showResult(`
            <p class="result-info">동시 요청 테스트가 완료되었습니다.</p>
            <p>Redis 성공: ${data.redis_success}명 / 소진: ${data.redis_sold_out}명</p>
            <p>PostgreSQL 성공: ${data.db_success}명 / 소진: ${data.db_sold_out}명</p>
            <p class="result-time">더 빠른 방식: ${faster}</p>
            <p class="result-time">Redis ${data.redis_elapsed_ms}ms / PostgreSQL ${data.db_elapsed_ms}ms</p>
        `);

        addLog(
            `[동시 테스트] Redis ${data.redis_elapsed_ms}ms / PostgreSQL ${data.db_elapsed_ms}ms`,
            "info",
            Math.round(data.redis_elapsed_ms + data.db_elapsed_ms)
        );
    } catch (error) {
        showResult(`<p class="result-fail">테스트 실행에 실패했습니다: ${error.message}</p>`);
        addLog("[동시 테스트] 실행 실패", "fail", 0);
    }

    await refreshCount();
    setButtonsDisabled(false);
}

async function resetCoupon() {
    setButtonsDisabled(true);

    try {
        const response = await fetch(`${API_BASE}/coupon/reset`, { method: "POST" });
        const data = await response.json();

        showResult(`
            <p class="result-info">${data.message}</p>
            <p class="result-time">처리 시간: ${data.elapsed_ms}ms</p>
        `);
        addLog("[초기화] 쿠폰 재고를 100개로 초기화했습니다.", "info", data.elapsed_ms);
    } catch (error) {
        showResult(`<p class="result-fail">초기화에 실패했습니다: ${error.message}</p>`);
        addLog("[초기화] 실행 실패", "fail", 0);
    }

    await refreshCount();
    setButtonsDisabled(false);
}

refreshCount();
setInterval(refreshCount, 3000);
