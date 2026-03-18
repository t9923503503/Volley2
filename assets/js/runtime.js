'use strict';

// ════════════════════════════════════════════════════════════
// 16. SCORE INTERACTIONS
// ════════════════════════════════════════════════════════════
function attachListeners() {
  // Remove old listener if any
  const sc = document.getElementById('screens');
  sc.removeEventListener('click', scoreClickHandler);
  sc.addEventListener('click', scoreClickHandler);
}

let _scoreAudioCtx = null;
function _getAudioCtx() {
  if (!_scoreAudioCtx || _scoreAudioCtx.state === 'closed') {
    _scoreAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_scoreAudioCtx.state === 'suspended') _scoreAudioCtx.resume();
  return _scoreAudioCtx;
}

function playScoreSound(dir) {
  try {
    const ctx = _getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = dir > 0 ? 880 : 440;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.18);
  } catch(e) {}
}

function playComboSound() {
  try {
    const ctx = _getAudioCtx();
    const notes = [523, 659, 784, 1047]; // до-ми-соль-до (мажорный аккорд вверх)
    notes.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.09;
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.start(t);
      osc.stop(t + 0.22);
    });
  } catch(e) {}
}

// Combo tracker: last pressed player key → timestamp + count
const _comboTracker = {};
const COMBO_WINDOW = 1500; // ms

function scoreClickHandler(e) {
  const btn = e.target.closest('.score-btn');
  if (!btn) return;
  if (btn.dataset.busy) return;
  btn.dataset.busy = '1';
  setTimeout(() => delete btn.dataset.busy, 200);
  const dir    = +btn.dataset.dir;

  // Combo detection (только для +)
  if (dir > 0) {
    const key = `${btn.dataset.div||btn.dataset.ci}_${btn.dataset.mi}_${btn.dataset.ri}`;
    const now = Date.now();
    const tr  = _comboTracker[key];
    if (tr && now - tr.t < COMBO_WINDOW) {
      tr.count++;
      tr.t = now;
      if (tr.count >= 2) { playComboSound(); }
      else               { playScoreSound(dir); }
    } else {
      if (Object.keys(_comboTracker).length > 100) {
        for (const k in _comboTracker) delete _comboTracker[k];
      }
      _comboTracker[key] = { t: now, count: 1 };
      playScoreSound(dir);
    }
  } else {
    playScoreSound(dir);
  }
  const mi     = +btn.dataset.mi;
  const ri     = +btn.dataset.ri;
  const divKey = btn.dataset.div;

  if (divKey) {
    // Division score
    if (!divScores[divKey]?.[mi]) return;
    const old  = divScores[divKey][mi][ri] ?? null;
    const base = old === null ? (dir > 0 ? 0 : -1) : old;
    const next = Math.max(0, Math.min(15, base + dir));
    if (old !== null && next === old) return;
    divScores[divKey][mi][ri] = next;
    scoreTs[divKey] = Date.now();
    addHistoryEntry(DIV_COURT_LABELS[divKey] || divKey, divRoster[divKey].men[mi] || '—', dir, next, divKey);
    updateDivWidget(divKey, mi, ri, next);
    saveState();
  } else {
    // Court score
    const ci   = +btn.dataset.ci;
    const old  = scores[ci]?.[mi]?.[ri] ?? null;
    const base = old === null ? (dir > 0 ? 0 : -1) : old;
    const next = Math.max(0, Math.min(15, base + dir));
    if (old !== null && next === old) return;
    scores[ci][mi][ri] = next;
    scoreTs['c'+ci] = Date.now();
    addHistoryEntry(COURT_META[ci].name, ALL_COURTS[ci].men[mi] || '—', dir, next, `k${ci}`);
    updateCourtWidget(ci, mi, ri, next);
    updateDivisions(); // recompute on every score change
    saveState();
  }
}

function _updateScoreDisp(sd, val) {
  const mx = val>=15, zr = val===0;
  sd.className = `score-disp${mx?' mx':zr?' zr':''}`;
  sd.textContent = '';
  sd.append(String(val));
  const lbl = document.createElement('span');
  lbl.className = 'score-max-lbl';
  lbl.textContent = mx ? 'МАХ' : '/15';
  sd.appendChild(lbl);
  sd.classList.add('pop');
  setTimeout(()=>sd.classList.remove('pop'), 250);
}

