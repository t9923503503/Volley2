'use strict';

function shareTopAvg() {
  const ranked = getAllRanked();
  const allP = [...ranked.M, ...ranked.W];
  const topAvg = allP
    .map(p => {
      const rounds = getAllRoundsForPlayer(p);
      const total  = rounds.reduce((sum, round) => sum + (round || 0), 0);
      return { ...p, avgVal: rounds.length ? total / rounds.length : 0, rTotal: rounds.length };
    })
    .filter(p => p.rTotal > 0)
    .sort((a,b) => b.avgVal - a.avgVal)
    .slice(0, 3);
  const lines  = topAvg.map((p,i) => `${MEDALS_3[i]} ${p.name} — ${p.avgVal.toFixed(1)} avg/раунд`);
  shareText(`📈 Топ по эффективности\n${lines.join('\n')}\n#KingBeach`);
}

function shareChemistry() {
  const pairMap = {};
  for (let ci = 0; ci < nc; ci++) {
    const ct = ALL_COURTS[ci];
    for (let mi = 0; mi < ppc; mi++) {
      for (let ri = 0; ri < ppc; ri++) {
        const sc = scores[ci]?.[mi]?.[ri] ?? null;
        if (!sc) continue;
        const k = `${ct.men[mi]||''}\x00${ct.women[partnerW(mi,ri)]||''}`;
        pairMap[k] = (pairMap[k]||0) + sc;
      }
    }
  }
  DIV_KEYS.forEach(dkey => {
    const men = divRoster[dkey].men, women = divRoster[dkey].women, Nd = men.length;
    if (!Nd) return;
    for (let mi = 0; mi < Nd; mi++) {
      for (let ri = 0; ri < Nd; ri++) {
        const sc = (divScores[dkey][mi]??[])[ri]??null;
        if (!sc) continue;
        const k = `${men[mi]||''}\x00${women[divPartnerW(mi,ri,Nd)]||''}`;
        pairMap[k] = (pairMap[k]||0) + sc;
      }
    }
  });
  const entries = Object.entries(pairMap).sort((a,b) => b[1]-a[1]).slice(0, 5);
  if (!entries.length) return;
  const lines = entries.map(([key, pts], i) => {
    const [man, woman] = key.split('\x00');
    return `${MEDALS_5[i]} ${man} + ${woman} — ${pts}оч`;
  });
  shareText(`💜 Идеальная химия — Топ 5\n${lines.join('\n')}\n#KingBeach`);
}

