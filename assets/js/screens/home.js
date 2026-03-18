'use strict';

function setHomeTab(tab) {
  homeActiveTab = tab;
  if (tab !== 'archive') homeArchiveFormOpen = false;
  const s = document.getElementById('screen-home');
  if (s) s.innerHTML = renderHome();
}

// ── Manual past tournaments CRUD ───────────────────────────
// loadManualTournaments / saveManualTournaments defined above as shims over kotc3_tournaments
function submitManualTournament() {
  const v = id => document.getElementById(id)?.value;
  const name     = (v('arch-inp-name') || '').trim();
  const date     =  v('arch-inp-date') || '';
  const format   =  v('arch-inp-fmt')  || 'King of the Court';
  const division =  v('arch-inp-div')  || 'Мужской';
  if (!name || !date) { showToast('⚠️ Введите название и дату'); return; }

  const playerResults = [...homeArchiveFormPlayers].sort((a,b) => b.pts - a.pts);
  const playersCount  = playerResults.length || (parseInt(v('arch-inp-players')||'0')||0);
  const winner        = playerResults[0]?.name || (v('arch-inp-winner')||'').trim();

  // Save to archive
  const arr = loadManualTournaments();
  arr.unshift({ id: Date.now(), name, date, format, division,
    playersCount, winner, playerResults, source: 'manual' });
  saveManualTournaments(arr);

  // Sync players → playerDB (each player gets +1 tournament, +pts)
  if (playerResults.length) {
    syncPlayersFromTournament(
      playerResults.map(p => ({ name: p.name, gender: p.gender, totalPts: p.pts })),
      date
    );
    showToast(`✅ Турнир сохранён · ${playerResults.length} игроков в базу`);
  } else {
    showToast('✅ Турнир добавлен в архив');
  }

  homeArchiveFormOpen = false;
  homeArchiveFormPlayers = [];
  setHomeTab('archive');
}
function deleteManualTournament(id) {
  saveManualTournaments(loadManualTournaments().filter(t => t.id !== id));
  setHomeTab('archive');
}
function toggleArchiveForm() {
  homeArchiveFormOpen = !homeArchiveFormOpen;
  if (homeArchiveFormOpen) homeArchiveFormPlayers = [];
  const s = document.getElementById('screen-home');
  if (s) s.innerHTML = renderHome();
}

function setArchFormGender(g) {
  homeArchiveFormGender = g;
  // just update the buttons visually without full re-render
  ['M','W'].forEach(x => {
    const b = document.getElementById('arch-g-btn-'+x);
    if (b) b.className = 'arch-plr-g-btn' + (x===g?' sel-'+g:'');
  });
}

function addArchFormPlayer() {
  const nameEl = document.getElementById('arch-plr-inp');
  const ptsEl  = document.getElementById('arch-plr-pts-inp');
  const name   = (nameEl?.value || '').trim();
  const pts    = parseInt(ptsEl?.value || '0') || 0;
  if (!name) { showToast('⚠️ Введите фамилию'); return; }
  homeArchiveFormPlayers.push({ name, pts, gender: homeArchiveFormGender });
  homeArchiveFormPlayers.sort((a,b) => b.pts - a.pts);
  nameEl.value = ''; ptsEl.value = '';
  _refreshArchPlrList();
  nameEl.focus();
}

function removeArchFormPlayer(idx) {
  homeArchiveFormPlayers.splice(idx, 1);
  _refreshArchPlrList();
}

function _refreshArchPlrList() {
  const el = document.getElementById('arch-plr-list-wrap');
  if (el) el.innerHTML = _archPlrListHtml();
}

function _archPlrListHtml() {
  if (!homeArchiveFormPlayers.length)
    return '<div class="arch-plr-empty">Игроки не добавлены — очки не запишутся в базу</div>';
  return `<div class="arch-plr-count">${homeArchiveFormPlayers.length} игроков</div>
<div class="arch-plr-list">` +
    homeArchiveFormPlayers.map((p,i) => `
  <div class="arch-plr-row">
    <span class="arch-plr-row-rank">${MEDALS_3[i]||i+1}</span>
    <span class="arch-plr-row-name">${esc(p.name)}</span>
    <span class="arch-plr-row-g ${p.gender}">${p.gender==='M'?'М':'Ж'}</span>
    <span class="arch-plr-row-pts">${p.pts}</span>
    <button class="arch-plr-row-del" onclick="removeArchFormPlayer(${i})">✕</button>
  </div>`).join('') + '</div>';
}

