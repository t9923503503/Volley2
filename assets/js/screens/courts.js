'use strict';

// ── Мини-бейдж позиции игрока (для корта) ───────────────────
function manColorIdx(name) {
  if (!name) return 0;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return h % 5;
}

function playerRankBadge(name, gender) {
  const ranked = getAllRanked();
  const arr = ranked[gender];
  const p = arr.find(x => x.name === name);
  if (!p || p.pts === 0) return '';
  const keys = activeDivKeys();
  const divIdx = Math.min(Math.floor((p.globalRank - 1) / ppc), keys.length - 1);
  const divKey = keys[divIdx];
  const DIV_LABELS = { hard:'🔥HARD', advance:'⚡ADV', medium:'⚙️MED', lite:'🍀LITE' };
  const divCls = 'prb-' + divKey;
  return `<div class="p-rank-badge"><span class="pb ${pbCls(p.globalRank)}">${p.globalRank}${p.globalTied?'=':''}</span><span class="p-rank-badge-div ${divCls}">${DIV_LABELS[divKey]}</span><span>${p.pts}оч</span></div>`;
}

/* ── Round nav helpers: generate buttons with lock logic ──── */
function renderCourtNavInner(ci) {
  return Array.from({length:ppc}, (_, ri) => {
    const hasScores    = Array.from({length:ppc}, (_, mi) => scores[ci]?.[mi]?.[ri]).some(s => s !== null && s > 0);
    const isCur        = ri === (courtRound[ci] || 0);
    // Round N locked until round N-1 has at least one score
    const prevUnlocked = ri === 0 || Array.from({length:ppc}, (_, mi) => scores[ci]?.[mi]?.[ri-1]).some(s => s !== null && s > 0);
    return `<button class="rnd-btn${isCur?' active':''}${hasScores?' rnd-has-scores':''}"${prevUnlocked?'':' disabled'} id="rnd-${ci}-${ri}" onclick="setCourtRoundGuard(${ci},${ri})">
      <span class="rn-num">${ri+1}</span><span class="rn-lbl">РАУНД</span>
    </button>`;
  }).join('');
}

function renderDivNavInner(key) {
  const Nd = divRoster[key].men.length;
  return Array.from({length:Nd}, (_, ri) => {
    const hasScores    = Array.from({length:Nd}, (_, mi) => (divScores[key][mi]??[])[ri]).some(s => s !== null && s > 0);
    const isCur        = ri === (divRoundState[key] || 0);
    const prevUnlocked = ri === 0 || Array.from({length:Nd}, (_, mi) => (divScores[key][mi]??[])[ri-1]).some(s => s !== null && s > 0);
    return `<button class="rnd-btn${isCur?' active':''}${hasScores?' rnd-has-scores':''}"${prevUnlocked?'':' disabled'} id="rnd-${key}-${ri}" onclick="setDivRoundGuard('${key}',${ri})">
      <span class="rn-num">${ri+1}</span><span class="rn-lbl">РАУНД</span>
    </button>`;
  }).join('');
}

