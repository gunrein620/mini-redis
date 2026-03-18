/**
 * 이 파일은 "사용자 버튼 클릭 -> API 호출 -> 결과 표시" 흐름을 담당합니다.
 * top-down으로 보면:
 * 1) 화면 공통 유틸(재고 갱신/로그/로딩 제어)
 * 2) 사용자 액션 함수(Redis 발급, DB 발급, 벌크 테스트, 초기화)
 * 3) 페이지 시작 시 자동 갱신
 */

const API_BASE = "http://localhost:8000";

// 최근 요청 로그 10개를 화면에 보여주기 위해 메모리에 보관
let logs = [];

/**
 * 공통 유틸 1) 재고 조회
 * 서버에서 Redis/DB 재고를 받아 화면 숫자를 갱신한다.
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
        // 재고 표시 갱신 실패는 UI 전체를 막지 않기 위해 조용히 넘긴다.
    }
}

/**
 * 공통 유틸 2) 결과 박스 출력
 * 각 기능 함수가 만든 HTML 문자열을 결과 영역에 반영한다.
 */
function showResult(html) {
    document.getElementById("result-box").innerHTML = html;
}

/**
 * 공통 유틸 3) 로그 추가
 * 최신 로그를 앞에 넣고, 10개를 넘으면 가장 오래된 로그를 버린다.
 */
function addLog(message, type, elapsedMs) {
    logs.unshift({ message, type, elapsedMs, time: new Date() });
    // 화면 복잡도를 줄이기 위해 최근 10건만 유지
    if (logs.length > 10) logs.pop();
    renderLogs();
}

/**
 * 공통 유틸 4) 로그 렌더링
 * logs 배열 상태를 그대로 HTML 리스트로 바꿔 화면에 그린다.
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
 * 공통 유틸 5) 버튼 잠금/해제
 * 요청 처리 중 중복 클릭으로 실험 결과가 섞이지 않게 막는다.
 */
function setButtonsDisabled(disabled) {
    document.querySelectorAll(".btn").forEach((btn) => (btn.disabled = disabled));
}

/**
 * 사용자 액션 1) Redis 방식 발급
 * Redis 전용 API를 호출하고, 성공/실패/시간을 결과와 로그에 반영한다.
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
 * 사용자 액션 2) DB 방식 발급
 * DB 전용 API를 호출하고, Redis 방식과 같은 형식으로 결과를 보여준다.
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
 * 사용자 액션 3) 벌크 테스트
 * 백엔드가 수행한 1000명 동시 요청 실험 결과를 받아,
 * Redis vs DB 처리 시간과 성공/거절 수를 비교해 보여준다.
 */
async function bulkTest() {
    setButtonsDisabled(true);
    showResult(
        '<span class="loading"></span> 1000명 동시 요청 테스트 중... (잠시 기다려주세요)'
    );

    try {
        const res = await fetch(`${API_BASE}/coupon/bulk-test`, { method: "POST" });
        const data = await res.json();

        // 어떤 방식이 더 빠른지 계산해서 요약 문구로 보여준다.
        const faster = data.redis_elapsed_ms < data.db_elapsed_ms ? "Redis" : "DB";
        const ratio = faster === "Redis"
            ? (data.db_elapsed_ms / data.redis_elapsed_ms).toFixed(1)
            : (data.redis_elapsed_ms / data.db_elapsed_ms).toFixed(1);

        showResult(`
            <div class="bulk-result">
                <div class="bulk-column">
                    <h3>⚡ Redis 결과</h3>
                    <p>총 요청: <strong>${data.total_requests}명</strong></p>
                    <p class="result-success">✅ 발급 성공: ${data.redis_success}명</p>
                    <p class="result-fail">🚫 재고 소진: ${data.redis_sold_out}명</p>
                    ${data.redis_error > 0 ? `<p class="result-fail">💥 에러: ${data.redis_error}명</p>` : ''}
                    <p class="result-time">⏱ ${data.redis_elapsed_ms}ms</p>
                    <p class="result-detail">방식: DECR 원자적 연산<br>재고 0 이하 → 즉시 거절</p>
                </div>
                <div class="bulk-column">
                    <h3>🐢 DB 결과</h3>
                    <p>총 요청: <strong>${data.total_requests}명</strong></p>
                    <p class="result-success">✅ 발급 성공: ${data.db_success}명</p>
                    <p class="result-fail">🚫 재고 소진: ${data.db_sold_out}명</p>
                    ${data.db_error > 0 ? `<p class="result-fail">💥 에러: ${data.db_error}명</p>` : ''}
                    <p class="result-time">⏱ ${data.db_elapsed_ms}ms</p>
                    <p class="result-detail">방식: SELECT FOR UPDATE 행 잠금<br>잠금 대기 → 순차 처리 → 거절</p>
                </div>
            </div>
            <div class="bulk-summary">
                🏆 <strong>${faster}</strong>가 <strong>${ratio}배</strong> 빠름
                &nbsp;|&nbsp; Redis ${data.redis_success}명, DB ${data.db_success}명 발급 성공
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
 * 사용자 액션 4) 초기화
 * 실습을 다시 시작하기 쉽게 Redis/DB 재고를 100으로 맞춘다.
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

// 페이지 시작 시 현재 재고를 먼저 보여준다.
refreshCount();
// 학습 중 값 변화를 바로 보도록 3초마다 자동 갱신한다.
setInterval(refreshCount, 3000);
