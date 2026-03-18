'use strict';

// ════════════════════════════════════════════════════════════
// 2. CORE MATH
// ════════════════════════════════════════════════════════════
function partnerW(mi, ri){ return fixedPairs ? mi : (mi + ri) % ppc; }
function partnerM(wi, ri){ return fixedPairs ? wi : ((wi - ri) % ppc + ppc) % ppc; }

function manRounds(ci, mi) {
  return Array.from({length:ppc}, (_,ri) => scores[ci]?.[mi]?.[ri] ?? null);
}
function womanRounds(ci, wi) {
  return Array.from({length:ppc}, (_,ri) => scores[ci]?.[partnerM(wi,ri)]?.[ri] ?? null);
}

// Returns sorted array for a single court+gender
// Tie-breaking: pts → bestRound → wins → stable index
function getRanked(ci, gender) {
  const arr = [];
  for (let i = 0; i < ppc; i++) {
    const rounds = gender === 'M' ? manRounds(ci, i) : womanRounds(ci, i);
    const played    = rounds.filter(r=>r!==null);
    const pts       = played.reduce((a,b)=>a+b, 0);
    const bestRound = played.length > 0 ? Math.max(...played) : 0;
    const wins      = played.filter(r=>r>=8).length;
    const rPlayed   = played.length;
    arr.push({ idx:i, pts, bestRound, wins, rPlayed });
  }
  arr.sort((a,b) => {
    if (b.pts       !== a.pts)       return b.pts       - a.pts;
    if (b.bestRound !== a.bestRound) return b.bestRound - a.bestRound;
    if (b.wins      !== a.wins)      return b.wins      - a.wins;
    return a.idx - b.idx; // stable
  });
  // Assign place with tie marker
  arr.forEach((x, i, s) => {
    const tied = i > 0 && s[i].pts === s[i-1].pts;
    x.place = tied ? s[i-1].place : i + 1;
    x.tied  = tied;
  });
  return arr;
}

// Global ranking across all active courts
function getAllRanked() {
  const out = { M:[], W:[] };
  for (const gender of ['M','W']) {
    const all = [];
    for (let ci = 0; ci < nc; ci++) {
      const ct   = ALL_COURTS[ci];
      const meta = COURT_META[ci];
      getRanked(ci, gender).forEach(r => {
        const rounds = gender==='M' ? manRounds(ci,r.idx) : womanRounds(ci,r.idx);
        all.push({
          pts: r.pts, bestRound: r.bestRound, wins: r.wins,
          rPlayed: r.rPlayed, courtPlace: r.place, tied: r.tied,
          name:      gender==='M' ? ct.men[r.idx]   : ct.women[r.idx],
          courtName: meta.name, courtColor: meta.color,
          gender, genderIcon: gender==='M' ? '🏋️' : '👩',
          originalCourtIndex: ci * ppc + r.idx,
        });
      });
    }
    // Global sort with same tie-breaking
    all.sort((a,b) => {
      if (b.pts       !== a.pts)       return b.pts       - a.pts;
      if (b.bestRound !== a.bestRound) return b.bestRound - a.bestRound;
      if (b.wins      !== a.wins)      return b.wins      - a.wins;
      return a.originalCourtIndex - b.originalCourtIndex;
    });
    // Assign global rank (shared rank for equal pts)
    all.forEach((p,i,arr) => {
      const tied = i > 0 && arr[i].pts === arr[i-1].pts;
      p.globalRank = tied ? arr[i-1].globalRank : i + 1;
      p.globalTied = tied;
    });
    out[gender] = all;
  }
  return out;
}

// Compute svod slices — CORE SLICE MATH
// HARD:    [0 .. ppc-1]           → global places 1..ppc
// ADVANCE: [ppc .. ppc*2-1]      → global places ppc+1 .. ppc*2
// MEDIUM:  [ppc*2 .. ppc*3-1]    → global places ppc*2+1 .. ppc*3
// LITE:    [ppc*3 .. end]         → global places ppc*3+1 ..
function getSvod() {
  const ranked = getAllRanked();
  const keys = activeDivKeys();
  const result = { hard:{M:[],W:[]}, advance:{M:[],W:[]}, medium:{M:[],W:[]}, lite:{M:[],W:[]} };
  // Distribute players evenly across active divisions, last div gets remainder
  keys.forEach((key, i) => {
    const isLast = i === keys.length - 1;
    const start  = i * ppc;
    const end    = isLast ? undefined : start + ppc;
    result[key] = { M: ranked.M.slice(start, end), W: ranked.W.slice(start, end) };
  });
  return result;
}

