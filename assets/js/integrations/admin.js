'use strict';

// ════════════════════════════════════════════════════════════
// ADMIN PANEL
// ════════════════════════════════════════════════════════════
let _adminRequests    = [];
let _adminTempPlayers = [];
let _adminMergeId     = null;
let _adminMergeQuery  = '';

async function adminLoadData() {
  const cl = sbEnsureClient();
  if (!cl) return;
  try {
    const [reqRes, tmpRes] = await Promise.all([
      cl.rpc('list_pending_requests'),
      cl.from('players').select('id,name,gender,status').eq('status', 'temporary').order('name'),
    ]);
    _adminRequests    = reqRes.data  || [];
    _adminTempPlayers = tmpRes.data  || [];
  } catch(e) {
    console.warn('adminLoadData failed', e);
  }
  _adminRefreshPanel();
}

async function adminApprove(requestId) {
  const cl = sbEnsureClient();
  if (!cl) return;
  const { data, error } = await cl.rpc('approve_player_request', { p_request_id: requestId });
  if (error || !data?.ok) {
    showToast('Ошибка одобрения: ' + (error?.message || data?.message || ''), 'error');
    return;
  }
  showToast('✅ Заявка одобрена');
  await adminLoadData();
}

async function adminReject(requestId) {
  const cl = sbEnsureClient();
  if (!cl) return;
  const { data, error } = await cl.rpc('reject_player_request', { p_request_id: requestId });
  if (error || !data?.ok) {
    showToast('Ошибка отклонения: ' + (error?.message || data?.message || ''), 'error');
    return;
  }
  showToast('❌ Заявка отклонена');
  await adminLoadData();
}

function adminStartMerge(tempId) {
  _adminMergeId    = tempId;
  _adminMergeQuery = '';
  _adminRefreshPanel();
  setTimeout(() => document.getElementById('admin-merge-search')?.focus(), 50);
}

function adminCancelMerge() {
  _adminMergeId    = null;
  _adminMergeQuery = '';
  _adminRefreshPanel();
}

function adminMergeSearch(q) {
  _adminMergeQuery = q;
  _adminRefreshPanel();
}

async function adminMerge(realId) {
  const tempId = _adminMergeId;
  if (!tempId || !realId) {
    showToast('Выберите игрока для слияния', 'error');
    return;
  }
  if (String(tempId) === String(realId)) {
    showToast('Нельзя слить игрока с самим собой', 'error');
    return;
  }
  const localDb = typeof loadPlayerDB === 'function' ? loadPlayerDB() : [];
  const realPlayer = localDb.find(p => String(p.id) === String(realId));
  const tempPlayer = _adminTempPlayers.find(p => String(p.id) === String(tempId));
  if (!realPlayer || realPlayer.status === 'temporary') {
    showToast('Выберите реального игрока из списка (не временного)', 'error');
    return;
  }
  const tempName = tempPlayer ? tempPlayer.name : 'Временный';
  const realName = realPlayer.name || 'Игрок';
  const msg = `Слить временного игрока «${tempName}» в «${realName}»?\n\nЗаписи с турниров и очки будут перенесены. Действие необратимо.`;
  if (!(typeof showConfirm === 'function' && (await showConfirm(msg)))) return;

  const cl = sbEnsureClient();
  if (!cl) {
    showToast('Нет подключения к Supabase', 'error');
    return;
  }
  try {
    const { data, error } = await cl.rpc('merge_players', { p_temp_id: tempId, p_real_id: realId });
    if (error || !data?.ok) {
      showToast('Ошибка слияния: ' + (error?.message || data?.message || 'неизвестная ошибка'), 'error');
      return;
    }
    _adminMergeId    = null;
    _adminMergeQuery = '';
    showToast(`✅ Слито в «${realName}». Перенесено записей: ${data.moved ?? 0}`);
    if (typeof removePlayerFromDB === 'function') removePlayerFromDB(tempId);
    if (typeof _refreshRdb === 'function') _refreshRdb();
    await adminLoadData();
  } catch (e) {
    showToast('Ошибка слияния: ' + (e?.message || 'сеть'), 'error');
  }
}

