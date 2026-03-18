'use strict';

// ════════════════════════════════════════════════════════════
// GOOGLE SHEETS MODULE
// ════════════════════════════════════════════════════════════
let gshConfig = { ...DEFAULT_GSH_CONFIG };
let gshToken = null;       // current OAuth access token
let gshTokenExpiry = 0;    // timestamp when token expires

function gshLoadConfig() {
  try {
    const c = localStorage.getItem('kotc3_gsh');
    if (c) gshConfig = { ...gshConfig, ...JSON.parse(c) };
  } catch(e) { console.warn('[gshLoadConfig] Config parse error:', e); }
}

function gshSaveConfig() {
  localStorage.setItem('kotc3_gsh', JSON.stringify(gshConfig));
}

function gshIsConnected() {
  return gshToken && Date.now() < gshTokenExpiry;
}

// ── Render config card (inside renderRoster) ─────────────
function renderGSheetsCard() {
  const connected = gshIsConnected();
  const hasClientId = !!gshConfig.clientId.trim();
  return `<div class="gsh-card">
    <div class="gsh-title">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style="flex-shrink:0">
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#34a853" opacity=".2"/>
        <path d="M8 8h8M8 12h8M8 16h5" stroke="#34a853" stroke-width="2" stroke-linecap="round"/>
        <rect x="14" y="11" width="7" height="7" rx="1" fill="#34a853"/>
        <path d="M16 16l1.5-1.5L19 16" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      Google Sheets
    </div>
    <div class="gsh-sub">Автоматически записывает результаты в таблицу Google при завершении турнира</div>

    <div class="gsh-status">
      <div class="gsh-dot${connected ? ' ok' : hasClientId ? '' : ' err'}"></div>
      <span style="color:${connected ? '#34a853' : 'var(--muted)'}">
        ${connected ? '✓ Подключено · токен активен' : hasClientId ? 'Не авторизован · нажмите Войти' : 'Не настроено · введите Client ID'}
      </span>
    </div>

    <div class="gsh-input-row">
      <label>OAuth 2.0 Client ID</label>
      <input class="gsh-input" type="text" id="gsh-client-id"
        value="${escAttr(gshConfig.clientId)}"
        placeholder="xxxxxxx.apps.googleusercontent.com"
        oninput="gshConfig.clientId=this.value.trim();gshSaveConfig();gshRefreshCard()">
      <div class="gsh-hint">
        <a href="https://console.cloud.google.com" target="_blank">console.cloud.google.com</a>
        → APIs & Services → Credentials → Create OAuth 2.0 Client ID (Web application)
      </div>
    </div>

    <div class="gsh-input-row">
      <label>Spreadsheet ID <span style="opacity:.5">(необязательно)</span></label>
      <input class="gsh-input" type="text" id="gsh-sheet-id"
        value="${escAttr(gshConfig.spreadsheetId)}"
        placeholder="Оставьте пустым — создаст новую таблицу"
        oninput="gshConfig.spreadsheetId=this.value.trim();gshSaveConfig()">
      <div class="gsh-hint">ID из URL: docs.google.com/spreadsheets/d/<b style="color:#34a853">ВОТ_ЭТО</b>/edit</div>
    </div>

    <div class="gsh-btns">
      ${connected
        ? `<button class="btn-gsh disconnect" onclick="gshDisconnect()">🔌 Отключить</button>`
        : `<button class="btn-gsh connect" onclick="gshConnect()" ${!hasClientId?'disabled':''}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>
            Войти через Google
          </button>`
      }
    </div>
  </div>`;
}

function gshRefreshCard() {
  const roster = document.getElementById('screen-roster');
  if (roster && roster.classList.contains('active')) {
    roster.innerHTML = renderRoster();
  }
}

// ── OAuth via Google Identity Services ───────────────────
function gshConnect() {
  if (!gshConfig.clientId) {
    showToast('⚠️ Введите Client ID'); return;
  }
  if (!window.google?.accounts?.oauth2) {
    showToast('⚠️ Нет подключения — скрипт Google не загружен'); return;
  }
  const client = google.accounts.oauth2.initTokenClient({
    client_id: gshConfig.clientId,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    callback: (resp) => {
      if (resp.error) {
        showToast('❌ Ошибка авторизации: ' + resp.error);
        return;
      }
      gshToken = resp.access_token;
      gshTokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
      showToast('✅ Google подключён!');
      gshRefreshCard();
    },
  });
  client.requestAccessToken();
}

function gshDisconnect() {
  if (gshToken && window.google?.accounts?.oauth2) {
    google.accounts.oauth2.revoke(gshToken);
  }
  gshToken = null; gshTokenExpiry = 0;
  showToast('🔌 Google отключён');
  gshRefreshCard();
}

