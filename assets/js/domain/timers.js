'use strict';

// ════════════════════════════════════════════════════════════
// 20. GAME TIMER MODULE
// Each court has an independent timer that persists across tab switches.
// Uses Date.now() anchoring so background/lock screen won't drift.
// ════════════════════════════════════════════════════════════
const TIMER_PRESETS = [10, 12, 15]; // minutes
let timerTs = Array(8).fill(0); // last-action timestamp per timer (for smart merge)
const timerState = Array.from({length:8}, () => ({  // 0-3: корты, 4-7: дивизионы
  preset:   10,           // selected preset in minutes
  total:    10 * 60,      // total seconds for current preset
  remaining: 10 * 60,    // seconds left (float ok)
  running:  false,
  startedAt: null,        // Date.now() when last started
  startRemaining: 10*60, // remaining when last started
}));

// ── Audio: synthesized whistle/siren via Web Audio API ──────
let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}
function playWarning60() {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    // два коротких свистка — предупреждение
    [[0, 660], [0.28, 660]].forEach(([delay, freq]) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t + delay);
      gain.gain.linearRampToValueAtTime(0.4, t + delay + 0.02);
      gain.gain.setValueAtTime(0.4, t + delay + 0.16);
      gain.gain.linearRampToValueAtTime(0, t + delay + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t + delay);
      osc.stop(t + delay + 0.25);
    });
  } catch(e) {}
}

function speakFinal() {
  try {
    if (!window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance('FINAL');
    u.lang   = 'en-US';
    u.rate   = 0.85;
    u.pitch  = 1.1;
    u.volume = 1;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch(e) {}
}

function playEndSignal() {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    // 3-blast whistle pattern
    [[0, 880], [0.35, 1100], [0.7, 880]].forEach(([delay, freq]) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      const dist = ctx.createWaveShaper();

      // mild distortion for whistle texture
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const x = (i * 2) / 256 - 1;
        curve[i] = (Math.PI + 200) * x / (Math.PI + 200 * Math.abs(x));
      }
      dist.curve = curve;

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t + delay);
      osc.frequency.linearRampToValueAtTime(freq * 1.05, t + delay + 0.05);
      osc.frequency.linearRampToValueAtTime(freq,        t + delay + 0.28);

      gain.gain.setValueAtTime(0, t + delay);
      gain.gain.linearRampToValueAtTime(0.35, t + delay + 0.02);
      gain.gain.setValueAtTime(0.35, t + delay + 0.22);
      gain.gain.linearRampToValueAtTime(0, t + delay + 0.3);

      osc.connect(dist);
      dist.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t + delay);
      osc.stop(t + delay + 0.32);
    });
  } catch(e) {}
}

// ── Tick: called by rAF loop ─────────────────────────────────
let _timerLastSave = 0;
function timerTick() {
  requestAnimationFrame(timerTick);
  const now = Date.now();
  let anyRunning = false;
  timerState.forEach((ts, ci) => {
    if (!ts.running) return;
    anyRunning = true;
    const elapsed = (now - ts.startedAt) / 1000;
    const rem = Math.max(0, ts.startRemaining - elapsed);
    const wasPositive = ts.remaining > 0;
    const prev = ts.remaining;
    ts.remaining = rem;

    // 1 минута — предупреждение (только один раз за сессию)
    if (prev > 60 && rem <= 60 && !ts._w60) {
      ts._w60 = true;
      playWarning60();
    }
    // 20 секунд — голос "FINAL" (только один раз за сессию)
    if (prev > 20 && rem <= 20 && !ts._w20) {
      ts._w20 = true;
      speakFinal();
    }

    if (rem <= 0 && wasPositive) {
      ts.running = false;
      ts.remaining = 0;
      playEndSignal();
      saveTimerState();
    }
    updateTimerUI(ci);
  });
  // Сохраняем состояние раз в секунду пока хоть один таймер запущен
  if (anyRunning && now - _timerLastSave > 1000) {
    _timerLastSave = now;
    saveTimerState();
  }
}

// ── UI update (non-destructive, only touches timer DOM) ─────
function updateTimerUI(ci) {
  const ts  = timerState[ci];
  const rem = ts.remaining;
  const mins = Math.floor(rem / 60);
  const secs = Math.floor(rem % 60);
  const display = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;

  const disp = document.getElementById(`tmr-disp-${ci}`);
  const btn  = document.getElementById(`tmr-btn-${ci}`);
  const bar  = document.getElementById(`tmr-bar-${ci}`);

  if (!disp) return;

  disp.textContent = display;
  const danger = rem <= 60 && rem > 0;
  const done   = rem <= 0;
  disp.className = `timer-display${danger ? ' danger' : done ? ' done' : ''}`;

  if (btn && !_tmrPauseGuard[ci]) {
    if (done) {
      btn.textContent = 'ГОТОВО';
      btn.className = 'timer-btn timer-btn-reset';
    } else if (ts.running) {
      btn.textContent = 'ПАУЗА';
      btn.className = 'timer-btn timer-btn-start paused';
    } else {
      btn.textContent = rem < ts.total ? 'ПРОДОЛЖИТЬ' : 'СТАРТ';
      btn.className = rem < ts.total ? 'timer-btn timer-btn-start timer-btn-continue' : 'timer-btn timer-btn-start';
    }
  }

  if (bar) {
    const pct = ts.total > 0 ? (rem / ts.total) * 100 : 0;
    bar.style.width = pct + '%';
    bar.className = `timer-progress-fill${danger ? ' danger' : ''}`;
  }
}

