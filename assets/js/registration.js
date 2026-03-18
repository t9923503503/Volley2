'use strict';

// ══════════════════════════════════════════════════════════════
// REGISTRATION MODULE — Supabase-backed tournament sign-up
// ══════════════════════════════════════════════════════════════

/**
 * Архитектура:
 *   Supabase = primary source для регистрации
 *   localStorage = кеш + fallback офлайн
 *
 * Потоки:
 *   1. Найден в базе   → safe_register_player (RPC)
 *   2. Не найден        → "Отправить заявку" (insert player_requests)
 *                    ИЛИ → "Быстрая запись"  (insert players[temporary] + RPC)
 */

// ── State ────────────────────────────────────────────────────
let _regTrnId       = null;   // текущий турнир UUID
let _regTrnLocal    = null;   // локальный объект турнира (fallback)
let _regDebounce    = null;
let _regFormMode    = null;   // null | 'request' | 'temp'
let _regFormGender  = 'M';
let _regResults     = [];
let _regStatusMsg   = null;   // {type, text}

// ── Helpers ──────────────────────────────────────────────────
function _regSb() {
  if (sbClient) return sbClient;
  // Попытка создать клиент если не подключен
  if (typeof supabase !== 'undefined' && sbConfig.url && sbConfig.anonKey) {
    sbClient = supabase.createClient(sbConfig.url, sbConfig.anonKey);
    return sbClient;
  }
  return null;
}

function _regIsOnline() { return !!_regSb(); }

// ── Open Modal ───────────────────────────────────────────────
function openRegistrationModal(trnId, localTrn) {
  document.getElementById('reg-modal')?.remove();
  _regTrnId      = trnId;
  _regTrnLocal   = localTrn || getTournaments().find(t => t.id === trnId) || null;
  _regFormMode   = null;
  _regFormGender = 'M';
  _regResults    = [];
  _regStatusMsg  = null;

  const overlay       = document.createElement('div');
  overlay.id          = 'reg-modal';
  overlay.className   = 'reg-overlay';
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeRegistrationModal();
  });

  overlay.innerHTML = _regModalHtml();
  document.body.appendChild(overlay);

  // Авто-фокус на поиске
  setTimeout(() => document.getElementById('reg-search')?.focus(), 120);
}

function closeRegistrationModal() {
  document.getElementById('reg-modal')?.remove();
  _regTrnId = null;
  _regFormMode = null;
  _regResults = [];
}

