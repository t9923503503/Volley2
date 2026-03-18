'use strict';

// Авто-загрузка из data/leaderboard.json — один раз за сессию, тихо.
// Пропускается если ростер разблокирован (админ управляет данными сам).
let _autoImportDone = false;
async function _autoImportPublicData() {
  if (_autoImportDone || (typeof rosterUnlocked !== 'undefined' && rosterUnlocked)) return;
  _autoImportDone = true;
  try {
    const r = await fetch('./data/leaderboard.json?_=' + Date.now());
    if (!r.ok) return; // файл отсутствует — не ошибка
    const data = await r.json();
    ['M', 'W'].forEach(div => {
      (Array.isArray(data[div]) ? data[div] : []).forEach(entry => {
        if (!entry.name) return;
        const ratingField = div === 'M' ? 'ratingM' : 'ratingW';
        const trnField    = div === 'M' ? 'tournamentsM' : 'tournamentsW';
        upsertPlayerInDB({ name: entry.name, gender: div,
          [ratingField]: entry.rating      || 0,
          [trnField]:    entry.tournaments || 0,
          wins:          entry.wins        || 0,
          lastSeen:      entry.last_seen   || '',
          status:        'active' });
      });
    });
    (Array.isArray(data.Mix) ? data.Mix : []).forEach(entry => {
      if (!entry.name) return;
      upsertPlayerInDB({ name: entry.name, gender: entry.gender || 'M',
        ratingMix:      entry.rating      || 0,
        tournamentsMix: entry.tournaments || 0,
        wins:           entry.wins        || 0,
        lastSeen:       entry.last_seen   || '',
        status:         'active' });
    });
    // Перерисовать экран если он активен
    const s = document.getElementById('screen-players');
    if (s && s.classList.contains('active')) s.innerHTML = renderPlayers();
  } catch(e) { /* нет файла или сеть недоступна — молча пропускаем */ }
}