// Division court helpers
function divPartnerW(mi, ri, Nd){ return (mi + ri) % Nd; }
function divPartnerM(wi, ri, Nd){ return ((wi - ri) % Nd + Nd) % Nd; }

function divManRounds(key, mi) {
  const Nd = divRoster[key].men.length;
  return Array.from({length:Nd}, (_,ri) => (divScores[key][mi]??[])[ri] ?? null);
}
function divWomanRounds(key, wi) {
  const Nd = divRoster[key].men.length;
  return Array.from({length:Nd}, (_,ri) => {
    const mi = divPartnerM(wi, ri, Nd);
    return (divScores[key][mi]??[])[ri] ?? null;
  });
}
function divGetRanked(key, gender) {
  const names = gender==='M' ? divRoster[key].men : divRoster[key].women;
  const Nd = names.length;
  if (!Nd) return [];
  return names.map((name,i) => {
    const rounds = gender==='M' ? divManRounds(key,i) : divWomanRounds(key,i);
    const played = rounds.filter(r=>r!==null);
    return { idx:i, name, pts: played.reduce((a,b)=>a+b,0), bestRound: played.length>0?Math.max(...played):0, rPlayed:played.length };
  }).sort((a,b) => b.pts!==a.pts ? b.pts-a.pts : b.bestRound-a.bestRound)
    .map((x,i)=>({ ...x, place:i+1 }));
}


// ════════════════════════════════════════════════════════════
// 2b. COMBINED STATS HELPER
// Returns all played round scores for a player across Stage 1 + Finals
// ════════════════════════════════════════════════════════════
function getAllRoundsForPlayer(p) {
  const allRounds = [];
  // Stage 1 rounds
  for (let ci = 0; ci < nc; ci++) {
    const arr = p.gender === 'M' ? ALL_COURTS[ci].men : ALL_COURTS[ci].women;
    const idx = arr.findIndex((n, i) => n === p.name &&
      (p.gender === 'M' ? manRounds(ci, i) : womanRounds(ci, i)).some(r => r !== null));
    if (idx >= 0) {
      const rds = (p.gender === 'M' ? manRounds(ci, idx) : womanRounds(ci, idx))
        .filter(r => r !== null);
      allRounds.push(...rds);
      break;
    }
  }
  // Finals rounds — search all divisions
  for (const key of activeDivKeys()) {
    const arr = p.gender === 'M' ? divRoster[key].men : divRoster[key].women;
    const idx = arr.indexOf(p.name);
    if (idx >= 0) {
      const rds = (p.gender === 'M' ? divManRounds(key, idx) : divWomanRounds(key, idx))
        .filter(r => r !== null);
      allRounds.push(...rds);
      break;
    }
  }
  return allRounds;
}

// ════════════════════════════════════════════════════════════
// 3. PERSISTENCE
// ════════════════════════════════════════════════════════════
function saveState() {
  try {
    localStorage.setItem('kotc_version',     '1.1');
    localStorage.setItem('kotc3_cfg',        JSON.stringify({ ppc, nc, fixedPairs }));
    localStorage.setItem('kotc3_scores',     JSON.stringify(scores));
    localStorage.setItem('kotc3_roster',     JSON.stringify(ALL_COURTS.map(c=>({men:[...c.men],women:[...c.women]}))));
    localStorage.setItem('kotc3_divscores',  JSON.stringify(divScores));
    localStorage.setItem('kotc3_divroster',  JSON.stringify(divRoster));
    localStorage.setItem('kotc3_meta',       JSON.stringify(tournamentMeta));
    localStorage.setItem('kotc3_eventlog',   JSON.stringify(tournamentHistory));
  } catch(e){ console.error('[saveState] Failed to persist state:', e); }
  sbPush(); // синхронизировать с Supabase
}

