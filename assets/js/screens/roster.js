'use strict';

function toggleFixedPairs() {
  fixedPairs = !fixedPairs;
  saveState();
  // Re-render courts to update pair display
  for (let ci = 0; ci < nc; ci++) {
    const s = document.getElementById(`screen-${ci}`);
    if (s) s.innerHTML = renderCourt(ci);
  }
  updateDivisions();
  // Update toggle button label without full rebuild
  document.querySelectorAll('.fixed-pairs-toggle').forEach(el => {
    el.textContent = fixedPairs ? '🔗 Фиксированные' : '🔄 Ротация';
    el.classList.toggle('on', fixedPairs);
  });
  saveState();
  showToast(fixedPairs ? '🔗 Пары зафиксированы — напарники не меняются' : '🔄 Ротация пар включена');
}

function toggleSolar() {
  const on = document.body.classList.toggle('solar');
  localStorage.setItem('kotc3_solar', on ? '1' : '0');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', on ? '#000000' : '#0d0d1a');
  // Re-render just the theme button label without full roster rebuild
  document.querySelectorAll('.solar-toggle-roster').forEach(el => {
    el.textContent = on ? '🌙 Ночь' : '☀️ Пляж';
  });
}

function setPending(newNc, newPpc) {
  _nc = newNc; _ppc = newPpc;
  // Update seg buttons
  document.querySelectorAll('#seg-c .seg-btn').forEach((b,i)=>b.classList.toggle('on', i+1===_nc));
  document.querySelectorAll('#seg-n .seg-btn').forEach((b,i)=>b.classList.toggle('on', [4,5][i]===_ppc));
  // Update info text
  const info = document.getElementById('sc-info');
  if (info) info.innerHTML = `${_nc} корт(а) × ${_ppc} = <strong>${_nc*_ppc}м + ${_nc*_ppc}ж</strong>`;
}

async function applySettings() {
  if (_ppc === ppc && _nc === nc) { showToast('Настройки не изменились'); return; }
  if (!await showConfirm(`Применить: ${_nc} кортов, ${_ppc} игроков?\n\nОчки будут сброшены!`)) return;
  ppc = _ppc; nc = _nc;
  scores    = makeBlankScores();
  divScores = makeBlankDivScores();
  divRoster = makeBlankDivRoster();
  saveState();
  buildAll();
  switchTab('roster');
  showToast(`⚙️ ${nc} корт(а) · ${ppc} игроков`);
}

function autoDistribute() {
  // Collect all names from existing roster inputs if they exist
  document.querySelectorAll('.rc-inp').forEach(inp => {
    const ci = +inp.dataset.ci, g = inp.dataset.g, pi = +inp.dataset.pi;
    if (!isNaN(ci) && ci < 4) ALL_COURTS[ci][g][pi] = inp.value.trim();
  });
  // Trim/pad each court to ppc
  for (let ci = 0; ci < nc; ci++) {
    ALL_COURTS[ci].men   = ALL_COURTS[ci].men.slice(0,ppc).concat(
      Array.from({length:Math.max(0,ppc-ALL_COURTS[ci].men.length)}, (_,i)=>`М${ci*ppc+i+1}`)
    ).slice(0,ppc);
    ALL_COURTS[ci].women = ALL_COURTS[ci].women.slice(0,ppc).concat(
      Array.from({length:Math.max(0,ppc-ALL_COURTS[ci].women.length)}, (_,i)=>`Ж${ci*ppc+i+1}`)
    ).slice(0,ppc);
  }
  saveState();
  switchTab('roster');
  showToast('📋 Распределено');
}

// ════════════════════════════════════════════════════════════
// 9. ROSTER ACTIONS
// ════════════════════════════════════════════════════════════
// saveTournamentMeta() удалена — теперь tournamentMeta
// устанавливается автоматически при добавлении турнира
// через «ТУРНИРЫ РАСПИСАНИЕ» (submitTournamentForm)

function applyRoster() {
  document.querySelectorAll('.rc-inp').forEach(inp => {
    const ci = +inp.dataset.ci, g = inp.dataset.g, pi = +inp.dataset.pi;
    if (!isNaN(ci) && ci < 4) {
      ALL_COURTS[ci][g][pi] = inp.value.trim() || (g==='men' ? `М${pi+1}` : `Ж${pi+1}`);
    }
  });
  // Refresh court screens
  for (let ci = 0; ci < nc; ci++) {
    const s = document.getElementById(`screen-${ci}`);
    if (s) s.innerHTML = renderCourt(ci);
  }
  updateDivisions();
  saveState();
  showToast('✅ Ростер сохранён');
}

