const API_BASE = "http://localhost:8000";

// 쿠폰별 타이머/TTL 상태
let couponTimers = {};
let couponTtls = {};

// 파티클 효과
function spawnParticles(x, y, color, count = 12) {
    const container = document.getElementById("particles");
    for (let i = 0; i < count; i++) {
        const p = document.createElement("div");
        const size = Math.random() * 6 + 3;
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
        const distance = Math.random() * 80 + 40;
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance - 60;

        p.style.cssText = `
            position: absolute; left: ${x}px; top: ${y}px;
            width: ${size}px; height: ${size}px;
            background: ${color}; border-radius: 50%;
            pointer-events: none; z-index: 101;
        `;
        container.appendChild(p);

        p.animate([
            { transform: 'translate(0,0) scale(1)', opacity: 1 },
            { transform: `translate(${dx}px, ${dy}px) scale(0)`, opacity: 0 }
        ], { duration: 800 + Math.random() * 400, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' })
        .onfinish = () => p.remove();
    }
}

function clearAllTimers() {
    Object.values(couponTimers).forEach(id => clearInterval(id));
    couponTimers = {};
    couponTtls = {};
}

/**
 * 유효 쿠폰 조회
 */
async function fetchValidCoupons() {
    clearAllTimers();
    showSection("result");

    document.getElementById("result-area").innerHTML = `
        <div class="flex flex-col items-center py-20 animate-fade-up">
            <div class="relative w-10 h-10 mb-5">
                <div class="absolute inset-0 border-2 border-white/[0.06] rounded-full"></div>
                <div class="absolute inset-0 border-2 border-transparent border-t-[#0A84FF] rounded-full animate-spin"></div>
            </div>
            <p class="text-sm text-[#86868b]">쿠폰 정보를 조회하고 있어요</p>
        </div>
    `;

    document.getElementById("btn-search").disabled = true;

    try {
        const res = await fetch(`${API_BASE}/coupon/valid-coupons`);
        const data = await res.json();

        // 비교 카드 표시
        document.getElementById("compare-section").style.display = "block";
        document.getElementById("redis-count").textContent = `${data.redis_count}장`;
        document.getElementById("redis-elapsed").textContent = `${data.redis_elapsed_ms.toFixed(2)}ms`;
        document.getElementById("db-count").textContent = `${data.db_count}장`;
        document.getElementById("db-elapsed").textContent = `${data.db_elapsed_ms.toFixed(2)}ms`;

        const redisCoupons = data.redis_coupons || [];

        if (redisCoupons.length === 0) {
            showNoCoupon();
        } else {
            renderCoupons(redisCoupons);
        }
    } catch (e) {
        document.getElementById("compare-section").style.display = "none";
        document.getElementById("result-area").innerHTML = `
            <div class="flex flex-col items-center py-20 animate-fade-up">
                <div class="w-16 h-16 rounded-[16px] bg-[#FF453A]/10 border border-[#FF453A]/20 flex items-center justify-center mb-5">
                    <span class="text-2xl">😵</span>
                </div>
                <p class="text-sm text-[#86868b] text-center leading-relaxed">
                    서버에 연결할 수 없어요<br>
                    <span class="text-[#48484a] text-xs">백엔드 서버(localhost:8000)가 실행 중인지 확인해주세요</span>
                </p>
            </div>
        `;
    }

    document.getElementById("btn-search").disabled = false;
}

/**
 * 쿠폰 카드 렌더링
 */
function renderCoupons(coupons) {
    let html = `
        <div class="flex items-center justify-between mb-5 animate-fade-up">
            <div class="flex items-center gap-2">
                <span class="text-sm font-semibold text-[#1a1a2e]">유효 쿠폰</span>
                <span class="text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#0A84FF]/10 text-[#0A84FF] border border-[#0A84FF]/20">${coupons.length}장</span>
            </div>
            <span class="text-[11px] text-[#48484a]">TTL 실시간 카운트다운</span>
        </div>
        <div class="flex flex-col gap-4">
    `;

    coupons.forEach((coupon, idx) => {
        const ttl = coupon.remaining_seconds;
        const initTtl = 15;
        const ratio = initTtl > 0 ? Math.min(ttl / initTtl, 1) : 0;

        couponTtls[idx] = { current: ttl, initial: initTtl, coupon_code: coupon.coupon_code };

        const strokeColor = ratio <= 0.2 ? '#FF453A' : ratio <= 0.5 ? '#FF9F0A' : '#0A84FF';
        const circumference = 2 * Math.PI * 42;
        const dashoffset = circumference * (1 - ratio);

        html += `
        <div class="animate-fade-up" style="animation-delay: ${idx * 0.08}s;">
            <div id="coupon-card-${idx}" class="coupon-card relative overflow-hidden">
                <!-- 상단 하이라이트 라인 -->
                <div class="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#0A84FF]/30 to-transparent"></div>

                <div class="flex items-stretch">
                    <!-- 왼쪽: 원형 타이머 -->
                    <div class="flex-shrink-0 w-36 flex flex-col items-center justify-center p-5 relative">
                        <div class="relative w-24 h-24">
                            <svg class="circle-timer w-full h-full" viewBox="0 0 96 96">
                                <circle cx="48" cy="48" r="42" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="4"/>
                                <circle id="timer-circle-${idx}" cx="48" cy="48" r="42" fill="none"
                                    stroke="${strokeColor}" stroke-width="4" stroke-linecap="round"
                                    stroke-dasharray="${circumference}" stroke-dashoffset="${dashoffset}"
                                    style="filter: drop-shadow(0 0 8px ${strokeColor}30);"/>
                            </svg>
                            <div class="absolute inset-0 flex flex-col items-center justify-center">
                                <span id="timer-text-${idx}" class="text-lg font-bold tabular-nums text-[#1a1a2e]">${formatTtlShort(ttl)}</span>
                                <span class="text-[9px] text-[#48484a] uppercase tracking-wider mt-0.5 font-semibold">TTL</span>
                            </div>
                        </div>
                    </div>

                    <!-- 구분선 -->
                    <div class="relative w-0 flex-shrink-0">
                        <div class="absolute top-4 bottom-4 left-0 border-l border-dashed border-white/[0.06]"></div>
                        <div class="coupon-notch-left" style="top: -12px;"></div>
                        <div class="coupon-notch-left" style="bottom: -12px;"></div>
                    </div>

                    <!-- 오른쪽: 쿠폰 정보 -->
                    <div class="flex-1 p-5 pl-7 flex flex-col justify-between min-h-[140px]">
                        <div>
                            <p class="text-[10px] font-semibold tracking-[0.15em] uppercase text-[#0A84FF]/60 mb-1">선착순 쿠폰</p>
                            <p class="text-base font-bold text-[#1a1a2e] tracking-wider font-mono">${escapeHtml(coupon.coupon_code)}</p>
                            <p class="text-[11px] text-[#48484a] mt-1 font-mono">ID: ${coupon.id}</p>
                        </div>
                        <div class="flex items-center justify-between mt-3">
                            <span id="status-text-${idx}" class="text-[11px] ${ttl > 0 ? 'text-[#30D158]' : 'text-[#FF453A]'}">
                                ${ttl > 0 ? '● 유효' : '● 만료'}
                            </span>
                            <button id="btn-use-${idx}"
                                    onclick="useCoupon(${idx}, event)"
                                    class="text-[12px] font-semibold px-5 py-2.5 rounded-full
                                           bg-[#30D158]/10 text-[#30D158]
                                           border border-[#30D158]/20
                                           hover:bg-[#30D158]/20
                                           active:scale-[0.95]
                                           transition-all duration-200 cursor-pointer">
                                사용하기
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        `;

        if (ttl > 0) {
            startCouponTimer(idx);
        }
    });

    html += `</div>`;
    document.getElementById("result-area").innerHTML = html;
}

function startCouponTimer(idx) {
    const circumference = 2 * Math.PI * 42;

    couponTimers[idx] = setInterval(() => {
        couponTtls[idx].current--;
        const current = couponTtls[idx].current;
        const initial = couponTtls[idx].initial;

        if (current <= 0) {
            clearInterval(couponTimers[idx]);
            delete couponTimers[idx];
            couponTtls[idx].current = 0;

            const textEl = document.getElementById(`timer-text-${idx}`);
            if (textEl) {
                textEl.textContent = "만료";
                textEl.className = "text-sm font-bold tabular-nums text-[#FF453A]";
            }
            const circleEl = document.getElementById(`timer-circle-${idx}`);
            if (circleEl) {
                circleEl.style.strokeDashoffset = circumference;
                circleEl.style.stroke = '#FF453A';
                circleEl.style.filter = 'drop-shadow(0 0 8px #FF453A30)';
            }
            const statusEl = document.getElementById(`status-text-${idx}`);
            if (statusEl) {
                statusEl.textContent = "● 만료";
                statusEl.className = "text-[11px] text-[#FF453A]";
            }
            return;
        }

        const ratio = Math.min(current / initial, 1);
        const strokeColor = ratio <= 0.2 ? '#FF453A' : ratio <= 0.5 ? '#FF9F0A' : '#0A84FF';
        const dashoffset = circumference * (1 - ratio);

        const textEl = document.getElementById(`timer-text-${idx}`);
        if (textEl) textEl.textContent = formatTtlShort(current);

        const circleEl = document.getElementById(`timer-circle-${idx}`);
        if (circleEl) {
            circleEl.style.strokeDashoffset = dashoffset;
            circleEl.style.stroke = strokeColor;
            circleEl.style.filter = `drop-shadow(0 0 8px ${strokeColor}30)`;
        }
    }, 1000);
}

/**
 * 사용하기 버튼 클릭
 */
async function useCoupon(idx, event) {
    const ttlData = couponTtls[idx];
    if (!ttlData) return;

    const couponCode = ttlData.coupon_code;
    const btn = document.getElementById(`btn-use-${idx}`);
    if (btn) {
        btn.disabled = true;
        btn.textContent = "확인 중...";
        btn.style.opacity = "0.5";
    }

    try {
        const res = await fetch(`${API_BASE}/coupon/validate/${encodeURIComponent(couponCode)}`);
        const data = await res.json();

        if (btn) {
            btn.disabled = false;
            btn.textContent = "사용하기";
            btn.style.opacity = "1";
        }

        if (data.valid) {
            const rect = event.target.getBoundingClientRect();
            spawnParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, '#30D158', 15);
            showModal("success", null, `남은 시간: ${data.remaining_seconds}초 (${data.source})`);
        } else {
            showModal("fail", idx, data.reason || "만료된 쿠폰입니다");
        }
    } catch (e) {
        if (btn) {
            btn.disabled = false;
            btn.textContent = "사용하기";
            btn.style.opacity = "1";
        }
        showModal("fail", idx, "서버 연결 실패");
    }
}

function showModal(type, failIdx, detail) {
    const overlay = document.getElementById("modal-overlay");
    const icon = document.getElementById("modal-icon");
    const title = document.getElementById("modal-title");
    const desc = document.getElementById("modal-desc");

    if (type === "success") {
        icon.className = "w-20 h-20 mx-auto mb-6 rounded-[18px] flex items-center justify-center text-4xl bg-[#30D158]/10 border border-[#30D158]/20";
        icon.textContent = "🎉";
        title.textContent = "사용 가능합니다!";
        title.className = "text-xl font-bold text-[#30D158] mb-2";
        desc.textContent = detail || "이 쿠폰은 현재 사용 가능한 상태입니다.";
    } else {
        icon.className = "w-20 h-20 mx-auto mb-6 rounded-[18px] flex items-center justify-center text-4xl bg-[#FF453A]/10 border border-[#FF453A]/20";
        icon.textContent = "😢";
        title.textContent = "사용 불가능합니다";
        title.className = "text-xl font-bold text-[#FF453A] mb-2";
        desc.textContent = detail || "유효시간이 만료되어 사용할 수 없습니다.";
    }

    overlay.style.display = "flex";
    overlay.dataset.type = type;
    overlay.dataset.failIdx = failIdx !== null && failIdx !== undefined ? failIdx : "";
}

function closeModal() {
    const overlay = document.getElementById("modal-overlay");
    const type = overlay.dataset.type;
    const failIdx = overlay.dataset.failIdx;
    overlay.style.display = "none";

    if (type === "fail" && failIdx !== "") {
        const card = document.getElementById(`coupon-card-${failIdx}`);
        if (card) {
            card.style.transition = "opacity 0.5s ease, transform 0.5s ease";
            card.style.opacity = "0";
            card.style.transform = "scale(0.97) translateX(20px)";
            setTimeout(() => {
                const wrapper = card.parentElement;
                if (wrapper) {
                    wrapper.style.transition = "all 0.3s ease";
                    wrapper.style.maxHeight = "0";
                    wrapper.style.overflow = "hidden";
                    wrapper.style.marginBottom = "0";
                    wrapper.style.opacity = "0";
                    setTimeout(() => wrapper.remove(), 300);
                }

                const remaining = document.querySelectorAll('[id^="coupon-card-"]');
                if (remaining.length === 0) {
                    document.getElementById("result-area").innerHTML = `
                        <div class="flex flex-col items-center py-20 animate-fade-up">
                            <div class="w-16 h-16 rounded-[16px] bg-[#FF453A]/10 border border-[#FF453A]/20 flex items-center justify-center mb-5">
                                <span class="text-2xl">⏰</span>
                            </div>
                            <p class="text-sm text-[#86868b] text-center leading-relaxed">
                                모든 쿠폰의 유효시간이 만료되었어요<br>
                                <span class="text-[#48484a] text-xs">TTL이 만료되어 Redis에서 삭제되었습니다</span>
                            </p>
                        </div>
                    `;
                }
            }, 500);
        }
    }
}

function formatTtlShort(seconds) {
    if (seconds <= 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function showNoCoupon() {
    document.getElementById("result-area").innerHTML = `
        <div class="flex flex-col items-center py-20 animate-fade-up">
            <div class="animate-float">
                <div class="w-16 h-16 rounded-[16px] glass-panel flex items-center justify-center mb-5">
                    <span class="text-2xl">🔍</span>
                </div>
            </div>
            <p class="text-sm text-[#86868b] text-center leading-relaxed mt-3">
                현재 유효한 쿠폰이 없어요<br>
                <span class="text-[#48484a] text-xs">메인 페이지에서 쿠폰을 발급해주세요</span>
            </p>
        </div>
    `;
}

function showSection(section) {
    document.getElementById("result-section").style.display = section === "result" ? "block" : "none";
    document.getElementById("empty-state").style.display = section === "result" ? "none" : "block";
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}
