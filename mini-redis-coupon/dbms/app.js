/**
 * Mini Redis DBMS - 웹 기반 Redis 관리 도구
 *
 * 구성:
 * 1) API 레이어 — Mini Redis HTTP API 호출 + 응답 시간 측정
 * 2) UI 업데이트 — Dashboard, Key Browser, Command Log 렌더링
 * 3) TTL 타이머 — 서버 폴링(2초) + 클라이언트 카운트다운(1초) 하이브리드
 * 4) Operations — GET/SET/DEL/KEYS/FLUSHALL 버튼 핸들러
 */

const REDIS_API = "http://localhost:8000/redis";

// ── 상태 ──
let state = {
    keys: [],           // [{key, ttl}, ...]
    selectedKey: null,   // 현재 선택된 키 이름
    selectedKeyRequestId: 0,
    logs: [],           // 최근 명령 로그 (max 20)
    connected: false,
};

// ── API 레이어 ──

async function apiCall(method, path, body = null) {
    const start = performance.now();
    const opts = { method, headers: { "Content-Type": "application/json" } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${REDIS_API}${path}`, opts);
    const data = await res.json();
    const elapsed = (performance.now() - start).toFixed(1);
    return { ...data, _elapsed: elapsed, _ok: res.ok };
}

const api = {
    health:   () => apiCall("GET", "/health"),
    get:      (key) => apiCall("GET", `/get/${encodeURIComponent(key)}`),
    set:      (key, value, ttl) => apiCall("POST", "/set", { key, value, ...(ttl ? { ttl: Number(ttl) } : {}) }),
    delete:   (key) => apiCall("DELETE", `/delete/${encodeURIComponent(key)}`),
    keys:     () => apiCall("GET", "/keys"),
    ttl:      (key) => apiCall("GET", `/ttl/${encodeURIComponent(key)}`),
    incr:     (key) => apiCall("POST", `/incr/${encodeURIComponent(key)}`),
    decr:     (key) => apiCall("POST", `/decr/${encodeURIComponent(key)}`),
    flushall: () => apiCall("POST", "/flushall"),
};

// ── Health Check ──

async function checkHealth() {
    try {
        const res = await api.health();
        setConnected(res.status === "ok");
    } catch {
        setConnected(false);
    }
}

function setConnected(ok) {
    state.connected = ok;
    const dot = document.getElementById("status-dot");
    const text = document.getElementById("status-text");
    dot.className = `absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#f0f6ff] transition-colors duration-300 ${ok ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`;
    text.textContent = ok ? "Connected" : "Disconnected";
    text.className = `inline-block text-xs transition-colors duration-300 ${ok ? "text-emerald-600/70" : "text-red-400/70"}`;
}

// ── Dashboard Stats ──

function updateStats() {
    const total = state.keys.length;
    const ttlKeys = state.keys.filter(k => k.ttl > 0).length;
    const persistent = state.keys.filter(k => k.ttl === -1).length;
    document.getElementById("stat-total").textContent = total;
    document.getElementById("stat-ttl").textContent = ttlKeys;
    document.getElementById("stat-persistent").textContent = persistent;
}

// ── Key Browser ──

async function refreshKeys() {
    try {
        const res = await api.keys();
        state.keys = res.keys || [];
        document.getElementById("key-count").textContent = state.keys.length;
        updateStats();
        renderKeyList();

        // 선택된 키가 만료/삭제되어 목록에 없으면 detail 패널 닫기
        if (state.selectedKey && !state.keys.some(k => k.key === state.selectedKey)) {
            state.selectedKey = null;
            state.selectedKeyRequestId++;
            document.getElementById("key-detail").classList.add("hidden");
            document.getElementById("key-detail").innerHTML = "";
        }
    } catch {
        // 연결 실패 시 조용히 넘김
    }
}

function renderKeyList() {
    const container = document.getElementById("key-list");
    if (state.keys.length === 0) {
        container.innerHTML = '<p class="text-center text-sm text-[#9ca3af] py-6">키가 없습니다</p>';
        return;
    }

    container.innerHTML = state.keys.map(k => {
        const isSelected = k.key === state.selectedKey;
        const ttlHtml = k.ttl > 0
            ? `<span class="ttl-badge ttl">${k.ttl}s</span>`
            : `<span class="ttl-badge persistent">persistent</span>`;
        return `
            <div class="key-row ${isSelected ? "selected" : ""}" onclick="selectKey('${escapeAttr(k.key)}')">
                <span style="font-family:'SF Mono','Consolas',monospace;font-size:0.85rem;color:#1a1a2e;">${escapeHtml(k.key)}</span>
                <div style="display:flex;align-items:center;gap:0.5rem;">
                    ${ttlHtml}
                    <button onclick="event.stopPropagation(); quickDelete('${escapeAttr(k.key)}')"
                            style="color:#cbd5e1;border:none;background:none;cursor:pointer;font-size:0.75rem;transition:color 0.15s;"
                            onmouseover="this.style.color='#e63939'" onmouseout="this.style.color='#cbd5e1'">✕</button>
                </div>
            </div>`;
    }).join("");
}

async function selectKey(key) {
    state.selectedKey = key;
    const requestId = ++state.selectedKeyRequestId;
    renderKeyList();

    const detailEl = document.getElementById("key-detail");
    detailEl.classList.remove("hidden");
    detailEl.innerHTML = '<div style="padding:1rem;text-align:center;"><span class="loading"></span></div>';

    try {
        const [getRes, ttlRes] = await Promise.all([api.get(key), api.ttl(key)]);
        const value = getRes.data;
        const ttl = ttlRes.data;

        // 더 최신 선택/갱신이 발생했다면 오래된 응답은 버린다.
        if (requestId !== state.selectedKeyRequestId || state.selectedKey !== key) {
            return;
        }

        if (value === null || ttl === -2) {
            state.selectedKey = null;
            detailEl.innerHTML = '<div style="padding:1rem;text-align:center;color:#9ca3af;font-size:0.85rem;">키가 만료되었거나 존재하지 않습니다</div>';
            detailEl.classList.add("hidden");
            renderKeyList();
            return;
        }

        const isNumeric = /^-?\d+$/.test(value);
        const ttlDisplay = ttl === -1 ? "영구" : ttl === -2 ? "만료" : `${ttl}초 남음`;

        detailEl.innerHTML = `
            <div class="detail-panel" style="margin:0 1rem 1rem;">
                <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
                    <span style="font-family:'SF Mono',monospace;font-size:0.85rem;color:#1a1a2e;font-weight:600;">${escapeHtml(key)}</span>
                    <span style="font-size:0.75rem;color:#9ca3af;">TTL: ${ttlDisplay}</span>
                </div>
                <pre style="font-size:0.85rem;color:#1a1a2e;font-family:'SF Mono',monospace;background:rgba(0,0,0,0.03);border-radius:10px;padding:0.75rem;overflow-x:auto;white-space:pre-wrap;word-break:break-all;margin:0;">${escapeHtml(value)}</pre>
                ${isNumeric ? `
                <div style="display:flex;gap:0.5rem;margin-top:0.75rem;">
                    <button onclick="execIncr('${escapeAttr(key)}')"
                            class="btn btn-set" style="padding:6px 16px;font-size:0.75rem;">INCR +1</button>
                    <button onclick="execDecr('${escapeAttr(key)}')"
                            class="btn btn-del" style="padding:6px 16px;font-size:0.75rem;">DECR -1</button>
                </div>` : ""}
            </div>`;
    } catch {
        if (requestId !== state.selectedKeyRequestId || state.selectedKey !== key) {
            return;
        }
        detailEl.innerHTML = '<div style="padding:1rem;text-align:center;color:#e63939;font-size:0.85rem;">조회 실패</div>';
    }
}

// ── Operations ──

function getInputs() {
    return {
        key: document.getElementById("input-key").value.trim(),
        value: document.getElementById("input-value").value,
        ttl: document.getElementById("input-ttl").value,
    };
}

function clearInputs() {
    document.getElementById("input-key").value = "";
    document.getElementById("input-value").value = "";
    document.getElementById("input-ttl").value = "";
}

function showOpResult(html) {
    document.getElementById("op-result").innerHTML = `<div class="op-result-content"><span style="color:#38bdf8;">$</span> ${html}</div>`;
}

async function execGet() {
    const { key } = getInputs();
    if (!key) { showOpResult('<span style="color:#e63939;">key를 입력하세요</span>'); return; }

    try {
        const res = await api.get(key);
        if (res.data !== null) {
            showOpResult(`<span style="color:#22a352;">${escapeHtml(String(res.data))}</span> <span class="meta">${res._elapsed}ms</span>`);
            addLog("GET", key, "success", res._elapsed);
        } else {
            showOpResult(`<span style="color:#94a3b8;">(nil)</span> <span class="meta">${res._elapsed}ms</span>`);
            addLog("GET", key, "fail", res._elapsed);
        }
    } catch (e) {
        showOpResult(`<span style="color:#e63939;">연결 실패</span>`);
        addLog("GET", key, "fail", 0);
    } finally {
        clearInputs();
    }
}

async function execSet() {
    const { key, value, ttl } = getInputs();
    if (!key) { showOpResult('<span style="color:#e63939;">key를 입력하세요</span>'); return; }

    try {
        const res = await api.set(key, value, ttl || null);
        showOpResult(`<span style="color:#22a352;">OK</span> <span class="meta">${res._elapsed}ms</span>`);
        addLog("SET", key, "success", res._elapsed);
        await refreshKeys();
    } catch {
        showOpResult(`<span style="color:#e63939;">연결 실패</span>`);
        addLog("SET", key, "fail", 0);
    } finally {
        clearInputs();
    }
}

async function execDelete(targetKey) {
    const key = targetKey || getInputs().key;
    if (!key) { showOpResult('<span style="color:#e63939;">key를 입력하세요</span>'); return; }

    try {
        const res = await api.delete(key);
        const deleted = res.data > 0;
        showOpResult(`<span style="color:${deleted ? "#22a352" : "#94a3b8"};">${deleted ? "삭제 완료" : "해당 키 없음"}</span> <span class="meta">${res._elapsed}ms</span>`);
        addLog("DEL", key, deleted ? "success" : "fail", res._elapsed);
        if (state.selectedKey === key) {
            state.selectedKey = null;
            state.selectedKeyRequestId++;
            document.getElementById("key-detail").classList.add("hidden");
        }
        await refreshKeys();
    } catch {
        showOpResult(`<span style="color:#e63939;">연결 실패</span>`);
        addLog("DEL", key, "fail", 0);
    } finally {
        if (!targetKey) clearInputs();
    }
}

async function quickDelete(key) {
    await execDelete(key);
}

async function execKeys() {
    try {
        const res = await api.keys();
        state.keys = res.keys || [];
        document.getElementById("key-count").textContent = state.keys.length;
        updateStats();
        renderKeyList();
        showOpResult(`<span style="color:#0A84FF;">${state.keys.length}개 키</span> <span class="meta">${res._elapsed}ms</span>`);
        addLog("KEYS", "*", "success", res._elapsed);
    } catch {
        showOpResult(`<span style="color:#e63939;">연결 실패</span>`);
        addLog("KEYS", "*", "fail", 0);
    } finally {
        clearInputs();
    }
}

async function execFlushAll() {
    showConfirmModal("모든 키를 삭제하시겠습니까?", async () => {
        try {
            const res = await api.flushall();
            showOpResult(`<span style="color:#d97706;">${res.data}개 키 삭제 완료</span> <span class="meta">${res._elapsed}ms</span>`);
            addLog("FLUSHALL", "-", "success", res._elapsed);
            state.selectedKey = null;
            state.selectedKeyRequestId++;
            document.getElementById("key-detail").classList.add("hidden");
            await refreshKeys();
        } catch {
            showOpResult(`<span style="color:#e63939;">연결 실패</span>`);
            addLog("FLUSHALL", "-", "fail", 0);
        }
    });
}

async function execIncr(key) {
    try {
        const res = await api.incr(key);
        addLog("INCR", key, "success", res._elapsed);
        await selectKey(key);
        await refreshKeys();
    } catch {
        addLog("INCR", key, "fail", 0);
    }
}

async function execDecr(key) {
    try {
        const res = await api.decr(key);
        addLog("DECR", key, "success", res._elapsed);
        await selectKey(key);
        await refreshKeys();
    } catch {
        addLog("DECR", key, "fail", 0);
    }
}

// ── Command Log ──

function addLog(cmd, key, type, elapsed) {
    state.logs.unshift({ cmd, key, type, elapsed, time: new Date() });
    if (state.logs.length > 20) state.logs.pop();
    renderLogs();
}

function renderLogs() {
    const container = document.getElementById("log-list");
    document.getElementById("log-count").textContent = `(${state.logs.length}/20)`;

    if (state.logs.length === 0) {
        container.innerHTML = '<p class="text-center text-sm" style="color:#9ca3af;padding:1rem 0;">아직 기록이 없습니다</p>';
        return;
    }

    container.innerHTML = state.logs.map(log => `
        <div class="log-item ${log.type}">
            <span class="log-cmd">${log.cmd} ${escapeHtml(log.key)}</span>
            <span class="log-time">${log.elapsed}ms</span>
        </div>
    `).join("");
}

// ── Modal ──

let modalCallback = null;

function showConfirmModal(msg, onConfirm) {
    document.getElementById("modal-msg").textContent = msg;
    document.getElementById("modal").classList.remove("hidden");
    modalCallback = onConfirm;
    document.getElementById("modal-confirm").onclick = () => {
        const callback = modalCallback;
        closeModal();
        if (callback) callback();
    };
}

function closeModal() {
    document.getElementById("modal").classList.add("hidden");
    modalCallback = null;
}

// ── Utilities ──

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function escapeAttr(str) {
    return str.replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

// ── Polling & Init ──

async function init() {
    await checkHealth();
    await refreshKeys();
    // 2초마다 키 갱신, 5초마다 헬스체크
    setInterval(refreshKeys, 2000);
    setInterval(checkHealth, 5000);
}

// Enter 키로 GET 실행
document.getElementById("input-key").addEventListener("keydown", (e) => {
    if (e.key === "Enter") execGet();
});

init();