// ── Render ────────────────────────────────────────────────────
function _regModalHtml() {
  const trnName = _regTrnLocal?.name || 'Турнир';
  const cap     = _regTrnLocal?.capacity || '?';
  const online  = _regIsOnline();

  const resultsHtml = _regResults.length > 0
    ? _regResults.map(p => `
        <div class="reg-result-item" id="reg-p-${p.id}"
          onclick="regSelectPlayer('${escAttr(p.id)}', '${escAttr(p.name)}')">
          <div class="reg-result-avatar ${p.gender}">
            ${p.gender === 'M' ? '🏋️' : '👩'}
          </div>
          <div class="reg-result-info">
            <div class="reg-result-name">${esc(p.name)}</div>
            <div class="reg-result-meta">
              ${p.status === 'temporary' ? '<span class="temp">ВРЕМЕННЫЙ</span>' : ''}
              <span>🏆 ${p.tournaments || 0} турн.</span>
              <span>⭐ ${p.totalPts || 0} очков</span>
            </div>
          </div>
          <div class="reg-result-action">→</div>
        </div>`).join('')
    : '';

  const emptyHtml = !_regFormMode ? `
    <div class="reg-empty">
      <div class="reg-empty-text">
        ${_regResults.length === 0 && _regLastQuery?.length > 1
          ? '😕 Игрок не найден в базе. Выберите действие:'
          : '🔍 Начните вводить фамилию для поиска'}
      </div>
      ${_regResults.length === 0 && _regLastQuery?.length > 1 ? `
      <div class="reg-new-options">
        <button class="reg-new-btn request" onclick="regShowForm('request')">
          📝 Отправить заявку в базу
        </button>
        <button class="reg-new-btn temp" onclick="regShowForm('temp')">
          ⚡ Создать временного и записать сразу
        </button>
      </div>` : ''}
    </div>` : '';

  const formHtml = _regFormMode ? _regFormHtml() : '';

  const statusHtml = _regStatusMsg
    ? `<div class="reg-status ${_regStatusMsg.type}">${esc(_regStatusMsg.text)}</div>` : '';

  return `
  <div class="reg-modal">
    <div class="reg-accent"></div>
    <div class="reg-header">
      <div class="reg-title">⚡ Запись на турнир</div>
      <div class="reg-subtitle">${esc(trnName)} · мест: ${cap}
        ${online
          ? '<span style="color:var(--green)">● онлайн</span>'
          : '<span style="color:var(--red)">● офлайн</span>'}
      </div>
      <div class="reg-search-wrap">
        <span class="reg-search-icon">🔍</span>
        <input class="reg-search-inp" id="reg-search"
          type="text" placeholder="Поиск по фамилии…"
          autocomplete="off"
          oninput="regOnSearch(this.value)">
        <div class="reg-search-spin" id="reg-spin"></div>
      </div>
    </div>
    <div class="reg-body">
      <div class="reg-results" id="reg-results">${resultsHtml}</div>
      ${emptyHtml}
      ${formHtml}
      ${statusHtml}
    </div>
    <div class="reg-footer">
      <button class="reg-btn-close" onclick="closeRegistrationModal()">Закрыть</button>
    </div>
  </div>`;
}

function _regRefresh() {
  const overlay = document.getElementById('reg-modal');
  if (overlay) overlay.innerHTML = _regModalHtml();
  // Восстановить фокус и значение поиска
  const inp = document.getElementById('reg-search');
  if (inp && _regLastQuery) {
    inp.value = _regLastQuery;
    inp.focus();
    // Курсор в конец
    inp.setSelectionRange(inp.value.length, inp.value.length);
  }
}

let _regLastQuery = '';

// ── Debounced Search ─────────────────────────────────────────
function regOnSearch(query) {
  _regLastQuery = query;
  _regFormMode  = null;
  _regStatusMsg = null;

  if (_regDebounce) clearTimeout(_regDebounce);

  const q = query.trim();
  if (q.length < 2) {
    _regResults = [];
    _regRefresh();
    return;
  }

  // Показать спиннер
  const spin = document.getElementById('reg-spin');
  if (spin) spin.classList.add('active');

  _regDebounce = setTimeout(async () => {
    // ── Helper: search localStorage (returns canonical players) ──
    function _searchLocal(lq) {
      const db = loadPlayerDB();
      return db
        .filter(p => p.name.toLowerCase().includes(lq))
        .sort((a, b) => {
          const aStart = a.name.toLowerCase().startsWith(lq) ? 1 : 0;
          const bStart = b.name.toLowerCase().startsWith(lq) ? 1 : 0;
          return bStart - aStart || (b.tournaments || 0) - (a.tournaments || 0);
        })
        .slice(0, 10);
    }

    const lq = q.toLowerCase();
    try {
      if (_regIsOnline()) {
        // ── Supabase search (RPC) ──
        const { data, error } = await _regSb().rpc('search_players', {
          p_query: q, p_gender: null, p_limit: 10
        });
        if (error) throw error;
        // Merge: Supabase results + local-only players (by id dedup)
        const remote = data || [];
        const remoteCanonical = remote.map(r => fromSupabasePlayer(r)).filter(Boolean);
        const local  = _searchLocal(lq);
        const seenIds = new Set(remoteCanonical.map(r => r.id));
        _regResults = [...remoteCanonical, ...local.filter(l => !seenIds.has(l.id))].slice(0, 15);
      } else {
        _regResults = _searchLocal(lq);
      }
    } catch (err) {
      console.error('[REG] Search error, fallback to local:', err);
      // ── Fallback to localStorage on any error ──
      _regResults = _searchLocal(lq);
    }
    // Убрать спиннер и обновить
    const sp = document.getElementById('reg-spin');
    if (sp) sp.classList.remove('active');
    _regRefresh();
  }, 300); // 300ms debounce
}