function loadState() {
  try {
    // Version migration: if old version or no version, clear scores to avoid corruption
    const ver = localStorage.getItem('kotc_version');
    const verNum = ver ? ver.split('.').map(Number).reduce((a, v, i) => a + v * Math.pow(100, 2 - i), 0) : 0;
    if (verNum < 101) {
      ['kotc3_scores','kotc3_divscores','kotc3_divroster'].forEach(k=>localStorage.removeItem(k));
      localStorage.setItem('kotc_version','1.1');
    }
    const cfg = localStorage.getItem('kotc3_cfg');
    if (cfg) {
      const p = JSON.parse(cfg);
      if ([4,5].includes(+p.ppc))           { ppc = +p.ppc; _ppc = ppc; }
      if ([1,2,3,4].includes(+p.nc))        { nc  = +p.nc;  _nc  = nc;  }
      if (typeof p.fixedPairs === 'boolean') fixedPairs = p.fixedPairs;
    }
    const r = localStorage.getItem('kotc3_roster');
    if (r) {
      const pr = JSON.parse(r);
      if (Array.isArray(pr)) pr.forEach((ct,ci) => {
        if (ci < 4) {
          if (Array.isArray(ct.men))   ALL_COURTS[ci].men   = ct.men.slice(0,5);
          if (Array.isArray(ct.women)) ALL_COURTS[ci].women = ct.women.slice(0,5);
        }
      });
    }
    const sc = localStorage.getItem('kotc3_scores');
    if (sc) {
      const ps = JSON.parse(sc);
      if (Array.isArray(ps)) ps.forEach((court,ci) => {
        if (ci >= 4 || !Array.isArray(court)) return;
        court.forEach((row,mi) => {
          if (mi >= 5 || !Array.isArray(row)) return;
          row.forEach((val,ri) => {
            if (ri < ppc && scores[ci]?.[mi]) scores[ci][mi][ri] = (val === null || val === undefined) ? null : Number(val);
          });
        });
      });
    }
    const ds = localStorage.getItem('kotc3_divscores');
    if (ds) { const pd=JSON.parse(ds); if(pd) DIV_KEYS.forEach(k=>{if(pd[k]) divScores[k]=pd[k];}); }
    const dr = localStorage.getItem('kotc3_divroster');
    const mt = localStorage.getItem('kotc3_meta');
    if (mt) { try { tournamentMeta = JSON.parse(mt); } catch(e){} }
    if (dr) { const pd=JSON.parse(dr); if(pd) DIV_KEYS.forEach(k=>{if(pd[k]) divRoster[k]=pd[k];}); }
    const hs = localStorage.getItem('kotc3_eventlog');
    if (hs) { try { tournamentHistory = JSON.parse(hs) || []; } catch(e){ console.error('[loadState] eventlog parse error:', e); } }
  } catch(e){ console.error('[loadState] Failed to restore state:', e); }
}

