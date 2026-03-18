'use strict'; // ── Participants Manager + Tournament delete ──

/** Delete: remove by id with confirmation */
async function deleteTrn(id) {
  if (!await showConfirm('Удалить турнир? Действие необратимо.')) return;
  saveTournaments(getTournaments().filter(t => t.id !== id));
  _refreshRosterTrn();
  showToast('Турнир удалён', 'success');
}

// ══ Participants Manager ══════════════════════════════════════
let _ptTrnId = null;
let _ptSearch = '';
let _ptSelected = new Set(); // IDs selected for batch-add

function openParticipantsModal(trnId) {
  _ptTrnId = trnId;
  _ptSearch = '';
  _ptSelected.clear();
  document.getElementById('pt-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'pt-modal';
  overlay.className = 'pt-overlay';
  overlay.innerHTML = '<div class="pt-modal" id="pt-modal-inner"></div>';
  overlay.addEventListener('click', e => { if (e.target === overlay) closeParticipantsModal(); });
  document.body.appendChild(overlay);
  _renderPtModal();
}

function closeParticipantsModal() {
  document.getElementById('pt-modal')?.remove();
  _ptTrnId = null;
  _refreshRosterTrn();
}

function _renderPtModal() {
  const inner = document.getElementById('pt-modal-inner');
  if (!inner) return;
  const arr = getTournaments();
  const trn = arr.find(t => t.id === _ptTrnId);
  if (!trn) { closeParticipantsModal(); return; }

  const db = loadPlayerDB();
  const parts  = (trn.participants || []).map(id => db.find(p => p.id === id)).filter(Boolean);
  const wlist  = (trn.waitlist    || []).map(id => db.find(p => p.id === id)).filter(Boolean);
  const allIds = new Set([...(trn.participants||[]), ...(trn.waitlist||[])]);
  const free   = trn.capacity - parts.length;
  const pct    = Math.min(parts.length / (trn.capacity||1) * 100, 100);
  const isFull = parts.length >= trn.capacity;

  // Search results — show all if empty, filter if query
  const q = _ptSearch.trim().toLowerCase();
  const filtered = q
    ? db.filter(p => p.name.toLowerCase().includes(q))
    : db;
  // Sort alphabetically by name
  const searchResults = filtered
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    .slice(0, 50); // Show up to 50 players; list scrolls inside pt-body

  const gLabel = p => p.gender === 'M' ? 'М' : 'Ж';

  // Remove selected IDs that are already in the tournament
  for (const id of _ptSelected) { if (allIds.has(id)) _ptSelected.delete(id); }

  const addSelBtn = _ptSelected.size > 0
    ? `<button class="pt-add-sel-btn" onclick="ptAddSelected()">✓ Добавить выбранных (${_ptSelected.size})</button>`
    : '';

  const srHtml = searchResults.length ? `
    ${addSelBtn}
    <div class="pt-search-results">
      ${searchResults.map(p => {
        const alreadyIn = allIds.has(p.id);
        const isSelected = _ptSelected.has(p.id);
        return `<div class="pt-sr-item${isSelected ? ' selected' : ''}" onclick="${alreadyIn ? '' : `ptToggleSelect('${escAttr(p.id)}')`}"
          style="${alreadyIn ? 'opacity:.45;cursor:default' : ''}">
          <span class="pt-sr-badge ${p.gender}">${gLabel(p)}</span>
          <span class="pt-sr-name">${esc(p.name)}</span>
          <span class="pt-sr-meta">${p.totalPts||0} оч. · ${p.tournaments||0} турн.</span>
          ${alreadyIn
            ? '<span class="pt-sr-badge in">✓ Добавлен</span>'
            : `<span class="pt-sr-action${isSelected ? ' chk' : ''}">${isSelected ? '☑ Выбран' : '☐'}</span>`}
        </div>`;
      }).join('')}
    </div>` : addSelBtn;

  const partsHtml = parts.length
    ? parts.map((p, i) => `
      <div class="pt-item">
        <span class="pt-item-num">${i+1}</span>
        <span class="pt-item-name">${esc(p.name)}</span>
        <span class="pt-item-g ${p.gender}">${gLabel(p)}</span>
        <button class="pt-item-del" onclick="ptRemoveParticipant('${escAttr(p.id)}')" title="Убрать">✕</button>
      </div>`).join('')
    : '<div class="pt-empty">Участников нет. Найдите игрока выше.</div>';

  const wlistHtml = wlist.length
    ? wlist.map((p, i) => `
      <div class="pt-item">
        <span class="pt-item-num">⏳</span>
        <span class="pt-item-name">${esc(p.name)}</span>
        <span class="pt-item-g ${p.gender}">${gLabel(p)}</span>
        ${!isFull
          ? `<button class="pt-item-promote" onclick="ptPromoteWaitlist('${escAttr(p.id)}')">→ Добавить</button>`
          : ''}
        <button class="pt-item-del" onclick="ptRemoveWaitlist('${escAttr(p.id)}')" title="Убрать">✕</button>
      </div>`).join('')
    : '<div class="pt-empty">Лист ожидания пуст.</div>';

  inner.innerHTML = `
    <div class="pt-hdr">
      <div class="pt-hdr-info">
        <div class="pt-hdr-title">👥 Участники</div>
        <div class="pt-hdr-sub">${esc(trn.name)} · ${free > 0 ? `Свободно ${free} мест` : '⛔ Заполнен'}</div>
      </div>
      <button class="pt-close" onclick="closeParticipantsModal()">✕</button>
    </div>
    <div class="pt-body">
      <div class="pt-cap-bar"><div class="pt-cap-fill${isFull?' full':''}" style="width:${pct}%"></div></div>

      <!-- Search -->
      <div class="pt-search-wrap">
        <span class="pt-search-ico">🔍</span>
        <input class="pt-search-inp" id="pt-search-inp" type="search"
          placeholder="Поиск игрока в базе…" value="${esc(_ptSearch)}"
          oninput="ptSetSearch(this.value)" autocomplete="off">
      </div>
      ${srHtml}

      <!-- Participants -->
      <div>
        <div class="pt-section-hdr">
          <span class="pt-section-ttl">Участники</span>
          <span class="pt-section-cnt">${parts.length}/${trn.capacity}</span>
        </div>
        <div class="pt-list">${partsHtml}</div>
      </div>

      <!-- Waitlist -->
      ${wlist.length > 0 ? `
      <div>
        <div class="pt-section-hdr">
          <span class="pt-section-ttl">📋 Лист ожидания</span>
          <span class="pt-section-cnt">${wlist.length}</span>
        </div>
        <div class="pt-list">${wlistHtml}</div>
      </div>` : ''}
    </div>
    <div class="pt-footer">
      <button class="pt-btn-export" onclick="ptExportCSV('${escAttr(_ptTrnId)}')">📥 Экспорт CSV</button>
      <button class="pt-btn-import" onclick="document.getElementById('pt-import-file').click()">📤 Импорт CSV</button>
      <input type="file" id="pt-import-file" accept=".csv" style="display:none" onchange="ptImportCSV(event)">
      <button class="pt-btn-close" onclick="closeParticipantsModal()">Закрыть</button>
    </div>`;

  // Attach search event handlers
  const inp = document.getElementById('pt-search-inp');
  if (inp) {
    // Remove old listeners
    inp.removeEventListener('input', ptSearchHandler);
    inp.removeEventListener('focus', ptFocusHandler);

    // Add new listeners
    inp.addEventListener('input', ptSearchHandler);
    inp.addEventListener('focus', ptFocusHandler);

    // Keep focus if was searching
    if (_ptSearch) {
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    }
  }
}

function ptFocusHandler(e) {
  // Show all players when input is focused
  if (!_ptSearch) {
    _renderPtModal();
  }
}

function ptSearchHandler(e) {
  ptSetSearch(e.target?.value || '');
}

// ── CSV Export ────────────────────────────────────────────────
function ptExportCSV(trnId) {
  const arr = getTournaments();
  const trn = arr.find(t => t.id === trnId);
  if (!trn) { showToast('Турнир не найден', 'error'); return; }

  const db = loadPlayerDB();
  const parts = (trn.participants || []).map(id => db.find(p => p.id === id)).filter(Boolean);

  // CSV header
  const csv = ['Фамилия,Пол'];

  // Rows (escape quotes and CSV formula injection)
  const csvSafe = s => {
    let v = String(s).replace(/"/g, '""');
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
    return `"${v}"`;
  };
  parts.forEach(p => {
    const gender = p.gender === 'M' ? 'М' : 'Ж';
    csv.push(`${csvSafe(p.name)},${gender}`);
  });

  // Download
  const blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `ростер_${trn.name}_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  showToast('CSV скачан', 'success');
}

// ── CSV Import ────────────────────────────────────────────────
function ptImportCSV(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const text = e.target?.result || '';
      const lines = text.trim().split('\n');
      if (lines.length < 2) throw new Error('Файл пуст или некорректен');

      const db = loadPlayerDB();
      const arr = getTournaments();
      const trn = arr.find(t => t.id === _ptTrnId);
      if (!trn) throw new Error('Турнир не найден');

      // Skip header (line 0), process data (lines 1+)
      let added = 0;
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Parse CSV: "Фамилия",Пол or Фамилия,Пол
        const match = line.match(/^"?([^",]+)"?,([МЖ])/);
        if (!match) continue;

        const name = match[1].trim();

        // Find player in DB
        const player = db.find(p => p.name.toLowerCase() === name.toLowerCase());
        if (!player) {
          console.warn(`Игрок "${name}" не найден в базе`);
          continue;
        }

        // Add if not already there
        if (!trn.participants.includes(player.id) && !trn.waitlist.includes(player.id)) {
          if (trn.participants.length < trn.capacity) {
            trn.participants.push(player.id);
          } else {
            trn.waitlist = trn.waitlist || [];
            trn.waitlist.push(player.id);
          }
          added++;
        }
      }

      saveTournaments(arr);
      _renderPtModal();
      showToast(`Импортировано ${added} игроков`, 'success');
    } catch (err) {
      console.error('CSV Import error:', err);
      showToast('❌ Ошибка при импорте: ' + err.message, 'error');
    }

    // Reset file input
    event.target.value = '';
  };
  reader.readAsText(file);
}

let _ptSearchTimer = null;
function ptSetSearch(val) {
  _ptSearch = val;
  clearTimeout(_ptSearchTimer);
  _ptSearchTimer = setTimeout(_renderPtModal, 150);
}

function ptToggleSelect(playerId) {
  if (_ptSelected.has(playerId)) {
    _ptSelected.delete(playerId);
  } else {
    _ptSelected.add(playerId);
  }
  _renderPtModal();
}

function ptAddSelected() {
  const arr = getTournaments();
  const trn = arr.find(t => t.id === _ptTrnId);
  if (!trn || _ptSelected.size === 0) return;
  let added = 0, waitlisted = 0;
  for (const id of _ptSelected) {
    if (trn.participants.includes(id) || trn.waitlist.includes(id)) continue;
    if (trn.participants.length < trn.capacity) {
      trn.participants.push(id);
      added++;
    } else {
      trn.waitlist.push(id);
      waitlisted++;
    }
  }
  if (trn.participants.length >= trn.capacity) trn.status = 'full';
  _ptSelected.clear();
  saveTournaments(arr);
  _renderPtModal();
  const parts = [added && `${added} добавлено`, waitlisted && `${waitlisted} в лист ожидания`].filter(Boolean);
  if (parts.length) showToast('✓ ' + parts.join(', '), 'success');
}

function ptAddPlayer(playerId) {
  const arr = getTournaments();
  const trn = arr.find(t => t.id === _ptTrnId);
  if (!trn) return;
  if (trn.participants.includes(playerId) || trn.waitlist.includes(playerId)) return;

  if (trn.participants.length < trn.capacity) {
    trn.participants.push(playerId);
    if (trn.participants.length >= trn.capacity) trn.status = 'full';
  } else {
    trn.waitlist.push(playerId);
    showToast('Места закончились — добавлен в лист ожидания', 'info');
  }
  saveTournaments(arr);
  _renderPtModal();
}

function ptRemoveParticipant(playerId) {
  const arr = getTournaments();
  const trn = arr.find(t => t.id === _ptTrnId);
  if (!trn) return;
  trn.participants = trn.participants.filter(id => id !== playerId);
  if (trn.status === 'full' && trn.participants.length < trn.capacity) trn.status = 'open';
  saveTournaments(arr);
  _renderPtModal();
}

function ptRemoveWaitlist(playerId) {
  const arr = getTournaments();
  const trn = arr.find(t => t.id === _ptTrnId);
  if (!trn) return;
  trn.waitlist = trn.waitlist.filter(id => id !== playerId);
  saveTournaments(arr);
  _renderPtModal();
}

function ptPromoteWaitlist(playerId) {
  const arr = getTournaments();
  const trn = arr.find(t => t.id === _ptTrnId);
  if (!trn) return;
  if (trn.participants.length >= trn.capacity) {
    showToast('Нет свободных мест', 'error'); return;
  }
  trn.waitlist     = trn.waitlist.filter(id => id !== playerId);
  trn.participants.push(playerId);
  if (trn.participants.length >= trn.capacity) trn.status = 'full';
  saveTournaments(arr);
  _renderPtModal();
  showToast('Игрок переведён в участники', 'success');
}