// ── Register Existing Player ─────────────────────────────────
async function regSelectPlayer(playerId, playerName) {
  // ① Optimistic UI — пометить элемент
  const el = document.getElementById('reg-p-' + playerId);
  if (el) {
    el.classList.add('registering');
    el.querySelector('.reg-result-action').textContent = '⏳';
  }

  try {
    if (_regIsOnline()) {
      const match = _regResults.find(p => String(p.id) === String(playerId));
      // ── Supabase RPC ──
      const { data, error } = await _regSb().rpc('safe_register_player', {
        p_tournament_id: _regTrnId,
        p_player_id:     playerId
      });
      if (error) throw error;

      if (data.ok) {
        upsertPlayerInDB(
          match ? { ...match, id: playerId, name: playerName }
          : { id: playerId, name: playerName, gender: 'M', status: 'active', tournaments: 0, totalPts: 0 }
        );
        // Синхронизируем с localStorage
        _regSyncLocalParticipant(playerId, data.waitlist);
        // Закрыть модалку и показать toast
        closeRegistrationModal();
        showToast(data.message || playerName + ' зарегистрирован(а)', data.waitlist ? 'warning' : 'success');
        return;
      } else {
        // RPC вернул ошибку
        throw new Error(data.message || data.error);
      }
    } else {
      // ── Offline fallback: localStorage ──
      const arr = getTournaments();
      const trn = arr.find(t => t.id === _regTrnLocal?.id);
      if (!trn) throw new Error('Турнир не найден в localStorage');

      if (trn.participants.includes(playerId) || (trn.waitlist||[]).includes(playerId)) {
        throw new Error(playerName + ' уже зарегистрирован(а)');
      }

      const isWaitlist = trn.participants.length >= trn.capacity;
      if (isWaitlist) {
        trn.waitlist = trn.waitlist || [];
        trn.waitlist.push(playerId);
      } else {
        trn.participants.push(playerId);
        if (trn.participants.length >= trn.capacity) trn.status = 'full';
      }
      saveTournaments(arr);

      const msg = isWaitlist
        ? playerName + ' → лист ожидания'
        : playerName + ' зарегистрирован(а) (' + trn.participants.length + '/' + trn.capacity + ')';
      closeRegistrationModal();
      showToast(msg, isWaitlist ? 'warning' : 'success');
      return;
    }
  } catch (err) {
    console.error('[REG] Register error, fallback to local:', err);
    // ── Fallback: try localStorage registration ──
    try {
      const arr = getTournaments();
      const trn = arr.find(t => t.id === _regTrnId) || arr.find(t => t.id === _regTrnLocal?.id);
      if (!trn) throw new Error('Турнир не найден');

      if ((trn.participants||[]).includes(playerId) || (trn.waitlist||[]).includes(playerId)) {
        throw new Error(playerName + ' уже зарегистрирован(а)');
      }

      const isWaitlist = (trn.participants||[]).length >= trn.capacity;
      if (isWaitlist) {
        trn.waitlist = trn.waitlist || [];
        trn.waitlist.push(playerId);
      } else {
        trn.participants = trn.participants || [];
        trn.participants.push(playerId);
        if (trn.participants.length >= trn.capacity) trn.status = 'full';
      }
      saveTournaments(arr);

      const msg2 = isWaitlist
        ? playerName + ' → лист ожидания'
        : playerName + ' зарегистрирован(а) (' + trn.participants.length + '/' + trn.capacity + ')';
      closeRegistrationModal();
      showToast(msg2, isWaitlist ? 'warning' : 'success');
      return;
    } catch (localErr) {
      _regStatusMsg = { type: 'error', text: '❌ ' + (localErr.message || 'Ошибка регистрации') };
      if (el) {
        el.classList.remove('registering');
        el.querySelector('.reg-result-action').textContent = '→';
      }
    }
  }

  _regRefresh();
}