function renderCourt(ci) {
  const ct   = ALL_COURTS[ci];
  const meta = COURT_META[ci];
  const roundNavHtml = renderCourtNavInner(ci);

  let html = renderTimerBlock(ci, roundNavHtml) + `<div class="court-title" style="color:${meta.color}">${meta.name}</div>
  <div class="court-sub">нажимайте + и −</div>`;

  const curRi = courtRound[ci] || 0;
  for (let ri = 0; ri < ppc; ri++) {
    if (ri !== curRi) continue; // показываем только выбранный раунд
    html += `<div class="round-lbl">Раунд ${ri+1}</div>`;
    for (let i = 0; i < ppc; i++) {
      const mi = fixedPairs ? i : (i * 2 + ri) % ppc;
      const wi  = partnerW(mi, ri);
      const sc  = scores[ci]?.[mi]?.[ri] ?? null;
      const isNull = sc===null;
      const scVal = isNull ? 0 : sc;
      const mx  = scVal>=15, zr = !isNull && scVal===0;
      html += `
      <div class="match-card pair-${ci*ppc+mi}${(!isNull && scVal>0)?' has-score':''}" id="card-${ci}-${mi}-${ri}">
        <div class="match-card-inner">
          <div class="match-card-rows">
            <div class="mrow">
              <span class="g-icon">🏋️</span>
              <div class="p-info">
                <div class="p-name">${esc(ct.men[mi]||'—')}</div>
                ${ct.men[mi] ? playerRankBadge(ct.men[mi], 'M') : ''}
                <div class="p-partner">+ ${esc(ct.women[wi]||'—')}</div>
              </div>
              <div class="score-widget">
                <button class="score-btn minus" data-ci="${ci}" data-mi="${mi}" data-ri="${ri}" data-dir="-1"${(isNull||scVal<=0)?' disabled':''}>−</button>
                <div class="score-disp${mx?' mx':zr?' zr':isNull?' zr':''}" id="sd-${ci}-${mi}-${ri}">${isNull?'–':scVal}<span class="score-max-lbl">${mx?'МАХ':isNull?'':'/15'}</span></div>
              </div>
            </div>
            <div class="mrow auto-row">
              <span class="g-icon">👩</span>
              <div class="p-info">
                <div class="p-name">${esc(ct.women[wi]||'—')}</div>
                ${ct.women[wi] ? playerRankBadge(ct.women[wi], 'W') : ''}
                <div class="p-partner">+ ${esc(ct.men[mi]||'—')}</div>
              </div>
              <span class="auto-badge">AUTO</span>
              <div class="auto-score" id="as-${ci}-${wi}-${ri}">${isNull?'–':scVal}</div>
            </div>
          </div>
          <button class="score-btn plus" data-ci="${ci}" data-mi="${mi}" data-ri="${ri}" data-dir="1"${scVal>=15?' disabled':''}>+</button>
        </div>
      </div>`;
    }
  }
  html += `<button class="btn-reset-court" id="rcbtn-${ci}" onclick="resetCourtGuard(${ci},'↺ Сбросить очки ${escAttr(meta.name)}')">↺ Сбросить очки ${esc(meta.name)}</button>`;
  return html;
}

function setDivRound(key, ri) {
  divRoundState[key] = ri;
  const screen = document.getElementById(`screen-${key}`);
  if (screen) {
    const svod = getSvod();
    screen.innerHTML = renderDivCourt(key, svod[key].M, svod[key].W);
  }
}

/* ── Round-switch guard (double-tap to confirm) ──────────── */
let   _rndGuardPending = null;   // { btnId, fn }
const _rndGuardTimer   = {};

function _rndGuard(btnId, fn) {
  const btn = document.getElementById(btnId);
  if (!btn) { fn(); return; }
  if (btn.classList.contains('active')) return; // уже этот раунд — ничего делать

  // Если нажали другую кнопку — отменяем предыдущее ожидание
  if (_rndGuardPending && _rndGuardPending.btnId !== btnId) {
    clearTimeout(_rndGuardTimer[_rndGuardPending.btnId]);
    const prev = document.getElementById(_rndGuardPending.btnId);
    if (prev) {
      prev.classList.remove('rnd-confirming');
      prev.querySelector('.rn-num').textContent = prev.dataset.origNum;
    }
    _rndGuardPending = null;
  }

  if (_rndGuardPending && _rndGuardPending.btnId === btnId) {
    // Второе нажатие — подтверждаем переключение
    clearTimeout(_rndGuardTimer[btnId]);
    btn.classList.remove('rnd-confirming');
    btn.querySelector('.rn-num').textContent = btn.dataset.origNum;
    _rndGuardPending = null;
    fn();
  } else {
    // Первое нажатие — показываем запрос подтверждения
    const numEl = btn.querySelector('.rn-num');
    btn.dataset.origNum = numEl.textContent;
    numEl.textContent = '✓';
    btn.classList.add('rnd-confirming');
    _rndGuardPending = { btnId, fn };
    _rndGuardTimer[btnId] = setTimeout(() => {
      btn.classList.remove('rnd-confirming');
      numEl.textContent = btn.dataset.origNum;
      _rndGuardPending = null;
    }, 2000);
  }
}