// ── Sheets API helpers ────────────────────────────────────
async function gshFetch(url, opts = {}) {
  const resp = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': 'Bearer ' + gshToken,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!resp.ok) {
    const err = await resp.json().catch(()=>({error:{message:resp.statusText}}));
    throw new Error(err.error?.message || resp.statusText);
  }
  return resp.json();
}

async function gshGetOrCreateSpreadsheet(title) {
  if (gshConfig.spreadsheetId) return gshConfig.spreadsheetId;
  // Create new spreadsheet
  const data = await gshFetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    body: JSON.stringify({ properties: { title: 'КОТС — История турниров' } }),
  });
  const id = data.spreadsheetId;
  gshConfig.spreadsheetId = id;
  gshSaveConfig();
  gshRefreshCard();
  return id;
}

async function gshEnsureSheet(spreadsheetId, sheetTitle) {
  // Get existing sheets
  const meta = await gshFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`);
  const exists = meta.sheets?.some(s => s.properties.title === sheetTitle);
  if (exists) return;
  // Add sheet
  await gshFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: sheetTitle } } }]
    }),
  });
}

async function gshWriteTournament(tournament) {
  if (!gshIsConnected()) throw new Error('Нет авторизации Google');

  const dateStr = tournament.date || new Date().toISOString().split('T')[0];
  const sheetTitle = `${dateStr} ${tournament.name || 'Турнир'}`.slice(0, 60);

  const spreadsheetId = await gshGetOrCreateSpreadsheet();
  await gshEnsureSheet(spreadsheetId, sheetTitle);

  // Build rows
  const header = [
    ['КОРОЛЬ ПЛОЩАДКИ — ПРОТОКОЛ'],
    [tournament.name || 'Турнир'],
    [dateStr],
    [],
    ['Кортов', tournament.nc, 'Игроков на корт', tournament.ppc, 'Раундов сыграно', tournament.rPlayed, 'Сумма очков', tournament.totalScore],
    [],
    ['Место', 'Имя', 'Пол', 'Корт', 'Очки'],
  ];
  const rows = tournament.players.map((p, i) => [
    i + 1,
    p.name,
    p.gender === 'M' ? 'Мужчины' : 'Женщины',
    p.courtName || '—',
    p.totalPts,
  ]);
  const allRows = [...header, ...rows];

  await gshFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetTitle + '!A1')}:append?valueInputOption=USER_ENTERED&insertDataOption=OVERWRITE`,
    {
      method: 'POST',
      body: JSON.stringify({ values: allRows }),
    }
  );

  // Format header rows bold + color
  const sheetId = await gshFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`)
    .then(m => m.sheets?.find(s => s.properties.title === sheetTitle)?.properties?.sheetId);

  if (sheetId !== undefined) {
    await gshFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [
        // Title row bold + yellow bg
        { repeatCell: { range:{sheetId,startRowIndex:0,endRowIndex:1}, cell:{userEnteredFormat:{
          backgroundColor:{red:0.06,green:0.06,blue:0.1},
          textFormat:{bold:true,fontSize:14,foregroundColor:{red:1,green:0.78,blue:0.2}},
        }}, fields:'userEnteredFormat' }},
        // Column headers bold
        { repeatCell: { range:{sheetId,startRowIndex:6,endRowIndex:7}, cell:{userEnteredFormat:{
          backgroundColor:{red:0.12,green:0.12,blue:0.22},
          textFormat:{bold:true,foregroundColor:{red:0.53,green:0.53,blue:0.8}},
        }}, fields:'userEnteredFormat' }},
        // Auto-resize columns
        { autoResizeDimensions: { dimensions:{sheetId,dimension:'COLUMNS',startIndex:0,endIndex:5} }},
      ]})
    });
  }

  return spreadsheetId;
}

// ── Public export functions ───────────────────────────────
async function exportToSheetsFromHistory(id) {
  let history = [];
  try { history = JSON.parse(localStorage.getItem('kotc3_history') || '[]'); } catch(e){}
  const t = history.find(h => h.id === id);
  if (!t) return;
  await gshExportTournament(t, `gsh-btn-${id}`);
}

async function gshExportTournament(tournament, btnId) {
  if (!gshIsConnected()) {
    showToast('⚠️ Сначала войдите в Google (Ростер → Google Sheets)');
    return;
  }
  const btn = document.getElementById(btnId);
  if (btn) { btn.disabled = true; btn.textContent = '⏳ ...'; }
  try {
    const spreadsheetId = await gshWriteTournament(tournament);
    showToast('✅ Сохранено в Google Sheets!');
    // Open spreadsheet in new tab
    const w = window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}`, '_blank');
    if (!w) showToast('⚠️ Разрешите всплывающие окна для открытия таблицы');
  } catch(e) {
    showToast('❌ Ошибка: ' + e.message);
    console.error(e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📊 Sheets'; }
  }
}