function renderPlayers() {
  const db = loadPlayerDB();
  const g  = playersGender; // 'M' | 'W' | 'Mix'
  const q  = playersSearch.trim().toLowerCase();

  // Rating/tournament field names for current tab
  const ratingField = g === 'M' ? 'ratingM' : g === 'W' ? 'ratingW' : 'ratingMix';
  const trnField    = g === 'M' ? 'tournamentsM' : g === 'W' ? 'tournamentsW' : 'tournamentsMix';

  // Players for current tab
  const all = g === 'Mix'
    ? db.filter(p => (p.ratingMix||0) > 0 || (p.tournamentsMix||0) > 0)
    : db.filter(p => p.gender === g);

  const sortFn = playersSort === 'trn' ? (a,b) => (b[trnField]||0) - (a[trnField]||0)
               : playersSort === 'avg' ? (a,b) => {
                   const aa = (a[trnField]||0) > 0 ? (a[ratingField]||0)/(a[trnField]||0) : 0;
                   const ba = (b[trnField]||0) > 0 ? (b[ratingField]||0)/(b[trnField]||0) : 0;
                   return ba - aa;
                 }
               :                         (a,b) => (b[ratingField]||0) - (a[ratingField]||0);

  const allSorted = all.slice().sort(sortFn);
  const list = q ? allSorted.filter(p => p.name.toLowerCase().includes(q)) : allSorted;

  const totalM   = db.filter(p=>p.gender==='M').length;
  const totalW   = db.filter(p=>p.gender==='W').length;
  const totalMix = db.filter(p=>(p.ratingMix||0)>0||(p.tournamentsMix||0)>0).length;

  function rankClass(i){ return i===0?'gold':i===1?'silver':i===2?'bronze':''; }
  function medal(i){ return i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1; }

  const sortValOf = p => {
    if (playersSort === 'trn') return p[trnField]||0;
    if (playersSort === 'avg') return (p[trnField]||0) > 0
      ? ((p[ratingField]||0)/(p[trnField]||0)).toFixed(1) : '—';
    return p[ratingField]||0;
  };
  const sortLbl = playersSort === 'trn' ? 'турн.' : playersSort === 'avg' ? 'средн.' : 'рейт.';

  // Zone styling by rank position
  const zoneMeta = (rank) => {
    if (rank <= 10) return { cls: 'zone-hard',   lbl: 'HARD',   color: '#e94560' };
    if (rank <= 20) return { cls: 'zone-medium', lbl: 'MEDIUM', color: '#4DA8DA' };
    return              { cls: 'zone-lite',   lbl: 'LITE',   color: '#6ABF69' };
  };

  // Podium (only when not searching, 2+ players)
  const top3 = !q && allSorted.length >= 2;
  const podiumHtml = top3 ? (() => {
    const [p1, p2, p3] = allSorted;
    const pod = (p, cls, med) => p ? `
      <div class="plr-pod-item">
        <div class="plr-pod-col ${cls}">
          <span class="plr-pod-medal">${med}</span>
          <span class="plr-pod-name">${esc(p.name.split(' ')[0])}</span>
          <span class="plr-pod-pts ${cls}">${sortValOf(p)}</span>
          <span class="plr-pod-lbl">${sortLbl}</span>
        </div>
      </div>` : '';
    return `<div class="plr-podium">${pod(p2,'p2','🥈')}${pod(p1,'p1','🥇')}${pod(p3,'p3','🥉')}</div>`;
  })() : '';

  const itemsHtml = list.length === 0 ? `
    <div class="plr-empty">
      <div class="plr-empty-icon">${q ? '🔍' : g==='M'?'🏋️':g==='W'?'👩':'🤝'}</div>
      ${q ? `Нет совпадений для «${esc(q)}»`
          : g==='Mix' ? 'Нет игроков с рейтингом микст. Проведите микст-турнир.'
          : 'Нет игроков. Добавляйте через ⚙️ Ростер или загрузите из сети.'}
      ${!q && db.length === 0 ? `
      <button onclick="importPublicData()" style="margin-top:16px;padding:11px 22px;background:#4DA8DA;color:#fff;border:none;border-radius:9px;font-family:var(--font-b,sans-serif);font-weight:700;font-size:13px;letter-spacing:.4px;cursor:pointer;">📥 Загрузить рейтинг из GitHub</button>` : ''}
    </div>` : list.map((p, i) => {
      const zn     = zoneMeta(i + 1);
      const rPts   = p[ratingField] || 0;
      const tCount = p[trnField]    || 0;
      const avg    = tCount > 0 ? (rPts / tCount).toFixed(1) : '—';
      return `
    <div class="plr-item" style="border-left:3px solid ${zn.color}"
         onclick="showPlayerCard('${escAttr(p.name)}','${escAttr(p.gender)}')">
      <div class="plr-item-rank ${rankClass(i)}">${medal(i)}</div>
      <div class="plr-item-info">
        <div class="plr-item-name">${esc(p.name)}</div>
        <div class="plr-item-meta">
          <span>🏆 ${tCount} турн.</span>
          <span>⚡ ${rPts} рейт.</span>
          <span>📊 ${avg} ср.</span>
        </div>
      </div>
      <div class="plr-item-pts">
        <div class="plr-item-pts-val">${sortValOf(p)}</div>
        <div class="plr-item-pts-lbl">${sortLbl}</div>
      </div>
      <div class="plr-zone-badge ${zn.cls}">${zn.lbl}</div>
    </div>`;
    }).join('');

  // Авто-загрузка свежих данных из GitHub для посетителей (async, не блокирует рендер)
  _autoImportPublicData();

  return `
<div class="plr-wrap">
  <div class="plr-header" style="position:relative">
    <div class="plr-title">🔥 РЕЙТИНГ ЛЮТЫХ ИГРОКОВ</div>
    <div class="plr-sub">Professional Points — места, зоны, статистика</div>
    ${rosterUnlocked ? `<button onclick="importPublicData()" title="Обновить рейтинг из GitHub" style="position:absolute;right:0;top:2px;background:rgba(77,168,218,.15);border:1px solid rgba(77,168,218,.35);color:#4DA8DA;border-radius:7px;padding:5px 9px;font-size:13px;cursor:pointer;line-height:1;">📥</button>` : ''}
  </div>

  <!-- Stats chips -->
  <div class="plr-stats-row">
    <div class="plr-stat-chip">
      <div class="plr-stat-chip-val">${totalM}</div>
      <div class="plr-stat-chip-lbl">🏋️ Мужчин</div>
    </div>
    <div class="plr-stat-chip">
      <div class="plr-stat-chip-val">${totalW}</div>
      <div class="plr-stat-chip-lbl">👩 Женщин</div>
    </div>
    <div class="plr-stat-chip">
      <div class="plr-stat-chip-val">${totalMix}</div>
      <div class="plr-stat-chip-lbl">🤝 Микст</div>
    </div>
    <div class="plr-stat-chip">
      <div class="plr-stat-chip-val">${db.length}</div>
      <div class="plr-stat-chip-lbl">Всего</div>
    </div>
  </div>

  <!-- Tabs: М / Ж / Микст -->
  <div class="plr-tabs">
    <button class="plr-tab ${g==='M'?'active':''}" onclick="setPlayersGender('M')">🏋️ М (${totalM})</button>
    <button class="plr-tab ${g==='W'?'active':''}" onclick="setPlayersGender('W')">👩 Ж (${totalW})</button>
    <button class="plr-tab ${g==='Mix'?'active':''}" onclick="setPlayersGender('Mix')">🤝 Микст (${totalMix})</button>
  </div>

  <!-- Sort -->
  <div class="plr-sort-row">
    <button class="plr-sort-btn ${playersSort==='pts'?'active':''}" onclick="setPlayersSort('pts')">⚡ Рейтинг</button>
    <button class="plr-sort-btn ${playersSort==='avg'?'active':''}" onclick="setPlayersSort('avg')">📊 Средний</button>
    <button class="plr-sort-btn ${playersSort==='trn'?'active':''}" onclick="setPlayersSort('trn')">🏆 Турниры</button>
  </div>

  ${podiumHtml}

  <!-- Search -->
  <div class="plr-search-wrap">
    <span class="plr-search-icon">🔍</span>
    <input class="plr-search" id="plr-search-inp" type="search"
      placeholder="Поиск по имени…" value="${esc(playersSearch)}"
      oninput="setPlayersSearch(this.value)">
  </div>

  <!-- List -->
  <div class="plr-list">${itemsHtml}</div>

  <!-- Admin section: import + export — только при разблокированном ростере -->
  ${rosterUnlocked ? `
  <div style="margin-top:20px;padding:14px 16px;background:rgba(255,215,0,.05);border:1px solid rgba(255,215,0,.2);border-radius:10px;">
    <div style="font-family:var(--font-b,sans-serif);font-size:11px;font-weight:700;color:#ffd700;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;">⚙️ Управление рейтингом</div>
    <button onclick="importPublicData()" style="width:100%;padding:9px 14px;background:rgba(77,168,218,.15);color:#4DA8DA;border:1px solid rgba(77,168,218,.4);border-radius:7px;font-size:13px;font-family:var(--font-b,sans-serif);font-weight:700;cursor:pointer;margin-bottom:8px;">📥 Обновить из GitHub</button>
    <div style="font-size:12px;color:var(--sub,#8888aa);line-height:1.55;margin-bottom:12px;">Загружает актуальный leaderboard.json поверх локальных данных.</div>
    <button onclick="exportPublicData()" style="width:100%;padding:10px 14px;background:#ffd700;color:#0d0d1a;font-family:var(--font-b,sans-serif);font-weight:700;font-size:13px;letter-spacing:.5px;border:none;border-radius:7px;cursor:pointer;">⬇️ Скачать leaderboard.json + history.json</button>
    <div style="font-size:12px;color:var(--sub,#8888aa);line-height:1.55;margin-top:8px;">Скачайте и сделайте <code style="background:rgba(255,255,255,.08);padding:1px 5px;border-radius:3px">git commit data/</code> для публикации.</div>
  </div>` : ''}
</div>`;
}