// ── Finish & archive tournament ────────────────────────────
async function finishTournament() {
  const name = tournamentMeta.name.trim() || 'Без названия';
  const date = tournamentMeta.date || new Date().toISOString().split('T')[0];

  // Warn if temporary players are in the active roster
  const tempCount = (loadPlayerDB() || []).filter(p => p.status === 'temporary').length;
  const tempWarn  = tempCount > 0
    ? `\n\n⚠️ В базе ${tempCount} временных игрок(а). Перейдите в Ростер → Администрирование, чтобы слить их с реальными профилями.`
    : '';

  const confirmed = await showConfirm(
    `Завершить турнир «${name}»?\n\nРезультаты сохранятся в архиве.\nТекущие очки и ростер останутся.${tempWarn}`
  );
  if (!confirmed) return;

  // Build snapshot
  const ranked = getAllRanked();
  const allP   = [...ranked.M, ...ranked.W];

  // Enrich with totals (Stage 1 + Finals)
  const players = allP.map(p => {
    const rds = getAllRoundsForPlayer(p);
    const totalPts = rds.reduce((a,b)=>a+b,0);
    return { name: p.name, gender: p.gender, totalPts, courtName: p.courtName };
  }).filter(p => p.totalPts > 0)
    .sort((a,b) => b.totalPts - a.totalPts);

  const totalScore = players.reduce((s,p)=>s+p.totalPts,0);
  const rPlayed = (() => {
    let s=0;
    for(let ci=0;ci<nc;ci++) s+=scores[ci].flat().filter(x=>x!==null).length;
    return s;
  })();

  // ── Compute highlights for snapshot ────────────────────────
  // Best individual round
  let bestRound = null;
  for (let ci = 0; ci < nc; ci++) {
    for (let mi = 0; mi < ppc; mi++) {
      for (let ri = 0; ri < ppc; ri++) {
        const sc = scores[ci]?.[mi]?.[ri];
        if (sc != null && (!bestRound || sc > bestRound.score)) {
          bestRound = { name: ALL_COURTS[ci].men[mi], gender: 'M', score: sc, round: ri };
        }
      }
    }
    // Women scores are derived from men's — check partner mapping
    for (let wi = 0; wi < ppc; wi++) {
      for (let ri = 0; ri < ppc; ri++) {
        const mi = partnerM(wi, ri);
        const sc = scores[ci]?.[mi]?.[ri];
        if (sc != null && (!bestRound || sc > bestRound.score)) {
          bestRound = { name: ALL_COURTS[ci].women[wi], gender: 'W', score: sc, round: ri };
        }
      }
    }
  }

  // Best pair (man + woman with highest combined score)
  const pairMap = {};
  for (let ci = 0; ci < nc; ci++) {
    const ct = ALL_COURTS[ci];
    for (let mi = 0; mi < ppc; mi++) {
      for (let ri = 0; ri < ppc; ri++) {
        const sc = scores[ci]?.[mi]?.[ri];
        if (!sc) continue;
        const man = ct.men[mi], woman = ct.women[partnerW(mi, ri)];
        if (!man || !woman) continue;
        const k = `${man}\x00${woman}`;
        pairMap[k] = (pairMap[k] || 0) + sc;
      }
    }
  }
  // Include division scores
  DIV_KEYS.forEach(dkey => {
    const men = divRoster[dkey].men, women = divRoster[dkey].women, Nd = men.length;
    if (!Nd) return;
    for (let mi = 0; mi < Nd; mi++) {
      for (let ri = 0; ri < Nd; ri++) {
        const sc = (divScores[dkey][mi] ?? [])[ri] ?? null;
        if (!sc) continue;
        const man = men[mi], woman = women[divPartnerW(mi, ri, Nd)];
        if (!man || !woman) continue;
        const k = `${man}\x00${woman}`;
        pairMap[k] = (pairMap[k] || 0) + sc;
      }
    }
  });
  let bestPair = null;
  for (const [key, pts] of Object.entries(pairMap)) {
    if (!bestPair || pts > bestPair.totalPts) {
      const [man, woman] = key.split('\x00');
      bestPair = { man, woman, totalPts: pts };
    }
  }

  // Court stats
  const courtStats = Array.from({length: nc}, (_, ci) => {
    const flat = scores[ci].flat().filter(x => x !== null);
    const total = flat.reduce((s, x) => s + x, 0);
    return {
      name: (COURT_META[ci] || {}).name || `Корт ${ci + 1}`,
      totalPts: total,
      avgPts: flat.length ? (total / flat.length).toFixed(1) : '0',
    };
  });

  const snapshot = {
    id:        Date.now(),
    name,
    date,
    ppc,
    nc,
    players,
    totalScore,
    rPlayed,
    savedAt:   new Date().toISOString(),
    mvpName:   players[0]?.name || '',
    avgScore:  players.length && rPlayed ? (totalScore / (players.length * rPlayed)).toFixed(1) : '0',
    bestRound,
    bestPair,
    courtStats,
  };

  // Load history, prepend, save (max 200 entries to prevent localStorage overflow)
  const MAX_HISTORY = 200;
  let history = [];
  try { history = JSON.parse(localStorage.getItem('kotc3_history') || '[]'); } catch(e){}
  history.unshift(snapshot);
  if (history.length > MAX_HISTORY) {
    history = history.slice(0, MAX_HISTORY);
    AppLogger.warn('core', `История турниров обрезана до ${MAX_HISTORY} записей`);
  }
  try {
    localStorage.setItem('kotc3_history', JSON.stringify(history));
    // Warn if localStorage usage exceeds ~4MB (out of typical 5-10MB limit)
    const usageEstimate = new Blob(Object.values(localStorage)).size;
    if (usageEstimate > 4 * 1024 * 1024) {
      showToast('⚠️ LocalStorage заполнен более чем на 80% — рекомендуется экспорт и очистка старых турниров');
    }
  } catch (e) {
    AppLogger.error('core', 'Не удалось сохранить историю турниров (localStorage переполнен?)', e);
    showToast('❌ Не удалось сохранить турнир: хранилище переполнено. Удалите старые записи.');
  }

  showToast('🏆 Турнир сохранён в архиве!');
  // Recalc ratings first so sbPublishTournament sends up-to-date stats
  recalcAllPlayerStats(/*silent*/ true);
  // Sync players to database (legacy quick sync)
  syncPlayersFromTournament(players, date);
  // Publish results to Supabase (public — visible to all site visitors)
  if (sbEnsureClient()) {
    sbPublishTournament(snapshot).catch(e => console.warn('sbPublishTournament:', e));
  }
  // Auto-export to Google Sheets if connected
  if (gshIsConnected()) {
    gshExportTournament(snapshot, null).catch(()=>{});
  }
  // Refresh stats if currently open
  const statsScreen = document.getElementById('screen-stats');
  if (statsScreen && statsScreen.classList.contains('active')) {
    statsScreen.innerHTML = renderStats();
  }
}

