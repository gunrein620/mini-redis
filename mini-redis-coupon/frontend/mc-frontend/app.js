const API_BASE = "http://localhost:8000";

// 더미 데이터 (API 연동 전 테스트용)
const DUMMY_DATA = {
    "user01": {
        success: true,
        coupons: [
            { user_id: "user01", coupon_code: "CPN-7A3F-X9K2", ttl: 120, initial_ttl: 300, label: "10% 할인 쿠폰" },
            { user_id: "user01", coupon_code: "CPN-4D2E-R8T1", ttl: 200, initial_ttl: 300, label: "무료배송 쿠폰" },
        ]
    },
    "user02": {
        success: true,
        coupons: [
            { user_id: "user02", coupon_code: "CPN-2B8D-M4Q7", ttl: 15, initial_ttl: 300, label: "5000원 할인 쿠폰" },
        ]
    },
    "user03": {
        success: true,
        coupons: [
            { user_id: "user03", coupon_code: "CPN-9E1C-W6P0", ttl: 0, initial_ttl: 300, label: "신규가입 쿠폰" },
        ]
    },
};
const USE_DUMMY = true;

// 쿠폰별 타이머/TTL 상태
let couponTimers = {};  // { index: intervalId }
let couponTtls = {};    // { index: { current, initial } }

document.getElementById("user-id-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchCoupon();
});

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

async function searchCoupon() {
    const userId = document.getElementById("user-id-input").value.trim();
    if (!userId) return;

    clearAllTimers();
    showSection("result");

    document.getElementById("result-area").innerHTML = `
        <div class="flex flex-col items-center py-20 animate-fade-up">
            <div class="relative w-12 h-12 mb-6">
                <div class="absolute inset-0 border-2 border-white/5 rounded-full"></div>
                <div class="absolute inset-0 border-2 border-transparent border-t-violet-500 rounded-full animate-spin"></div>
                <div class="absolute inset-2 border-2 border-transparent border-t-indigo-400 rounded-full animate-spin" style="animation-direction: reverse; animation-duration: 0.8s;"></div>
            </div>
            <p class="text-sm text-white/30">쿠폰 정보를 조회하고 있어요</p>
        </div>
    `;

    document.getElementById("btn-search").disabled = true;

    if (USE_DUMMY) {
        await new Promise(r => setTimeout(r, 600));
        const data = DUMMY_DATA[userId];
        if (!data) {
            showNoCoupon(userId);
        } else {
            // TTL > 0 인 쿠폰만 필터
            const activeCoupons = data.coupons.filter(c => c.ttl > 0);
            if (activeCoupons.length === 0) {
                showNoCoupon(userId);
            } else {
                renderCoupons(activeCoupons);
            }
        }
    } else {
        try {
            const res = await fetch(`${API_BASE}/coupon/search?user_id=${encodeURIComponent(userId)}`);
            const data = await res.json();

            if (!data.success || !data.coupons || data.coupons.length === 0) {
                showNoCoupon(userId);
                document.getElementById("btn-search").disabled = false;
                return;
            }

            const activeCoupons = data.coupons.filter(c => c.ttl > 0);
            if (activeCoupons.length === 0) {
                showNoCoupon(userId);
            } else {
                renderCoupons(activeCoupons);
            }
        } catch (e) {
            document.getElementById("result-area").innerHTML = `
                <div class="flex flex-col items-center py-20 animate-fade-up">
                    <div class="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-5">
                        <span class="text-2xl">😵</span>
                    </div>
                    <p class="text-sm text-white/40 text-center leading-relaxed">
                        서버에 연결할 수 없어요<br>잠시 후 다시 시도해주세요
                    </p>
                </div>
            `;
        }
    }

    document.getElementById("btn-search").disabled = false;
}