function _adminRefreshPanel() {
  const el = document.getElementById('admin-panel-inner');
  if (el) el.innerHTML = _renderAdminPanelInner();
}

function renderAdminPanel() {
  if (sbStatus !== 'live') return '';
  return `<div class="sb-card admin-panel" id="admin-panel">
    <div class="sb-title">🛡 Администрирование</div>
    <div class="sb-sub">Заявки игроков и временные профили. Требует подключения к Supabase.</div>
    <button class="btn-sb connect" style="margin-bottom:12px" onclick="adminLoadData()">🔄 Загрузить данные</button>
    <div id="admin-panel-inner">${_renderAdminPanelInner()}</div>
  </div>`;
}

function _renderAdminPanelInner() {
  return _renderPendingRequests() + _renderTempPlayers();
}

function _renderPendingRequests() {
  if (!_adminRequests.length) {
    return `<div class="admin-section-title">📋 Pending-заявки</div>
      <div class="admin-empty">Нет ожидающих заявок</div>`;
  }
  const rows = _adminRequests.map(r => `
    <div class="admin-row">
      <div class="admin-row-info">
        <span class="admin-name">${esc(r.name)}</span>
        <span class="admin-meta">${r.gender === 'M' ? '♂' : '♀'}${r.phone ? ' · ' + esc(r.phone) : ''}${r.tournament_name ? ' · ' + esc(r.tournament_name) : ''}</span>
      </div>
      <div class="admin-row-btns">
        <button class="btn-admin approve" onclick="adminApprove('${escAttr(r.id)}')">✅ Одобрить</button>
        <button class="btn-admin reject"  onclick="adminReject('${escAttr(r.id)}')">❌ Отклонить</button>
      </div>
    </div>`).join('');
  return `<div class="admin-section-title">📋 Pending-заявки (${_adminRequests.length})</div>${rows}`;
}

function _renderTempPlayers() {
  const header = `<div class="admin-section-title" style="margin-top:12px">👤 Временные игроки</div>`;
  if (!_adminTempPlayers.length) {
    return header + `<div class="admin-empty">Нет временных профилей</div>`;
  }
  const rows = _adminTempPlayers.map(p => {
    const isMerging = _adminMergeId === p.id;
    const mergeForm = isMerging ? (() => {
      const q = _adminMergeQuery.trim().toLowerCase();
      const candidates = q.length >= 2
        ? (loadPlayerDB() || [])
            .filter(c => c.status !== 'temporary' && c.id !== p.id && c.name.toLowerCase().includes(q))
            .slice(0, 6)
        : [];
      return `<div class="admin-merge-form">
        <div style="margin-bottom:6px;font-size:13px;color:var(--accent)">
          Слить <b>${esc(p.name)}</b> в реального игрока:
        </div>
        <input id="admin-merge-search" class="sb-input" type="text"
          placeholder="Введите фамилию..." value="${escAttr(_adminMergeQuery)}"
          oninput="adminMergeSearch(this.value)">
        ${candidates.map(c => `
          <div class="admin-merge-candidate" onclick="adminMerge('${escAttr(String(c.id))}')">
            ${esc(c.name)} <span class="admin-meta">${c.gender === 'M' ? '♂' : '♀'}</span>
          </div>`).join('')}
        ${q.length >= 2 && !candidates.length ? '<div class="admin-empty">Не найдено</div>' : ''}
        <button class="btn-admin reject" style="margin-top:8px" onclick="adminCancelMerge()">Отмена</button>
      </div>`;
    })() : '';
    return `<div class="admin-row">
      <div class="admin-row-info">
        <span class="admin-name">${esc(p.name)}</span>
        <span class="admin-meta">${p.gender === 'M' ? '♂' : '♀'} · временный</span>
      </div>
      <div class="admin-row-btns">
        ${isMerging ? '' : `<button class="btn-admin merge" onclick="adminStartMerge('${escAttr(p.id)}')">🔀 Слить</button>`}
      </div>
    </div>${mergeForm}`;
  }).join('');
  return header + rows;
}
