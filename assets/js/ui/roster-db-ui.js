'use strict'; // ── Roster Player DB UI ──

// ── ROSTER PLAYER DB MANAGEMENT ────────────────────────────
let rosterDbTab = 'M';

function setRosterDbTab(g) {
  rosterDbTab = g;
  _refreshRdb();
}
function _refreshRdb() {
  const el = document.getElementById('roster-db-section');
  if (el) el.innerHTML = _rdbBodyHtml();
}
function rdbAdd() {
  const inp = document.getElementById('rdb-add-inp');
  const name = (inp?.value || '').trim();
  if (!name) { showToast('⚠️ Введите фамилию'); return; }
  if (name.length > 50) { showToast('⚠️ Фамилия не должна превышать 50 символов'); return; }
  if (addPlayerToDB(name, rosterDbTab)) {
    inp.value = ''; _refreshRdb();
    showToast('✅ ' + name + ' добавлен');
  } else { showToast('⚠️ Уже в базе'); }
}
function rdbRemove(id) {
  removePlayerFromDB(id); _refreshRdb();
}
function rdbSetPts(id, val) {
  const db = loadPlayerDB();
  const p = db.find(x => x.id == id);
  if (p) { p.totalPts = Math.max(0, parseInt(val)||0); savePlayerDB(db); }
}
function rdbSetTrn(id, val) {
  const db = loadPlayerDB();
  const p = db.find(x => x.id == id);
  if (p) { p.tournaments = Math.max(0, parseInt(val)||0); savePlayerDB(db); }
}
function rdbAdjPts(id, d) {
  const db = loadPlayerDB();
  const p = db.find(x => x.id == id);
  if (p) {
    p.totalPts = Math.max(0, (p.totalPts||0) + d);
    savePlayerDB(db); _refreshRdb();
  }
}

function _rdbBodyHtml() {
  const allDb = loadPlayerDB();
  const db    = allDb.filter(p => p.gender === rosterDbTab)
                     .sort((a,b) => (b.totalPts||0) - (a.totalPts||0));
  const rankCls = i => i===0?'g':i===1?'s':i===2?'b':'';
  const medal   = i => i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1;

  const rows = db.length ? db.map((p,i) => `
    <div class="rdb-row">
      <span class="rdb-rank ${rankCls(i)}">${medal(i)}</span>
      <span class="rdb-name" onclick="showPlayerCard('${escAttr(p.name)}','${escAttr(p.gender)}')"
        title="Открыть карточку">${esc(p.name)}</span>
      <span title="Турниров" style="color:var(--muted);font-size:9px;flex-shrink:0">🏆</span>
      <input class="rdb-trn-inp" type="number" min="0" value="${p.tournaments||0}"
        onchange="rdbSetTrn(${p.id},this.value)" onblur="rdbSetTrn(${p.id},this.value)"
        title="Кол-во турниров">
      <span title="Очки" style="color:var(--muted);font-size:9px;flex-shrink:0">⚡</span>
      <div class="rdb-pts-wrap">
        <button class="rdb-adj" onclick="rdbAdjPts(${p.id},-5)" title="-5">−</button>
        <input class="rdb-pts-inp" type="number" min="0" value="${p.totalPts||0}"
          onchange="rdbSetPts(${p.id},this.value)" onblur="rdbSetPts(${p.id},this.value)"
          title="Очки">
        <button class="rdb-adj" onclick="rdbAdjPts(${p.id},+5)" title="+5">+</button>
      </div>
      <button class="rdb-del" onclick="rdbRemove(${p.id})" title="Удалить">✕</button>
    </div>`).join('')
    : `<div class="rdb-empty">Нет игроков. Добавьте выше.</div>`;

  const mCnt = allDb.filter(p=>p.gender==='M').length;
  const wCnt = allDb.filter(p=>p.gender==='W').length;

  return `
    <div class="rdb-hdr">
      <span class="rdb-title">👤 БАЗА <span>ИГРОКОВ</span></span>
      <div class="rdb-tabs">
        <button class="rdb-tab ${rosterDbTab==='M'?'active':''}" onclick="setRosterDbTab('M')">🏋️ М (${mCnt})</button>
        <button class="rdb-tab ${rosterDbTab==='W'?'active':''}" onclick="setRosterDbTab('W')">👩 Ж (${wCnt})</button>
      </div>
    </div>
    <div class="rdb-add-row">
      <input class="rdb-add-inp" id="rdb-add-inp" type="text"
        placeholder="${rosterDbTab==='M'?'Фамилия (мужской)':'Фамилия (женский)'}"
        onkeydown="if(event.key==='Enter')rdbAdd()">
      <button class="rdb-add-btn" onclick="rdbAdd()">+ Добавить</button>
    </div>
    <div class="rdb-list">${rows}</div>`;
}