// ── Export public data to GitHub ─────────────────────────────────────────────
// Generates data/leaderboard.json + data/history.json and triggers download.
// Admin then does: git add data/ && git commit -m "Update ratings" && git push
// Only the GitHub repo owner (push access) can actually publish the data.
function exportPublicData() {
  if (hasRosterPassword() && !rosterUnlocked) {
    showToast('🔒 Сначала разблокируйте ростер', 'warn');
    return;
  }

  // Fresh recalc so exported numbers are up-to-date
  recalcAllPlayerStats(/*silent*/ true);
  const db  = loadPlayerDB();
  const now = new Date().toISOString();

  // ── leaderboard.json ────────────────────────────────────
  const makeRow = (p, rField, tField) => ({
    name:        p.name,
    gender:      p.gender,
    rating:      p[rField]  || 0,
    tournaments: p[tField]  || 0,
    wins:        p.wins     || 0,
    last_seen:   p.lastSeen || '',
  });

  const leaderboard = {
    _note:   'Сгенерировано приложением. git commit + push data/ для публикации.',
    updated: now,
    M:   db.filter(p => p.gender === 'M' && (p.ratingM   || 0) > 0)
           .sort((a, b) => (b.ratingM   || 0) - (a.ratingM   || 0))
           .map(p => makeRow(p, 'ratingM',   'tournamentsM')),
    W:   db.filter(p => p.gender === 'W' && (p.ratingW   || 0) > 0)
           .sort((a, b) => (b.ratingW   || 0) - (a.ratingW   || 0))
           .map(p => makeRow(p, 'ratingW',   'tournamentsW')),
    Mix: db.filter(p =>                      (p.ratingMix || 0) > 0)
           .sort((a, b) => (b.ratingMix || 0) - (a.ratingMix || 0))
           .map(p => makeRow(p, 'ratingMix', 'tournamentsMix')),
  };

  // ── history.json ────────────────────────────────────────
  const pMap = new Map();
  db.forEach(p => pMap.set(p.id, p));

  const allTournaments = [];

  // New system: kotc3_tournaments (status=finished, structured winners with playerIds)
  getTournaments()
    .filter(t => t.status === 'finished')
    .forEach(t => {
      const top3 = [];
      if (Array.isArray(t.winners)) {
        t.winners
          .filter(w => w && typeof w === 'object' && Array.isArray(w.playerIds) && w.playerIds.length)
          .sort((a, b) => (a.place || 99) - (b.place || 99))
          .slice(0, 3)
          .forEach(slot => {
            const p = pMap.get(slot.playerIds[0]);
            if (p) top3.push({
              name:       p.name,
              gender:     p.gender,
              game_pts:   slot.points || 0,
              rating_pts: calculateRanking(slot.place || 1),
            });
          });
      }
      allTournaments.push({
        id: String(t.id), name: t.name || '', date: t.date || '',
        format: t.format || '', division: t.division || '', top3,
      });
    });

  // Old system: kotc3_history (King of the Court live-game snapshots)
  let kotcHistory = [];
  try { kotcHistory = JSON.parse(localStorage.getItem('kotc3_history') || '[]'); } catch(e) {}
  kotcHistory.forEach(snap => {
    if (!Array.isArray(snap.players) || !snap.players.length) return;
    allTournaments.push({
      id:       String(snap.id || ''),
      name:     snap.name     || '',
      date:     snap.date     || '',
      format:   snap.format   || 'King of the Court',
      division: snap.division || '',
      top3: snap.players.slice(0, 3).map((p, i) => ({
        name:       p.name   || '',
        gender:     p.gender || 'M',
        game_pts:   p.totalPts || 0,
        rating_pts: calculateRanking(i + 1),
      })),
    });
  });

  // Newest first
  allTournaments.sort((a, b) => (b.date || '') > (a.date || '') ? 1 : -1);

  const historyData = {
    _note:       'Сгенерировано приложением. git commit + push data/ для публикации.',
    updated:     now,
    tournaments: allTournaments,
  };

  // Trigger downloads (slight delay between them for browser compatibility)
  _downloadJson(leaderboard, 'leaderboard.json');
  setTimeout(() => _downloadJson(historyData, 'history.json'), 350);

  const total = leaderboard.M.length + leaderboard.W.length + leaderboard.Mix.length;
  showToast(
    `⬇️ Скачаны leaderboard.json (${total} игр.) и history.json (${allTournaments.length} турн.) — сделайте git commit data/`,
    'success'
  );
}

