'use strict'; // ── Tournament create/edit form ──

// ── Roster Tournament Manager ─────────────────────────────────
let rosterTrnFormOpen = false;
let rosterTrnEditId   = null; // string id of tournament being edited, null = new

function openTrnAdd() {
  rosterTrnFormOpen = true;
  rosterTrnEditId   = null;
  _refreshRosterTrn();
  setTimeout(() => document.getElementById('trnf-name')?.focus(), 80);
}
function openTrnEdit(id) {
  rosterTrnFormOpen = true;
  rosterTrnEditId   = id;
  _refreshRosterTrn();
  setTimeout(() => document.getElementById('trnf-name')?.focus(), 80);
}
function closeTrnForm() {
  rosterTrnFormOpen = false;
  rosterTrnEditId   = null;
  _refreshRosterTrn();
}

// ── Form submit: validate → create or update ──────────────────
function submitTournamentForm() {
  const g = id => (document.getElementById(id)?.value || '').trim();
  const formData = {
    name:     g('trnf-name'),
    date:     g('trnf-date'),
    time:     g('trnf-time'),
    location: g('trnf-loc'),
    format:   g('trnf-format'),
    division: g('trnf-div'),
    level:    g('trnf-level'),
    prize:    document.getElementById('trnf-prize-toggle')?.checked ? g('trnf-prize') : '',
    capacity: parseInt(document.getElementById('trnf-cap')?.value || '0', 10),
  };
  // IPT-specific settings
  if (formData.format === 'IPT Mixed') {
    const limitRaw = document.getElementById('trnf-ipt-limit')?.value || '21';
    const limitNum = Math.max(1, parseInt(limitRaw, 10) || 0);
    formData.ipt = {
      pointLimit: limitNum || 21,
      finishType: document.getElementById('trnf-ipt-finish')?.value || 'hard',
    };
    // IPT always needs exactly 8 players — set capacity if too low
    if (formData.capacity < 8) formData.capacity = 8;
  }

  // Field → input id map (used for highlighting errors)
  const idMap = {
    name:'trnf-name', date:'trnf-date', time:'trnf-time',
    location:'trnf-loc', format:'trnf-format', division:'trnf-div',
    level:'trnf-level', prize:'trnf-prize', capacity:'trnf-cap',
  };

  // Clear previous error states before re-validating
  Object.values(idMap).forEach(id =>
    document.getElementById(id)?.classList.remove('trn-form-inp--error')
  );

  let firstError = null;
  const REQUIRED = ['name','date','time','location','format','division','level'];
  REQUIRED.forEach(field => {
    if (!formData[field]) {
      document.getElementById(idMap[field])?.classList.add('trn-form-inp--error');
      if (!firstError) firstError = 'Заполните поле «' + field + '»';
    }
  });
  if (document.getElementById('trnf-prize-toggle')?.checked && !formData.prize) {
    document.getElementById('trnf-prize')?.classList.add('trn-form-inp--error');
    if (!firstError) firstError = 'Заполните поле «Призовой фонд» или отключите его';
  }
  if (!formData.capacity || formData.capacity < 4 || formData.capacity > 999) {
    document.getElementById('trnf-cap')?.classList.add('trn-form-inp--error');
    if (!firstError) firstError = formData.capacity > 999
      ? 'Максимальная вместимость — 999 участников'
      : 'Минимальная вместимость — 4 участника';
  }
  if (firstError) { showToast(firstError, 'error'); return; }

  const arr = getTournaments();
  if (rosterTrnEditId !== null) {
    const idx = arr.findIndex(t => t.id === rosterTrnEditId);
    if (idx !== -1) {
      // Preserve immutable fields: participants, waitlist, winners, status, source
      arr[idx] = { ...arr[idx], ...formData };
    }
    showToast('Турнир обновлён', 'success');
  } else {
    arr.push({
      id: 't_' + Date.now(),
      ...formData,
      status:       'open',
      participants: [],
      waitlist:     [],
      winners:      [],
    });
    // Автоматически устанавливаем как текущий турнир
    tournamentMeta.name = formData.name;
    tournamentMeta.date = formData.date;
    saveState();
    showToast('Турнир добавлен и установлен как текущий', 'success');
  }

  saveTournaments(arr);
  rosterTrnFormOpen = false;
  rosterTrnEditId   = null;
  _refreshRosterTrn();
}

// ── Admin actions ─────────────────────────────────────────────
/** Clone: copy all fields except id/participants/waitlist/winners, open pre-filled form */
function cloneTrn(id) {
  const src = getTournaments().find(t => t.id === id);
  if (!src) return;
  rosterTrnFormOpen = true;
  rosterTrnEditId   = null;
  _refreshRosterTrn();
  // Populate form fields after render (fields are injected via innerHTML)
  setTimeout(() => {
    const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val; };
    set('trnf-name',   src.name + ' (копия)');
    set('trnf-date',   src.date);
    set('trnf-time',   src.time);
    set('trnf-loc',    src.location);
    set('trnf-format', src.format);
    set('trnf-div',    src.division);
    set('trnf-level',  src.level);
    if (src.prize) {
      const tog = document.getElementById('trnf-prize-toggle');
      if (tog) { tog.checked = true; tog.dispatchEvent(new Event('change')); }
      set('trnf-prize', src.prize);
    }
    set('trnf-cap',    src.capacity);
    document.getElementById('trnf-name')?.focus();
  }, 60);
}

/** Finish: open results form (user records winners, then saves + marks finished) */
function finishTrn(id) {
  openResultsForm(id);
}

// ── IPT form toggle ──────────────────────────────────────────
function _trnfFormatChange(val) {
  const show = val === 'IPT Mixed';
  ['trnf-ipt-opts', 'trnf-ipt-type'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? '' : 'none';
  });
  // Auto-set capacity to 8 for IPT
  if (show) {
    const cap = document.getElementById('trnf-cap');
    if (cap && parseInt(cap.value, 10) < 8) cap.value = 8;
  }
}