function renderHome() {
  const T = loadUpcomingTournaments();
  const totalReg  = T.reduce((s,t) => s + t.participants.length, 0);
  const openCount = T.filter(t => t.status === 'open').length;

  // helpers
  const pct  = (r,c) => c ? Math.min(r/c*100, 100) : 0;
  const pcls = (r,c) => { if (!c) return 'g'; const p=r/c; return p>=1?'r':p>=.8?'y':'g'; };

  function cardHtml(t) {
    const c   = pcls(t.participants.length, t.capacity);
    const isIPT = t.format === 'IPT Mixed';
    const isActive = t.status === 'active';
    const isOpen   = t.status === 'open';
    const ac  = isOpen ? 'var(--gold)' : isIPT && isActive ? '#1a4a8e' : '#2a2a44';
    const stLabel = isOpen ? 'ОТКРЫТ'
      : isIPT && isActive ? 'В ИГРЕ'
      : t.status === 'finished' ? 'ЗАВЕРШЁН'
      : 'ЗАПОЛНЕНО';
    const btnLabel = isIPT
      ? (isActive ? '🏐 Продолжить матч' : t.participants.length >= 8 ? '🏐 Начать матч IPT' : '👥 Добавить игроков')
      : (isOpen ? '⚡ Записаться' : '📋 В лист ожидания');
    return `
<div class="trn-card" onclick="openTrnDetails('${escAttr(t.id)}')" style="cursor:pointer">
  <div class="trn-card-accent" style="background:${ac}"></div>
  <div class="trn-card-body">
    <div class="trn-card-head">
      <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
        <span class="trn-lv ${t.level}">${t.level.toUpperCase()}</span>
        <span style="font-size:10px;color:var(--muted);background:rgba(255,255,255,.06);
          padding:2px 7px;border-radius:6px">${esc(t.division)}</span>
      </div>
      <span class="trn-st ${t.status}">
        <span class="trn-st-dot"></span>
        ${stLabel}
      </span>
    </div>
    <div class="trn-fmt">👑 ${esc(t.format)}</div>
    <div class="trn-name">${esc(t.name)}</div>
    <div class="trn-meta">🕐 <span>${esc(t.date)}, ${esc(t.time)}</span></div>
    <div class="trn-meta">📍 <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px">${esc(t.location)}</span></div>
    ${t.prize ? `<div class="trn-prize">🏆 Призовой фонд: ${esc(t.prize)}</div>` : ''}
    <div class="trn-prog">
      <div class="trn-prog-hdr">
        <span class="trn-prog-lbl">${isIPT ? 'Участники' : 'Регистрация'}</span>
        <span class="trn-prog-val ${c}">${t.participants.length}/${t.capacity}</span>
      </div>
      <div class="trn-prog-bar">
        <div class="trn-prog-fill ${c}" style="width:${pct(t.participants.length,t.capacity)}%"></div>
      </div>
    </div>
    <button class="trn-btn ${isIPT ? 'ipt' : t.status}"
      onclick="event.stopPropagation();openTrnDetails('${escAttr(t.id)}')">
      ${btnLabel}
    </button>
  </div>
</div>`;
  }

  function calRow(t) {
    const c = t.status==='open' ? 'g' : 'r';
    return `
<div class="cal-row" onclick="showTournament('${escAttr(t.id)}')" style="cursor:pointer">
  <div class="cal-date-box">
    <div class="cal-dn">${t.dayNum}</div>
    <div class="cal-ds">${t.dayStr}</div>
  </div>
  <div class="cal-info">
    <div class="cal-info-name">${esc(t.name)}</div>
    <div class="cal-info-meta">
      <span>🕐 ${esc(t.time)}</span>
      <span class="trn-lv ${t.level}" style="font-size:9px;padding:1px 5px">${t.level.toUpperCase()}</span>
      <span>${esc(t.division)}</span>
    </div>
  </div>
  <div class="cal-right">
    <span class="trn-st ${t.status}" style="font-size:9px;padding:2px 6px">
      <span class="trn-st-dot"></span>${t.status==='open'?'ОТКРЫТ':'ЗАПОЛНЕНО'}
    </span>
    <span class="cal-slots ${c}">${t.participants.length}/${t.capacity}</span>
  </div>
</div>`;
  }

  // group by month for calendar
  const byMonth = {};
  T.forEach(t => { (byMonth[t.month] = byMonth[t.month]||[]).push(t); });
  const calHtml = Object.entries(byMonth).map(([m, ts]) => `
<div class="cal-month">
  <div class="cal-month-hdr">
    <span class="cal-month-title">${m}</span>
    <div class="cal-month-line"></div>
    <span class="cal-month-count">${ts.length} турн.</span>
  </div>
  ${ts.map(calRow).join('')}
</div>`).join('');

  const isS = homeActiveTab === 'schedule';
  const isC = homeActiveTab === 'calendar';
  const isA = homeActiveTab === 'archive';

  // ── Archive content builder ─────────────────────────────
  function archCardHtml(t) {
    const isApp = t.source === 'app';
    let dateStr = '—';
    dateStr = fmtDateLong(t.date);
    const winner = t.winner || (t.players && t.players[0] ? t.players[0].name : '');
    const cnt    = t.playersCount || (t.players ? t.players.length : 0);
    const rds    = t.rPlayed ? `🏐 ${t.rPlayed} раундов` : '';
    return `
<div class="arch-card" onclick="showTournamentDetails(${t.id})" style="cursor:pointer">
  <div class="arch-card-accent"></div>
  <div class="arch-card-body">
    <div class="arch-card-top">
      <div>
        <div class="arch-name">${esc(t.name)}</div>
        <div class="arch-date">📅 ${dateStr}</div>
      </div>
      <div class="arch-badges">
        <span class="arch-src ${isApp?'app':'manual'}">${isApp?'📱 Приложение':'✏️ Вручную'}</span>
        ${!isApp?`<button class="arch-del-btn" onclick="event.stopPropagation();deleteManualTournament(${t.id})" title="Удалить">✕</button>`:''}
      </div>
    </div>
    <div class="arch-meta">
      <span class="arch-chip">${esc(t.format||'King of the Court')}</span>
      <span class="arch-chip">${esc(t.division||'—')}</span>
      ${cnt?`<span class="arch-chip blue">👥 ${cnt} игроков</span>`:''}
      ${rds?`<span class="arch-chip blue">${rds}</span>`:''}
      ${winner?`<span class="arch-chip gold">🥇 ${esc(winner)}</span>`:''}
    </div>
    ${t.playerResults?.length>1 ? `
    <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:3px">
      ${t.playerResults.slice(0,5).map((p,i)=>{
        return `<span style="font-size:10px;padding:2px 7px;border-radius:5px;
          background:rgba(255,255,255,.05);border:1px solid #2a2a40;color:var(--muted)">
          ${MEDALS_3[i]||'·'} ${esc(p.name)} ${p.pts?`<b style="color:var(--gold)">${p.pts}</b>`:''}
        </span>`;
      }).join('')}
      ${t.playerResults.length>5?`<span style="font-size:10px;color:var(--muted)">+${t.playerResults.length-5}</span>`:''}
    </div>` : ''}
  </div>
</div>`;
  }

  const archiveHtml = (() => {
    const appT = (() => {
      try {
        return (JSON.parse(localStorage.getItem('kotc3_history')||'[]'))
          .map(t => ({...t, source:'app', playersCount:t.players?.length||0,
            winner: t.players?.[0]?.name||'',
            format: t.format||'King of the Court', division: t.division||'Смешанный'}));
      } catch(e){ return []; }
    })();
    const manT = loadManualTournaments();
    let all  = [...appT, ...manT];

    // Apply search filter
    const q = archiveSearch.toLowerCase().trim();
    if (q) {
      all = all.filter(t => {
        if ((t.name||'').toLowerCase().includes(q)) return true;
        if ((t.winner||'').toLowerCase().includes(q)) return true;
        const plrs = t.players || t.playerResults || [];
        return plrs.some(p => (p.name||'').toLowerCase().includes(q));
      });
    }

    // Apply sort
    if (archiveSort === 'date_desc')  all.sort((a,b) => (b.date||'') > (a.date||'') ? 1 : -1);
    else if (archiveSort === 'date_asc') all.sort((a,b) => (a.date||'') > (b.date||'') ? 1 : -1);
    else if (archiveSort === 'players') all.sort((a,b) => (b.playersCount||0) - (a.playersCount||0));
    else if (archiveSort === 'pts') all.sort((a,b) => (b.totalScore||0) - (a.totalScore||0));

    // Search bar HTML
    const searchHtml = `
    <div class="arch-search-row">
      <input class="arch-search-inp" type="text" placeholder="🔍 Поиск по имени или турниру..."
        value="${esc(archiveSearch)}"
        oninput="archiveSearch=this.value;setHomeTab('archive')">
      <select class="arch-sort-sel" onchange="archiveSort=this.value;setHomeTab('archive')">
        <option value="date_desc"${archiveSort==='date_desc'?' selected':''}>Новые</option>
        <option value="date_asc"${archiveSort==='date_asc'?' selected':''}>Старые</option>
        <option value="players"${archiveSort==='players'?' selected':''}>Игроки</option>
        <option value="pts"${archiveSort==='pts'?' selected':''}>Очки</option>
      </select>
    </div>`;

    const formHtml = homeArchiveFormOpen ? `
<div class="arch-add-form">
  <div class="arch-form-title">✏️ Добавить прошедший турнир</div>
  <div class="arch-form-grid">
    <input class="arch-form-inp arch-form-full" id="arch-inp-name"
      type="text" placeholder="Название турнира *">
    <input class="arch-form-inp" id="arch-inp-date"
      type="date" value="${new Date().toISOString().split('T')[0]}">
    <select class="arch-form-sel" id="arch-inp-fmt">
      <option>King of the Court</option>
      <option>Round Robin</option>
      <option>Олимпийская система</option>
      <option>Другой</option>
    </select>
    <select class="arch-form-sel" id="arch-inp-div">
      <option>Мужской</option>
      <option>Женский</option>
      <option>Смешанный</option>
    </select>
  </div>

  <!-- Player results section -->
  <div class="arch-plr-section">
    <div class="arch-plr-section-title">👥 Результаты игроков (необязательно)</div>
    <div class="arch-plr-add-row">
      <input class="arch-form-inp arch-plr-name" id="arch-plr-inp"
        type="text" placeholder="Фамилия"
        onkeydown="if(event.key==='Enter')addArchFormPlayer()">
      <input class="arch-form-inp arch-plr-pts" id="arch-plr-pts-inp"
        type="number" min="0" max="999" placeholder="Очки"
        onkeydown="if(event.key==='Enter')addArchFormPlayer()">
      <div class="arch-plr-gender-wrap">
        <button id="arch-g-btn-M" class="arch-plr-g-btn sel-M" onclick="setArchFormGender('M')">М</button>
        <button id="arch-g-btn-W" class="arch-plr-g-btn" onclick="setArchFormGender('W')">Ж</button>
      </div>
      <button class="arch-plr-add-btn" onclick="addArchFormPlayer()">+</button>
    </div>
    <div id="arch-plr-list-wrap">${_archPlrListHtml()}</div>
  </div>

  <button class="arch-save-btn" onclick="submitManualTournament()">
    💾 Сохранить${homeArchiveFormPlayers.length ? ` (${homeArchiveFormPlayers.length} игроков → база)` : ' в архив'}
  </button>
</div>` : '';

    const listHtml = all.length === 0 ? `
<div class="arch-empty">
  <div class="arch-empty-icon">🏆</div>
  Архив пуст. Завершите турнир в приложении<br>или добавьте прошедший вручную.
</div>` : (() => {
      const appOnes = all.filter(t=>t.source==='app');
      const manOnes = all.filter(t=>t.source==='manual');
      let html = '';
      if (appOnes.length) {
        html += `<div class="arch-divider"><div class="arch-divider-line"></div><span class="arch-divider-txt">📱 Из приложения (${appOnes.length})</span><div class="arch-divider-line"></div></div>`;
        html += appOnes.map(archCardHtml).join('');
      }
      if (manOnes.length) {
        html += `<div class="arch-divider"><div class="arch-divider-line"></div><span class="arch-divider-txt">✏️ Добавлены вручную (${manOnes.length})</span><div class="arch-divider-line"></div></div>`;
        html += manOnes.map(archCardHtml).join('');
      }
      return html;
    })();

    return searchHtml + formHtml + listHtml;
  })();

  return `
<div class="home-wrap">
  <!-- Hero -->
  <div class="home-hero">
    <div class="home-badge">🔥 Сезон 2026 — уже открыт!</div>
    <div class="home-title">ДОМИНИРУЙ НА<br><span>КОРТЕ</span></div>
    <div class="home-subtitle">Записывайся на турниры, следи за рейтингом<br>и становись королём пляжного волейбола</div>
    <div class="home-stats">
      <div class="home-stat"><div class="home-stat-val">${T.length}</div><div class="home-stat-lbl">Турниров</div></div>
      <div class="home-stat"><div class="home-stat-val">${totalReg}+</div><div class="home-stat-lbl">Участников</div></div>
      <div class="home-stat"><div class="home-stat-val">${openCount}</div><div class="home-stat-lbl">Открыто</div></div>
    </div>
  </div>

  <!-- Player DB banner -->
  ${(() => {
    const db = loadPlayerDB();
    const total = db.length;
    const men   = db.filter(p=>p.gender==='M').length;
    const women = db.filter(p=>p.gender==='W').length;
    // pick up to 2 real names for avatars
    const topM = db.filter(p=>p.gender==='M').sort((a,b)=>(b.totalPts||0)-(a.totalPts||0))[0];
    const topW = db.filter(p=>p.gender==='W').sort((a,b)=>(b.totalPts||0)-(a.totalPts||0))[0];
    const av1  = topM ? topM.name.slice(0,2).toUpperCase() : '🏋️';
    const av2  = topW ? topW.name.slice(0,2).toUpperCase() : '👩';
    const av3  = total > 2 ? `+${total-2}` : '👤';
    return `
  <button class="plr-banner" onclick="switchTab('players')">
    <div class="plr-banner-avatars">
      <div class="plr-av" title="${topM?escAttr(topM.name):'Мужчины'}">${av1}</div>
      <div class="plr-av" title="${topW?escAttr(topW.name):'Женщины'}">${av2}</div>
      <div class="plr-av">${av3}</div>
    </div>
    <div class="plr-banner-body">
      <div class="plr-banner-title">👤 РЕЙТИНГ <span>ЛЮТОСТИ</span></div>
      <div class="plr-banner-sub">Управляй составом · История · Статистика</div>
      <div class="plr-banner-pill">
        🏋️ ${men} муж &nbsp;·&nbsp; 👩 ${women} жен &nbsp;·&nbsp; Всего ${total}
      </div>
    </div>
    <div class="plr-banner-arrow">→</div>
  </button>`;
  })()}

  <!-- Epic Player Card -->
  <div class="player-showcase">
    <div class="epic-player-card">
      <div class="card-top-row">
        <div class="hex-border hex-avatar">
          <div class="hex-inner">
            <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='150' height='150'%3E%3Crect fill='%23ff5e00' width='150' height='150'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' fill='%23fff' font-family='sans-serif' font-size='28' font-weight='700'%3EPLAYER%3C/text%3E%3C/svg%3E" alt="Mamedov" class="avatar-img" loading="lazy">
          </div>
        </div>
        <div class="hex-border hex-logo">
          <div class="hex-inner">
            <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%23111' width='100' height='100'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' fill='%23ff5e00' font-family='sans-serif' font-size='18' font-weight='700'%3ELOGO%3C/text%3E%3C/svg%3E" alt="Lyutye Logo" class="logo-img" loading="lazy">
          </div>
        </div>
      </div>
      <div class="player-identity">
        <h2 class="player-name">MAMEDOV</h2>
        <div class="player-level-hex">
          <div class="hex-inner">7</div>
        </div>
      </div>
      <div class="player-rank">РАНГ: 3850</div>
      <div class="badges-grid">
        <div class="badge badge-gold">🏆 KING OF COURT 2026</div>
        <div class="badge badge-fire">🔥 5 WIN STREAK</div>
        <div class="badge badge-ice">❄️ SNOW MASTER</div>
        <div class="badge badge-silver">🥈 2 SIDE OUT TOURNEY</div>
      </div>
      <div class="battle-history">
        <div class="history-header">
          <span>ПОСЛЕДНИЕ БИТВЫ</span>
          <span>ДАТА</span>
          <span>РЕЗУЛЬТАТ</span>
          <span>МЕСТО</span>
        </div>
        <div class="history-row row-win">
          <span class="tourney-name">DOUBLE TROUBLE</span>
          <span class="tourney-date">04.01.2026</span>
          <span class="tourney-tier">🥉 HARD</span>
          <span class="tourney-place">1</span>
        </div>
        <div class="history-row">
          <span class="tourney-name">KOTC</span>
          <span class="tourney-date">10.01.2026</span>
          <span class="tourney-tier">-</span>
          <span class="tourney-place">1</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Tabs -->
  <div class="home-tabs">
    <button class="home-tab-btn ${isS?'active':''}" onclick="setHomeTab('schedule')" style="font-size:11px">
      ⚔️ РАСПИСАНИЕ
    </button>
    <button class="home-tab-btn ${isC?'active':''}" onclick="setHomeTab('calendar')" style="font-size:11px">
      📅 КАЛЕНДАРЬ
    </button>
    <button class="home-tab-btn ${isA?'active':''}" onclick="setHomeTab('archive')" style="font-size:11px">
      🏆 АРХИВ
    </button>
  </div>

  <!-- Schedule -->
  <div style="display:${isS?'block':'none'}">
    <div class="home-sec-hdr">
      <span class="home-sec-title">БЛИЖАЙШИЕ <span>ЧЕМПИОНАТЫ</span></span>
      <span class="home-sec-count">${T.length} событий</span>
    </div>
    <div class="home-grid">${T.map(cardHtml).join('')}</div>
  </div>

  <!-- Calendar -->
  <div style="display:${isC?'block':'none'}">
    <div class="home-sec-hdr">
      <span class="home-sec-title">КАЛЕНДАРЬ <span>СОБЫТИЙ</span></span>
      <span class="home-sec-count">Март — Апрель 2026</span>
    </div>
    ${calHtml}
  </div>

  <!-- Archive -->
  <div style="display:${isA?'block':'none'}">
    <div class="home-sec-hdr">
      <span class="home-sec-title">АРХИВ <span>ТУРНИРОВ</span></span>
    </div>
    ${_buildProgressionChart()}
    <button class="arch-add-toggle" onclick="toggleArchiveForm()">
      ${homeArchiveFormOpen ? '− Свернуть форму' : '+ Добавить прошедший турнир'}
    </button>
    ${archiveHtml}
  </div>
</div>`;
}

