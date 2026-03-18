'use strict';

function showTournament(trnId) {
  const trn = getTournaments().find(t => t.id === trnId);
  if (!trn) {
    showToast('❌ Турнир не найден');
    return;
  }

  const participants = (trn.participants || []).length;
  const capacity = trn.capacity || 0;
  const remaining = capacity - participants;
  const isFull = remaining <= 0;

  const html = `
    <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);display:flex;align-items:flex-end;z-index:9999" onclick="if(event.target===this) this.remove()">
      <div style="background:#0d0d1a;border-radius:16px 16px 0 0;width:100%;max-height:80vh;overflow-y:auto;padding:20px;box-shadow:0 -10px 40px rgba(0,0,0,.8)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
          <div>
            <h2 style="font-size:1.5rem;margin:0;color:#fff;font-weight:700">${esc(trn.name)}</h2>
            <div style="font-size:12px;color:#999;margin-top:4px">🗓️ ${esc(trn.date || '—')} · 🕐 ${esc(trn.time || '—')}</div>
          </div>
          <button onclick="this.closest('[style*=fixed]').remove()" style="background:transparent;border:1px solid #2a2a44;color:#fff;padding:8px 12px;border-radius:6px;cursor:pointer;font-size:18px;width:32px;height:32px;display:flex;align-items:center;justify-content:center">✕</button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
          <div style="background:#1a1e24;padding:12px;border-radius:8px;border:1px solid #1e1e34">
            <div style="font-size:11px;color:#999">Уровень</div>
            <div style="font-size:14px;color:#fff;font-weight:600;margin-top:4px">${trn.level ? esc(trn.level.toUpperCase()) : '—'}</div>
          </div>
          <div style="background:#1a1e24;padding:12px;border-radius:8px;border:1px solid #1e1e34">
            <div style="font-size:11px;color:#999">Тип</div>
            <div style="font-size:14px;color:#fff;font-weight:600;margin-top:4px">${esc(trn.division || '—')}</div>
          </div>
          <div style="background:#1a1e24;padding:12px;border-radius:8px;border:1px solid #1e1e34">
            <div style="font-size:11px;color:#999">Участники</div>
            <div style="font-size:14px;color:${isFull ? '#ff6b6b' : '#4ade80'};font-weight:600;margin-top:4px">${participants}/${capacity}</div>
          </div>
          <div style="background:#1a1e24;padding:12px;border-radius:8px;border:1px solid #1e1e34">
            <div style="font-size:11px;color:#999">Статус</div>
            <div style="font-size:14px;color:${trn.status === 'open' ? '#4ade80' : '#ff6b6b'};font-weight:600;margin-top:4px">${trn.status === 'open' ? '🟢 ОТКРЫТ' : '🔴 ЗАПОЛНЕНО'}</div>
          </div>
        </div>

        ${trn.description ? `<div style="background:#1a1e24;padding:12px;border-radius:8px;border:1px solid #1e1e34;margin-bottom:16px;font-size:13px;line-height:1.5">${esc(trn.description)}</div>` : ''}

        <div style="display:flex;gap:8px">
          <button onclick="switchTab('svod');this.closest('[style*=fixed]').remove()" style="flex:1;padding:12px;background:var(--gold);color:#000;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px">📋 ПЕРЕЙТИ К ЗАПИСИ</button>
          <button onclick="this.closest('[style*=fixed]').remove()" style="flex:1;padding:12px;background:#2a2a44;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px">Закрыть</button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
}

// ════════════════════════════════════════════════════════════
// 11b. PLAYER CARD
// ════════════════════════════════════════════════════════════
function showPlayerCard(name, gender) {
  const gIcon      = gender === 'M' ? '🏋️' : '👩';
  const partnerIcon= gender === 'M' ? '👩' : '🏋️';

  // ── PlayerDB record ───────────────────────────────────────
  const db     = loadPlayerDB();
  const dbPlayer = db.find(p => p.name === name && p.gender === gender)
                || db.find(p => p.name === name);

  // ── Tournament history from kotc3_tournaments ─────────────
  const allTrns = getTournaments();
  const pid     = dbPlayer?.id;
  const MEDALS  = MEDALS_3;

  // Tournaments where player participated or placed
  const trnHistory = pid ? allTrns
    .filter(t => t.status === 'finished' &&
      ((t.participants||[]).includes(pid) ||
       (t.winners||[]).some(w => (w.playerIds||[]).includes(pid))))
    .sort((a,b) => (b.date||'') > (a.date||'') ? 1 : -1)
    : [];

  // Podium counts
  const podCnt = [1,2,3].map(place =>
    allTrns.filter(t => (t.winners||[]).some(w => w.place === place && (w.playerIds||[]).includes(pid))).length
  );
  const [p1cnt, p2cnt, p3cnt] = podCnt;
  const totalPodiums = p1cnt + p2cnt + p3cnt;

  // Winrate
  const totalPlayed = dbPlayer?.tournaments || trnHistory.length;
  const wins        = dbPlayer?.wins ?? p1cnt;
  const winrate     = totalPlayed ? Math.round(wins / totalPlayed * 100) : 0;

  // ── Achievements ──────────────────────────────────────────
  const achvs = [];
  if (wins >= 1)          achvs.push({ icon:'🥇', text:'Первая победа',         cls:'' });
  if (wins >= 5)          achvs.push({ icon:'🏆', text:'Машина побед ×5',        cls:'' });
  if (wins >= 10)         achvs.push({ icon:'👑', text:'Легенда кортов ×10',     cls:'' });
  if (totalPlayed >= 5)   achvs.push({ icon:'⚡', text:'Постоянный участник',    cls:'blue' });
  if (totalPlayed >= 10)  achvs.push({ icon:'🔥', text:'Ветеран (10+ турниров)', cls:'blue' });
  if (totalPodiums >= 3)  achvs.push({ icon:'🎯', text:'Призёр (3+ подиума)',    cls:'green' });
  if (winrate >= 50 && totalPlayed >= 3)
                          achvs.push({ icon:'📈', text:'Winrate 50%+',           cls:'green' });
  if (p2cnt >= 3)         achvs.push({ icon:'🥈', text:'Серебряный мастер ×3',   cls:'purple' });

  // Streak-based achievements from trnHistory
  if (trnHistory.length >= 3) {
    let consecWins = 0, consecPodiums = 0;
    for (const t of trnHistory) {
      const slot = (t.winners||[]).find(w => (w.playerIds||[]).includes(pid));
      if (slot?.place === 1) { consecWins++; consecPodiums++; }
      else if (slot?.place <= 3) { consecWins = 0; consecPodiums++; }
      else break;
    }
    if (consecWins >= 3)    achvs.push({ icon:'🔥', text:`Серия ${consecWins} побед`,    cls:'fire' });
    if (consecPodiums >= 5) achvs.push({ icon:'💎', text:`Призёр ${consecPodiums}× подряд`, cls:'purple' });
  }

  // Activity-based
  if (totalPlayed >= 20)  achvs.push({ icon:'🏅', text:'20+ турниров',  cls:'blue' });
  if (totalPlayed >= 50)  achvs.push({ icon:'🌟', text:'Полтинник!',    cls:'gold' });

  // ── Stage 1 data (current session) ───────────────────────
  let s1Data = null;
  for (let ci = 0; ci < nc; ci++) {
    const arr = gender === 'M' ? ALL_COURTS[ci].men : ALL_COURTS[ci].women;
    const idx = arr.indexOf(name);
    if (idx < 0) continue;
    const ct   = ALL_COURTS[ci];
    const meta = COURT_META[ci];
    const rounds = [];
    for (let ri = 0; ri < ppc; ri++) {
      let score, partnerName;
      if (gender === 'M') {
        score = scores[ci]?.[idx]?.[ri] ?? null;
        partnerName = ct.women[partnerW(idx, ri)] || '—';
      } else {
        const mi = partnerM(idx, ri);
        score = scores[ci]?.[mi]?.[ri] ?? null;
        partnerName = ct.men[mi] || '—';
      }
      rounds.push({ ri, score, partnerName });
    }
    s1Data = { courtName: meta.name, courtColor: meta.color, rounds };
    break;
  }

  // ── Finals data (current session) ────────────────────────
  const DIV_LABELS = { hard:'🔥 HARD', advance:'⚡ ADVANCE', medium:'⚙️ MEDIUM', lite:'🍀 LITE' };
  let finData = null;
  for (const key of activeDivKeys()) {
    const arr = gender === 'M' ? divRoster[key].men : divRoster[key].women;
    const idx = arr.indexOf(name);
    if (idx < 0) continue;
    const Nd = divRoster[key].men.length;
    const rounds = [];
    for (let ri = 0; ri < Nd; ri++) {
      let score, partnerName;
      if (gender === 'M') {
        score = (divScores[key][idx] ?? [])[ri] ?? null;
        partnerName = divRoster[key].women[divPartnerW(idx, ri, Nd)] || '—';
      } else {
        const mi = divPartnerM(idx, ri, Nd);
        score = (divScores[key][mi] ?? [])[ri] ?? null;
        partnerName = divRoster[key].men[mi] || '—';
      }
      rounds.push({ ri, score, partnerName });
    }
    finData = { label: DIV_LABELS[key] || key, rounds };
    break;
  }

  // Require at least some data to show
  if (!dbPlayer && !s1Data && !finData) { showToast('Нет данных'); return; }

  // ── Session summary stats ─────────────────────────────────
  const sessionScores = [];
  [s1Data, finData].forEach(d => d?.rounds.forEach(r => { if (r.score !== null) sessionScores.push(r.score); }));
  const sessTotal = sessionScores.reduce((a,b)=>a+b, 0);
  const sessAvg   = sessionScores.length ? (sessTotal / sessionScores.length).toFixed(1) : '—';
  const sessBest  = sessionScores.length ? Math.max(...sessionScores) : '—';

  // ── Render rounds helper ──────────────────────────────────
  function renderRounds(rounds) {
    const played = rounds.filter(r => r.score !== null).map(r => r.score);
    const hi = played.length ? Math.max(...played) : -1;
    const lo = played.length > 1 ? Math.min(...played) : -1;
    return rounds.map(({ ri, score, partnerName }) => {
      const isRest = score === null;
      const cls = isRest ? 'rest' : score === hi && score > 0 ? 'hi' : score === lo && played.length > 1 ? 'lo' : '';
      return `<div class="pcard-round-row">
        <span class="pcard-r-num">Р${ri+1}</span>
        <div class="pcard-r-score ${cls}">${isRest ? 'отд' : score}</div>
        ${!isRest
          ? `<span class="pcard-r-partner">${partnerIcon} ${esc(partnerName)}</span>`
          : '<span class="pcard-r-partner" style="color:#555">— отдых —</span>'}
      </div>`;
    }).join('');
  }

  // ── Avatar initials ───────────────────────────────────────
  const initials = name.trim().split(/\s+/).map(w=>w[0]?.toUpperCase()||'').join('').slice(0,2) || gIcon;

  // ── Build HTML ────────────────────────────────────────────
  const joinedStr = dbPlayer?.addedAt ? `📅 с ${dbPlayer.addedAt}` : '';

  // DB stats row (only if dbPlayer exists)
  const totalRating = (dbPlayer?.ratingM||0) + (dbPlayer?.ratingW||0) + (dbPlayer?.ratingMix||0);
  const dbStatsHtml = dbPlayer ? `
    <div class="pcard-summary">
      <div class="pcard-stat-box">
        <div class="pcard-stat-val">${totalRating}</div>
        <div class="pcard-stat-lbl">🔥 Рейтинг</div>
      </div>
      <div class="pcard-stat-box">
        <div class="pcard-stat-val">${wins}</div>
        <div class="pcard-stat-lbl">🎯 Победы</div>
      </div>
      <div class="pcard-stat-box">
        <div class="pcard-stat-val">${totalPlayed}</div>
        <div class="pcard-stat-lbl">🏆 Турниры</div>
      </div>
      <div class="pcard-stat-box">
        <div class="pcard-stat-val">${winrate}%</div>
        <div class="pcard-stat-lbl">📈 Winrate</div>
      </div>
    </div>
    <div class="pcard-podium">
      <div class="pcard-pod p1">
        <span class="pcard-pod-icon">🥇</span>
        <span class="pcard-pod-cnt">${p1cnt}</span>
        <span class="pcard-pod-lbl">1 место</span>
      </div>
      <div class="pcard-pod p2">
        <span class="pcard-pod-icon">🥈</span>
        <span class="pcard-pod-cnt">${p2cnt}</span>
        <span class="pcard-pod-lbl">2 место</span>
      </div>
      <div class="pcard-pod p3">
        <span class="pcard-pod-icon">🥉</span>
        <span class="pcard-pod-cnt">${p3cnt}</span>
        <span class="pcard-pod-lbl">3 место</span>
      </div>
    </div>
    ${(() => {
      const rM = dbPlayer.ratingM || 0, rW = dbPlayer.ratingW || 0, rMix = dbPlayer.ratingMix || 0;
      const tM = dbPlayer.tournamentsM || 0, tW = dbPlayer.tournamentsW || 0, tMix = dbPlayer.tournamentsMix || 0;
      const maxR = Math.max(rM, rW, rMix, 1);
      if (rM + rW + rMix === 0) return '';
      return `<div class="pcard-rating-breakdown">
        ${rM ? `<div class="pcard-rb-row"><span class="pcard-rb-label">♂ Мужские</span><div class="pcard-rb-bar"><div class="pcard-rb-fill m" style="width:${Math.round(rM/maxR*100)}%"></div></div><span class="pcard-rb-val">${rM}</span><span class="pcard-rb-trn">${tM} турн.</span></div>` : ''}
        ${rW ? `<div class="pcard-rb-row"><span class="pcard-rb-label">♀ Женские</span><div class="pcard-rb-bar"><div class="pcard-rb-fill w" style="width:${Math.round(rW/maxR*100)}%"></div></div><span class="pcard-rb-val">${rW}</span><span class="pcard-rb-trn">${tW} турн.</span></div>` : ''}
        ${rMix ? `<div class="pcard-rb-row"><span class="pcard-rb-label">🔄 Микст</span><div class="pcard-rb-bar"><div class="pcard-rb-fill mix" style="width:${Math.round(rMix/maxR*100)}%"></div></div><span class="pcard-rb-val">${rMix}</span><span class="pcard-rb-trn">${tMix} турн.</span></div>` : ''}
      </div>`;
    })()}` : '';

  const achvHtml = achvs.length ? `
    <div class="pcard-section">🏅 Достижения</div>
    <div class="pcard-achv-row">
      ${achvs.map(a => `<div class="pcard-achv ${a.cls}"><span>${a.icon}</span>${esc(a.text)}</div>`).join('')}
    </div>` : '';

  // ── Form trend (last 5 tournaments) ──────────────────────
  const formTrendHtml = (() => {
    if (!trnHistory.length) return '';
    const last5 = trnHistory.slice(0, 5);
    const items = last5.map(t => {
      const slot = (t.winners||[]).find(w => (w.playerIds||[]).includes(pid));
      if (!slot) return { medal: '👤', place: 99 };
      return { medal: MEDALS[slot.place-1] || `${slot.place}`, place: slot.place };
    });
    if (items.every(i => i.place === 99)) return '';

    // Determine trend
    const places = items.filter(i => i.place < 99).map(i => i.place);
    let trendIcon = '➡️', trendText = '';
    if (places.length >= 2) {
      const avg1 = places.slice(0, Math.ceil(places.length/2)).reduce((a,b)=>a+b,0) / Math.ceil(places.length/2);
      const avg2 = places.slice(Math.ceil(places.length/2)).reduce((a,b)=>a+b,0) / (places.length - Math.ceil(places.length/2));
      if (avg1 < avg2 - 0.5) { trendIcon = '📈'; trendText = 'подъём'; }
      else if (avg1 > avg2 + 0.5) { trendIcon = '📉'; trendText = 'спад'; }
      else { trendIcon = '➡️'; trendText = 'стабильно'; }
    }
    const winsInRow = (() => { let c = 0; for (const i of items) { if (i.place === 1) c++; else break; } return c; })();
    if (winsInRow >= 3) { trendIcon = '🔥'; trendText = `${winsInRow} побед подряд!`; }

    return `
    <div class="pcard-section">📈 Форма</div>
    <div class="pcard-form-row">
      ${items.map((it, idx) => `${idx > 0 ? '<span class="pcard-form-arrow">→</span>' : ''}<span class="pcard-form-item">${it.medal}</span>`).join('')}
      <span class="pcard-form-label">${trendIcon} ${trendText}</span>
    </div>`;
  })();

  const trnHistHtml = trnHistory.length ? `
    <div class="pcard-section">📚 История турниров</div>
    <div class="pcard-trn-list">
      ${trnHistory.map(t => {
        const slot    = (t.winners||[]).find(w => (w.playerIds||[]).includes(pid));
        const medal   = slot ? (MEDALS[slot.place-1] || `${slot.place}-е`) : '👤';
        const pts     = slot?.points ?? null;
        let dateStr   = t.date || '';
        try { dateStr = new Date(t.date+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short'}); } catch(e){}
        return `<div class="pcard-trn-row" onclick="openTrnDetails('${escAttr(t.id)}')" style="cursor:pointer">
          <span class="pcard-trn-medal">${medal}</span>
          <div class="pcard-trn-info">
            <div class="pcard-trn-name">${esc(t.name)} <span style="font-size:10px;color:var(--muted)">→</span></div>
            <div class="pcard-trn-date">📅 ${dateStr}${t.location ? ' · ' + esc(t.location) : ''}</div>
          </div>
          ${pts !== null ? `<span class="pcard-trn-pts">${pts}</span>` : ''}
        </div>`;
      }).join('')}
    </div>` : '';

  // ── Best partners (chemistry) ─────────────────────────────
  const partnersHtml = (() => {
    if (typeof getPlayerPairStats !== 'function') return '';
    const pairs = getPlayerPairStats(name, gender);
    if (!pairs.length) return '';
    const icon = gender === 'M' ? '👩' : '🏋️';
    return `
    <div class="pcard-section">💜 Лучшие партнёры</div>
    <div class="pcard-partners">
      ${pairs.map((p, i) => `<div class="pcard-partner-row">
        <span class="pcard-partner-rank">${i+1}</span>
        <span class="pcard-partner-name">${icon} ${esc(p.name)}</span>
        <span class="pcard-partner-pts">${p.pts} оч</span>
        <span class="pcard-partner-info">${p.rounds} р.</span>
      </div>`).join('')}
    </div>`;
  })();

  // ── Session histogram ───────────────────────────────────────
  const histogramHtml = (() => {
    if (!sessionScores.length) return '';
    const max = Math.max(...sessionScores, 1);
    return `<div class="pcard-histogram">
      ${sessionScores.map(sc => `<div class="pcard-hist-bar${sc === 0 ? ' rest' : ''}" style="height:${Math.max(sc/max*100, 4)}%" title="${sc} оч"></div>`).join('')}
    </div>`;
  })();

  const sessionHtml = (s1Data || finData) ? `
    <div class="pcard-section">🏐 Текущая сессия</div>
    <div class="pcard-summary" style="grid-template-columns:1fr 1fr 1fr">
      <div class="pcard-stat-box"><div class="pcard-stat-val">${sessTotal}</div><div class="pcard-stat-lbl">Σ очков</div></div>
      <div class="pcard-stat-box"><div class="pcard-stat-val">${sessAvg}</div><div class="pcard-stat-lbl">avg/раунд</div></div>
      <div class="pcard-stat-box"><div class="pcard-stat-val">${sessBest}</div><div class="pcard-stat-lbl">лучший раунд</div></div>
    </div>
    ${histogramHtml}
    ${s1Data ? `<div class="pcard-section">Этап 1 · ${s1Data.courtName}</div><div class="pcard-rounds">${renderRounds(s1Data.rounds)}</div>` : ''}
    ${finData ? `<div class="pcard-section">${finData.label}</div><div class="pcard-rounds">${renderRounds(finData.rounds)}</div>` : ''}` : '';

  document.getElementById('pcard-box').innerHTML = `
    <div class="pcard-hdr">
      <div class="pcard-hdr-left">
        <div class="pcard-avatar ${gender}">${initials}</div>
        <div>
          <div class="pcard-name">${esc(name)}</div>
          <div class="pcard-court">${gIcon} ${gender === 'M' ? 'Мужчина' : 'Женщина'}${s1Data ? ' · ' + s1Data.courtName : ''}</div>
          ${joinedStr ? `<div class="pcard-joined">${joinedStr}</div>` : ''}
        </div>
      </div>
      <button class="pcard-close" onclick="closePcard()">✕</button>
    </div>
    ${dbStatsHtml}
    ${achvHtml}
    ${formTrendHtml}
    ${partnersHtml}
    ${trnHistHtml}
    ${sessionHtml}
  `;
  document.getElementById('pcard-overlay').classList.add('open');
}

function closePcard() {
  document.getElementById('pcard-overlay').classList.remove('open');
}

// ════════════════════════════════════════════════════════════
// 11c. SHARE HELPERS
// ════════════════════════════════════════════════════════════
async function shareText(text) {
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
  } catch(e) { /* cancelled or unsupported */ }
  try { await navigator.clipboard.writeText(text); showToast('✅ Текст скопирован'); } catch(e) {}
}