async function resetTournament() {
  if (!await showConfirm('Сбросить ВСЕ результаты?\n\nРостер сохранится, все очки обнулятся.')) return;
  scores    = makeBlankScores();
  divScores = makeBlankDivScores();
  divRoster = makeBlankDivRoster();
  ['kotc3_scores','kotc3_divscores','kotc3_divroster'].forEach(k=>localStorage.removeItem(k));
  for (let i = 0; i < 8; i++) timerReset(i);
  buildAll();
  switchTab(0);
  showToast('🗑 Турнир сброшен');
}

// ════════════════════════════════════════════════════════════
// 4. DROPDOWN ENGINE
// ════════════════════════════════════════════════════════════
// Key design: .dropdown elements live in <body>,
// positioned via getBoundingClientRect() — never clipped by nav overflow.

let openDropdownId = null;

function openDropdown(id, anchorEl) {
  closeDropdown();
  const menu = document.getElementById(id);
  if (!menu) return;
  const rect = anchorEl.getBoundingClientRect();
  menu.style.left = Math.min(rect.left, window.innerWidth - 170) + 'px';
  menu.style.top  = rect.bottom + 'px';
  menu.classList.add('open');
  anchorEl.classList.add('dd-open');
  document.getElementById('dd-backdrop').classList.add('open');
  openDropdownId = id;
}

function closeDropdown() {
  if (openDropdownId) {
    const m = document.getElementById(openDropdownId);
    if (m) m.classList.remove('open');
  }
  document.querySelectorAll('.nb').forEach(b=>b.classList.remove('dd-open'));
  document.getElementById('dd-backdrop').classList.remove('open');
  openDropdownId = null;
}

document.getElementById('dd-backdrop').addEventListener('click', closeDropdown);

function toggleDropdown(id, btn) {
  if (openDropdownId === id) { closeDropdown(); return; }
  openDropdown(id, btn);
}

// ════════════════════════════════════════════════════════════
// 5. NAVIGATION BUILD — pill buttons
// ════════════════════════════════════════════════════════════
function hasRound5Score() {
  const lastRi = ppc - 1;
  for (let ci = 0; ci < nc; ci++) {
    for (let mi = 0; mi < ppc; mi++) {
      if ((scores[ci]?.[mi]?.[lastRi] ?? null) > 0) return true;
    }
  }
  return false;
}