async function clearRoster() {
  if (!await showConfirm('Удалить текущий состав и начать заполнение с чистого листа?')) return;
  // 1. Убрать кэш из localStorage
  localStorage.removeItem('kotc3_roster');
  // 2. Обнулить глобальные массивы ALL_COURTS
  for (let ci = 0; ci < 4; ci++) {
    ALL_COURTS[ci].men   = Array(ppc).fill('');
    ALL_COURTS[ci].women = Array(ppc).fill('');
  }
  // 3. Очистить DOM-поля (если ростер уже отрисован)
  document.querySelectorAll('.rc-inp').forEach(inp => { inp.value = ''; });
  saveState();
  showToast('🧹 Состав очищен — введите новые имена и нажмите Сохранить');
}

async function resetRosterNames() {
  if (!await showConfirm('Сбросить имена к стандартным?')) return;
  const defaults = [
    { men:['Яковлев','Жидков','Алик','Куанбеков','Юшманов'],           women:['Лебедева','Чемерис В','Настя НМ','Сайдуллина','Маргарита'] },
    { men:['Обухов','Соболев','Иванов','Грузин','Шперлинг'],            women:['Шперлинг','Шерметова','Сабанцева','Микишева','Базутова'] },
    { men:['Сайдуллин','Лебедев','Камалов','Привет','Анашкин'],         women:['Носкова','Арефьева','Кузьмина','Яковлева','Маша Привет'] },
    { men:['Игрок М1','Игрок М2','Игрок М3','Игрок М4','Игрок М5'],    women:['Игрок Ж1','Игрок Ж2','Игрок Ж3','Игрок Ж4','Игрок Ж5'] },
  ];
  defaults.forEach((d,i)=>{ ALL_COURTS[i].men=[...d.men]; ALL_COURTS[i].women=[...d.women]; });
  saveState();
  switchTab('roster');
  showToast('↺ Имена сброшены');
}

// ════════════════════════════════════════════════════════════
// 10. HISTORY LOG
// ════════════════════════════════════════════════════════════
const DIV_COURT_LABELS = { hard:'🔥 HARD', advance:'⚡ ADV', medium:'⚙️ MED', lite:'🍀 LITE' };