function updateCourtWidget(ci, mi, ri, val) {
  const sd = document.getElementById(`sd-${ci}-${mi}-${ri}`);
  if (sd) _updateScoreDisp(sd, val);
  // Buttons
  const card = document.getElementById(`card-${ci}-${mi}-${ri}`);
  if (card) {
    card.querySelector('.score-btn.minus').disabled = (val<=0);
    card.querySelector('.score-btn.plus').disabled  = val>=15;
    card.classList.toggle('has-score', val>0);
  }
  // Auto score for woman
  const wi = partnerW(mi, ri);
  const as = document.getElementById(`as-${ci}-${wi}-${ri}`);
  if (as) as.textContent = val;
  // Instantly unlock next round button if this was the first score
  const courtNav = document.getElementById(`rnd-nav-${ci}`);
  if (courtNav) courtNav.innerHTML = renderCourtNavInner(ci);
  // Unlock division tabs when last round gets its first score
  syncDivLock();
}

function updateDivWidget(key, mi, ri, val) {
  const Nd = divRoster[key].men.length;
  const sd = document.getElementById(`dsd-${key}-${mi}-${ri}`);
  if (sd) _updateScoreDisp(sd, val);
  const card = document.getElementById(`dcard-${key}-${mi}-${ri}`);
  if (card) {
    card.querySelector('.score-btn.minus').disabled = val<=0;
    card.querySelector('.score-btn.plus').disabled  = val>=15;
    card.classList.toggle('has-score', val>0);
  }
  const wi = divPartnerW(mi, ri, Nd);
  const as = document.getElementById(`das-${key}-${wi}-${ri}`);
  if (as) as.textContent = val;
  // Instantly unlock next round button if this was the first score
  const dci    = DIV_TIMER_IDX[key];
  const divNav = document.getElementById(`rnd-nav-${dci}`);
  if (divNav) divNav.innerHTML = renderDivNavInner(key);
}

// ════════════════════════════════════════════════════════════
// 17. COURT RESETS
// ════════════════════════════════════════════════════════════

/* Triple-tap guard for reset buttons.
   Tap 1 → orange warning "⚠️ Ещё раз?"
   Tap 2 → red warning "🔴 Точно сбросить?"
   Tap 3 → execute reset
   Resets to idle after 3 s of inactivity. */
const _rcGuard = {};   // btnId → { step, timer }

function _resetGuard(btnId, fn) {
  const btn = document.getElementById(btnId);
  if (!btn) { fn(); return; }

  const state = _rcGuard[btnId] || { step: 0 };
  clearTimeout(state.timer);
  state.step = (state.step || 0) + 1;

  if (state.step === 1) {
    btn.textContent = '⚠️ Ещё раз?';
    btn.classList.add('rc-warn1');
    btn.classList.remove('rc-warn2');
    state.timer = setTimeout(() => _rcReset(btnId, btn), 3000);
    _rcGuard[btnId] = state;
  } else if (state.step === 2) {
    btn.textContent = '🔴 Точно сбросить?';
    btn.classList.add('rc-warn2');
    btn.classList.remove('rc-warn1');
    state.timer = setTimeout(() => _rcReset(btnId, btn), 3000);
    _rcGuard[btnId] = state;
  } else {
    _rcReset(btnId, btn);
    fn();
  }
}

function _rcReset(btnId, btn) {
  delete _rcGuard[btnId];
  if (!btn) return;
  btn.classList.remove('rc-warn1', 'rc-warn2');
  // Restore original label from data attribute
  btn.textContent = btn.dataset.origLabel || '↺ Сброс';
}

function resetCourtGuard(ci, origLabel) {
  const btnId = `rcbtn-${ci}`;
  const btn = document.getElementById(btnId);
  if (btn) btn.dataset.origLabel = origLabel;
  _resetGuard(btnId, () => resetCourt(ci));
}