function setCourtRoundGuard(ci, ri) {
  _rndGuard(`rnd-${ci}-${ri}`, () => setCourtRound(ci, ri));
}
function setDivRoundGuard(key, ri) {
  _rndGuard(`rnd-${key}-${ri}`, () => setDivRound(key, ri));
}

function setCourtRound(ci, ri) {
  courtRound[ci] = ri;
  // Обновляем экран корта без полного ребилда
  const slot = document.getElementById(`screen-${ci}`);
  if (slot) slot.innerHTML = renderCourt(ci);
}

function renderTotals(ci) {
  const ct   = ALL_COURTS[ci];
  const mr   = getRanked(ci,'M');
  const wr   = getRanked(ci,'W');
  let html = `<div class="totals-section" id="totals-${ci}">
    <div class="totals-title">🏆 ИТОГО — МУЖЧИНЫ</div>`;
  mr.forEach(r=>{
    html+=`<div class="totals-row">
      <div class="pb ${pbCls(r.place)}">${r.place}${r.tied?'<sup>=</sup>':''}</div>
      <div class="t-name">${esc(ct.men[r.idx]||'—')}</div>
      <div class="t-pts">${r.pts}</div><div class="t-lbl">оч</div>
    </div>`;
  });
  html+=`<div class="totals-title" style="border-top:1px solid #1e1e34">🏆 ИТОГО — ЖЕНЩИНЫ</div>`;
  wr.forEach(r=>{
    html+=`<div class="totals-row">
      <div class="pb ${pbCls(r.place)}">${r.place}${r.tied?'<sup>=</sup>':''}</div>
      <div class="t-name">${esc(ct.women[r.idx]||'—')}</div>
      <div class="t-pts">${r.pts}</div><div class="t-lbl">оч</div>
    </div>`;
  });
  html+=`</div>`;
  return html;
}

function updateDivisions() {
  const svod = getSvod();
  activeDivKeys().forEach(key => {
    const sM = svod[key].M;
    const sW = svod[key].W;
    const newMen   = sM.map(p=>p.name);
    const newWomen = sW.map(p=>p.name);
    // Reset div scores if roster changed
    const oldMen   = divRoster[key].men;
    const oldWomen = divRoster[key].women;
    if (JSON.stringify([...newMen].sort())!==JSON.stringify([...oldMen].sort()) ||
        JSON.stringify([...newWomen].sort())!==JSON.stringify([...oldWomen].sort())) {
      divRoster[key] = { men:newMen, women:newWomen };
      const Nd = Math.max(newMen.length, 1);
      // Не сбрасываем если в финале уже есть введённые очки
      const hasFinalsData = divScores[key]?.some(row => row?.some(v => v !== null && v > 0));
      if (!hasFinalsData) {
        divScores[key] = Array.from({length:Nd}, ()=>Array(Nd).fill(null));
      }
    }
    const screen = document.getElementById(`screen-${key}`);
    if (screen) {
      // Pass svod slices for chip display
      screen.innerHTML = renderDivCourt(key, sM, sW);
    }
  });
}