// ── "Not Found" Form ─────────────────────────────────────────
function regShowForm(mode) {
  _regFormMode = mode; // 'request' | 'temp'
  _regStatusMsg = null;
  _regRefresh();
  setTimeout(() => document.getElementById('reg-new-name')?.focus(), 80);
}

function regSetGender(g) {
  _regFormGender = g;
  ['M','W'].forEach(x => {
    const b = document.getElementById('reg-g-' + x);
    if (b) b.className = 'reg-gender-btn' + (x === g ? ' sel-' + g : '');
  });
}

function _regFormHtml() {
  const isReq = _regFormMode === 'request';
  // Pre-fill name from search input
  const prefillName = _regLastQuery || '';

  return `
  <div class="reg-form">
    <div class="reg-form-title">${isReq ? '📝 Заявка в базу' : '⚡ Быстрая запись'}</div>
    <div class="reg-form-row">
      <input class="reg-form-inp" id="reg-new-name" type="text"
        placeholder="Фамилия Имя" value="${esc(prefillName)}">
      <div class="reg-gender-btns">
        <button class="reg-gender-btn ${_regFormGender==='M'?'sel-M':''}"
          id="reg-g-M" onclick="regSetGender('M')">М</button>
        <button class="reg-gender-btn ${_regFormGender==='W'?'sel-W':''}"
          id="reg-g-W" onclick="regSetGender('W')">Ж</button>
      </div>
    </div>
    ${isReq ? `
    <div class="reg-form-row">
      <input class="reg-form-inp" id="reg-new-phone" type="tel"
        placeholder="Телефон (необязательно)">
    </div>` : ''}
    <button class="reg-form-submit ${isReq ? 'request' : 'temp'}"
      id="reg-submit-btn"
      onclick="${isReq ? 'regSubmitRequest()' : 'regSubmitTemp()'}">
      ${isReq ? '📝 Отправить заявку' : '⚡ Создать и записать'}
    </button>
  </div>`;
}