function addHistoryEntry(courtName, playerName, delta, newScore, courtKey) {
  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  tournamentHistory.unshift({
    time:   `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    court:  courtName,
    player: playerName,
    delta,
    score:  newScore,
    key:    courtKey || 'all'
  });
  if (tournamentHistory.length > 450) tournamentHistory.length = 450;
  // Живое обновление если вкладка РОСТЕР открыта
  const el = document.getElementById('admin-history-log');
  if (el) el.innerHTML = renderHistoryLog();
}

function setHistoryFilter(f) {
  historyFilter = f;
  const el = document.getElementById('admin-history-log');
  if (el) el.innerHTML = renderHistoryLog();
  // Update filter bar buttons
  document.querySelectorAll('.hf-btn').forEach(b => {
    b.classList.toggle('on', b.dataset.f === f);
  });
}

function renderHistoryLog() {
  const filtered = historyFilter === 'all'
    ? tournamentHistory
    : tournamentHistory.filter(e => e.key === historyFilter);
  if (!filtered.length)
    return `<div class="history-empty">${tournamentHistory.length ? 'Нет событий по этому фильтру' : 'Событий пока нет — нажмите «+» на любом корте'}</div>`;
  return filtered.map(e => {
    const pos  = e.delta > 0;
    const sign = pos ? '+1' : '−1';
    const dcls = pos ? 'pos' : 'neg';
    return `<div class="history-row${pos ? '' : ' neg'}">
      <span class="history-time">[${e.time}]</span>
      <span class="history-court">${esc(e.court)}</span>
      <span class="history-player">| ${esc(e.player)}</span>
      <span class="history-delta ${dcls}">${sign}</span>
      <span class="history-total">(${e.score})</span>
    </div>`;
  }).join('');
}

function clearHistory() {
  tournamentHistory = [];
  saveState();
  const el = document.getElementById('admin-history-log');
  if (el) el.innerHTML = renderHistoryLog();
}

// ════════════════════════════════════════════════════════════
// 11. RENDER: ROSTER
// ════════════════════════════════════════════════════════════
function renderRoster() {
  const today = new Date().toISOString().split('T')[0];

  let html = `<div class="page-h">✏️ РОСТЕР</div>
  <div class="page-sub">Настройки турнира и имена игроков</div>

  <!-- Формат турнира -->
  <div class="settings-card">
    <div class="sc-title">⚙️ Формат турнира</div>
    <div class="sc-row">
      <span class="sc-lbl">Кортов:</span>
      <div class="seg" id="seg-c">
        ${[1,2,3,4].map(v=>`<button class="seg-btn${_nc===v?' on':''}" onclick="setPending(${v},_ppc)">${v}</button>`).join('')}
      </div>
    </div>
    <div class="sc-row">
      <span class="sc-lbl">Игроков:</span>
      <div class="seg" id="seg-n">
        ${[4,5].map(v=>`<button class="seg-btn${_ppc===v?' on':''}" onclick="setPending(_nc,${v})">${v}</button>`).join('')}
      </div>
    </div>
    <div class="sc-info" id="sc-info">
      ${_nc} корт(а) × ${_ppc} = <strong>${_nc*_ppc}м + ${_nc*_ppc}ж</strong>
    </div>
    <div class="sc-row">
      <span class="sc-lbl">Пары:</span>
      <button class="seg-btn fixed-pairs-toggle${fixedPairs?' on':''}" onclick="toggleFixedPairs()">
        ${fixedPairs ? '🔗 Фиксированные' : '🔄 Ротация'}
      </button>
    </div>
    <div class="sc-btns">
      <button class="btn-apply" onclick="applySettings()">✅ Применить</button>
      <button class="btn-dist"  onclick="autoDistribute()">📋 Распределить</button>
    </div>
    <div class="sc-warn">⚠️ Изменение настроек сбросит очки</div>
  </div>

  <!-- 3. Таймер -->
  <div class="settings-card">
    <div class="sc-title">⏱ Длительность таймера</div>
    <div class="sc-row">
      <span class="sc-lbl">Корты (К1–К${nc})</span>
      <div style="display:flex;align-items:center;gap:6px">
        <button class="timer-custom-btn" onclick="timerCustomStep(0,-1)">−</button>
        <div class="timer-custom-val active" id="roster-tmr-courts">${timerState[0].preset} мин</div>
        <button class="timer-custom-btn" onclick="timerCustomStep(0,1)">+</button>
      </div>
    </div>
    <div class="sc-row">
      <span class="sc-lbl">Финалы (HD/AV/MD/LT)</span>
      <div style="display:flex;align-items:center;gap:6px">
        <button class="timer-custom-btn" onclick="timerCustomStep(4,-1)">−</button>
        <div class="timer-custom-val active" id="roster-tmr-divs">${timerState[4].preset} мин</div>
        <button class="timer-custom-btn" onclick="timerCustomStep(4,1)">+</button>
      </div>
    </div>
    <div class="sc-info">Диапазон: 2–25 минут</div>
    <div class="sc-row" style="margin-top:8px">
      <span class="sc-lbl">Тема:</span>
      <button class="solar-toggle-roster seg-btn on" onclick="toggleSolar()">
        ${document.body.classList.contains('solar') ? '🌙 Ночь' : '☀️ Пляж'}
      </button>
    </div>
  </div>

  <!-- 4. Защита ростера -->
  <div class="settings-card">
    <div class="sc-title">🔐 Доступ к ростеру</div>
    <div class="sc-info">
      ${hasRosterPassword()
        ? (rosterUnlocked
            ? 'Пароль установлен. Это устройство разблокировано до закрытия вкладки.'
            : 'Пароль установлен. Для изменения составов нужен пароль.')
        : 'Пароль не настроен. Защита хранится локально в браузере и не заменяет серверную авторизацию.'}
    </div>
    <div class="sc-row">
      <span class="sc-lbl">Статус:</span>
      <span class="sc-info" style="margin:0;padding:0;border:none;background:none">
        ${hasRosterPassword()
          ? (rosterUnlocked ? '🔓 Доступ открыт' : '🔒 Требуется пароль')
          : '⚪ Защита отключена'}
      </span>
    </div>
    <div class="sc-btns">
      <button class="btn-apply" onclick="rosterConfigurePassword()">
        ${hasRosterPassword() ? '🔁 Сменить пароль' : '🔐 Установить пароль'}
      </button>
      ${hasRosterPassword() ? `
        <button class="btn-dist" onclick="${rosterUnlocked ? 'rosterLockNow()' : 'rosterUnlockNow()'}">
          ${rosterUnlocked ? '🔒 Заблокировать' : '🔓 Разблокировать'}
        </button>
        <button class="btn-dist" style="background:#3a2230;border-color:#7a3550;color:#ffd7e4"
          onclick="rosterRemovePassword()">🗑 Убрать пароль</button>
      ` : ''}
    </div>
    <div class="sc-warn">Локальная защита: действует только на этом устройстве.</div>
  </div>`;

  // ── 5. Ростер составы ────────────────────────────────────────
  for (let ci = 0; ci < nc; ci++) {
    const ct   = ALL_COURTS[ci];
    const meta = COURT_META[ci];
    const men   = ct.men.slice(0,ppc);
    const women = ct.women.slice(0,ppc);
    const incomplete = men.some(n=>!n.trim()) || men.length < ppc;
    html += `<div class="rc-block">
      <div class="rc-hdr" style="background:linear-gradient(90deg,${meta.color}20,transparent);border-bottom:2px solid ${meta.color}35">
        <span style="color:${meta.color}">${meta.name}</span>
        <span style="font-size:11px;color:var(--muted)">${ppc}м + ${ppc}ж</span>
      </div>
      <div class="rc-grid">
        <div class="rc-col-hdr m">🏋️ Мужчины</div>
        <div class="rc-col-hdr w">👩 Женщины</div>`;
    for (let pi = 0; pi < ppc; pi++) {
      html += `
        <div class="rc-entry"><span class="rc-num">${pi+1}</span>
          <input class="rc-inp men-input" type="text" id="rc-${ci}-men-${pi}" value="${esc(men[pi]||'')}"
            data-ci="${ci}" data-g="men" data-pi="${pi}" placeholder="Фамилия"
            oninput="rosterAcShow(this)" onblur="setTimeout(rosterAcHide,200)"></div>
        <div class="rc-entry"><span class="rc-num">${pi+1}</span>
          <input class="rc-inp women-input" type="text" id="rc-${ci}-women-${pi}" value="${esc(women[pi]||'')}"
            data-ci="${ci}" data-g="women" data-pi="${pi}" placeholder="Фамилия"
            oninput="rosterAcShow(this)" onblur="setTimeout(rosterAcHide,200)"></div>`;
    }
    html += `</div>`;
    if (incomplete) html += `<div class="rc-warn">⚠️ Внимание: неполный состав</div>`;
    html += `</div>`;
  }

  // Tournament Manager + Player DB
  html += `<div class="trn-mgr-wrap" id="roster-trn-section">${_rosterTrnHtml()}</div>`;
  html += `<div class="rdb-wrap" id="roster-db-section">${_rdbBodyHtml()}</div>`;

  // ── 5. Сохранить / Сброс / Новый состав ─────────────────────
  html += `<div class="roster-save-bar">
    <button class="btn-rsr primary"   onclick="applyRoster()">✅ Сохранить</button>
    <button class="btn-rsr sec"       onclick="resetRosterNames()">↺ Сброс имён</button>
    <button class="btn-rsr danger"    onclick="clearRoster()">🧹 Новый состав</button>
  </div>`;

  // ── Низ: Завершить / Сброс / Supabase / GSheets / Backup / History ──
  html += `<button class="btn-finish" onclick="finishTournament()">
    🏁 ЗАВЕРШИТЬ ТУРНИР
  </button>
  <div style="margin-top:12px;padding:14px;background:linear-gradient(135deg,#1a1a2e,#16213e);border:1px solid rgba(233,69,96,.2);border-radius:12px">
    <div style="color:var(--muted);font-size:12px;margin-bottom:10px;text-align:center">⚠️ Сброс очищает все результаты. Ростер сохраняется.</div>
    <button class="btn-reset-tournament" onclick="resetTournament()">🗑 Сбросить турнир</button>
  </div>

  ${renderSupabaseCard()}

  ${typeof renderAdminPanel === 'function' ? renderAdminPanel() : ''}

  ${renderGSheetsCard()}

  <div class="backup-card" id="backup-card">
    <div class="backup-title">💾 Резервное копирование</div>
    <div class="backup-sub">Сохраните все данные (игроки + турниры) в один файл.<br>Используйте для переноса между устройствами или как защиту от очистки браузера.</div>
    <div class="backup-btns">
      <button class="backup-btn export" onclick="exportData()">
        📥 Экспортировать базу
      </button>
      <label class="backup-btn import" style="cursor:pointer">
        📤 Импортировать из файла
        <input type="file" accept=".json" style="display:none"
          onchange="importData(this.files[0]);this.value=''"
          capture="">
      </label>
    </div>
    <div class="backup-info-row">
      ℹ️ Формат файла: <b>kotc3_backup_YYYY-MM-DD.json</b> · Совместим с любым устройством
    </div>
  </div>

  <div class="history-card">
    <div class="history-hdr">
      <span class="history-hdr-title">📋 Лента событий (450)</span>
      <button class="btn-clear-log" onclick="clearHistory()">Очистить</button>
    </div>
    <div class="history-filter-bar">
      ${[
        {f:'all',   label:'Все'},
        {f:'k0',    label:'К1'},
        {f:'k1',    label:'К2'},
        {f:'k2',    label:'К3'},
        {f:'k3',    label:'К4'},
        {f:'hard',    label:'🔥'},
        {f:'advance', label:'⚡'},
        {f:'medium',  label:'⚙️'},
        {f:'lite',    label:'🍀'},
      ].map(({f,label})=>`<button class="hf-btn${historyFilter===f?' on':''}" data-f="${f}" onclick="setHistoryFilter('${f}')">${label}</button>`).join('')}
    </div>
    <div class="history-list" id="admin-history-log">${renderHistoryLog()}</div>
  </div>`;
  return html;
}