function renderStats() {
  const ranked = getAllRanked();
  const allP   = [...ranked.M, ...ranked.W];
  if (allP.every(p=>p.pts===0)) {
    return `<div class="stats-empty">
      <div style="font-size:48px">📊</div>
      <div class="page-h" style="margin-top:12px">Пусто</div>
      <div class="page-sub">Введите очки на кортах Этапа 1</div>
    </div>`;
  }
  const total  = allP.reduce((s,p)=>s+p.pts, 0);
  const avgGlob= (total/allP.length).toFixed(1);
  const _flatScores = Array.from({length:nc}, (_,ci) => scores[ci].flat());
  const rPlayed= (() => { let s=0; for(let ci=0;ci<nc;ci++) s+=_flatScores[ci].filter(x=>x!==null).length; return s; })();
  const _flatDivScores = {};
  DIV_KEYS.forEach(k => { _flatDivScores[k] = (divScores[k]||[]).flat(); });
  const divVol = DIV_KEYS.reduce((o,k)=>({...o,[k]:_flatDivScores[k].reduce((s,x)=>s+(x||0),0)}),{});

  // Enrich allP with combined total (Stage 1 + Finals)
  const allPEnriched = allP.map(p => {
    const allRounds = getAllRoundsForPlayer(p);
    const totalPts  = allRounds.reduce((a,b)=>a+b, 0);
    const bestRound = allRounds.length > 0 ? Math.max(...allRounds) : p.bestRound;
    const rTotal    = allRounds.length;
    return { ...p, totalPts, bestRound, rTotal };
  });
  const top5   = [...allPEnriched].sort((a,b)=>b.totalPts-a.totalPts).slice(0,5);
  const maxPts = top5[0]?.totalPts || 1;

  // Consistency = low variance across ALL rounds (Stage 1 + Finals)
  function getVar(p) {
    const rds = getAllRoundsForPlayer(p);
    if (!rds.length) return 999;
    const avg = rds.reduce((a,b)=>a+b,0)/rds.length;
    return rds.reduce((s,r)=>s+(r-avg)**2,0)/rds.length;
  }
  const consist = [...allPEnriched].filter(p=>p.totalPts>0)
    .map(p=>({...p,vari:getVar(p)}))
    .sort((a,b)=>a.vari-b.vari).slice(0,5);

  const courtEff = Array.from({length:nc},(_,ci)=>{
    const flat = _flatScores[ci];
    const t = flat.reduce((s,x)=>s+(x||0),0);
    const n = flat.filter(x=>x!==null&&x!==undefined).length||1;
    return { name:(COURT_META[ci]||{}).name||`Корт ${ci+1}`, color:(COURT_META[ci]||{}).color||'#888', total:t, avg:(t/n).toFixed(1) };
  });

  // ── Финалы и итоговый рейтинг (только если финалы активны) ─
  const divsActive = activeDivKeys().some(k => divRoster[k].men.length > 0);
  const finalsSection = (() => {
    if (!divsActive) return '';
    const svod = getSvod();
    const DIV_META = {
      hard:    { icon:'🔥', cls:'lh-hard',    offset:0       },
      advance: { icon:'⚡', cls:'lh-advance', offset:ppc     },
      medium:  { icon:'⚙️', cls:'lh-medium',  offset:ppc*2   },
      lite:    { icon:'🍀', cls:'lh-lite',    offset:ppc*3   },
    };

    let out = `<div class="page-h" style="font-size:18px;margin:0 0 10px">🏆 ФИНАЛЫ — РЕЗУЛЬТАТЫ</div>`;

    activeDivKeys().forEach(key => {
      const { icon, cls, offset } = DIV_META[key];
      const men   = divGetRanked(key, 'M');
      const women = divGetRanked(key, 'W');
      if (!men.length && !women.length) return;
      const s1AvgMap = {};
      [...svod[key].M, ...svod[key].W].forEach(p => {
        if (p.rPlayed > 0) s1AvgMap[p.name] = p.pts / p.rPlayed;
      });
      out += `<div class="level-block" style="margin-bottom:10px">
        <div class="level-hdr ${cls}"><span>${icon} ${key.toUpperCase()}</span></div>
        <div class="svod-table-wrap"><table class="svod-table">
          <thead><tr>
            <th class="td-rank">Фин</th><th>Имя</th>
            <th class="td-pts">Оч·2</th><th class="td-avg">avg/р</th>
            <th class="td-rank" style="text-align:right">Итог</th>
          </tr></thead><tbody>`;
      [...men.map(x=>({...x,gender:'M'})), ...women.map(x=>({...x,gender:'W'}))].forEach(p => {
        const finAvg = p.rPlayed > 0 ? p.pts / p.rPlayed : null;
        const avg    = finAvg != null ? finAvg.toFixed(1) : '—';
        const s1Avg  = s1AvgMap[p.name];
        let trend = '';
        if (finAvg != null && s1Avg != null) {
          if (finAvg > s1Avg + 0.05)      trend = `<span class="avg-trend up">↑</span>`;
          else if (finAvg < s1Avg - 0.05) trend = `<span class="avg-trend dn">↓</span>`;
        }
        const gp = offset + p.place;
        out += `<tr>
          <td class="td-rank"><span class="pb ${pbCls(p.place)}">${p.place}</span></td>
          <td><div class="td-name" style="cursor:pointer" ondblclick="showPlayerCard('${escAttr(p.name)}','${escAttr(p.gender)}')" title="Двойной клик для карточки">${esc(p.name)}</div></td>
          <td class="td-pts">${p.pts}</td>
          <td class="td-avg">${avg}${trend}</td>
          <td class="td-rank" style="text-align:right"><span class="pb ${pbCls(gp)}" style="font-size:10px;padding:2px 4px">${gp}</span></td>
        </tr>`;
      });
      out += `</tbody></table></div></div>`;
    });

    // Combined leaderboard: Stage 1 + Finals
    const combined = [...allPEnriched].sort((a,b) => b.totalPts - a.totalPts);
    if (combined.some(p => p.totalPts > 0)) {
      out += `<div class="page-h" style="font-size:18px;margin:12px 0 10px">📊 ИТОГО ЗА ДВА ЭТАПА</div>
        <div class="svod-table-wrap"><table class="svod-table">
          <thead><tr>
            <th class="td-rank">#</th><th>Имя</th>
            <th class="td-pts">Оч·1</th><th class="td-pts">Оч·2</th>
            <th class="td-pts" style="color:var(--gold)">Σ</th>
          </tr></thead><tbody>`;
      combined.filter(p => p.pts > 0 || p.totalPts > 0).forEach((p, i) => {
        const fin2 = p.totalPts - p.pts;
        out += `<tr>
          <td class="td-rank"><span class="pb ${pbCls(i+1)}">${i+1}</span></td>
          <td><div class="td-name" style="cursor:pointer" ondblclick="showPlayerCard('${escAttr(p.name)}','${escAttr(p.gender)}')" title="Двойной клик для карточки">${esc(p.name)}</div></td>
          <td class="td-pts">${p.pts}</td>
          <td class="td-pts">${fin2 > 0 ? fin2 : '—'}</td>
          <td class="td-pts" style="color:var(--gold);font-weight:700">${p.totalPts}</td>
        </tr>`;
      });
      out += `</tbody></table></div>`;
    }
    return out;
  })();

  return `${finalsSection}<div class="stats-grid">
    <div class="stat-card voltage-card">
      <div class="stat-card-title">⚡ ВОЛЬТАЖ ТУРНИРА</div>
      <div class="stat-card-desc">Общая сумма всех набранных очков за турнир — чем выше, тем активнее игра</div>
      <div class="voltage-num">${total}</div>
      <div class="voltage-sub">${allP.length} игроков · ${rPlayed} сыгранных раундов</div>
      <div class="voltage-row"><span>Среднее / игрок</span><strong>${avgGlob}</strong></div>
      <div class="voltage-row"><span>Финалы (2-й тур)</span><strong>${activeDivKeys().map(k=>divVol[k]||0).join('/')}</strong></div>
    </div>

    <div class="stat-card">
      <div class="stat-card-title">🏅 ТОП-5 ИГРОКОВ</div>
      <div class="stat-card-desc">Рейтинг по сумме очков за оба этапа · avg — среднее очков за один сыгранный раунд</div>
      ${top5.map((p,i)=>{
        const pct=Math.round(p.pts/maxPts*100);
        const pb=pbCls(p.globalRank);
        const fc=i===0?'bfg':i===1?'bfs':i===2?'bfb':'bfl';
        const avg=p.rTotal>0?(p.totalPts/p.rTotal).toFixed(1):'—';
        return `<div class="bar-row">
          <div class="bar-lbl">
            <span class="pb ${pb}" style="font-size:11px;padding:2px 5px">${p.globalRank}</span>
            <button class="bar-name player-tap" onclick="showPlayerCard('${escAttr(p.name)}','${escAttr(p.gender)}')">${p.genderIcon} ${esc(p.name)}</button>
            <span class="bar-court">${p.courtName}</span>
            <span class="bar-avg">avg ${avg}</span>
            <span class="bar-pts">${p.totalPts}</span>
          </div>
          <div class="bar-track"><div class="bar-fill ${fc}" style="width:${pct}%"></div></div>
        </div>`;
      }).join('')}
    </div>

    <div class="stat-card">
      <div class="stat-card-title">🎯 СТАБИЛЬНОСТЬ</div>
      <div class="stat-card-desc">Кто играл ровно, без провалов и взлётов · чем меньше разброс очков по раундам — тем выше в списке</div>
      ${consist.map((p,i)=>`
        <div class="consist-row">
          <span class="consist-rank">${i+1}</span>
          <button class="bar-name player-tap" onclick="showPlayerCard('${escAttr(p.name)}','${escAttr(p.gender)}')">${p.genderIcon} ${esc(p.name)}</button>
          <span class="bar-court">${p.courtName}</span>
          <div class="consist-bar"><div class="consist-fill" style="width:${Math.max(5,100-p.vari*5)}%"></div></div>
          <span class="bar-pts">${p.totalPts??p.pts}</span>
        </div>`).join('')}
    </div>

    ${(() => {
      // ── Топ по эффективности (AVG за раунд, мин. 1 раунд) ─────
      const topAvg = [...allPEnriched]
        .filter(p => p.rTotal > 0)
        .map(p => ({ ...p, avgVal: p.totalPts / p.rTotal }))
        .sort((a,b) => b.avgVal - a.avgVal)
        .slice(0, 3);
      if (!topAvg.length) return '';
      const maxAvg = topAvg[0].avgVal || 1;
      return `<div class="stat-card" style="position:relative">
        <button class="share-btn" onclick="shareTopAvg()" title="Поделиться">📤</button>
        <div class="stat-card-title">📈 ТОП ПО ЭФФЕКТИВНОСТИ</div>
        <div class="stat-card-desc">Среднее очков за один сыгранный раунд · кто выжимал максимум из каждой игры</div>
        ${topAvg.map((p,i) => {
          const pct = Math.round(p.avgVal / maxAvg * 100);
          return `<div class="avg-row">
            <span class="avg-rank">${MEDALS_3[i]}</span>
            <div class="avg-bar-wrap">
              <div class="bar-lbl" style="margin-bottom:2px">
                <button class="bar-name player-tap" onclick="showPlayerCard('${escAttr(p.name)}','${escAttr(p.gender)}')">${p.genderIcon} ${esc(p.name)}</button>
                <span class="bar-court">${p.courtName}</span>
                <span class="avg-num">${p.avgVal.toFixed(1)}</span>
              </div>
              <div class="avg-track"><div class="avg-fill" style="width:${pct}%"></div></div>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    })()}

    ${(() => {
      // ── Идеальная химия (Best Pairing) ────────────────────────
      const pairMap = {};
      // Stage 1 courts
      for (let ci = 0; ci < nc; ci++) {
        const ct = ALL_COURTS[ci];
        for (let mi = 0; mi < ppc; mi++) {
          const manName = ct.men[mi] || '';
          for (let ri = 0; ri < ppc; ri++) {
            const sc = scores[ci]?.[mi]?.[ri] ?? null;
            if (sc === null || sc === 0) continue;
            const womanName = ct.women[partnerW(mi, ri)] || '';
            if (!manName || !womanName) continue;
            const k = `${manName}\x00${womanName}`;
            pairMap[k] = (pairMap[k] || 0) + sc;
          }
        }
      }
      // Division courts
      DIV_KEYS.forEach(dkey => {
        const men   = divRoster[dkey].men;
        const women = divRoster[dkey].women;
        const Nd    = men.length;
        if (!Nd) return;
        for (let mi = 0; mi < Nd; mi++) {
          const manName = men[mi] || '';
          for (let ri = 0; ri < Nd; ri++) {
            const sc = (divScores[dkey][mi] ?? [])[ri] ?? null;
            if (sc === null || sc === 0) continue;
            const womanName = women[divPartnerW(mi, ri, Nd)] || '';
            if (!manName || !womanName) continue;
            const k = `${manName}\x00${womanName}`;
            pairMap[k] = (pairMap[k] || 0) + sc;
          }
        }
      });
      const entries = Object.entries(pairMap).sort((a,b) => b[1]-a[1]).slice(0, 5);
      if (!entries.length) return '';
      const maxPts = entries[0][1] || 1;
      return `<div class="stat-card chem-card" style="position:relative">
        <button class="share-btn" onclick="shareChemistry()" title="Поделиться">📤</button>
        <div class="stat-card-title">💜 ИДЕАЛЬНАЯ ХИМИЯ — ТОП 5</div>
        <div class="stat-card-desc">Лучшие смешанные пары (М+Ж) по сумме очков, набранных вместе за все раунды</div>
        ${entries.map(([key, pts], i) => {
          const [man, woman] = key.split('\x00');
          const pct = Math.round(pts / maxPts * 100);
          return `<div class="avg-row">
            <span class="avg-rank">${MEDALS_5[i]}</span>
            <div class="avg-bar-wrap">
              <div class="bar-lbl" style="margin-bottom:2px">
                <span class="bar-name" style="font-size:13px"><button class="player-tap" onclick="showPlayerCard('${escAttr(man)}','M')">🏋️ ${esc(man)}</button> <span style="color:#9b5de5">+</span> <button class="player-tap" onclick="showPlayerCard('${escAttr(woman)}','W')">👩 ${esc(woman)}</button></span>
                <span class="avg-num">${pts}</span>
              </div>
              <div class="avg-track"><div class="avg-fill" style="width:${pct}%;background:linear-gradient(90deg,#5a1e8a,#c77dff)"></div></div>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    })()}

    <div class="stat-card">
      <div class="stat-card-title">🏐 ЭФФЕКТИВНОСТЬ КОРТОВ</div>
      <div class="stat-card-desc">Сумма и среднее очков по каждому корту · avg/р — среднее за один раунд на корте</div>
      ${courtEff.map(c=>{
        const pct=Math.round(c.total/((total||2)/2)*100);
        return `<div class="court-eff-row">
          <span class="bar-name" style="color:${c.color};min-width:90px">${c.name}</span>
          <div class="bar-track" style="flex:1"><div class="bar-fill" style="width:${pct}%;background:${c.color}55;border-right:2px solid ${c.color}"></div></div>
          <span class="bar-pts" style="font-size:12px;margin-left:6px">${c.total}оч avg${c.avg}</span>
        </div>`;
      }).join('')}
    </div>

  </div>

  ${renderHistory()}`;
}

// ════════════════════════════════════════════════════════════
// PLAYER RATING SCREEN
// ════════════════════════════════════════════════════════════
function renderRating() {
  const allRanked = getAllRanked();
  const allP = [...allRanked.M, ...allRanked.W];

  if (allP.length === 0) {
    return `<div class="stats-empty">
      <div style="font-size:48px">👥</div>
      <div class="page-h" style="margin-top:12px">Нет игроков</div>
      <div class="page-sub">Добавьте игроков в базу</div>
    </div>`;
  }

  // Enrich with total points
  const enriched = allP.map(p => {
    const allRounds = getAllRoundsForPlayer(p);
    const totalPts = allRounds.reduce((a,b)=>a+b, 0);
    return { ...p, totalPts };
  });

  // Sort by total points descending
  const sorted = [...enriched].sort((a,b) => b.totalPts - a.totalPts);

  const rows = sorted.map((p, idx) => {
    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '  ';
    const gender = p.gender === 'M' ? '♂️' : '♀️';
    return `
      <tr>
        <td style="text-align:center;padding:8px 4px">${medal}</td>
        <td style="text-align:center;padding:8px 4px">${idx + 1}</td>
        <td style="padding:8px 4px">${esc(p.name)}</td>
        <td style="text-align:center;padding:8px 4px">${gender}</td>
        <td style="text-align:right;padding:8px 4px;font-weight:700;color:var(--gold)">${p.totalPts}</td>
      </tr>`;
  }).join('');

  return `
    <div style="padding:12px;max-width:600px;margin:0 auto">
      <div style="padding:12px;background:#0d1015;border-radius:8px;border:1px solid #1e1e34;margin-bottom:16px">
        <div style="font-size:1.2rem;font-weight:700;color:var(--gold);margin-bottom:8px">👥 РЕЙТИНГ ИГРОКОВ</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="border-bottom:1px solid #1e1e34">
              <th style="text-align:center;padding:8px 4px"></th>
              <th style="text-align:center;padding:8px 4px">#</th>
              <th style="text-align:left;padding:8px 4px">Игрок</th>
              <th style="text-align:center;padding:8px 4px">Пол</th>
              <th style="text-align:right;padding:8px 4px">Очки</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ════════════════════════════════════════════════════════════
// PLAYER PAIR STATS (for Player Card chemistry section)
// ════════════════════════════════════════════════════════════
function getPlayerPairStats(playerName, playerGender) {
  const pairMap = {}; // partnerName -> { pts, rounds }
  const isMale = playerGender === 'M';

  // Stage 1 courts
  for (let ci = 0; ci < nc; ci++) {
    const ct = ALL_COURTS[ci];
    if (isMale) {
      const mi = ct.men.indexOf(playerName);
      if (mi < 0) continue;
      for (let ri = 0; ri < ppc; ri++) {
        const sc = scores[ci]?.[mi]?.[ri] ?? null;
        if (!sc) continue;
        const partner = ct.women[partnerW(mi, ri)] || '';
        if (!partner) continue;
        if (!pairMap[partner]) pairMap[partner] = { pts: 0, rounds: 0 };
        pairMap[partner].pts += sc;
        pairMap[partner].rounds++;
      }
    } else {
      const wi = ct.women.indexOf(playerName);
      if (wi < 0) continue;
      for (let ri = 0; ri < ppc; ri++) {
        const mi = partnerM(wi, ri);
        const sc = scores[ci]?.[mi]?.[ri] ?? null;
        if (!sc) continue;
        const partner = ct.men[mi] || '';
        if (!partner) continue;
        if (!pairMap[partner]) pairMap[partner] = { pts: 0, rounds: 0 };
        pairMap[partner].pts += sc;
        pairMap[partner].rounds++;
      }
    }
  }

  // Division courts
  DIV_KEYS.forEach(dkey => {
    const men = divRoster[dkey].men, women = divRoster[dkey].women, Nd = men.length;
    if (!Nd) return;
    if (isMale) {
      const mi = men.indexOf(playerName);
      if (mi < 0) return;
      for (let ri = 0; ri < Nd; ri++) {
        const sc = (divScores[dkey][mi] ?? [])[ri] ?? null;
        if (!sc) continue;
        const partner = women[divPartnerW(mi, ri, Nd)] || '';
        if (!partner) continue;
        if (!pairMap[partner]) pairMap[partner] = { pts: 0, rounds: 0 };
        pairMap[partner].pts += sc;
        pairMap[partner].rounds++;
      }
    } else {
      const wi = women.indexOf(playerName);
      if (wi < 0) return;
      for (let ri = 0; ri < Nd; ri++) {
        const mi = divPartnerM(wi, ri, Nd);
        const sc = (divScores[dkey][mi] ?? [])[ri] ?? null;
        if (!sc) continue;
        const partner = men[mi] || '';
        if (!partner) continue;
        if (!pairMap[partner]) pairMap[partner] = { pts: 0, rounds: 0 };
        pairMap[partner].pts += sc;
        pairMap[partner].rounds++;
      }
    }
  });

  return Object.entries(pairMap)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 3);
}