// ── Timer persistence ─────────────────────────────────────────
const TIMER_STORAGE_KEY = 'kotc_timers_v1';

function saveTimerState() {
  try {
    const snapshot = timerState.map(ts => ({
      preset:         ts.preset,
      total:          ts.total,
      remaining:      ts.remaining,
      running:        ts.running,
      startedAt:      ts.startedAt,
      startRemaining: ts.startRemaining,
    }));
    localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(snapshot));
  } catch(e) {}
}

function loadTimerState() {
  try {
    const raw = localStorage.getItem(TIMER_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    const now = Date.now();
    saved.forEach((s, ci) => {
      if (ci >= timerState.length) return;
      const ts = timerState[ci];
      ts.preset         = s.preset         ?? ts.preset;
      ts.total          = s.total          ?? ts.total;
      ts.startedAt      = s.startedAt      ?? null;
      ts.startRemaining = s.startRemaining ?? ts.startRemaining;
      ts.running        = s.running        ?? false;
      // Если таймер был запущен — вычисляем сколько утекло пока страница была закрыта
      if (ts.running && ts.startedAt) {
        const elapsed = (now - ts.startedAt) / 1000;
        ts.remaining = Math.max(0, ts.startRemaining - elapsed);
        if (ts.remaining <= 0) {
          ts.running   = false;
          ts.remaining = 0;
        }
      } else {
        ts.remaining = s.remaining ?? ts.remaining;
      }
    });
  } catch(e) {}
}

// ── Timer actions (глобальные: действие на любом корте/дивизионе = действие на всей группе) ────
// ci < 4  → корты (группа 0-3)
// ci >= 4 → дивизионы (группа 4-7)
function _timerGroup(ci) {
  return ci < 4 ? [0, 1, 2, 3] : [4, 5, 6, 7];
}

function playTimerStart() {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    [[0, 520, 0.14], [0.13, 800, 0.18]].forEach(([delay, freq, dur]) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t+delay);
      gain.gain.linearRampToValueAtTime(0.32, t+delay+0.02);
      gain.gain.linearRampToValueAtTime(0, t+delay+dur);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t+delay); osc.stop(t+delay+dur+0.05);
    });
  } catch(e) {}
}
function playTimerPause() {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(620, t);
    osc.frequency.linearRampToValueAtTime(360, t+0.2);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.28, t+0.02);
    gain.gain.linearRampToValueAtTime(0, t+0.2);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(t); osc.stop(t+0.22);
  } catch(e) {}
}

/* Pause guard: double-tap required to pause while timer is running */
const _tmrPauseGuard = {};
function timerStartPauseGuard(ci) {
  const ts = timerState[ci];
  if (!ts.running) { timerStartPause(ci); return; } // START/CONTINUE → immediate

  const btn = document.getElementById(`tmr-btn-${ci}`);
  if (_tmrPauseGuard[ci]) {
    // Second tap → confirm pause
    clearTimeout(_tmrPauseGuard[ci]);
    delete _tmrPauseGuard[ci];
    if (btn) btn.classList.remove('pause-guard');
    timerStartPause(ci);
  } else {
    // First tap → show warning
    if (btn) { btn.classList.add('pause-guard'); btn.textContent = '⏸ Пауза?'; }
    _tmrPauseGuard[ci] = setTimeout(() => {
      delete _tmrPauseGuard[ci];
      if (btn) btn.classList.remove('pause-guard');
      // updateTimerUI will restore the text on next tick
    }, 2000);
  }
}

function timerStartPause(ci) {
  const now  = Date.now();
  const ref  = timerState[ci]; // решение старт/пауза берём с инициатора
  if (ref.remaining <= 0) { timerReset(ci); return; }
  const willRun = !ref.running;
  if (willRun) { try { getAudioCtx().resume(); } catch(e) {} playTimerStart(); }
  else playTimerPause();

  for (const i of _timerGroup(ci)) {
    const ts = timerState[i];
    if (willRun) {
      ts.startedAt      = now;
      ts.startRemaining = ts.remaining;
      ts.running        = true;
    } else {
      ts.running   = false;
      ts.remaining = Math.max(0, ts.startRemaining - (now - ts.startedAt) / 1000);
    }
    timerTs[i] = now;
    updateTimerUI(i);
  }
  saveTimerState();
  sbPush();
}