function syncDivLock() {
  // IPT mode: unlock Phase 2 buttons only when phase2Groups exist
  const trnId   = typeof _iptActiveTrnId !== 'undefined' ? _iptActiveTrnId : null;
  const iptTrn  = trnId ? getTournaments().find(t => t.id === trnId) : null;
  if (iptTrn?.ipt?.groups) {
    const p2Groups = iptTrn.ipt.phase2Groups;
    const tipLocked = 'Завершите все группы Фазы 1, чтобы открыть финалы';
    const TAB_TO_NAME = { hard: 'ХАРД', advance: 'АДВАНС', medium: 'МЕДИУМ', lite: 'ЛАЙТ' };
    document.querySelectorAll('.pill-div-btn').forEach(p => {
      const name = TAB_TO_NAME[p.dataset.tab];
      const group = p2Groups ? p2Groups.find(g => g.name === name) : null;
      const active = group && group.status !== 'skip';
      p.classList.toggle('pill-div-locked', !active);
      p.title = active ? '' : tipLocked;
    });
    return;
  }
  // KotC mode: unlock after round 5 has scores
  const unlocked = hasRound5Score();
  const tip = `Добавьте очки в раунде ${ppc} на кортах 1–${nc}, чтобы открыть`;
  document.querySelectorAll('.pill-div-btn').forEach(p => {
    p.classList.toggle('pill-div-locked', !unlocked);
    p.title = unlocked ? '' : tip;
  });
}

function buildNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = '';

  // ── Верхняя строка: лого + утилиты ──────────────────────
  const top = document.createElement('div');
  top.className = 'nav-top';

  const logo = document.createElement('div');
  logo.id = 'nav-logo';
  logo.className = 'nav-logo-container';
  logo.innerHTML = '<div class="brand-main">ЛЮТЫЕ ПЛЯЖНИКИ !!</div><div class="brand-sub">King of the Court</div>';
  logo.setAttribute('role', 'button');
  logo.setAttribute('title', 'На главную');
  logo.addEventListener('click', () => switchTab('home'));
  top.appendChild(logo);

  const spacer = document.createElement('div');
  spacer.className = 'nav-spacer';
  top.appendChild(spacer);


  [
    { label:'🏠',   tab:'home'    },
    { label:'👤',   tab:'players' },
    { label:'СВОД', tab:'svod'    },
    { label:'СТАТ', tab:'stats'   },
    { label:'👥',   tab:'rating'  },
    { label:'⚙️',   tab:'roster'  },
  ].forEach(({label,tab}) => {
    const b = document.createElement('button');
    b.className = 'nb'; b.dataset.tab = tab;
    b.textContent = label;
    b.addEventListener('click', ()=>switchTab(tab));
    top.appendChild(b);
  });
  nav.appendChild(top);

  // ── Ряд пиллов: корты + разделитель + дивизионы ─────────
  const row = document.createElement('div');
  row.className = 'nav-pills-row';

  for (let ci = 0; ci < nc; ci++) {
    const meta = COURT_META[ci];
    const p = document.createElement('button');
    p.className = 'nav-pill'; p.dataset.tab = ci;
    p.style.setProperty('--pill-c', meta.color);
    p.innerHTML = `<span class="pill-dot"></span><span class="pill-main">К${ci+1}</span><span class="pill-sub">КОРТ</span>`;
    p.addEventListener('click', ()=>switchTab(ci));
    row.appendChild(p);
  }

  const sep = document.createElement('div');
  sep.className = 'nav-pill-sep';
  row.appendChild(sep);

  const ALL_DIV_DEFS = {
    hard:    { icon:'🔥', main:'HD', sub:'ТОП',     color:'#e94560' },
    advance: { icon:'⚡', main:'AV', sub:'2-й ЭШ.', color:'#f5a623' },
    medium:  { icon:'⚙️', main:'MD', sub:'3-й ЭШ.', color:'#4DA8DA' },
    lite:    { icon:'🍀', main:'LT', sub:'4-й ЭШ.', color:'#6ABF69' },
  };
  activeDivKeys().map(id => ({id, ...ALL_DIV_DEFS[id]})).forEach(({id,icon,main,sub,color}) => {
    const p = document.createElement('button');
    p.className = 'nav-pill pill-div-btn'; p.dataset.tab = id;
    p.style.setProperty('--pill-c', color);
    p.innerHTML = `<span class="pill-dot"></span><span class="pill-main">${icon} ${main}</span><span class="pill-sub">${sub}</span>`;
    p.addEventListener('click', ()=>switchTab(id));
    row.appendChild(p);
  });

  nav.appendChild(row);


  syncNavActive();
  syncDivLock();
}