function _downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Import leaderboard from GitHub static JSON into local playerDB ────────────
async function importPublicData() {
  try {
    showToast('⏳ Загружаю данные…', 'info');
    const r = await fetch('./data/leaderboard.json?_=' + Date.now());
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();

    let count = 0;
    // M and W — straightforward, gender matches division
    ['M', 'W'].forEach(div => {
      const arr = Array.isArray(data[div]) ? data[div] : [];
      arr.forEach(entry => {
        if (!entry.name) return;
        const ratingField = div === 'M' ? 'ratingM' : 'ratingW';
        const trnField    = div === 'M' ? 'tournamentsM' : 'tournamentsW';
        upsertPlayerInDB({
          name:       entry.name,
          gender:     div,
          [ratingField]: entry.rating      || 0,
          [trnField]:    entry.tournaments || 0,
          wins:          entry.wins        || 0,
          lastSeen:      entry.last_seen   || '',
          status:        'active',
        });
        count++;
      });
    });
    // Mix — gender from entry itself
    const mixArr = Array.isArray(data.Mix) ? data.Mix : [];
    mixArr.forEach(entry => {
      if (!entry.name) return;
      upsertPlayerInDB({
        name:            entry.name,
        gender:          entry.gender || 'M',
        ratingMix:       entry.rating      || 0,
        tournamentsMix:  entry.tournaments || 0,
        wins:            entry.wins        || 0,
        lastSeen:        entry.last_seen   || '',
        status:          'active',
      });
      count++;
    });

    const s = document.getElementById('screen-players');
    if (s) s.innerHTML = renderPlayers();
    showToast(`✅ Загружено ${count} игроков из leaderboard.json`, 'success');
  } catch (e) {
    showToast('❌ Ошибка загрузки: ' + e.message, 'error');
  }
}