function timerReset(ci) {
  const now = Date.now();
  for (const i of _timerGroup(ci)) {
    const ts = timerState[i];
    ts.running        = false;
    ts.remaining      = ts.total;
    ts.startedAt      = null;
    ts.startRemaining = ts.total;
    ts._w60 = false;
    ts._w20 = false;
    timerTs[i] = now;
    updateTimerUI(i);
    document.querySelectorAll(`[data-timer-ci="${i}"]`).forEach(b => {
      b.classList.toggle('active', +b.dataset.timerMin === ts.preset);
    });
  }
  saveTimerState();
  sbPush();
}

const _timerResetGuardTimers = {};
function timerResetGuard(ci) {
  const btn = document.getElementById(`tmr-reset-${ci}`);
  if (!btn) { timerReset(ci); return; }
  if (btn.dataset.confirming === '1') {
    clearTimeout(_timerResetGuardTimers[ci]);
    delete _timerResetGuardTimers[ci];
    btn.dataset.confirming = '';
    btn.textContent = 'СБРОС';
    btn.classList.remove('confirm');
    timerReset(ci);
  } else {
    btn.dataset.confirming = '1';
    btn.textContent = '✓ ОК?';
    btn.classList.add('confirm');
    _timerResetGuardTimers[ci] = setTimeout(() => {
      btn.dataset.confirming = '';
      btn.textContent = 'СБРОС';
      btn.classList.remove('confirm');
    }, 2000);
  }
}

function timerSetPreset(ci, minutes) {
  const group = _timerGroup(ci);
  if (group.some(i => timerState[i].running)) return; // нельзя менять пресет во время игры
  const now = Date.now();
  for (const i of group) {
    const ts = timerState[i];
    ts.preset         = minutes;
    ts.total          = minutes * 60;
    ts.remaining      = ts.total;
    ts.startRemaining = ts.total;
    timerTs[i] = now;
    updateTimerUI(i);
    document.querySelectorAll(`[data-timer-ci="${i}"]`).forEach(b => {
      b.classList.toggle('active', +b.dataset.timerMin === minutes);
    });
  }
  saveTimerState();
  sbPush();
}

function timerCustomStep(ci, step) {
  const ts = timerState[ci];
  const cur = ts.preset;
  const next = Math.min(25, Math.max(2, cur + step));
  if (next === cur) return;
  timerSetPreset(ci, next);
  // обновляем отображение в Ростере
  const rosterId = ci < 4 ? 'roster-tmr-courts' : 'roster-tmr-divs';
  const val = document.getElementById(rosterId);
  if (val) val.textContent = `${next} мин`;
}

// ── Render helper (called inside renderCourt) ────────────────
function renderTimerBlock(ci, roundNavHtml='') {
  const ts = timerState[ci];
  const rem = ts.remaining;
  const mins = Math.floor(rem / 60);
  const secs = Math.floor(rem % 60);
  const display = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  const danger  = rem <= 60 && rem > 0;
  const done    = rem <= 0;
  const pct     = ts.total > 0 ? (rem / ts.total) * 100 : 0;

  const startLabel = done ? 'ГОТОВО' : ts.running ? 'ПАУЗА' : rem < ts.total ? 'ПРОДОЛЖИТЬ' : 'СТАРТ';
  const startCls   = done ? 'timer-btn timer-btn-reset'
                          : ts.running ? 'timer-btn timer-btn-start paused'
                          : rem < ts.total ? 'timer-btn timer-btn-start timer-btn-continue'
                          : 'timer-btn timer-btn-start';

  return `<div class="timer-block" id="timer-block-${ci}">
    <div style="display:flex;align-items:center;gap:10px">
      <div class="timer-display${danger?' danger':done?' done':''}" id="tmr-disp-${ci}" style="flex-shrink:0">${display}</div>
      <div style="flex:1;display:flex;flex-direction:column;gap:6px">
        <div class="timer-controls" style="margin-top:0">
          <button class="${startCls}" id="tmr-btn-${ci}" onclick="timerStartPauseGuard(${ci})" style="flex:1">${startLabel}</button>
          <button class="timer-btn timer-btn-reset" id="tmr-reset-${ci}" onclick="timerResetGuard(${ci})">СБРОС</button>
        </div>
        <div class="timer-progress" style="margin-top:0">
          <div class="timer-progress-fill${danger?' danger':''}" id="tmr-bar-${ci}" style="width:${pct}%"></div>
        </div>
      </div>
    </div>
    ${roundNavHtml ? `<div class="round-nav-inner" id="rnd-nav-${ci}">${roundNavHtml}</div>` : ''}
  </div>`;
}
