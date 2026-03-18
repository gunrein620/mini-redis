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
    dot.className = `absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#0a0a0f] transition-colors duration-300 ${ok ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`;
    text.textContent = ok ? "Connected" : "Disconnected";
    text.className = `ml-auto text-xs transition-colors duration-300 ${ok ? "text-emerald-400/70" : "text-red-400/70"}`;
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
    } catch {
        // 연결 실패 시 조용히 넘김
    }
}

function renderKeyList() {
    const container = document.getElementById("key-list");
    if (state.keys.length === 0) {
        container.innerHTML = '<p class="text-center text-sm text-white/20 py-6">키가 없습니다</p>';
        return;
    }

    container.innerHTML = state.keys.map(k => {
        const isSelected = k.key === state.selectedKey;
        const ttlHtml = k.ttl > 0
            ? `<span class="ttl-badge ttl">${k.ttl}s</span>`
            : `<span class="ttl-badge persistent">persistent</span>`;
        return `
            <div class="key-row ${isSelected ? "selected" : ""}" onclick="selectKey('${escapeAttr(k.key)}')">
                <span class="font-mono text-sm text-white/70">${escapeHtml(k.key)}</span>
                <div class="flex items-center gap-2">
                    ${ttlHtml}
                    <button onclick="event.stopPropagation(); quickDelete('${escapeAttr(k.key)}')"
                            class="text-white/15 hover:text-red-400 transition-colors text-xs">✕</button>
                </div>
            </div>`;
    }).join("");
}

async function selectKey(key) {
    state.selectedKey = key;
    renderKeyList();

    const detailEl = document.getElementById("key-detail");
    detailEl.classList.remove("hidden");
    detailEl.innerHTML = '<div class="p-4 text-center"><span class="loading"></span></div>';

    try {
        const [getRes, ttlRes] = await Promise.all([api.get(key), api.ttl(key)]);
        const value = getRes.data;
        const ttl = ttlRes.data;

        if (value === null) {
            detailEl.innerHTML = '<div class="p-4 text-center text-white/30 text-sm">키가 만료되었거나 존재하지 않습니다</div>';
            return;
        }

        const isNumeric = /^-?\d+$/.test(value);
        const ttlDisplay = ttl === -1 ? "영구" : ttl === -2 ? "만료" : `${ttl}초 남음`;

        detailEl.innerHTML = `
            <div class="detail-panel mx-4 mb-4">
                <div class="flex items-center gap-2 mb-2">
                    <span class="font-mono text-sm text-violet-400 font-semibold">${escapeHtml(key)}</span>
                    <span class="text-xs text-white/30">TTL: ${ttlDisplay}</span>
                </div>
                <pre class="text-sm text-white/70 font-mono bg-black/20 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">${escapeHtml(value)}</pre>
                ${isNumeric ? `
                <div class="flex gap-2 mt-3">
                    <button onclick="execIncr('${escapeAttr(key)}')"
                            class="px-4 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600/80 hover:bg-emerald-500 active:scale-[0.97] transition-all">INCR +1</button>
                    <button onclick="execDecr('${escapeAttr(key)}')"
                            class="px-4 py-1.5 rounded-lg text-xs font-semibold bg-rose-600/80 hover:bg-rose-500 active:scale-[0.97] transition-all">DECR -1</button>
                </div>` : ""}
            </div>`;
    } catch {
        detailEl.innerHTML = '<div class="p-4 text-center text-red-400/70 text-sm">조회 실패</div>';
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

function showOpResult(html) {
    document.getElementById("op-result").innerHTML = html;
}

async function execGet() {
    const { key } = getInputs();
    if (!key) { showOpResult('<span class="text-red-400">key를 입력하세요</span>'); return; }

    try {
        const res = await api.get(key);
        if (res.data !== null) {
            showOpResult(`<span class="text-emerald-400">${escapeHtml(String(res.data))}</span> <span class="text-white/30 text-xs">${res._elapsed}ms</span>`);
            addLog("GET", key, "success", res._elapsed);
        } else {
            showOpResult(`<span class="text-white/40">(nil)</span> <span class="text-white/30 text-xs">${res._elapsed}ms</span>`);
            addLog("GET", key, "fail", res._elapsed);
        }
    } catch (e) {
        showOpResult(`<span class="text-red-400">연결 실패</span>`);
        addLog("GET", key, "fail", 0);
    }
}

async function execSet() {
    const { key, value, ttl } = getInputs();
    if (!key) { showOpResult('<span class="text-red-400">key를 입력하세요</span>'); return; }

    try {
        const res = await api.set(key, value, ttl || null);
        showOpResult(`<span class="text-emerald-400">OK</span> <span class="text-white/30 text-xs">${res._elapsed}ms</span>`);
        addLog("SET", key, "success", res._elapsed);
        await refreshKeys();
    } catch {
        showOpResult(`<span class="text-red-400">연결 실패</span>`);
        addLog("SET", key, "fail", 0);
    }
}

async function execDelete(targetKey) {
    const key = targetKey || getInputs().key;
    if (!key) { showOpResult('<span class="text-red-400">key를 입력하세요</span>'); return; }

    try {
        const res = await api.delete(key);
        const deleted = res.data > 0;
        showOpResult(`<span class="${deleted ? "text-emerald-400" : "text-white/40"}">${deleted ? "삭제 완료" : "해당 키 없음"}</span> <span class="text-white/30 text-xs">${res._elapsed}ms</span>`);
        addLog("DEL", key, deleted ? "success" : "fail", res._elapsed);
        if (state.selectedKey === key) {
            state.selectedKey = null;
            document.getElementById("key-detail").classList.add("hidden");
        }
        await refreshKeys();
    } catch {
        showOpResult(`<span class="text-red-400">연결 실패</span>`);
        addLog("DEL", key, "fail", 0);
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
        showOpResult(`<span class="text-indigo-400">${state.keys.length}개 키</span> <span class="text-white/30 text-xs">${res._elapsed}ms</span>`);
        addLog("KEYS", "*", "success", res._elapsed);
    } catch {
        showOpResult(`<span class="text-red-400">연결 실패</span>`);
        addLog("KEYS", "*", "fail", 0);
    }
}

async function execFlushAll() {
    showConfirmModal("모든 키를 삭제하시겠습니까?", async () => {
        try {
            const res = await api.flushall();
            showOpResult(`<span class="text-amber-400">${res.data}개 키 삭제 완료</span> <span class="text-white/30 text-xs">${res._elapsed}ms</span>`);
            addLog("FLUSHALL", "-", "success", res._elapsed);
            state.selectedKey = null;
            document.getElementById("key-detail").classList.add("hidden");
            await refreshKeys();
        } catch {
            showOpResult(`<span class="text-red-400">연결 실패</span>`);
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
        container.innerHTML = '<p class="text-center text-sm text-white/20 py-3">아직 기록이 없습니다</p>';
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
        closeModal();
        if (modalCallback) modalCallback();
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