function renderHistory() {
  let history = [];
  try { history = JSON.parse(localStorage.getItem('kotc3_history') || '[]'); } catch(e){}

  let html = `<div class="hist-section-title">📚 АРХИВ ТУРНИРОВ</div>`;

  if (!history.length) {
    html += `<div class="hist-empty">Нет завершённых турниров.<br>Нажмите «Завершить турнир» в Ростере.</div>`;
    return html;
  }

  html += history.map(t => {
    const dateStr = fmtDateLong(t.date);
    const top = t.players.slice(0,5);
    return `<div class="hist-card" style="cursor:pointer" onclick="showTournamentDetails(${t.id})">
      <div class="hist-hdr">
        <div>
          <div class="hist-name">${esc(t.name)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">📅 ${dateStr}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;align-items:flex-start">
          <button class="btn-gsh-hist" id="gsh-btn-${t.id}" onclick="event.stopPropagation();exportToSheetsFromHistory(${t.id})" title="Экспорт в Google Sheets">📊 Sheets</button>
          <button class="btn-pdf-hist" onclick="event.stopPropagation();exportTournamentPDF(${t.id})">📄 PDF</button>
          <button class="btn-del-hist" onclick="event.stopPropagation();deleteHistory(${t.id})">✕</button>
        </div>
      </div>
      <div class="hist-meta-row">
        <span class="hist-chip">👥 ${t.players.length} игроков</span>
        <span class="hist-chip">🏐 ${t.rPlayed} раундов</span>
        <span class="hist-chip">⚡ ${t.totalScore} очков</span>
        <span class="hist-chip">🏟 ${t.nc} корт(а) × ${t.ppc}</span>
      </div>
      <div class="hist-podium">
        ${top.map((p,i) => `<div class="hist-row">
          <span class="hist-place-num">${MEDALS_5[i]||i+1}</span>
          <span class="hist-p-name">${p.gender==='M'?'🏋️':'👩'} ${esc(p.name)}</span>
          <span style="font-size:10px;color:var(--muted)">${p.courtName||''}</span>
          <span class="hist-p-pts">${p.totalPts} оч</span>
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');

  return html;
}

// ════════════════════════════════════════════════════════════
// PROGRESSION CHART (last 10 tournaments)
// ════════════════════════════════════════════════════════════
function _buildProgressionChart() {
  let history = [];
  try { history = JSON.parse(localStorage.getItem('kotc3_history') || '[]'); } catch(e){}
  if (history.length < 2) return '';

  const last10 = history.slice(0, 10).reverse(); // oldest → newest
  const maxScore = Math.max(...last10.map(t => t.totalScore || 0), 1);

  const bars = last10.map(t => {
    const sc    = t.totalScore || 0;
    const pct   = Math.round(sc / maxScore * 100);
    const cnt   = t.players?.length || 0;
    let dateLabel = '';
    try {
      dateLabel = new Date(t.date+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
    } catch(e) { dateLabel = t.date || ''; }
    return `<div class="prog-bar-col" onclick="showTournamentDetails(${t.id})" title="${esc(t.name)}: ${sc} оч, ${cnt} игр.">
      <div class="prog-bar-val">${sc}</div>
      <div class="prog-bar" style="height:${Math.max(pct, 8)}%"></div>
      <div class="prog-bar-lbl">${dateLabel}</div>
    </div>`;
  }).join('');

  return `
  <div class="prog-chart-wrap">
    <div class="prog-chart-title">📈 ПРОГРЕССИЯ ТУРНИРОВ</div>
    <div class="prog-chart">${bars}</div>
  </div>`;
}

// ════════════════════════════════════════════════════════════
// TOURNAMENT DETAILS MODAL (from kotc3_history)
// ════════════════════════════════════════════════════════════
function showTournamentDetails(trnId) {
  // Try kotc3_history first, then manual tournaments
  let t = null;
  try {
    const hist = JSON.parse(localStorage.getItem('kotc3_history') || '[]');
    t = hist.find(h => h.id === trnId);
  } catch(e){}
  if (!t) {
    const manual = loadManualTournaments();
    t = manual.find(m => m.id === trnId);
  }
  if (!t) { showToast('Турнир не найден'); return; }

  document.getElementById('trn-detail-modal')?.remove();

  const players   = t.players || t.playerResults || [];
  const dateStr   = fmtDateLong(t.date);
  const cnt       = players.length || t.playersCount || 0;
  const rPlayed   = t.rPlayed || 0;
  const totalScore= t.totalScore || players.reduce((s,p) => s + (p.totalPts||p.pts||0), 0);
  const avgGlobal = cnt && rPlayed ? (totalScore / (cnt * rPlayed)).toFixed(1) : '—';

  // Enrich players with avg and rating points
  const enriched = players.map((p, i) => {
    const pts   = p.totalPts ?? p.pts ?? 0;
    const avg   = rPlayed ? (pts / rPlayed).toFixed(1) : '—';
    const place = i + 1;
    const rPts  = place <= POINTS_TABLE.length ? POINTS_TABLE[place - 1] : 0;
    return { ...p, pts, avg, place, rPts };
  });

  const mvp     = enriched[0];
  const top3    = enriched.slice(0, 3);

  // Highlights
  const highlightsHtml = _buildHighlights(t, enriched, avgGlobal);

  // Podium
  const podiumHtml = top3.length ? `
    <div class="trd-section">🏆 ПОДИУМ</div>
    <div class="trd-podium">
      ${top3.map((p, i) => `
        <div class="trd-pod-row">
          <span class="trd-pod-medal">${MEDALS_3[i]}</span>
          <span class="trd-pod-name">${p.gender==='M'?'🏋️':'👩'} ${esc(p.name)}</span>
          <span class="trd-pod-pts">${p.pts} оч</span>
          <span class="trd-pod-avg">${p.avg}/р</span>
        </div>`).join('')}
    </div>` : '';

  // Full ranking table
  const rankingHtml = enriched.length > 3 ? `
    <div class="trd-section">📊 ПОЛНЫЙ РЕЙТИНГ</div>
    <div class="trd-table-wrap">
      <table class="trd-table">
        <thead><tr>
          <th>#</th><th>Игрок</th><th>Очки</th><th>Avg</th><th>+Рейтинг</th>
        </tr></thead>
        <tbody>
          ${enriched.map(p => `<tr>
            <td><span class="trd-rank-num">${p.place <= 3 ? MEDALS_3[p.place-1] : p.place}</span></td>
            <td class="trd-rank-name">${p.gender==='M'?'🏋️':'👩'} ${esc(p.name)}${p.courtName ? ` <span class="trd-court-tag">${esc(p.courtName)}</span>` : ''}</td>
            <td class="trd-rank-pts">${p.pts}</td>
            <td class="trd-rank-avg">${p.avg}</td>
            <td class="trd-rank-rpts">+${p.rPts}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '';

  // Meta chips
  const metaHtml = `
    <div class="trd-meta-row">
      ${t.format ? `<span class="trd-chip">👑 ${esc(t.format)}</span>` : ''}
      ${t.division ? `<span class="trd-chip">${esc(t.division)}</span>` : ''}
      ${t.nc ? `<span class="trd-chip">🏟 ${t.nc} корт(а)</span>` : ''}
      ${t.ppc ? `<span class="trd-chip">👥 ${t.ppc} на корт</span>` : ''}
    </div>`;

  const overlay = document.createElement('div');
  overlay.id = 'trn-detail-modal';
  overlay.className = 'td-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.innerHTML = `
  <div class="td-modal">
    <div class="td-accent" style="background:var(--gold)"></div>
    <div class="td-body" style="overflow-y:auto;padding:16px 16px 24px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
        <div>
          <div class="td-name" style="margin:0">${esc(t.name)}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:4px">
            📅 ${dateStr}${rPlayed ? ` · 🏐 ${rPlayed} раундов` : ''}
          </div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">
            👥 ${cnt} игроков · ⚡ ${totalScore} очков · avg ${avgGlobal}/р
          </div>
        </div>
        <button onclick="this.closest('.td-overlay').remove()" style="background:transparent;border:1px solid #2a2a44;color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:16px">✕</button>
      </div>

      ${metaHtml}
      ${podiumHtml}
      ${highlightsHtml}
      ${rankingHtml}

      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="trd-share-btn" onclick="event.stopPropagation();_shareTournamentResult(${trnId})">📤 Поделиться</button>
        <button onclick="this.closest('.td-overlay').remove()" style="flex:1;padding:10px;background:#2a2a44;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;font-size:13px">Закрыть</button>
      </div>
    </div>
  </div>`;

  document.body.appendChild(overlay);
}

function _buildHighlights(t, enriched, avgGlobal) {
  const items = [];
  const mvp = enriched[0];
  if (mvp) items.push(`🏆 MVP: <b>${esc(mvp.name)}</b> (${mvp.pts} оч, avg ${mvp.avg})`);

  // Best round (from saved data if available)
  if (t.bestRound) {
    items.push(`⚡ Лучший раунд: <b>${esc(t.bestRound.name)}</b> (${t.bestRound.score} оч, Р${t.bestRound.round+1})`);
  }

  // Best pair (from saved data if available)
  if (t.bestPair) {
    items.push(`💜 Лучшая пара: <b>${esc(t.bestPair.man)} + ${esc(t.bestPair.woman)}</b> (${t.bestPair.totalPts} оч)`);
  }

  // Average score per round
  if (avgGlobal !== '—') {
    items.push(`📈 Среднее: ${avgGlobal} очков за раунд`);
  }

  // Court stats if available
  if (t.courtStats?.length) {
    const best = t.courtStats.reduce((a,b) => (+a.avgPts > +b.avgPts ? a : b));
    items.push(`🏟 Лучший корт: <b>${esc(best.name)}</b> (avg ${best.avgPts})`);
  }

  if (!items.length) return '';

  return `
    <div class="trd-section">💡 HIGHLIGHTS</div>
    <div class="trd-highlights">
      ${items.map(i => `<div class="trd-hl-item">${i}</div>`).join('')}
    </div>`;
}

function _shareTournamentResult(trnId) {
  let t = null;
  try {
    const hist = JSON.parse(localStorage.getItem('kotc3_history') || '[]');
    t = hist.find(h => h.id === trnId);
  } catch(e){}
  if (!t) {
    const manual = loadManualTournaments();
    t = manual.find(m => m.id === trnId);
  }
  if (!t) return;

  const players = t.players || t.playerResults || [];
  const top3    = players.slice(0, 3);
  const cnt     = players.length || t.playersCount || 0;
  const dateStr = t.date ? new Date(t.date+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}) : '';

  let text = `👑 ${t.name}\n📅 ${dateStr} · 👥 ${cnt} игроков\n\n🏆 Подиум:\n`;
  top3.forEach((p,i) => {
    const pts = p.totalPts ?? p.pts ?? 0;
    text += `${MEDALS_3[i]} ${p.name} — ${pts} оч\n`;
  });
  if (t.totalScore) text += `\n⚡ Всего: ${t.totalScore} очков`;
  if (t.rPlayed) text += ` за ${t.rPlayed} раундов`;
  text += '\n#KingBeach #Volley';

  shareText(text);
}