function renderCoupons(coupons) {
    // 쿠폰 개수 표시 + 카드 리스트
    let html = `
        <div class="flex items-center justify-between mb-5 animate-fade-up">
            <div class="flex items-center gap-2">
                <span class="text-sm font-semibold text-white/70">조회 결과</span>
                <span class="text-[11px] font-bold px-2.5 py-1 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20">${coupons.length}장</span>
            </div>
        </div>
        <div class="flex flex-col gap-5">
    `;

    coupons.forEach((coupon, idx) => {
        const ttl = coupon.ttl;
        const initTtl = coupon.initial_ttl || ttl;
        const ratio = initTtl > 0 ? (ttl / initTtl) : 0;

        couponTtls[idx] = { current: ttl, initial: initTtl };

        const strokeColor = ratio <= 0.2 ? '#ef4444' : ratio <= 0.5 ? '#f59e0b' : '#8b5cf6';
        const circumference = 2 * Math.PI * 42;
        const dashoffset = circumference * (1 - ratio);

        html += `
        <div class="animate-fade-up" style="animation-delay: ${idx * 0.1}s;">
            <div id="coupon-card-${idx}" class="relative rounded-3xl glass overflow-hidden group hover:border-white/[0.12] transition-all duration-500">
                <!-- 상단 글로우 라인 -->
                <div class="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-violet-500/40 to-transparent"></div>

                <div class="flex items-stretch">
                    <!-- 왼쪽: 원형 타이머 -->
                    <div class="flex-shrink-0 w-36 flex flex-col items-center justify-center p-5 relative">
                        <div class="relative w-24 h-24">
                            <svg class="circle-timer w-full h-full" viewBox="0 0 96 96">
                                <circle cx="48" cy="48" r="42" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="4"/>
                                <circle id="timer-circle-${idx}" cx="48" cy="48" r="42" fill="none"
                                    stroke="${strokeColor}" stroke-width="4" stroke-linecap="round"
                                    stroke-dasharray="${circumference}" stroke-dashoffset="${dashoffset}"
                                    style="filter: drop-shadow(0 0 6px ${strokeColor}40);"/>
                            </svg>
                            <div class="absolute inset-0 flex flex-col items-center justify-center">
                                <span id="timer-text-${idx}" class="text-lg font-bold tabular-nums text-white/90">${formatTtlShort(ttl)}</span>
                                <span class="text-[9px] text-white/25 uppercase tracking-wider mt-0.5">TTL</span>
                            </div>
                        </div>
                    </div>

                    <!-- 구분선 (세로 점선 + 노치) -->
                    <div class="relative w-0 flex-shrink-0">
                        <div class="absolute top-4 bottom-4 left-0 border-l border-dashed border-white/[0.06]"></div>
                        <div class="coupon-notch-left" style="top: -12px;"></div>
                        <div class="coupon-notch-left" style="bottom: -12px;"></div>
                    </div>

                    <!-- 오른쪽: 쿠폰 정보 -->
                    <div class="flex-1 p-5 pl-7 flex flex-col justify-between min-h-[140px]">
                        <div>
                            <p class="text-[10px] font-semibold tracking-[0.15em] uppercase text-violet-400/60 mb-1">${escapeHtml(coupon.label || '선착순 쿠폰')}</p>
                            <p class="text-base font-bold text-white/90 tracking-wider font-mono">${escapeHtml(coupon.coupon_code)}</p>
                        </div>
                        <div class="flex items-center justify-between mt-3">
                            <span class="text-[11px] text-white/25">${escapeHtml(coupon.user_id)}</span>
                            <button id="btn-use-${idx}"
                                    onclick="useCoupon(${idx}, event)"
                                    class="text-[11px] font-semibold px-4 py-2 rounded-xl
                                           bg-gradient-to-r from-emerald-500/20 to-emerald-400/10
                                           text-emerald-400 border border-emerald-500/20
                                           hover:from-emerald-500/30 hover:to-emerald-400/20
                                           hover:shadow-lg hover:shadow-emerald-500/10
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

        // 각 쿠폰별 타이머 시작
        startCouponTimer(idx);
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

            // 만료 표시
            const textEl = document.getElementById(`timer-text-${idx}`);
            if (textEl) {
                textEl.textContent = "만료";
                textEl.className = "text-sm font-bold tabular-nums text-red-400";
            }
            const circleEl = document.getElementById(`timer-circle-${idx}`);
            if (circleEl) {
                circleEl.style.strokeDashoffset = circumference;
                circleEl.style.stroke = '#ef4444';
            }
            return;
        }

        const ratio = current / initial;
        const strokeColor = ratio <= 0.2 ? '#ef4444' : ratio <= 0.5 ? '#f59e0b' : '#8b5cf6';
        const dashoffset = circumference * (1 - ratio);

        const textEl = document.getElementById(`timer-text-${idx}`);
        if (textEl) textEl.textContent = formatTtlShort(current);

        const circleEl = document.getElementById(`timer-circle-${idx}`);
        if (circleEl) {
            circleEl.style.strokeDashoffset = dashoffset;
            circleEl.style.stroke = strokeColor;
            circleEl.style.filter = `drop-shadow(0 0 6px ${strokeColor}40)`;
        }
    }, 1000);
}

function useCoupon(idx, event) {
    const ttlData = couponTtls[idx];
    if (!ttlData) return;

    if (ttlData.current > 0) {
        // 파티클!
        const rect = event.target.getBoundingClientRect();
        spawnParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, '#34d399', 15);
        showModal("success");
    } else {
        showModal("fail", idx);
    }
}

function showModal(type, failIdx) {
    const overlay = document.getElementById("modal-overlay");
    const icon = document.getElementById("modal-icon");
    const title = document.getElementById("modal-title");
    const desc = document.getElementById("modal-desc");

    if (type === "success") {
        icon.className = "w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center text-4xl bg-emerald-500/15 border border-emerald-500/20";
        icon.textContent = "🎉";
        title.textContent = "사용 가능합니다!";
        title.className = "text-xl font-bold text-emerald-400 mb-2";
        desc.textContent = "이 쿠폰은 현재 사용 가능한 상태입니다.";
    } else {
        icon.className = "w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center text-4xl bg-red-500/15 border border-red-500/20";
        icon.textContent = "😢";
        title.textContent = "사용 불가능합니다";
        title.className = "text-xl font-bold text-red-400 mb-2";
        desc.textContent = "유효시간이 만료되어 사용할 수 없습니다.";
    }

    overlay.style.display = "flex";
    overlay.dataset.type = type;
    overlay.dataset.failIdx = failIdx !== undefined ? failIdx : "";
}

function closeModal() {
    const overlay = document.getElementById("modal-overlay");
    const type = overlay.dataset.type;
    const failIdx = overlay.dataset.failIdx;
    overlay.style.display = "none";

    if (type === "success") {
        // 모달만 닫고 아무 일도 안 함
    } else if (type === "fail" && failIdx !== "") {
        // 만료 쿠폰 카드 사라짐
        const card = document.getElementById(`coupon-card-${failIdx}`);
        if (card) {
            card.style.transition = "opacity 0.5s ease, transform 0.5s ease, max-height 0.5s ease";
            card.style.opacity = "0";
            card.style.transform = "scale(0.95) translateX(20px)";
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

                // 남은 카드 없으면 메시지
                const remaining = document.querySelectorAll('[id^="coupon-card-"]');
                if (remaining.length === 0) {
                    document.getElementById("result-area").innerHTML = `
                        <div class="flex flex-col items-center py-20 animate-fade-up">
                            <div class="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-5">
                                <span class="text-2xl">⏰</span>
                            </div>
                            <p class="text-sm text-white/40 text-center leading-relaxed">
                                모든 쿠폰의 유효시간이 만료되었어요<br>
                                <span class="text-white/25 text-xs">TTL이 만료되어 Redis에서 삭제되었습니다</span>
                            </p>
                        </div>
                    `;
                }
            }, 500);
        }
    }
}

function formatTtl(seconds) {
    if (seconds <= 0) return "만료됨";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m > 0) return `${m}분 ${s}초`;
    return `${s}초`;
}

function formatTtlShort(seconds) {
    if (seconds <= 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function showNoCoupon(userId) {
    document.getElementById("result-area").innerHTML = `
        <div class="flex flex-col items-center py-20 animate-fade-up">
            <div class="animate-float">
                <div class="w-16 h-16 rounded-2xl glass flex items-center justify-center mb-5">
                    <span class="text-2xl">🔍</span>
                </div>
            </div>
            <p class="text-sm text-white/40 text-center leading-relaxed mt-3">
                <strong class="text-white/60">${escapeHtml(userId)}</strong> 님에게<br>발급된 쿠폰이 없어요
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
