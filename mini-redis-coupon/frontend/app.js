/**
 * 선착순 쿠폰 이벤트 프론트엔드
 * - API 서버(포트 8000)와 통신
 * - 쿠폰 발급, 재고 조회, 동시 테스트 기능
 */

const API_BASE = "http://localhost:8000";

// 요청 로그 배열 (최대 10개 유지)
let logs = [];

/**
 * 남은 쿠폰 수량을 서버에서 조회하여 화면에 표시
 */
async function refreshCount() {
    try {
        const res = await fetch(`${API_BASE}/coupon/count`);
        const data = await res.json();
        document.getElementById("redis-count").textContent =
            data.redis_count !== null ? data.redis_count : "-";
        document.getElementById("db-count").textContent =
            data.db_count !== null ? data.db_count : "-";
    } catch (e) {
        // 서버 연결 실패 시 무시
    }
}

/**
 * 결과 박스에 내용을 표시
 */
function showResult(html) {
    document.getElementById("result-box").innerHTML = html;
}

/**
 * 로그 항목을 추가 (최대 10개)
 */
function addLog(message, type, elapsedMs) {
    logs.unshift({ message, type, elapsedMs, time: new Date() });
    // 최대 10개만 유지
    if (logs.length > 10) logs.pop();
    renderLogs();
}

/**
 * 로그 목록을 화면에 렌더링
 */
function renderLogs() {
    const logList = document.getElementById("log-list");
    document.getElementById("log-count").textContent = `(${logs.length}/10)`;

    if (logs.length === 0) {
        logList.innerHTML = '<p class="placeholder">아직 요청 기록이 없습니다</p>';
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

/**
 * 버튼 비활성화/활성화 토글
 */
function setButtonsDisabled(disabled) {
    document.querySelectorAll(".btn").forEach((btn) => (btn.disabled = disabled));
}

/**
 * Redis 방식으로 쿠폰 발급
 */
async function issueCouponRedis() {
    setButtonsDisabled(true);
    showResult('<span class="loading"></span> Redis로 쿠폰 발급 중...');

    try {
        const res = await fetch(`${API_BASE}/coupon/issue/redis`, { method: "POST" });
        const data = await res.json();

        if (data.success) {
            showResult(`
                <p class="result-success">✅ ${data.message}</p>
                <p>사용자 ID: ${data.user_id}</p>
                <p>남은 수량: ${data.remaining}개</p>
                <p class="result-time">⏱ 처리 시간: ${data.elapsed_ms}ms</p>
            `);
            addLog(`[Redis] 발급 성공 (${data.user_id})`, "success", data.elapsed_ms);
        } else {
            showResult(`
                <p class="result-fail">❌ ${data.message}</p>
                <p class="result-time">⏱ 처리 시간: ${data.elapsed_ms}ms</p>
            `);
            addLog(`[Redis] ${data.message}`, "fail", data.elapsed_ms);
        }
    } catch (e) {
        showResult(`<p class="result-fail">❌ 서버 연결 실패: ${e.message}</p>`);
        addLog(`[Redis] 연결 실패`, "fail", 0);
    }

    await refreshCount();
    setButtonsDisabled(false);
}

/**
 * DB 방식으로 쿠폰 발급
 */
async function issueCouponDB() {
    setButtonsDisabled(true);
    showResult('<span class="loading"></span> DB로 쿠폰 발급 중...');

    try {
        const res = await fetch(`${API_BASE}/coupon/issue/db`, { method: "POST" });
        const data = await res.json();

        if (data.success) {
            showResult(`
                <p class="result-success">✅ ${data.message}</p>
                <p>사용자 ID: ${data.user_id}</p>
                <p>남은 수량: ${data.remaining}개</p>
                <p class="result-time">⏱ 처리 시간: ${data.elapsed_ms}ms</p>
            `);
            addLog(`[DB] 발급 성공 (${data.user_id})`, "success", data.elapsed_ms);
        } else {
            showResult(`
                <p class="result-fail">❌ ${data.message}</p>
                <p class="result-time">⏱ 처리 시간: ${data.elapsed_ms}ms</p>
            `);
            addLog(`[DB] ${data.message}`, "fail", data.elapsed_ms);
        }
    } catch (e) {
        showResult(`<p class="result-fail">❌ 서버 연결 실패: ${e.message}</p>`);
        addLog(`[DB] 연결 실패`, "fail", 0);
    }

    await refreshCount();
    setButtonsDisabled(false);
}

/**
 * 1000명 동시 요청 시뮬레이션
 */
async function bulkTest() {
    setButtonsDisabled(true);
    showResult(
        '<span class="loading"></span> 1000명 동시 요청 테스트 중... (잠시 기다려주세요)'
    );

    try {
        const res = await fetch(`${API_BASE}/coupon/bulk-test`, { method: "POST" });
        const data = await res.json();

        showResult(`
            <div class="bulk-result">
                <div class="bulk-column">
                    <h3>⚡ Redis 결과</h3>
                    <p>총 요청: ${data.total_requests}명</p>
                    <p class="result-success">성공: ${data.success_count}명</p>
                    <p class="result-fail">실패: ${data.fail_count}명</p>
                    <p class="result-time">⏱ ${data.redis_elapsed_ms}ms</p>
                </div>
                <div class="bulk-column">
                    <h3>🐢 DB 결과</h3>
                    <p>총 요청: ${data.total_requests}명</p>
                    <p class="result-info">성공: 100명 (DB 잠금)</p>
                    <p class="result-time">⏱ ${data.db_elapsed_ms}ms</p>
                </div>
            </div>
        `);

        const diff = data.db_elapsed_ms - data.redis_elapsed_ms;
        addLog(
            `[벌크] Redis ${data.redis_elapsed_ms}ms / DB ${data.db_elapsed_ms}ms`,
            "info",
            Math.round(data.redis_elapsed_ms + data.db_elapsed_ms)
        );
    } catch (e) {
        showResult(`<p class="result-fail">❌ 테스트 실패: ${e.message}</p>`);
        addLog(`[벌크] 테스트 실패`, "fail", 0);
    }

    await refreshCount();
    setButtonsDisabled(false);
}

/**
 * 쿠폰 재고를 100개로 초기화
 */
async function resetCoupon() {
    setButtonsDisabled(true);

    try {
        const res = await fetch(`${API_BASE}/coupon/reset`, { method: "POST" });
        const data = await res.json();

        showResult(`
            <p class="result-info">🔄 ${data.message}</p>
            <p class="result-time">⏱ 처리 시간: ${data.elapsed_ms}ms</p>
        `);
        addLog(`[초기화] 재고 100개로 초기화`, "info", data.elapsed_ms);
    } catch (e) {
        showResult(`<p class="result-fail">❌ 초기화 실패: ${e.message}</p>`);
        addLog(`[초기화] 실패`, "fail", 0);
    }

    await refreshCount();
    setButtonsDisabled(false);
}

// 페이지 로드 시 재고 조회
refreshCount();
// 3초마다 재고 자동 갱신
setInterval(refreshCount, 3000);
