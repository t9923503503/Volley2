'use strict'; // ── Results Form modal ──

// ── Results Form ──────────────────────────────────────────────
// Single state object — avoids stale closures and window pollution
let _resState = null;

const PRESETS = {
  standard: { label:'Стандарт', pts:[100,80,60] },
  major:    { label:'Major',    pts:[150,120,90] },
  custom:   { label:'Кастом',   pts:null },
};

function openResultsForm(trnId) {
  const trn = getTournaments().find(t => t.id === trnId);
  if (!trn) { showToast('Турнир не найден', 'error'); return; }
  // Auto-sync roster → playerDB if DB is empty
  if (loadPlayerDB().length === 0) syncPlayersFromRoster();

  const hasResults = Array.isArray(trn.winners) && trn.winners.length > 0
                     && typeof trn.winners[0] === 'object';

  // Default preset detection from existing data
  let defaultPreset = 'standard';
  if (hasResults) {
    const pts = trn.winners.map(w => w.points).join(',');
    if (pts === '100,80,60') defaultPreset = 'standard';
    else if (pts === '150,120,90') defaultPreset = 'major';
    else defaultPreset = 'custom';
  }

  _resState = {
    trnId,
    newPlayerSlotIdx: null,
    preset: defaultPreset,
    trnType: trn.ratingType || divisionToType(trn.division),
    slots: hasResults
      ? trn.winners.map(w => ({ ...w, playerIds: [...w.playerIds] }))
      : [
          { place: 1, playerIds: [], points: 100 },
          { place: 2, playerIds: [], points: 80  },
          { place: 3, playerIds: [], points: 60  },
        ],
  };

  document.getElementById('results-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.id        = 'results-modal';
  overlay.className = 'res-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) closeResultsModal(); });

  const isEdit = hasResults;
  const partCount = (trn.participants || []).length;
  const partChip  = partCount
    ? `<span class="res-participants-chip">👥 ${partCount} участников в турнире</span>` : '';

  overlay.innerHTML = `
    <div class="res-modal" role="dialog" aria-modal="true">
      <div class="res-modal-hdr">
        <div>
          <div class="res-modal-title">${isEdit ? '✏️ Редактировать результаты' : '🏆 Завершить турнир'}</div>
          <div class="res-modal-sub">${esc(trn.name)} · ${trn.date}</div>
        </div>
        <button class="res-modal-close" onclick="closeResultsModal()">✕</button>
      </div>
      <div class="res-modal-body">
        ${partChip}
        <!-- Tournament type selector for rating -->
        <div class="res-type-row">
          <span class="res-type-lbl">🏆 Тип турнира (рейтинг):</span>
          <div class="res-type-btns" id="res-type-btns">
            <button class="res-type-btn ${_resState.trnType==='M'?'active':''}"
              onclick="resSetTrnType('M')">🏋️ М</button>
            <button class="res-type-btn ${_resState.trnType==='W'?'active':''}"
              onclick="resSetTrnType('W')">👩 Ж</button>
            <button class="res-type-btn ${_resState.trnType==='Mix'?'active':''}"
              onclick="resSetTrnType('Mix')">🤝 Микст</button>
          </div>
        </div>
        <!-- Points presets -->
        <div class="res-presets" id="res-presets">
          ${Object.entries(PRESETS).map(([key, p]) => `
            <button class="res-preset-btn ${defaultPreset === key ? 'active' : ''}"
              onclick="resApplyPreset('${key}')"
              id="res-preset-${key}">
              ${p.label}
              ${p.pts ? `<span class="res-preset-pts">${p.pts.join('/')}</span>` : '<span class="res-preset-pts">свои очки</span>'}
            </button>`).join('')}
        </div>
        <!-- Completion progress -->
        <div class="res-progress" id="res-progress">
          <div class="res-progress-dot" id="rpd-0"></div>
          <div class="res-progress-dot" id="rpd-1"></div>
          <div class="res-progress-dot" id="rpd-2"></div>
          <span class="res-progress-lbl" id="res-progress-lbl">Заполните все 3 призовых места</span>
        </div>
        <div id="res-slots-wrap"></div>
        <div class="res-total">Всего очков: <b id="res-total-pts">0</b></div>
        <div id="res-new-player-wrap"></div>
      </div>
      <div class="res-modal-footer">
        ${!isEdit ? `<button class="res-btn-skip" onclick="finishTrnNoResults('${escAttr(trnId)}')">
          Без результатов
        </button>` : ''}
        <button class="res-btn-save" id="res-btn-save" disabled onclick="saveResults()">
          ${isEdit ? '💾 Сохранить изменения' : '💾 Сохранить и завершить'}
        </button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  _reRenderSlots();
}

function closeResultsModal() {
  document.getElementById('results-modal')?.remove();
  _resState = null;
}
function resSetTrnType(type) {
  if (!_resState) return;
  _resState.trnType = type;
  document.querySelectorAll('.res-type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.includes(
      type === 'M' ? 'М' : type === 'W' ? 'Ж' : 'Микст'
    ));
  });
}

/** Mark finished without recording results */
async function finishTrnNoResults(trnId) {
  if (!await showConfirm('Завершить турнир без записи результатов?')) return;
  const arr = getTournaments();
  const t   = arr.find(t => t.id === trnId);
  if (t) { t.status = 'finished'; saveTournaments(arr); }
  closeResultsModal();
  _refreshRosterTrn();
  showToast('Турнир завершён', 'success');
}

// ── Slots render ──────────────────────────────────────────────
function _reRenderSlots() {
  const el = document.getElementById('res-slots-wrap');
  if (!el || !_resState) return;

  // Participants-first: only show tournament participants in dropdowns;
  // fall back to full DB if no participants recorded yet.
  const allDb      = loadPlayerDB().sort((a,b) => a.name.localeCompare(b.name, 'ru'));
  const allMap     = _buildPlayerMap();                   // Map<id,player> for O(1) badge lookup
  const trn        = getTournaments().find(t => t.id === _resState.trnId);
  const partIds    = new Set(trn?.participants || []);
  const playerPool = partIds.size > 0
    ? allDb.filter(p => partIds.has(p.id))
    : allDb;

  const allSelectedIds = _resState.slots.flatMap(s => s.playerIds);
  el.innerHTML = _resState.slots.map((slot, idx) =>
    _slotHtml(slot, idx, playerPool, allMap, allSelectedIds)
  ).join('');

  // Sync total points
  const totalEl = document.getElementById('res-total-pts');
  if (totalEl) totalEl.textContent = _resState.slots
    .reduce((s, w) => s + (w.playerIds.length > 0 ? w.points : 0), 0);

  // Hard validation: all 3 places must have ≥1 player
  const filled = _resState.slots.filter(s => s.playerIds.length > 0).length;
  const saveBtn = document.getElementById('res-btn-save');
  if (saveBtn) saveBtn.disabled = filled < 3;

  // Progress dots
  _resState.slots.forEach((s, i) => {
    const dot = document.getElementById('rpd-' + i);
    if (dot) dot.classList.toggle('done', s.playerIds.length > 0);
  });
  const lblEl = document.getElementById('res-progress-lbl');
  if (lblEl) {
    if (filled === 3) {
      lblEl.textContent = '✓ Готово — все три места заполнены';
      lblEl.className   = 'res-progress-lbl all-done';
    } else {
      lblEl.textContent = `Заполнено ${filled}/3 призовых мест`;
      lblEl.className   = 'res-progress-lbl';
    }
  }
}

function _slotHtml(slot, idx, playerPool, allMap, allSelectedIds) {
  const MEDALS    = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const medal     = MEDALS[slot.place] || ('#' + slot.place);
  const canAdd    = slot.playerIds.length < 2;
  const available = playerPool.filter(p => !allSelectedIds.includes(p.id));
  const isCustom  = _resState.preset === 'custom';

  const badges = slot.playerIds.map(id => {
    const p = allMap.get(id);
    return `<span class="res-badge">
      <button class="player-tap" onclick="showPlayerCard('${escAttr(p?.name||'')}','${escAttr(p?.gender||'M')}')"
        style="color:inherit;font-size:inherit">${esc(p?.name || '?')}</button>
      <button class="res-badge-rm" onclick="resRemovePlayer(${idx},'${id}')" aria-label="Убрать">×</button>
    </span>`;
  }).join('');

  const selectRow = canAdd ? `
    <div class="res-sel-row">
      <input class="res-search-inp" type="text" placeholder="Поиск..."
        id="res-search-${idx}" oninput="resFilterPlayers(${idx})">
      <select class="res-sel" id="res-sel-${idx}" onchange="resAddPlayer(${idx}, this.value)">
        <option value="">— выбрать —</option>
        ${available.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
      </select>
      <button class="res-new-btn" onclick="resOpenNewPlayerForm(${idx})" title="Создать нового">🆕</button>
    </div>` : `<div class="res-slot-full">Слот заполнен (max 2)</div>`;

  return `
    <div class="res-slot ${slot.place === 1 ? 'res-slot--gold' : ''}">
      <div class="res-slot-hdr">
        <span class="res-slot-place">${medal} ${slot.place} место</span>
        <div class="res-pts-wrap">
          <label class="res-pts-label">очков</label>
          <input class="res-pts-inp" type="number" min="0" max="9999"
            value="${slot.points}"
            ${isCustom ? '' : 'readonly style="opacity:.7;cursor:default"'}
            onchange="resChangePoints(${idx}, this.value)">
        </div>
      </div>
      <div class="res-slot-players">
        ${badges || '<span class="res-slot-empty">Не выбрано</span>'}
      </div>
      ${selectRow}
    </div>`;
}

// ── Slot actions (called from onclick attributes) ─────────────
function resAddPlayer(slotIdx, playerId) {
  if (!playerId || !_resState) return;
  const slot = _resState.slots[slotIdx];
  if (slot.playerIds.length >= 2) {
    showToast('Максимум 2 игрока в слоте', 'error'); return;
  }
  if (_resState.slots.flatMap(s => s.playerIds).includes(playerId)) {
    showToast('Игрок уже назначен в другой слот', 'error'); return;
  }
  slot.playerIds.push(playerId);
  _reRenderSlots();
}

function resRemovePlayer(slotIdx, playerId) {
  if (!_resState) return;
  _resState.slots[slotIdx].playerIds =
    _resState.slots[slotIdx].playerIds.filter(id => id !== playerId);
  _reRenderSlots();
}

function resChangePoints(slotIdx, val) {
  if (!_resState) return;
  _resState.slots[slotIdx].points = Math.max(0, parseInt(val) || 0);
  const totalEl = document.getElementById('res-total-pts');
  if (totalEl) totalEl.textContent = _resState.slots
    .reduce((s, w) => s + (w.playerIds.length > 0 ? w.points : 0), 0);
}

/** Apply a points preset (standard / major / custom) */
function resApplyPreset(key) {
  if (!_resState) return;
  _resState.preset = key;
  const preset = PRESETS[key];
  if (preset?.pts) {
    _resState.slots.forEach((s, i) => { if (preset.pts[i] !== undefined) s.points = preset.pts[i]; });
  }
  // Update active button
  Object.keys(PRESETS).forEach(k => {
    document.getElementById('res-preset-' + k)?.classList.toggle('active', k === key);
  });
  _reRenderSlots();
}

/** Filter <select> options without re-rendering the whole slot */
function resFilterPlayers(slotIdx) {
  const q   = (document.getElementById('res-search-' + slotIdx)?.value || '').toLowerCase();
  const sel = document.getElementById('res-sel-' + slotIdx);
  if (!sel) return;
  Array.from(sel.options).forEach(opt => {
    opt.hidden = q.length > 0 && opt.value !== '' && !opt.text.toLowerCase().includes(q);
  });
}

// ── Inline new player form (no prompt(), no extra modal) ──────
function resOpenNewPlayerForm(slotIdx) {
  if (!_resState) return;
  _resState.newPlayerSlotIdx = slotIdx;
  // Pre-select gender from tournament division
  const trn  = getTournaments().find(t => t.id === _resState.trnId);
  const defG = trn?.division === 'Мужской' ? 'M'
             : trn?.division === 'Женский' ? 'W' : 'M';
  const wrap = document.getElementById('res-new-player-wrap');
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="res-new-player-form">
      <div class="res-new-player-title">Добавить нового игрока в базу</div>
      <div class="res-new-player-row">
        <input class="res-new-inp" id="res-new-name" type="text"
          placeholder="Имя Фамилия"
          onkeydown="if(event.key==='Enter')resCreateNewPlayer()">
        <select class="res-new-gender" id="res-new-gender">
          <option value="M" ${defG === 'M' ? 'selected' : ''}>М</option>
          <option value="W" ${defG === 'W' ? 'selected' : ''}>Ж</option>
        </select>
        <button class="res-new-confirm" onclick="resCreateNewPlayer()">Добавить</button>
        <button class="res-new-cancel" onclick="resCloseNewPlayerForm()">✕</button>
      </div>
    </div>`;
  setTimeout(() => document.getElementById('res-new-name')?.focus(), 30);
}

function resCloseNewPlayerForm() {
  const wrap = document.getElementById('res-new-player-wrap');
  if (wrap) wrap.innerHTML = '';
  if (_resState) _resState.newPlayerSlotIdx = null;
}

function resCreateNewPlayer() {
  if (!_resState) return;
  const name   = (document.getElementById('res-new-name')?.value || '').trim();
  const gender = document.getElementById('res-new-gender')?.value || 'M';
  if (!name) { showToast('Введите имя игрока', 'error'); return; }
  const db = loadPlayerDB();
  if (db.find(p => p.name.toLowerCase() === name.toLowerCase() && p.gender === gender)) {
    showToast('Игрок уже есть в базе', 'error'); return;
  }
  const newPlayer = upsertPlayerInDB({
    id:          'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    name,
    gender,
    status:      'active',
  });

  // Auto-assign to the target slot
  const slotIdx = _resState.newPlayerSlotIdx;
  if (slotIdx !== null) {
    const slot = _resState.slots[slotIdx];
    if (slot && slot.playerIds.length < 2) slot.playerIds.push(newPlayer.id);
  }
  resCloseNewPlayerForm();
  _reRenderSlots();
  showToast(name + ' добавлен в базу', 'success');
}

// ── Save results ──────────────────────────────────────────────
function saveResults() {
  if (!_resState) return;

  // Hard validation: all 3 places must be filled
  const filledCount = _resState.slots.filter(s => s.playerIds.length > 0).length;
  if (filledCount < 3) {
    showToast('Заполните все 3 призовых места', 'error'); return;
  }

  const arr = getTournaments();
  const trn = arr.find(t => t.id === _resState.trnId);
  if (!trn) { showToast('Турнир не найден', 'error'); return; }

  const isFirstSave = trn.status !== 'finished';
  const filled      = _resState.slots.filter(s => s.playerIds.length > 0);

  // Save rating type chosen by user
  trn.ratingType = _resState.trnType || divisionToType(trn.division);

  // Audit log — black box
  if (!Array.isArray(trn.history)) trn.history = [];
  trn.history.push({
    timestamp:       new Date().toISOString(),
    action:          isFirstSave ? 'finished' : 'edited',
    winnersSnapshot: JSON.parse(JSON.stringify(filled)),
  });

  trn.winners    = filled;
  trn.status     = 'finished';
  trn.finishedAt = trn.finishedAt || new Date().toISOString();
  saveTournaments(arr);

  // Full recalc — idempotent, safe for edits, no double-counting
  recalcAllPlayerStats(/*silent*/ true);
  closeResultsModal();
  _refreshRosterTrn();
  showToast(isFirstSave ? '🏆 Турнир завершён!' : '✏️ Результаты обновлены!', 'success');
}