// ── Submit: Player Request ───────────────────────────────────
async function regSubmitRequest() {
  const name  = (document.getElementById('reg-new-name')?.value || '').trim();
  const phone = (document.getElementById('reg-new-phone')?.value || '').trim();
  if (!name) { showToast('Введите фамилию', 'error'); return; }

  const btn = document.getElementById('reg-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Отправляю…'; }

  try {
    if (_regIsOnline()) {
      const { data, error } = await _regSb().rpc('submit_player_request', {
        p_name:          name,
        p_gender:        _regFormGender,
        p_phone:         phone || null,
        p_tournament_id: _regTrnId || null
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.message || data?.error || 'Ошибка отправки');

      _regStatusMsg = {
        type: 'success',
        text: '📝 ' + (data.message || (name + ' будет добавлен(а) после проверки.'))
      };
      _regFormMode = null;
    } else {
      // Offline — сохраняем в localStorage очередь
      const queue = JSON.parse(localStorage.getItem('kotc3_player_requests') || '[]');
      queue.push({ name, gender: _regFormGender, phone, trnId: _regTrnId, ts: Date.now() });
      localStorage.setItem('kotc3_player_requests', JSON.stringify(queue));

      _regStatusMsg = {
        type: 'success',
        text: '📝 Заявка сохранена локально. Отправится при подключении к Supabase.'
      };
      _regFormMode = null;
    }
  } catch (err) {
    console.error('[REG] Request error:', err);
    _regStatusMsg = { type: 'error', text: '❌ ' + (err.message || 'Ошибка отправки') };
    if (btn) { btn.disabled = false; btn.textContent = '📝 Отправить заявку'; }
  }

  _regRefresh();
}

// ── Submit: Temporary Player + Instant Register ──────────────
async function regSubmitTemp() {
  const name = (document.getElementById('reg-new-name')?.value || '').trim();
  if (!name) { showToast('Введите фамилию', 'error'); return; }

  const btn = document.getElementById('reg-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Создаю…'; }

  try {
    if (_regIsOnline()) {
      // ① Создаём или находим профиль через RPC
      const { data: playerRpc, error: pErr } = await _regSb().rpc('create_temporary_player', {
        p_name:   name,
        p_gender: _regFormGender
      });
      if (pErr) throw pErr;
      if (!playerRpc?.ok || !playerRpc.player?.id) {
        throw new Error(playerRpc?.message || playerRpc?.error || 'Ошибка создания игрока');
      }
      const remotePlayer = playerRpc.player;
      upsertPlayerInDB(fromSupabasePlayer(remotePlayer) || {
        id: remotePlayer.id,
        name: remotePlayer.name,
        gender: remotePlayer.gender || _regFormGender,
        status: remotePlayer.status || 'temporary',
        tournaments: remotePlayer.tournaments_played ?? 0,
        totalPts: remotePlayer.total_pts ?? 0,
      });

      // ② Сразу регистрируем через RPC
      const { data: reg, error: rErr } = await _regSb().rpc('safe_register_player', {
        p_tournament_id: _regTrnId,
        p_player_id:     remotePlayer.id
      });
      if (rErr) throw rErr;

      if (reg.ok) {
        const profileLabel = playerRpc.created
          ? 'временный игрок'
          : (remotePlayer.status === 'temporary' ? 'существующий временный профиль' : 'существующий профиль');
        _regStatusMsg = {
          type: reg.waitlist ? 'waitlist' : 'success',
          text: reg.message + ' (' + profileLabel + ')'
        };
        // Синхронизируем в localStorage
        _regSyncLocalParticipant(remotePlayer.id, reg.waitlist);
      } else {
        throw new Error(reg.message || reg.error);
      }
      _regFormMode = null;

    } else {
      // ── Offline fallback ──
      // Создаём в localStorage playerDB
      const newP = upsertPlayerInDB({ name, gender: _regFormGender, status: 'temporary' });

      if (newP && _regTrnLocal) {
        // Регистрируем локально
        const arr = getTournaments();
        const trn = arr.find(t => t.id === _regTrnLocal.id);
        if (trn) {
          const isWaitlist = trn.participants.length >= trn.capacity;
          if (isWaitlist) {
            trn.waitlist = trn.waitlist || [];
            trn.waitlist.push(newP.id);
          } else {
            trn.participants.push(newP.id);
            if (trn.participants.length >= trn.capacity) trn.status = 'full';
          }
          saveTournaments(arr);

          _regStatusMsg = {
            type: isWaitlist ? 'waitlist' : 'success',
            text: name + (isWaitlist ? ' → лист ожидания' : ' записан(а)') + ' (временный)'
          };
        }
      }
      _regFormMode = null;
    }
  } catch (err) {
    console.error('[REG] Temp player error:', err);
    _regStatusMsg = { type: 'error', text: '❌ ' + (err.message || 'Ошибка создания') };
    if (btn) { btn.disabled = false; btn.textContent = '⚡ Создать и записать'; }
  }

  _regRefresh();
}

// ── Sync helper: update localStorage after Supabase registration ──
function _regSyncLocalParticipant(playerId, isWaitlist) {
  if (!_regTrnLocal?.id) return;
  try {
    const arr = getTournaments();
    const trn = arr.find(t => t.id === _regTrnLocal.id);
    if (!trn) return;
    if (isWaitlist) {
      trn.waitlist = trn.waitlist || [];
      if (!trn.waitlist.includes(playerId)) trn.waitlist.push(playerId);
    } else {
      if (!trn.participants.includes(playerId)) trn.participants.push(playerId);
      if (trn.participants.length >= trn.capacity) trn.status = 'full';
    }
    saveTournaments(arr);
  } catch(e) { console.error('[addToTournament] saveTournaments failed:', e); }
}


// ── Export / Import ───────────────────────────────────────────
// ══ Backup / Restore ══════════════════════════════════════════
const BACKUP_VERSION = '1.0';

/**
 * Full backup: kotc3_playerdb + kotc3_tournaments → single JSON file.
 * File name: kotc3_backup_YYYY-MM-DD.json
 */
function exportData() {
  try {
    const players     = loadPlayerDB();
    const tournaments = getTournaments();
    const payload = {
      version:     BACKUP_VERSION,
      timestamp:   new Date().toISOString(),
      players,
      tournaments,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'kotc3_backup_' + new Date().toISOString().split('T')[0] + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast(`✅ Бэкап создан: ${players.length} игроков, ${tournaments.length} турниров`, 'success');
  } catch (err) {
    showToast('Ошибка экспорта: ' + err.message, 'error');
  }
}

/**
 * Full restore from backup file.
 * Validates structure, shows confirm, writes both keys, recalculates stats, re-renders.
 * @param {File} file
 */
function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onerror = () => showToast('Не удалось прочитать файл', 'error');
  reader.onload  = async e => {
    let parsed;
    try { parsed = JSON.parse(e.target.result); }
    catch { showToast('❌ Повреждённый файл — не является валидным JSON', 'error'); return; }

    // Structure validation
    if (typeof parsed !== 'object' || parsed === null) {
      showToast('❌ Неверная структура файла', 'error'); return;
    }
    if (!Array.isArray(parsed.players) && typeof parsed.players !== 'object') {
      showToast('❌ Поле players отсутствует или имеет неверный тип', 'error'); return;
    }
    if (!Array.isArray(parsed.tournaments)) {
      showToast('❌ Поле tournaments должно быть массивом', 'error'); return;
    }
    // Minimum tournament record check
    const TRN_KEYS = ['id', 'name', 'date', 'status', 'participants'];
    const badTrn = parsed.tournaments.find(t => TRN_KEYS.some(k => !(k in t)));
    if (badTrn) {
      showToast('❌ Найдены турниры с неполной структурой', 'error'); return;
    }

    // Normalise players: accept both array (our format) and object (Grok format)
    const playersArr = Array.isArray(parsed.players)
      ? parsed.players
      : Object.values(parsed.players);

    const ts  = parsed.tournaments.length;
    const ps  = playersArr.length;
    const ver = parsed.version ? ` (v${parsed.version})` : '';

    if (!await showConfirm(
      `Восстановить данные из бэкапа${ver}?\n` +
      `• ${ps} игроков • ${ts} турниров\n` +
      `⚠️ Текущие данные будут ПОЛНОСТЬЮ ЗАМЕНЕНЫ.`
    )) return;

    try {
      savePlayerDB(playersArr);
      saveTournaments(parsed.tournaments);
      recalcAllPlayerStats(/*silent*/ true);
      showToast(`✅ Восстановлено: ${ps} игроков, ${ts} турниров`, 'success');
      // Re-render active screens
      const homeScr = document.getElementById('screen-home');
      if (homeScr?.classList.contains('active')) homeScr.innerHTML = renderHome();
      const rosterScr = document.getElementById('screen-roster');
      if (rosterScr?.classList.contains('active')) rosterScr.innerHTML = renderRoster();
      const plrScr = document.getElementById('screen-players');
      if (plrScr?.classList.contains('active')) plrScr.innerHTML = renderPlayers();
      _refreshRosterTrn();
    } catch (writeErr) {
      showToast('Ошибка записи: ' + writeErr.message, 'error');
    }
  };
  reader.readAsText(file);
}

/** Legacy alias — kept for backward compat with old trn-mgr header buttons */
function exportTournamentsJSON() { exportData(); }
function importTournamentsJSON(file) { importData(file); }

// ── Render ────────────────────────────────────────────────────
function _refreshRosterTrn() {
  const el = document.getElementById('roster-trn-section');
  if (el) el.innerHTML = _rosterTrnHtml();
}

function _rosterTrnHtml() {
  const arr     = getTournaments();
  const editTrn = rosterTrnEditId !== null ? arr.find(t => t.id === rosterTrnEditId) : null;

  const formHtml = rosterTrnFormOpen ? `
    <div class="trn-mgr-form">
      <div class="trn-mgr-form-title">${editTrn ? '✏️ Редактировать турнир' : '➕ Новый турнир'}</div>
      <div class="trn-form-grid">
        <div class="trn-form-full">
          <label class="trn-form-label">Название</label>
          <input class="trn-form-inp" id="trnf-name" type="text" placeholder="Название турнира"
            value="${esc(editTrn?.name || '')}">
        </div>
        <div>
          <label class="trn-form-label">Дата</label>
          <input class="trn-form-inp" id="trnf-date" type="date"
            value="${editTrn?.date || ''}">
        </div>
        <div>
          <label class="trn-form-label">Время</label>
          <input class="trn-form-inp" id="trnf-time" type="time"
            value="${editTrn?.time || '09:00'}">
        </div>
        <div class="trn-form-full">
          <label class="trn-form-label">Место проведения</label>
          <input class="trn-form-inp" id="trnf-loc" type="text" placeholder="Пляж / адрес"
            value="${esc(editTrn?.location || '')}">
        </div>
        <div>
          <label class="trn-form-label">Формат</label>
          <select class="trn-form-sel" id="trnf-format" onchange="_trnfFormatChange(this.value)">
            ${['King of the Court','IPT Mixed','Царь горы','Случайные связки','Double Trouble','Round Robin','Олимпийская система','Другой'].map(f =>
              `<option value="${f}" ${(editTrn?.format || 'King of the Court') === f ? 'selected' : ''}>${f}</option>`
            ).join('')}
          </select>
        </div>
        <div>
          <label class="trn-form-label">Дивизион</label>
          <select class="trn-form-sel" id="trnf-div">
            ${['Мужской','Женский','Микст'].map(d =>
              `<option value="${d}" ${(editTrn?.division || 'Мужской') === d ? 'selected' : ''}>${d}</option>`
            ).join('')}
          </select>
        </div>
        <div>
          <label class="trn-form-label">Уровень</label>
          <select class="trn-form-sel" id="trnf-level">
            ${[['hard','Хард (Pro)'],['medium','Средний'],['easy','Лайт']].map(([v,l]) =>
              `<option value="${v}" ${(editTrn?.level || 'medium') === v ? 'selected' : ''}>${l}</option>`
            ).join('')}
          </select>
        </div>
        <div>
          <label class="trn-form-label">Мест (ёмкость)</label>
          <input class="trn-form-inp" id="trnf-cap" type="number" min="4" max="200"
            value="${editTrn?.capacity || 24}">
        </div>
        <div id="trnf-ipt-opts" style="display:${(editTrn?.format || '') === 'IPT Mixed' ? '' : 'none'}">
          <label class="trn-form-label">⚡ Лимит очков (IPT)</label>
          <input class="trn-form-inp" id="trnf-ipt-limit" type="number" min="1" max="999"
            value="${Number.isFinite(+editTrn?.ipt?.pointLimit) ? +editTrn.ipt.pointLimit : 21}">
        </div>
        <div id="trnf-ipt-type" style="display:${(editTrn?.format || '') === 'IPT Mixed' ? '' : 'none'}">
          <label class="trn-form-label">🏁 Тип завершения (IPT)</label>
          <select class="trn-form-sel" id="trnf-ipt-finish">
            <option value="hard" ${(editTrn?.ipt?.finishType || 'hard') === 'hard' ? 'selected' : ''}>Жёсткий лимит</option>
            <option value="balance" ${(editTrn?.ipt?.finishType || '') === 'balance' ? 'selected' : ''}>До разрыва ±2</option>
          </select>
        </div>
        <div class="trn-form-full">
          <label class="trn-form-label trn-form-toggle-label">
            <input type="checkbox" id="trnf-prize-toggle" ${editTrn?.prize ? 'checked' : ''}
              onchange="document.getElementById('trnf-prize-wrap').style.display=this.checked?'':'none'">
            Призовой фонд
          </label>
          <div id="trnf-prize-wrap" style="display:${editTrn?.prize ? '' : 'none'}">
            <input class="trn-form-inp" id="trnf-prize" type="text" placeholder="Например: 10 000 ₽"
              value="${esc(editTrn?.prize || '')}">
          </div>
        </div>
      </div>
      <div class="trn-form-btns">
        <button class="trn-form-save" onclick="submitTournamentForm()">
          ${editTrn ? '💾 Сохранить' : '➕ Добавить'}
        </button>
        <button class="trn-form-cancel" onclick="closeTrnForm()">Отмена</button>
      </div>
    </div>` : '';

  const STATUS_LABELS = { open:'Открыт', full:'Заполнен', finished:'Завершён', cancelled:'Отменён' };

  const rows = arr.length ? arr.map(t => {
    const reg      = t.participants.length;
    const levelLbl = TRN_LEVEL_LABELS[t.level] || t.level;
    const statusLbl = STATUS_LABELS[t.status]  || t.status;
    const isActive  = t.status !== 'finished' && t.status !== 'cancelled';
    return `
    <div class="trn-mgr-row">
      <div class="trn-mgr-dot ${t.status || 'open'}"></div>
      <div class="trn-mgr-info">
        <div class="trn-mgr-name">${esc(t.name)}</div>
        <div class="trn-mgr-sub">${formatTrnDate(t.date)} · ${t.time} · ${esc(t.location)}</div>
        <div class="trn-mgr-stats">${reg}/${t.capacity} · ${statusLbl}</div>
      </div>
      <span class="trn-mgr-badge ${t.level || 'medium'}">${levelLbl}</span>
      <div class="trn-mgr-actions">
        <button class="trn-mgr-edit"  onclick="openTrnEdit('${escAttr(t.id)}')"  title="Редактировать">✏️</button>
        <button class="trn-mgr-clone" onclick="cloneTrn('${escAttr(t.id)}')"     title="Дублировать">📋</button>
        ${isActive
          ? `<button class="trn-mgr-finish" onclick="finishTrn('${escAttr(t.id)}')" title="Завершить">✅</button>`
          : `<button class="trn-mgr-finish" onclick="openResultsForm('${escAttr(t.id)}')" title="Редактировать результаты" style="font-size:11px">📊</button>`}
        <button class="trn-mgr-plr" onclick="openParticipantsModal('${escAttr(t.id)}')" title="Участники">👥</button>
        <button class="trn-mgr-del"   onclick="deleteTrn('${escAttr(t.id)}')"   title="Удалить">✕</button>
      </div>
    </div>`;
  }).join('')
    : `<div class="trn-mgr-empty">Нет турниров. Добавьте первый.</div>`;

  return `
    <div class="trn-mgr-hdr">
      <span class="trn-mgr-title">📅 ТУРНИРЫ <span>РАСПИСАНИЕ</span></span>
      <div class="trn-mgr-hdr-actions">
        ${rosterTrnFormOpen ? '' : `<button class="trn-mgr-add-btn" onclick="openTrnAdd()">+ Добавить</button>`}
      </div>
    </div>
    ${formHtml}
    <div class="trn-mgr-list">${rows}</div>`;
}