function syncNavActive() {
  // Utility buttons (nb)
  document.querySelectorAll('.nb[data-tab]').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === String(activeTabId));
  });
  // Pill buttons
  document.querySelectorAll('.nav-pill[data-tab]').forEach(p => {
    p.classList.toggle('active', p.dataset.tab === String(activeTabId));
  });
  syncIPTNav();
}

/** Update court pill labels when IPT is active (К1 → ХАРД etc.) */
function syncIPTNav() {
  const trnId = typeof _iptActiveTrnId !== 'undefined' ? _iptActiveTrnId : null;
  const trn   = trnId ? getTournaments().find(t => t.id === trnId) : null;
  const groups   = trn?.ipt?.groups;
  const p2Groups = trn?.ipt?.phase2Groups;

  // Phase 1 court pills: show only groups.length pills, hide extras
  document.querySelectorAll('.nav-pill[data-tab]').forEach(pill => {
    const tab = parseInt(pill.dataset.tab);
    if (isNaN(tab)) return;
    const subEl = pill.querySelector('.pill-sub');
    if (!subEl) return;
    if (groups) {
      pill.style.display = tab < groups.length ? '' : 'none';
      subEl.textContent = groups[tab] ? groups[tab].name : 'КОРТ';
    } else {
      pill.style.display = '';
      subEl.textContent = 'КОРТ';
    }
  });

  // Phase 2 div pills: show only expected tabs for this IPT format
  // 2 groups → hard+lite, 4 groups → all four
  const TAB_TO_NAME = { hard: 'ХАРД', advance: 'АДВАНС', medium: 'МЕДИУМ', lite: 'ЛАЙТ' };
  const P2_TABS = { 2: ['hard','lite'], 3: ['hard','advance','lite'], 4: ['hard','advance','medium','lite'] };
  const expectedTabs = groups ? (P2_TABS[groups.length] || ['hard','advance','medium','lite']) : null;
  document.querySelectorAll('.pill-div-btn[data-tab]').forEach(pill => {
    const tabId = pill.dataset.tab;
    if (expectedTabs) {
      pill.style.display = expectedTabs.includes(tabId) ? '' : 'none';
    } else {
      pill.style.display = '';
    }
    if (!p2Groups) return;
    const g = p2Groups.find(pg => pg.name === TAB_TO_NAME[tabId]);
    if (!g) return;
    const subEl = pill.querySelector('.pill-sub');
    if (!subEl) return;
    subEl.textContent = g.status === 'finished' ? '✅ ГОТОВО'
      : g.status === 'skip' ? '—'
      : 'ФИНАЛ';
  });
}

// ════════════════════════════════════════════════════════════
// 6. SCREENS BUILD
// ════════════════════════════════════════════════════════════
function buildScreens() {
  const sc = document.getElementById('screens');
  sc.innerHTML = '';

  // Corт screens (0..3, always created, hidden for ci >= nc)
  for (let ci = 0; ci < 4; ci++) {
    const s = document.createElement('div');
    s.className = 'screen'; s.id = `screen-${ci}`;
    s.innerHTML = ci < nc ? renderCourt(ci) : '';
    sc.appendChild(s);
  }

  // Named screens
  const named = ['home','players','svod','hard','advance','medium','lite','stats','rating','roster','ipt'];
  named.forEach(id => {
    const s = document.createElement('div');
    s.className = 'screen'; s.id = `screen-${id}`;
    sc.appendChild(s);
  });
}

function buildAll() {
  buildNav();
  buildScreens();
  updateDivisions();
  attachListeners();
  attachSwipe();
  // ── Roster FAB ──
  if (!document.getElementById('roster-fab')) {
    const fab = document.createElement('button');
    fab.id = 'roster-fab';
    fab.className = 'roster-fab';
    fab.title = 'Ростер';
    fab.textContent = '⚙️';
    fab.addEventListener('click', () => switchTab('roster'));
    document.body.appendChild(fab);
  }
}

