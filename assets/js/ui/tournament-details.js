'use strict'; // ── Tournament Details modal ──

// ══ Tournament Details Modal ══════════════════════════════════
function openTrnDetails(trnId) {
  document.getElementById('td-modal')?.remove();
  const arr = getTournaments();
  const trn = arr.find(t => t.id === trnId);
  if (!trn) return;

  const db      = loadPlayerDB();
  const parts   = (trn.participants || []).map(id => db.find(p => p.id === id)).filter(Boolean);
  const wlist   = (trn.waitlist    || []).map(id => db.find(p => p.id === id)).filter(Boolean);
  const pct     = Math.min(parts.length / (trn.capacity||1) * 100, 100);
  const isFull  = trn.status === 'full' || parts.length >= trn.capacity;
  const isFinished = trn.status === 'finished';

  const pcls = (r,c) => { const p=r/c; return p>=1?'r':p>=.8?'y':'g'; };
  const c    = pcls(parts.length, trn.capacity);

  const LV_LABELS  = { hard:'ХАРД', medium:'СРЕДНИЙ', easy:'ЛАЙТ' };
  const ST_LABELS  = { open:'ОТКРЫТ', full:'ЗАПОЛНЕН', active:'В ИГРЕ', finished:'ЗАВЕРШЁН', cancelled:'ОТМЕНЁН' };
  const plrPills   = parts.slice(0, 8).map(p =>
    `<span class="td-plr-pill">${esc(p.name)}</span>`).join('');
  const moreParts  = parts.length > 8
    ? `<span class="td-plr-pill more">+${parts.length - 8}</span>` : '';

  const MEDALS = ['🥇','🥈','🥉'];
  const winnersHtml = isFinished && trn.winners?.length
    ? `<div class="td-section-ttl">🏆 Результаты</div>
       <div class="td-winners-list">
         ${trn.winners.map((slot, i) => {
           const names = (slot.playerIds || [])
             .map(id => db.find(p => p.id === id)?.name || '—')
             .join(', ');
           return `<div class="td-winner-row">
             <span class="td-winner-place">${MEDALS[slot.place-1] || slot.place}</span>
             <span class="td-winner-names">${esc(names)}</span>
             <span class="td-winner-pts">${slot.points} оч.</span>
           </div>`;
         }).join('')}
       </div>` : '';

  const wlistHtml = wlist.length && !isFinished
    ? `<div class="td-section-ttl">📋 Лист ожидания (${wlist.length})</div>
       <div class="td-plr-pills">
         ${wlist.slice(0,6).map(p=>`<span class="td-plr-pill">${esc(p.name)}</span>`).join('')}
         ${wlist.length>6?`<span class="td-plr-pill more">+${wlist.length-6}</span>`:''}
       </div>` : '';

  const overlay = document.createElement('div');
  overlay.id    = 'td-modal';
  overlay.className = 'td-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.innerHTML = `
  <div class="td-modal">
    <div class="td-accent"></div>
    <div class="td-body">
      <div class="td-chips-row">
        <span class="td-chip lv-${trn.level || 'medium'}">${LV_LABELS[trn.level] || esc((trn.level||'').toUpperCase())}</span>
        <span class="td-chip">${esc(trn.division || '')}</span>
        <span class="td-chip st-${trn.status}">${ST_LABELS[trn.status] || trn.status}</span>
      </div>
      <div class="td-name">${esc(trn.name)}</div>
      <div class="td-info-row">🕐 <span>${formatTrnDate(trn.date)}${trn.time ? ', ' + esc(trn.time) : ''}</span></div>
      <div class="td-info-row">📍 <span>${esc(trn.location || '—')}</span></div>
      <div class="td-info-row">👑 <span>${esc(trn.format || 'King of the Court')}</span></div>
      ${trn.prize ? `<div class="td-prize-row">🏆 Призовой фонд: ${esc(trn.prize)}</div>` : ''}

      ${!isFinished ? `
      <div class="td-prog-wrap">
        <div class="td-prog-hdr">
          <span class="td-prog-lbl">Регистрация</span>
          <span class="td-prog-val ${c}">${parts.length}/${trn.capacity}</span>
        </div>
        <div class="td-prog-bar">
          <div class="td-prog-fill ${c}" style="width:${pct}%"></div>
        </div>
      </div>` : ''}

      ${winnersHtml}

      ${parts.length > 0 && !isFinished ? `
      <div class="td-section-ttl">👥 Участники (${parts.length})</div>
      <div class="td-plr-pills">${plrPills}${moreParts}</div>` : ''}

      ${wlistHtml}
    </div>
    <div class="td-footer">
      ${!isFinished
        ? trn.format === 'IPT Mixed'
          ? `<button class="td-btn-parts" onclick="document.getElementById('td-modal')?.remove();openParticipantsModal('${escAttr(trn.id)}')">👥 Участники (${parts.length}/${trn.capacity})</button>
             <button class="td-btn-reg${parts.length < 8 ? ' disabled' : ''}"
               ${parts.length < 8 ? `disabled title="Нужно минимум 8 участников"` : `onclick="openIPT('${escAttr(trn.id)}')"`}>🏐 Начать матч IPT</button>`
          : `<button class="td-btn-reg ${isFull?'wait':''}" onclick="document.getElementById('td-modal')?.remove();openRegistrationModal('${escAttr(trn.id)}')">
              ${isFull ? '📋 В лист ожидания' : '⚡ Записаться'}
            </button>`
        : trn.format === 'IPT Mixed' && (trn.ipt?.rounds || trn.ipt?.groups)
          ? `<button class="td-btn-reg" onclick="openIPT('${escAttr(trn.id)}')">📊 Просмотр IPT</button>`
          : ''}
      <button class="td-btn-close" onclick="document.getElementById('td-modal')?.remove()">Закрыть</button>
    </div>
  </div>`;

  document.body.appendChild(overlay);
}