function resetDivGuard(key, origLabel) {
  const btnId = `rcbtn-${key}`;
  const btn = document.getElementById(btnId);
  if (btn) btn.dataset.origLabel = origLabel;
  _resetGuard(btnId, () => resetDivision(key));
}

async function resetCourt(ci) {
  if (!await showConfirm(`Сбросить очки ${COURT_META[ci].name}?`)) return;
  scores[ci] = Array.from({length:ppc}, ()=>Array(ppc).fill(null));
  timerReset(ci);
  const s = document.getElementById(`screen-${ci}`);
  if (s) s.innerHTML = renderCourt(ci);
  updateDivisions();
  saveState();
  showToast('↺ Очки сброшены');
}
async function resetDivision(key) {
  if (!await showConfirm(`Сбросить очки дивизиона?`)) return;
  const Nd = divRoster[key].men.length || ppc;
  divScores[key] = Array.from({length:Nd}, ()=>Array(Nd).fill(null));
  updateDivisions();
  saveState();
  showToast('↺ Очки дивизиона сброшены');
}

// ════════════════════════════════════════════════════════════
// 18. SWIPE BETWEEN COURTS (отключено)
// ════════════════════════════════════════════════════════════
function attachSwipe() {
  // свайп между кортами отключён
}

// ════════════════════════════════════════════════════════════
// 19. UTILITIES
// ════════════════════════════════════════════════════════════
function pbCls(p){ return p===1?'pb1':p===2?'pb2':p===3?'pb3':'pbn'; }
function esc(s){ if(!s) return ''; return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]); }
/** Escape a string for safe use inside onclick="fn('...')" HTML attributes */
function escAttr(s){ return esc(String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'")); }


// ── Shared constants ──────────────────────────────────────
const MEDALS_3 = ['🥇','🥈','🥉'];
const MEDALS_5 = ['🥇','🥈','🥉','4️⃣','5️⃣'];
const TOAST_DURATION = 2500;

/** Safe JSON parse from localStorage with fallback */
function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
  catch(e) { return fallback; }
}

/** Format a RU date string from ISO: "3 марта 2026" */
function fmtDateLong(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso+'T12:00:00')
      .toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
  } catch(e) { return '—'; }
}
let _toastTimer=null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(()=>t.classList.remove('show'), TOAST_DURATION);
}

function _onScroll() {
  document.getElementById('scrollTopBtn').classList.toggle('visible', window.scrollY > 120);
}
window.addEventListener('scroll', _onScroll, { passive: true });
window.addEventListener('beforeunload', () => window.removeEventListener('scroll', _onScroll));

// Global unhandled promise rejection handler
window.addEventListener('unhandledrejection', event => {
  console.error('Unhandled promise rejection:', event.reason);
  showToast('❌ ' + (event.reason?.message || 'Неизвестная ошибка'));
});

// Handlers moved from inline onclick (CSP compliance)
document.getElementById('scrollTopBtn').addEventListener('click', () => {
  window.scrollTo({top:0,behavior:'smooth'});
});
document.getElementById('pcard-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closePcard();
});

// ════════════════════════════════════════════════════════════
// 20. LOGO (inline base64 for offline PWA)
// ════════════════════════════════════════════════════════════
// Injected at build time — see LOGO_PLACEHOLDER
(function(){ var el = document.getElementById('nav-logo'); if (el && el.tagName === 'IMG') el.src = 'icon.svg'; })();
function showConfirm(msg) {
  return new Promise(resolve => {
    const ov = document.getElementById('confirm-overlay');
    document.getElementById('confirm-msg').textContent = msg;
    ov.classList.add('open');
    document.getElementById('confirm-ok').focus();
    function cleanup(result) {
      ov.classList.remove('open');
      document.getElementById('confirm-ok').onclick = null;
      document.getElementById('confirm-cancel').onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onKey(e) {
      if (e.key === 'Escape') cleanup(false);
      if (e.key === 'Enter')  cleanup(true);
    }
    document.addEventListener('keydown', onKey);
    document.getElementById('confirm-ok').onclick     = () => cleanup(true);
    document.getElementById('confirm-cancel').onclick = () => cleanup(false);
  });
}