// ════════════════════════════════════════════════════════════
// 14. RENDER: DIVISION COURT
// ════════════════════════════════════════════════════════════
function renderDivCourt(key, svodM, svodW) {
  // Карта имя → originalCourtIndex для стабильного цвета
  const origIdxMap = {};
  [...(svodM||[]), ...(svodW||[])].forEach(p => { if (p && p.name) origIdxMap[p.name] = p.originalCourtIndex ?? 0; });

  const info = {
    hard:    { color:'#e94560', label:`🔥 HARD`,    sub:`Топ-${ppc} по результатам Сводки` },
    advance: { color:'#f5a623', label:`⚡ ADVANCE`, sub:`Места ${ppc+1}–${ppc*2} по результатам Сводки` },
    medium:  { color:'#4DA8DA', label:`⚙️ MEDIUM`,  sub:`Места ${ppc*2+1}–${ppc*3} по результатам Сводки` },
    lite:    { color:'#6ABF69', label:`🍀 LITE`,    sub:`Места ${ppc*3+1}+ по результатам Сводки` },
  }[key];

  const men   = divRoster[key].men;
  const women = divRoster[key].women;
  const Nd    = men.length;

  const dci = DIV_TIMER_IDX[key]; // индекс таймера для этого дивизиона

  // Empty state
  if (!Nd) {
    return renderTimerBlock(dci) +
      `<div class="div-title" style="color:${info.color}">${info.label}</div>
      <div class="div-empty">Недостаточно участников — введите очки на кортах Этапа 1</div>`;
  }

  // Round nav для дивизиона (с логикой блокировки)
  const divRoundNavHtml = renderDivNavInner(key);

  let html = renderTimerBlock(dci, divRoundNavHtml) +
    `<div class="div-title" style="color:${info.color}">${info.label}</div>`;

  // Round nav будет внутри таймер-блока (см. renderTimerBlock)

  // Show only current round
  const curDivRi = divRoundState[key] || 0;
  for (let ri = 0; ri < Nd; ri++) {
    if (ri !== curDivRi) continue;
    html+=`<div class="round-lbl">Раунд ${ri+1}</div>`;
    for (let i = 0; i < Nd; i++) {
      const mi = fixedPairs ? i : (i * 2 + ri) % Nd;
      const wi  = divPartnerW(mi, ri, Nd);
      const sc  = (divScores[key][mi]??[])[ri] ?? null;
      const isNull = sc===null;
      const scVal = isNull ? 0 : sc;
      const mx  = scVal>=15, zr = !isNull && scVal===0;
      html+=`
      <div class="match-card pair-${origIdxMap[men[mi]]??mi}${(!isNull && scVal>0)?' has-score':''}" id="dcard-${key}-${mi}-${ri}">
        <div class="match-card-inner">
          <div class="match-card-rows">
            <div class="mrow">
              <span class="g-icon">🏋️</span>
              <div class="p-info">
                <div class="p-name">${esc(men[mi]||'—')}</div>
                <div class="p-partner">+ ${esc(women[wi]||'—')}</div>
              </div>
              <div class="score-widget">
                <button class="score-btn minus" data-div="${key}" data-mi="${mi}" data-ri="${ri}" data-dir="-1"${(isNull||scVal<=0)?' disabled':''}>−</button>
                <div class="score-disp${mx?' mx':zr?' zr':isNull?' zr':''}" id="dsd-${key}-${mi}-${ri}">${isNull?'–':scVal}<span class="score-max-lbl">${mx?'МАХ':isNull?'':'/15'}</span></div>
              </div>
            </div>
            <div class="mrow auto-row">
              <span class="g-icon">👩</span>
              <div class="p-info"><div class="p-name">${esc(women[wi]||'—')}</div></div>
              <span class="auto-badge">AUTO</span>
              <div class="auto-score" id="das-${key}-${wi}-${ri}">${isNull?'–':scVal}</div>
            </div>
          </div>
          <button class="score-btn plus" data-div="${key}" data-mi="${mi}" data-ri="${ri}" data-dir="1"${scVal>=15?' disabled':''}>+</button>
        </div>
      </div>`;
    }
  }

  html+=`<button class="btn-reset-court" id="rcbtn-${key}" onclick="resetDivGuard('${key}','↺ Сброс очков ${info.label}')">↺ Сброс очков ${info.label}</button>`;
  return html;
}
