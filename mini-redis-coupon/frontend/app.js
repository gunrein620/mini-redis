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
 * 서버에서 재고를 받아 화면 숫자를 갱신한다.
 */
async function refreshCount() {
    try {
        const res = await fetch(`${API_BASE}/coupon/count`);
        const data = await res.json();
        const count = data.redis_count !== null ? data.redis_count : data.db_count;
        const displayValue = count !== null ? count : "-";
        const primaryCountEl = document.getElementById("coupon-count");
        const legacyRedisCountEl = document.getElementById("redis-count");
        const legacyDbCountEl = document.getElementById("db-count");

        if (primaryCountEl) primaryCountEl.textContent = displayValue;
        if (legacyRedisCountEl) legacyRedisCountEl.textContent = displayValue;
        if (legacyDbCountEl) legacyDbCountEl.textContent =
            data.db_count !== null ? data.db_count : displayValue;
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

        if (!res.ok) {
            const msg = data.detail || `서버 오류 (${res.status})`;
            showResult(`<p class="result-fail">❌ ${msg}</p>`);
            addLog(`[Redis] ${msg}`, "fail", 0);
        } else if (data.success) {
            showResult(renderTicket("Redis", data));
            addLog(`[Redis] 발급 성공 (${data.coupon_code})`, "success", data.elapsed_ms);
        } else {
            showResult(renderTicketFail("Redis", data.message, data.elapsed_ms));
            addLog(`[Redis] ${data.message}`, "fail", data.elapsed_ms);
        }
    } catch (e) {
        showResult(renderTicketFail("Redis", `서버 연결 실패: ${e.message}`, 0));
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

        if (!res.ok) {
            const msg = data.detail || `서버 오류 (${res.status})`;
            showResult(`<p class="result-fail">❌ ${msg}</p>`);
            addLog(`[DB] ${msg}`, "fail", 0);
        } else if (data.success) {
            showResult(renderTicket("DB", data));
            addLog(`[DB] 발급 성공 (${data.coupon_code})`, "success", data.elapsed_ms);
        } else {
            showResult(renderTicketFail("DB", data.message, data.elapsed_ms));
            addLog(`[DB] ${data.message}`, "fail", data.elapsed_ms);
        }
    } catch (e) {
        showResult(renderTicketFail("DB", `서버 연결 실패: ${e.message}`, 0));
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
        const maxElapsed = Math.max(data.redis_elapsed_ms, data.db_elapsed_ms, 1);
        const maxCountMetric = Math.max(
            data.redis_success,
            data.db_success,
            data.redis_sold_out,
            data.db_sold_out,
            data.redis_error,
            data.db_error,
            1
        );
        const redisTimeWidth = (data.redis_elapsed_ms / maxElapsed) * 100;
        const dbTimeWidth = (data.db_elapsed_ms / maxElapsed) * 100;
        const redisSuccessWidth = (data.redis_success / maxCountMetric) * 100;
        const dbSuccessWidth = (data.db_success / maxCountMetric) * 100;
        const redisSoldOutWidth = (data.redis_sold_out / maxCountMetric) * 100;
        const dbSoldOutWidth = (data.db_sold_out / maxCountMetric) * 100;
        const redisErrorWidth = (data.redis_error / maxCountMetric) * 100;
        const dbErrorWidth = (data.db_error / maxCountMetric) * 100;

        showResult(`
            <div class="bulk-hero">
                <div class="bulk-hero-label">Bulk Test Result</div>
                <div class="bulk-hero-value">${faster}가 ${ratio}배 빠름</div>
                <div class="bulk-hero-copy">총 ${data.total_requests}명 요청 기준으로 처리 시간과 결과를 비교했습니다.</div>
            </div>

            <div class="bulk-chart">
                <div class="bulk-chart-group">
                    <div class="bulk-chart-title">처리 시간</div>
                    <div class="metric-row">
                        <div class="metric-label"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/redis/redis-original.svg" style="width:14px;height:14px;display:inline;vertical-align:middle;margin-right:4px;">Redis</div>
                        <div class="metric-track"><div class="metric-fill redis" style="width:${redisTimeWidth}%;"></div></div>
                        <div class="metric-value">${data.redis_elapsed_ms}ms</div>
                    </div>
                    <div class="metric-row">
                        <div class="metric-label"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/postgresql/postgresql-original.svg" style="width:14px;height:14px;display:inline;vertical-align:middle;margin-right:4px;">DB</div>
                        <div class="metric-track"><div class="metric-fill db" style="width:${dbTimeWidth}%;"></div></div>
                        <div class="metric-value">${data.db_elapsed_ms}ms</div>
                    </div>
                </div>

                <div class="bulk-chart-group" style="padding:12px 18px;">
                    <div class="bulk-chart-title" style="margin-bottom:8px;">발급 성공</div>
                    <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;">
                        <span style="font-weight:700;color:#ef4444;"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/redis/redis-original.svg" style="width:12px;height:12px;display:inline;vertical-align:middle;margin-right:3px;">Redis <strong>${data.redis_success}명</strong></span>
                        <span style="font-weight:700;color:#2563eb;"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/postgresql/postgresql-original.svg" style="width:12px;height:12px;display:inline;vertical-align:middle;margin-right:3px;">DB <strong>${data.db_success}명</strong></span>
                    </div>
                </div>

                <div class="bulk-chart-group" style="padding:12px 18px;">
                    <div class="bulk-chart-title" style="margin-bottom:8px;">재고 소진 / 에러</div>
                    <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;">
                        <span style="font-weight:700;color:#ef4444;"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/redis/redis-original.svg" style="width:12px;height:12px;display:inline;vertical-align:middle;margin-right:3px;">Redis 소진 <strong>${data.redis_sold_out}명</strong>${data.redis_error > 0 ? ` / 에러 <strong>${data.redis_error}명</strong>` : ''}</span>
                        <span style="font-weight:700;color:#2563eb;"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/postgresql/postgresql-original.svg" style="width:12px;height:12px;display:inline;vertical-align:middle;margin-right:3px;">DB 소진 <strong>${data.db_sold_out}명</strong>${data.db_error > 0 ? ` / 에러 <strong>${data.db_error}명</strong>` : ''}</span>
                    </div>
                </div>
            </div>

            <div class="bulk-stats">
                <div class="bulk-stat-card">
                    <div class="bulk-stat-label">Redis</div>
                    <div class="bulk-stat-values">
                        <div>성공 <strong>${data.redis_success}</strong></div>
                        <div>소진 <strong>${data.redis_sold_out}</strong></div>
                    </div>
                </div>
                <div class="bulk-stat-card">
                    <div class="bulk-stat-label">DB</div>
                    <div class="bulk-stat-values">
                        <div>성공 <strong>${data.db_success}</strong></div>
                        <div>소진 <strong>${data.db_sold_out}</strong></div>
                    </div>
                </div>
                <div class="bulk-stat-card">
                    <div class="bulk-stat-label">방식 차이</div>
                    <div class="bulk-stat-values">
                        <div>Redis: <strong>DECR</strong></div>
                        <div>DB: <strong>FOR UPDATE</strong></div>
                    </div>
                </div>
            </div>
        `);

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

/**
 * 사용자 액션 5) 유효 쿠폰 조회 (Redis vs DB 캐싱 속도 비교)
 * 현재 유효한(TTL이 남은) 쿠폰을 Redis 인메모리와 DB 네트워크 조회로 각각 가져와 속도를 비교한다.
 */
async function queryValidCoupons() {
    setButtonsDisabled(true);
    showResult('<span class="loading"></span> 유효 쿠폰 조회 중... (Redis vs DB)');

    try {
        const res = await fetch(`${API_BASE}/coupon/valid-coupons`);
        const data = await res.json();

        if (!res.ok) {
            const msg = data.detail || `서버 오류 (${res.status})`;
            showResult(`<p class="result-fail">${msg}</p>`);
            addLog(`[조회] ${msg}`, "fail", 0);
            setButtonsDisabled(false);
            return;
        }

        // Redis 쿠폰 목록 HTML (id 내림차순, DB와 동일 형식)
        const redisList = data.redis_coupons.length > 0
            ? data.redis_coupons.map((c, i) =>
                `<div class="coupon-item">${i + 1}) #${c.id} ${c.coupon_code} <span class="ttl-badge">${c.remaining_seconds}초</span></div>`
            ).join("")
            : '<p class="placeholder">유효한 쿠폰 없음</p>';

        // DB 쿠폰 목록 HTML (id 내림차순)
        const dbList = data.db_coupons.length > 0
            ? data.db_coupons.map((c, i) =>
                `<div class="coupon-item">${i + 1}) #${c.id} ${c.coupon_code} <span class="ttl-badge">${c.expires_at}</span></div>`
            ).join("")
            : '<p class="placeholder">유효한 쿠폰 없음</p>';

        // 속도 비교 요약
        const faster = data.redis_elapsed_ms < data.db_elapsed_ms ? "Redis" : "DB";
        const ratio = data.redis_elapsed_ms < data.db_elapsed_ms
            ? (data.db_elapsed_ms / Math.max(data.redis_elapsed_ms, 0.01)).toFixed(1)
            : (data.redis_elapsed_ms / Math.max(data.db_elapsed_ms, 0.01)).toFixed(1);

        const maxElapsed = Math.max(data.redis_elapsed_ms, data.db_elapsed_ms, 1);
        const redisTimeWidth = (data.redis_elapsed_ms / maxElapsed) * 100;
        const dbTimeWidth = (data.db_elapsed_ms / maxElapsed) * 100;
        const maxCount = Math.max(data.redis_count, data.db_count, 1);
        const redisCountWidth = (data.redis_count / maxCount) * 100;
        const dbCountWidth = (data.db_count / maxCount) * 100;

        showResult(`
            <div class="bulk-hero">
                <div class="bulk-hero-label">Valid Coupon Query</div>
                <div class="bulk-hero-value">${faster}가 ${ratio}배 빠름</div>
                <div class="bulk-hero-copy">Redis 인메모리 vs DB 네트워크 조회 속도를 비교했습니다.</div>
            </div>

            <div class="bulk-chart">
                <div class="bulk-chart-group">
                    <div class="bulk-chart-title">조회 시간</div>
                    <div class="metric-row">
                        <div class="metric-label"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/redis/redis-original.svg" style="width:14px;height:14px;display:inline;vertical-align:middle;margin-right:4px;">Redis</div>
                        <div class="metric-track"><div class="metric-fill redis" style="width:${redisTimeWidth}%;"></div></div>
                        <div class="metric-value">${data.redis_elapsed_ms}ms</div>
                    </div>
                    <div class="metric-row">
                        <div class="metric-label"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/postgresql/postgresql-original.svg" style="width:14px;height:14px;display:inline;vertical-align:middle;margin-right:4px;">DB</div>
                        <div class="metric-track"><div class="metric-fill db" style="width:${dbTimeWidth}%;"></div></div>
                        <div class="metric-value">${data.db_elapsed_ms}ms</div>
                    </div>
                </div>

                <div class="bulk-chart-group">
                    <div class="bulk-chart-title">유효 쿠폰 수</div>
                    <div class="metric-row">
                        <div class="metric-label"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/redis/redis-original.svg" style="width:14px;height:14px;display:inline;vertical-align:middle;margin-right:4px;">Redis</div>
                        <div class="metric-track"><div class="metric-fill redis" style="width:${redisCountWidth}%;"></div></div>
                        <div class="metric-value">${data.redis_count}개</div>
                    </div>
                    <div class="metric-row">
                        <div class="metric-label"><img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/postgresql/postgresql-original.svg" style="width:14px;height:14px;display:inline;vertical-align:middle;margin-right:4px;">DB</div>
                        <div class="metric-track"><div class="metric-fill db" style="width:${dbCountWidth}%;"></div></div>
                        <div class="metric-value">${data.db_count}개</div>
                    </div>
                </div>
            </div>

            <div class="bulk-stats">
                <div class="bulk-stat-card">
                    <div class="bulk-stat-label">Redis</div>
                    <div class="bulk-stat-values">
                        <div>유효 <strong>${data.redis_count}개</strong></div>
                        <div>방식 <strong>TTL 스캔</strong></div>
                    </div>
                </div>
                <div class="bulk-stat-card">
                    <div class="bulk-stat-label">DB</div>
                    <div class="bulk-stat-values">
                        <div>유효 <strong>${data.db_count}개</strong></div>
                        <div>방식 <strong>expires_at</strong></div>
                    </div>
                </div>
                <div class="bulk-stat-card">
                    <div class="bulk-stat-label">네트워크</div>
                    <div class="bulk-stat-values">
                        <div>Redis: <strong>in-process</strong></div>
                        <div>DB: <strong>TCP 왕복</strong></div>
                    </div>
                </div>
            </div>

            ${data.redis_coupons.length > 0 || data.db_coupons.length > 0 ? `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px;">
                <div class="bulk-stat-card" style="text-align:left;">
                    <div class="bulk-stat-label" style="margin-bottom:8px;">Redis 쿠폰 목록</div>
                    <div class="coupon-list">${redisList}</div>
                </div>
                <div class="bulk-stat-card" style="text-align:left;">
                    <div class="bulk-stat-label" style="margin-bottom:8px;">DB 쿠폰 목록</div>
                    <div class="coupon-list">${dbList}</div>
                </div>
            </div>` : ``}
        `);

        addLog(
            `[조회] Redis ${data.redis_elapsed_ms}ms (${data.redis_count}개) / DB ${data.db_elapsed_ms}ms (${data.db_count}개)`,
            "info",
            Math.round(data.redis_elapsed_ms + data.db_elapsed_ms)
        );
    } catch (e) {
        showResult(`<p class="result-fail">조회 실패: ${e.message}</p>`);
        addLog(`[조회] 실패`, "fail", 0);
    }

    setButtonsDisabled(false);
}

/**
 * 사용자 액션 6) 쿠폰 검증
 * Redis TTL로 쿠폰이 아직 유효한지 확인한다 (발급 후 15초 이내 여부).
 * 버튼 옆 span에 결과를 간단히 표시한다.
 */
async function validateCoupon(couponCode, btn) {
    const span = document.getElementById("validate-result");
    if (!span) return;
    span.textContent = "확인 중...";

    try {
        const res = await fetch(`${API_BASE}/coupon/validate/${couponCode}`);
        const data = await res.json();

        if (data.valid) {
            span.style.color = "#16a34a";
            span.textContent = `✅ 남은 시간: ${data.remaining_seconds}초`;
        } else {
            span.style.color = "#dc2626";
            span.textContent = `❌ ${data.reason}`;
        }
    } catch (e) {
        span.style.color = "#dc2626";
        span.textContent = `❌ 검증 실패`;
    }
}

/**
 * 티켓 카드 렌더링 — 발급 성공
 */
function renderTicket(method, data) {
    return `
        <div class="ticket">
            <div class="ticket-header">
                <div class="ticket-header-title">${method} 발급 성공</div>
                <div class="ticket-header-badge">${method}</div>
            </div>
            <div class="ticket-code-area">
                <div class="ticket-notch ticket-notch-left"></div>
                <div class="ticket-notch ticket-notch-right"></div>
                <div class="ticket-code">${data.coupon_code}</div>
                <div class="ticket-code-sub">COUPON CODE</div>
            </div>
            <div class="ticket-details">
                <div class="ticket-detail-item">
                    <div class="ticket-detail-label">사용자</div>
                    <div class="ticket-detail-value">${data.user_id}</div>
                </div>
                <div class="ticket-detail-item">
                    <div class="ticket-detail-label">남은 수량</div>
                    <div class="ticket-detail-value">${data.remaining}개</div>
                </div>
                <div class="ticket-detail-item">
                    <div class="ticket-detail-label">만료 시각</div>
                    <div class="ticket-detail-value">${data.expires_at}</div>
                </div>
                <div class="ticket-detail-item">
                    <div class="ticket-detail-label">유효 시간</div>
                    <div class="ticket-detail-value">15초</div>
                </div>
            </div>
            <div class="ticket-footer">
                <div class="ticket-elapsed">${data.elapsed_ms}ms</div>
                <div style="display:flex;align-items:center;gap:8px;">
                    <span id="validate-result" style="font-size:13px;font-weight:600;"></span>
                    <button class="ticket-validate-btn" onclick="validateCoupon('${data.coupon_code}', this)">쿠폰 검증</button>
                </div>
            </div>
        </div>`;
}

/**
 * 티켓 카드 렌더링 — 발급 실패
 */
function renderTicketFail(method, message, elapsedMs) {
    return `
        <div class="ticket">
            <div class="ticket-header">
                <div class="ticket-header-title" style="color:#e63939;">${message}</div>
                <div class="ticket-header-badge fail-badge">${method}</div>
            </div>
            ${elapsedMs ? `
            <div class="ticket-footer" style="border-top:none;">
                <div class="ticket-elapsed">${elapsedMs}ms</div>
            </div>` : ``}
        </div>`;
}

// 페이지 시작 시 현재 재고를 먼저 보여준다.
refreshCount();
// 학습 중 값 변화를 바로 보도록 3초마다 자동 갱신한다.
setInterval(refreshCount, 3000);