// Перерисовка с сохранением позиции прокрутки и фокуса (debounced)
let _safeRenderRaf = null;
function safeRender() {
  if (_safeRenderRaf) return; // coalesce rapid calls
  _safeRenderRaf = requestAnimationFrame(() => {
    _safeRenderRaf = null;
    const _scrollPos = window.scrollY;
    const _focusId   = document.activeElement?.id;
    const _focusSel  = [document.activeElement?.selectionStart, document.activeElement?.selectionEnd];
    buildAll();
    switchTab(activeTabId != null ? activeTabId : 0);
    window.scrollTo(0, _scrollPos);
    if (_focusId) {
      const el = document.getElementById(_focusId);
      if (el) { el.focus(); try { el.setSelectionRange(_focusSel[0], _focusSel[1]); } catch(e){} }
    }
  });
}


// ════════════════════════════════════════════════════════════
// 7. TAB SWITCHING
// ════════════════════════════════════════════════════════════
let _switchTabBusy = false;
async function switchTab(id) {
  if (_switchTabBusy) return;
  _switchTabBusy = true;
  try { await _switchTabInner(id); } finally { _switchTabBusy = false; }
}
async function _switchTabInner(id) {
  closeDropdown();
  // Если запрошен неактивный дивизион — перенаправляем на первый активный
  if (typeof id === 'string' && DIV_KEYS.includes(id) && !activeDivKeys().includes(id)) {
    id = activeDivKeys()[0] || 0;
  }
  const prevTabId = activeTabId;
  activeTabId = id;

  // Hide all, show target
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const screen = document.getElementById(`screen-${id}`);
  if (!screen) return;

  // ── IPT mode: override court/division screens ─────────────
  const _iptTrnId = typeof _iptActiveTrnId !== 'undefined' ? _iptActiveTrnId : null;
  const _iptTrn   = _iptTrnId ? getTournaments().find(t => t.id === _iptTrnId) : null;
  if (_iptTrn?.ipt?.groups) {
    if (typeof id === 'number' && _iptTrn.ipt.groups[id]) {
      screen.innerHTML = renderIPTGroup(id);
      screen.classList.add('active');
      syncNavActive();
      window.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }
    const _TAB_TO_P2_NAME = { hard: 'ХАРД', advance: 'АДВАНС', medium: 'МЕДИУМ', lite: 'ЛАЙТ' };
    if (id in _TAB_TO_P2_NAME) {
      const fi = _iptTrn.ipt.phase2Groups?.findIndex(g => g.name === _TAB_TO_P2_NAME[id]) ?? -1;
      // Phase 2 group (live play)
      if (fi >= 0 && _iptTrn.ipt.phase2Groups[fi]) {
        screen.innerHTML = renderIPTPhase2Group(fi);
        screen.classList.add('active');
        syncNavActive();
        window.scrollTo({ top: 0, behavior: 'auto' });
        return;
      }
      // Phase 1 not yet complete — nothing to show for this div tab
      return;
    }
  }

  // Re-render content on demand
  if (id === 'home')    screen.innerHTML = renderHome();
  if (id === 'players') { playersSearch=''; recalcAllPlayerStats(true); screen.innerHTML = renderPlayers(); }
  if (id === 'svod')    screen.innerHTML = renderSvod();
  if (id === 'roster') {
    if (hasRosterPassword() && !rosterUnlocked) {
      screen.classList.add('active');
      syncNavActive();
      const ok = await rosterRequestUnlock({ successMessage: '' });
      if (!ok) {
        activeTabId = prevTabId;
        switchTab(prevTabId != null ? prevTabId : 'svod');
        return;
      }
    }
    historyFilter = 'all'; // сбросить фильтр при открытии ростера
    screen.innerHTML = renderRoster();
  }
  if (id === 'stats')  screen.innerHTML = renderStats();
  if (id === 'ipt')    screen.innerHTML = renderIPT();
  if (id === 'rating') screen.innerHTML = renderRating();
  if (id === 'hard' || id === 'advance' || id === 'medium' || id === 'lite') {
    if (!hasRound5Score()) {
      showToast(`🔒 Добавьте очки в раунде ${ppc} на кортах 1–${nc}`);
      activeTabId = prevTabId;
      syncNavActive();
      return;
    }
    updateDivisions();
  }

  screen.classList.add('active');
  syncNavActive();
  window.scrollTo({top:0, behavior:'auto'});
}
