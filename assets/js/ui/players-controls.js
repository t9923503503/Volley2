'use strict'; // ── Players screen controls + Roster autocomplete ──

// Shared app state, player store and tournament store are loaded before core.js.
function setPlayersGender(g) {
  playersGender = g;
  playersSearch = '';
  const inp = document.getElementById('plr-search-inp');
  if (inp) inp.value = '';
  refreshPlayersScreen();
}
let _plrSearchTimer = null;
function setPlayersSearch(val) {
  playersSearch = val;
  clearTimeout(_plrSearchTimer);
  _plrSearchTimer = setTimeout(refreshPlayersScreen, 150);
}
function setPlayersSort(key) {
  playersSort = key;
  refreshPlayersScreen();
}
function refreshPlayersScreen() {
  const s = document.getElementById('screen-players');
  if (s && s.classList.contains('active')) s.innerHTML = renderPlayers();
}

// ── ROSTER AUTOCOMPLETE ─────────────────────────────────────
let _rcAcInputId = null;

function rosterAcShow(inp) {
  const q = inp.value.trim().toLowerCase();
  if (!q || q.length < 1) { rosterAcHide(); return; }
  const g  = inp.classList.contains('men-input') ? 'M' : 'W';
  const db = loadPlayerDB();
  const hits = db
    .filter(p => p.gender === g && p.name.toLowerCase().includes(q))
    .sort((a,b) => (b.totalPts||0) - (a.totalPts||0))
    .slice(0, 7);
  if (!hits.length) { rosterAcHide(); return; }

  let dd = document.getElementById('rc-autocomplete');
  if (!dd) {
    dd = document.createElement('div');
    dd.id = 'rc-autocomplete';
    document.body.appendChild(dd);
  }
  const rect = inp.getBoundingClientRect();
  dd.style.top    = (rect.bottom + 2) + 'px';
  dd.style.left   = rect.left + 'px';
  dd.style.width  = Math.max(rect.width, 180) + 'px';
  _rcAcInputId = inp.id;

  dd.innerHTML = hits.map(p => `
    <div class="rc-ac-item" onmousedown="rosterAcPick('${escAttr(p.name)}')">
      <span class="rc-ac-name">${esc(p.name)}</span>
      <span class="rc-ac-meta">${p.tournaments||0}т · ${p.totalPts||0}оч</span>
    </div>`).join('<div class="rc-ac-sep"></div>');
  dd.style.display = 'block';
}

function rosterAcHide() {
  const dd = document.getElementById('rc-autocomplete');
  if (dd) dd.remove();
  _rcAcInputId = null;
}

function rosterAcPick(name) {
  if (_rcAcInputId) {
    const inp = document.getElementById(_rcAcInputId);
    if (inp) { inp.value = name; inp.dispatchEvent(new Event('change')); }
  }
  rosterAcHide();
}

// Close autocomplete on outside click
document.addEventListener('click', e => {
  if (!e.target.closest('#rc-autocomplete') && !e.target.classList.contains('rc-inp'))
    rosterAcHide();
});
