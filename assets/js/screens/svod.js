'use strict';

function setSvodFilter(f) {
  svodGenderFilter = f;
  const s = document.getElementById('screen-svod');
  if (s) s.innerHTML = renderSvod();
}

function renderSvod() {
  // ── Check if finals are active ──────────────────────────────
  const divsActive = activeDivKeys().some(k => divRoster[k].men.length > 0);

  const svod = getSvod();
  const ALL_GROUP_DEFS = {
    hard:    { cls:'lh-hard',    icon:'🏆' },
    advance: { cls:'lh-advance', icon:'⚡' },
    medium:  { cls:'lh-medium',  icon:'⚙️' },
    lite:    { cls:'lh-lite',    icon:'🍀' },
  };
  const keys = activeDivKeys();
  const groups = keys.map((key, i) => {
    const isLast = i === keys.length - 1;
    const start  = i * ppc + 1;
    const end    = isLast ? null : (i + 1) * ppc;
    const rangeLabel = isLast ? `${start}+` : `${start}–${end}`;
    const label  = `${key.toUpperCase()} (Места ${rangeLabel})`;
    return { key, ...ALL_GROUP_DEFS[key], label, rangeLabel };
  });

  // ── Helper: render a svod-table (Stage 1 ranking) ───────────
  function renderStage1Table(g) {
    const mpl = svod[g.key].M;
    const wpl = svod[g.key].W;
    if (!mpl.length && !wpl.length)
      return `<div class="div-empty">Недостаточно участников</div>`;
    let t = `<div class="svod-table-wrap"><table class="svod-table">
      <thead><tr>
        <th class="td-rank">#</th>
        <th>Имя</th><th>Корт</th>
        <th class="td-pts">Оч·1</th>
        <th class="td-avg">avg/р</th>
      </tr></thead><tbody>`;
    const allPlayers = [
      ...(svodGenderFilter !== 'W' ? mpl : []),
      ...(svodGenderFilter !== 'M' ? wpl : []),
    ];
    // Динамические разделители по activeDivKeys
    const sepLabels = {};
    const ALL_SEP = { advance:{cls:'sep-advance',label:'⚡ ADVANCE'}, medium:{cls:'sep-medium',label:'⚙️ MEDIUM'}, lite:{cls:'sep-lite',label:'🍀 LITE'} };
    // Зона риска: ±1 от каждой границы дивизиона
    const bubbleRanks = new Set();
    activeDivKeys().forEach((key, i) => {
      if (i === 0) return; // первый дивизион — разделитель перед ним не нужен
      const boundary = i * ppc; // после этого глобального ранга
      if (ALL_SEP[key]) sepLabels[boundary] = ALL_SEP[key];
      bubbleRanks.add(boundary);      // последний в верхнем дивизионе
      bubbleRanks.add(boundary + 1);  // первый в нижнем дивизионе
    });
    allPlayers.forEach(p => {
      const avg = p.rPlayed>0 ? (p.pts/p.rPlayed).toFixed(1) : '—';
      const isBubble = bubbleRanks.has(p.globalRank);
      t += `<tr${isBubble ? ' class="bubble-risk"' : ''}>
        <td class="td-rank"><span class="pb ${pbCls(p.globalRank)}">${p.globalRank}${p.globalTied?'<sup>=</sup>':''}</span></td>
        <td><div class="td-name" style="cursor:pointer" ondblclick="showPlayerCard('${escAttr(p.name)}','${escAttr(p.gender)}')" title="Двойной клик для карточки">${esc(p.name)}</div></td>
        <td class="td-court" style="color:${p.courtColor}">${p.courtName}</td>
        <td class="td-pts">${p.pts}</td>
        <td class="td-avg">${avg}</td>
      </tr>`;
      // Разделитель после границы дивизиона (только если нет ничьей)
      if (sepLabels[p.globalRank] && !p.globalTied) {
        const sep = sepLabels[p.globalRank];
        t += `<tr class="svod-div-sep ${sep.cls}"><td colspan="5"><div class="svod-div-sep-inner"><div class="svod-div-sep-line"></div><span>${sep.label}</span><div class="svod-div-sep-line"></div></div></td></tr>`;
      }
    });
    return t + `</tbody></table></div>`;
  }

  const fAll = svodGenderFilter === 'all';
  const fM   = svodGenderFilter === 'M';
  const fW   = svodGenderFilter === 'W';
  let html = `<div class="page-h">📊 СВОДКА</div>
  <div class="page-sub">${nc} корта · ${ppc} игроков${divsActive ? ' · <strong style="color:var(--gold)">Финалы активны</strong>' : ' · актуально в реальном времени'}</div>
  <div class="svod-filter-bar">
    <button class="seg-btn${fAll?' on':''}" onclick="setSvodFilter('all')">Все</button>
    <button class="seg-btn${fM?' on':''}"  onclick="setSvodFilter('M')">🏋️ Мужчины</button>
    <button class="seg-btn${fW?' on':''}"  onclick="setSvodFilter('W')">👩 Женщины</button>
  </div>`;

  groups.forEach(g => {
    const mpl = svod[g.key].M;
    const wpl = svod[g.key].W;
    html += `<div class="level-block">
      <div class="level-hdr ${g.cls}">
        <span>${g.icon} ${g.label}</span>
        <span class="level-desc">${mpl.length}м · ${wpl.length}ж</span>
      </div>`;

    html += renderStage1Table(g);
    html += `</div>`;
  });
  return html;
}

async function svodOpenCard(name, gender) {
  if (!await showConfirm(`Открыть карточку: ${name}?`)) return;
  showPlayerCard(name, gender);
}
