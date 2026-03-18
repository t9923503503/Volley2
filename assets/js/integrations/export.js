'use strict';

function exportTournamentPDF(id) {
  let history = [];
  try { history = JSON.parse(localStorage.getItem('kotc3_history') || '[]'); } catch(e){}
  const t = history.find(h => h.id === id);
  if (!t) return;

  const dateStr = fmtDateLong(t.date);
  const medals = ['🥇','🥈','🥉','4','5'];
  const podiumColors = ['#ffc832','#c0c0c0','#cd7f32','#aaaaaa','#aaaaaa'];

  const top5rows = t.players.slice(0,5).map((p,i) => `
    <tr class="podium-row top${i+1}">
      <td class="place-cell"><span class="medal m${i+1}">${medals[i]}</span></td>
      <td class="name-cell">${p.gender==='M'?'🏋️':'👩'} ${esc(p.name)}</td>
      <td class="court-cell">${esc(p.courtName||'—')}</td>
      <td class="pts-cell">${p.totalPts}</td>
    </tr>`).join('');

  const allRows = t.players.map((p,i) => `
    <tr class="${i%2===0?'even':'odd'}${i<3?' top'+(i+1):''}">
      <td class="place-cell"><span class="rank-num">${i+1}</span></td>
      <td class="name-cell">${p.gender==='M'?'🏋️':'👩'} ${esc(p.name)}</td>
      <td class="gender-cell">${p.gender==='M'?'Муж':'Жен'}</td>
      <td class="court-cell">${esc(p.courtName||'—')}</td>
      <td class="pts-cell">${p.totalPts} оч</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>КОТС — ${esc(t.name)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@400;600;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    background:#0f0f1a; color:#fff;
    font-family:'Barlow Condensed',Arial,sans-serif;
    padding: 24px 28px;
  }
  /* ── Header ── */
  .header {
    text-align:center; padding: 24px 0 20px;
    border-bottom: 2px solid #ffc832;
    margin-bottom: 20px;
  }
  .brand {
    font-family:'Bebas Neue',sans-serif;
    font-size:12px; letter-spacing:4px; color:#ffc832; margin-bottom:8px;
  }
  .trn-name {
    font-family:'Bebas Neue',sans-serif;
    font-size:36px; letter-spacing:2px; color:#fff; line-height:1;
  }
  .trn-date { font-size:14px; color:#8888aa; margin-top:6px; }

  /* ── Stats chips ── */
  .stats-row {
    display:flex; gap:10px; justify-content:center;
    margin: 18px 0;
  }
  .chip {
    background:#1a1a2e; border:1px solid #2a2a44;
    border-radius:8px; padding:8px 16px;
    font-size:13px; font-weight:700; color:#ffc832;
    letter-spacing:.5px;
  }

  /* ── Section title ── */
  .section-title {
    font-family:'Bebas Neue',sans-serif;
    font-size:20px; letter-spacing:2px; color:#ffc832;
    margin: 22px 0 10px; padding-bottom:6px;
    border-bottom:1px solid #2a2a44;
  }

  /* ── Tables ── */
  table { width:100%; border-collapse:collapse; }
  th {
    background:#1e1e38; color:#8888cc;
    font-size:11px; font-weight:700; letter-spacing:1px;
    padding:8px 10px; text-align:left; text-transform:uppercase;
  }
  td { padding:8px 10px; font-size:14px; vertical-align:middle; }
  tr.even td { background:#16162a; }
  tr.odd  td { background:#111120; }

  .place-cell { width:44px; text-align:center; }
  .pts-cell   { text-align:right; font-weight:900; color:#ffc832; }
  .court-cell { color:#6666aa; font-size:12px; }
  .gender-cell{ color:#6666aa; font-size:12px; width:50px; }
  .name-cell  { font-weight:700; }

  /* Medals */
  .medal { font-size:20px; }
  .rank-num {
    display:inline-block; width:24px; height:24px; line-height:24px;
    border-radius:6px; background:#2a2a44; color:#aaa;
    font-size:12px; font-weight:700; text-align:center;
  }

  /* Top 3 highlight */
  tr.top1 td { background:#1f1a00 !important; }
  tr.top2 td { background:#1a1a1a !important; }
  tr.top3 td { background:#1a1000 !important; }
  tr.top1 .name-cell { color:#ffc832; }
  tr.top2 .name-cell { color:#c0c0c0; }
  tr.top3 .name-cell { color:#cd7f32; }

  /* Podium table larger */
  .podium-table td { padding:10px 12px; font-size:15px; }
  .podium-row .name-cell { font-size:16px; }

  /* ── Footer ── */
  .footer {
    margin-top:28px; padding-top:10px;
    border-top:1px solid #2a2a44;
    display:flex; justify-content:space-between;
    font-size:11px; color:#444466;
  }

  /* ── Print ── */
  @media print {
    body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .no-print { display:none !important; }
  }

  /* ── Print button (hidden on print) ── */
  .print-bar {
    position:fixed; top:16px; right:16px; z-index:999;
    display:flex; gap:8px;
  }
  .btn-print {
    background:#ffc832; color:#000; border:none; border-radius:10px;
    padding:10px 22px; font-family:'Bebas Neue',sans-serif;
    font-size:18px; letter-spacing:1px; cursor:pointer;
    box-shadow:0 4px 20px rgba(255,200,50,.4);
  }
  .btn-close {
    background:#2a2a44; color:#fff; border:none; border-radius:10px;
    padding:10px 16px; font-family:'Bebas Neue',sans-serif;
    font-size:18px; cursor:pointer;
  }
</style>
</head>
<body>

<div class="print-bar no-print">
  <button class="btn-print" onclick="window.print()">🖨 Сохранить PDF</button>
  <button class="btn-close" onclick="window.close()">✕</button>
</div>

<div class="header">
  <div class="brand">👑 КОРОЛЬ ПЛОЩАДКИ · ПРОТОКОЛ ТУРНИРА</div>
  <div class="trn-name">${esc(t.name || 'Турнир')}</div>
  <div class="trn-date">📅 ${dateStr}</div>
</div>

<div class="stats-row">
  <div class="chip">👥 ${t.players.length} игроков</div>
  <div class="chip">🏐 ${t.rPlayed} раундов</div>
  <div class="chip">⚡ ${t.totalScore} очков</div>
  <div class="chip">🏟 ${t.nc} корт(а) × ${t.ppc}</div>
</div>

<div class="section-title">🏆 ПЬЕДЕСТАЛ</div>
<table class="podium-table">
  <thead><tr>
    <th>Место</th><th>Участник</th><th>Корт</th><th style="text-align:right">Очки</th>
  </tr></thead>
  <tbody>${top5rows}</tbody>
</table>

<div class="section-title">📋 ВСЕ РЕЗУЛЬТАТЫ</div>
<table>
  <thead><tr>
    <th>#</th><th>Участник</th><th>Пол</th><th>Корт</th><th style="text-align:right">Очки</th>
  </tr></thead>
  <tbody>${allRows}</tbody>
</table>

<div class="footer">
  <span>Лютые Пляжники · КОТС · Surgut</span>
  <span>Сформировано: ${new Date().toLocaleDateString('ru-RU')}</span>
</div>

</body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const w    = window.open(url, '_blank', 'width=800,height=900');
  if (!w) { showToast('⚠️ Разрешите всплывающие окна для этого сайта'); URL.revokeObjectURL(url); return; }
  w.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
}

function deleteHistory(id) {
  let history = [];
  try { history = JSON.parse(localStorage.getItem('kotc3_history') || '[]'); } catch(e){}
  history = history.filter(t => t.id !== id);
  localStorage.setItem('kotc3_history', JSON.stringify(history));
  // Re-render stats
  const s = document.getElementById('screen-stats');
  if (s) s.innerHTML = renderStats();
}
