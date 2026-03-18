'use strict'; // ── IPT Mixed — rotation schedule & scoring logic ──

// ════════════════════════════════════════════════════════════════
// Rotation schedule: 8 players (indices 0..7), 4 rounds, 2 courts
// IPT_SCHEDULE[round][court] = { t1: [idx,idx], t2: [idx,idx] }
// Properties: each player has 4 unique partners; opponents ≤ 2 times.
// ════════════════════════════════════════════════════════════════
const IPT_SCHEDULE = [
  // Round 0
  [ { t1:[0,1], t2:[2,3] }, { t1:[4,5], t2:[6,7] } ],
  // Round 1
  [ { t1:[0,2], t2:[4,6] }, { t1:[1,3], t2:[5,7] } ],
  // Round 2
  [ { t1:[0,4], t2:[1,6] }, { t1:[2,7], t2:[3,5] } ],
  // Round 3
  [ { t1:[0,7], t2:[2,5] }, { t1:[1,4], t2:[3,6] } ],
];

// ── Group names by division count ─────────────────────────────
const IPT_GROUP_NAMES = {
  1: ['IPT'],
  2: ['ХАРД', 'ЛАЙТ'],
  3: ['ХАРД', 'МЕДИУМ', 'ЛАЙТ'],
  4: ['ХАРД', 'АДВАНС', 'МЕДИУМ', 'ЛАЙТ'],
};
function getIPTGroupNames(n) {
  return IPT_GROUP_NAMES[n] || Array.from({ length: n }, (_, i) => `ГРУППА ${i + 1}`);
}

/**
 * Map 8 participant IDs to the rotation schedule.
 * @param {string[]} participants — exactly 8 player IDs
 * @returns {Array} rounds array ready for a group
 */
function generateIPTRounds(participants) {
  return IPT_SCHEDULE.map((roundDef, rn) => ({
    num: rn,
    status: rn === 0 ? 'active' : 'waiting',
    courts: roundDef.map(def => ({
      team1:  def.t1.map(i => participants[i]),
      team2:  def.t2.map(i => participants[i]),
      score1: 0,
      score2: 0,
      status: rn === 0 ? 'active' : 'waiting',
    })),
  }));
}

/**
 * Dynamic round generator for N players (N >= 4, any count).
 * Generates rounds so each player plays ≈ 4 matches.
 * Minimises partner repeats greedily.
 */
function generateDynamicIPTRounds(participants) {
  const n = participants.length;
  const courtsPerRound  = Math.floor(n / 4);
  const playersPerRound = courtsPerRound * 4;
  const benchSize       = n - playersPerRound;
  const numRounds       = Math.ceil(4 * n / playersPerRound);

  const pairKey  = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
  const partnerCount = {};
  const getPC    = (a, b) => partnerCount[pairKey(a, b)] || 0;
  const bumpPC   = (a, b) => { const k = pairKey(a, b); partnerCount[k] = (partnerCount[k] || 0) + 1; };
  const benchHistory = new Array(n).fill(0);

  return Array.from({ length: numRounds }, (_, r) => {
    let activeIdx;
    if (benchSize === 0) {
      activeIdx = participants.map((_, i) => i);
    } else {
      const sorted = participants.map((_, i) => i)
        .sort((a, b) => benchHistory[a] !== benchHistory[b]
          ? benchHistory[a] - benchHistory[b] : a - b);
      const benchSet = new Set(sorted.slice(0, benchSize));
      sorted.slice(0, benchSize).forEach(i => benchHistory[i]++);
      activeIdx = participants.map((_, i) => i).filter(i => !benchSet.has(i));
    }

    const active  = activeIdx.map(i => participants[i]);
    const shift   = (r * courtsPerRound) % active.length;
    const rotated = active.slice(shift).concat(active.slice(0, shift));

    const courts = Array.from({ length: courtsPerRound }, (_, c) => {
      const g    = rotated.slice(c * 4, c * 4 + 4);
      const opts = [
        { t1: [g[0], g[1]], t2: [g[2], g[3]] },
        { t1: [g[0], g[2]], t2: [g[1], g[3]] },
        { t1: [g[0], g[3]], t2: [g[1], g[2]] },
      ];
      const costs = opts.map(o => getPC(o.t1[0], o.t1[1]) + getPC(o.t2[0], o.t2[1]));
      const best  = opts[costs.indexOf(Math.min(...costs))];
      bumpPC(best.t1[0], best.t1[1]);
      bumpPC(best.t2[0], best.t2[1]);
      return { team1: best.t1, team2: best.t2, score1: 0, score2: 0,
               status: r === 0 ? 'active' : 'waiting' };
    });
    return { num: r, status: r === 0 ? 'active' : 'waiting', courts };
  });
}

/**
 * Build partner/opponent history from rounds.
 */
function buildIPTMatchHistory(rounds) {
  const partners = {}, opponents = {};
  const pairKey = (a, b) => { const x = String(a), y = String(b); return x < y ? `${x}|${y}` : `${y}|${x}`; };
  const bump    = (obj, k) => { obj[k] = (obj[k] || 0) + 1; };
  (rounds || []).forEach(r => (r.courts || []).forEach(c => {
    const t1 = c.team1 || [], t2 = c.team2 || [];
    if (t1.length === 2) bump(partners, pairKey(t1[0], t1[1]));
    if (t2.length === 2) bump(partners, pairKey(t2[0], t2[1]));
    t1.forEach(a => t2.forEach(b => bump(opponents, pairKey(a, b))));
  }));
  return { partners, opponents };
}

/**
 * Generate all groups from the participants list.
 * Always splits into groups of 8 (last group may have remainder).
 * @param {string[]} participants
 * @returns {Array} groups array for trn.ipt.groups
 */
function generateIPTGroups(participants) {
  const n         = participants.length;
  const numGroups = Math.max(1, Math.floor(n / 8));
  const names     = getIPTGroupNames(numGroups);

  return names.map((name, gi) => {
    const start   = gi * 8;
    const players = gi < numGroups - 1
      ? participants.slice(start, start + 8)
      : participants.slice(start); // last group gets remainder
    const rounds  = players.length === 8
      ? generateIPTRounds(players)
      : generateDynamicIPTRounds(players);
    return { name, players, currentRound: 0, status: 'active', rounds };
  });
}

/**
 * Migrate legacy flat ipt structure (ipt.rounds) to ipt.groups[].
 * Safe to call multiple times.
 */
function _migrateIPTLegacy(trn) {
  const ipt = trn?.ipt;
  if (!ipt || ipt.groups) return;
  if (!ipt.rounds) return;
  const players = ipt.rounds[0]?.courts.flatMap(c => [...(c.team1||[]), ...(c.team2||[])]) || [];
  ipt.groups = [{ name: 'IPT', players, currentRound: ipt.currentRound || 0,
                  status: trn.status === 'finished' ? 'finished' : 'active',
                  rounds: ipt.rounds }];
  ipt.currentGroup = 0;
}

/**
 * Check if a match is over given point limit and finish type.
 */
function iptMatchFinished(court, pointLimit, finishType) {
  const s1 = court.score1, s2 = court.score2;
  if (finishType === 'balance') {
    if (s1 < pointLimit && s2 < pointLimit) return false;
    return Math.abs(s1 - s2) >= 2;
  }
  return s1 >= pointLimit || s2 >= pointLimit;
}

/**
 * Compute standings for a single group.
 * @param {object} group — { rounds, players }
 * @param {number} pointLimit
 * @param {string} finishType
 * @returns {Array<{playerId, wins, diff, pts, matches, wr}>} sorted
 */
function calcIPTGroupStandings(group, pointLimit, finishType) {
  const stats = {};
  const ensure = id => { if (!stats[id]) stats[id] = { playerId: id, wins: 0, diff: 0, pts: 0, matches: 0 }; };

  (group.rounds || []).forEach(round => {
    (round.courts || []).forEach(court => {
      const { team1, team2, score1: s1, score2: s2 } = court;
      team1.forEach(ensure); team2.forEach(ensure);
      if (s1 === 0 && s2 === 0) return;
      const done = iptMatchFinished(court, pointLimit, finishType);
      team1.forEach(id => { stats[id].pts += s1; stats[id].diff += s1 - s2;
        if (done && s1 > s2) stats[id].wins++;
        if (done) stats[id].matches++; });
      team2.forEach(id => { stats[id].pts += s2; stats[id].diff += s2 - s1;
        if (done && s2 > s1) stats[id].wins++;
        if (done) stats[id].matches++; });
    });
  });

  return Object.values(stats)
    .map(s => ({ ...s, wr: s.matches ? s.wins / s.matches : 0 }))
    .sort((a, b) =>
      b.wins !== a.wins ? b.wins - a.wins :
      b.diff !== a.diff ? b.diff - a.diff :
      b.pts  - a.pts);
}

/**
 * Legacy wrapper: calcIPTStandings(trn) — returns standings for the current group.
 */
function calcIPTStandings(trn) {
  _migrateIPTLegacy(trn);
  const ipt = trn.ipt;
  const gi  = ipt.currentGroup || 0;
  const g   = ipt.groups[gi];
  return g ? calcIPTGroupStandings(g, ipt.pointLimit, ipt.finishType) : [];
}

/**
 * Apply score delta to a team in a specific group.
 * @param {string} trnId
 * @param {number} groupIdx
 * @param {number} roundNum
 * @param {number} courtNum
 * @param {1|2}    team
 * @param {1|-1}   delta
 */
function iptApplyScore(trnId, groupIdx, roundNum, courtNum, team, delta) {
  const arr = getTournaments();
  const trn = arr.find(t => t.id === trnId);
  if (!trn?.ipt) return;
  _migrateIPTLegacy(trn);

  const group = trn.ipt.groups[groupIdx];
  if (!group) return;
  const round = group.rounds[roundNum];
  if (!round) return;
  const court = round.courts[courtNum];
  if (!court || court.status === 'finished') return;

  const key  = team === 1 ? 'score1' : 'score2';
  court[key] = Math.max(0, court[key] + delta);

  if (iptMatchFinished(court, trn.ipt.pointLimit, trn.ipt.finishType)) {
    court.status = 'finished';
    showToast(`✅ Матч завершён: ${court.score1} : ${court.score2}`, 'success');
    playScoreSound && playScoreSound(1);
  }

  saveTournaments(arr);
  _iptRerender();
}

/**
 * Mark current round of a group finished, activate next round.
 * @param {string} trnId
 * @param {number} groupIdx
 */
function finishIPTRound(trnId, groupIdx) {
  const arr = getTournaments();
  const trn = arr.find(t => t.id === trnId);
  if (!trn?.ipt) return;
  _migrateIPTLegacy(trn);

  const group = trn.ipt.groups[groupIdx];
  if (!group) return;
  const rn = group.currentRound;
  group.rounds[rn].status = 'finished';

  if (rn + 1 < group.rounds.length) {
    group.currentRound = rn + 1;
    group.rounds[rn + 1].status = 'active';
    group.rounds[rn + 1].courts.forEach(c => c.status = 'active');
    showToast(`▶ ${group.name} — Раунд ${rn + 2} начат`, 'success');
  } else {
    group.status = 'finished';
    showToast(`🏁 Группа ${group.name} завершена!`, 'success');
  }

  saveTournaments(arr);

  // Auto-generate Phase 2 when all Phase 1 groups just finished (requires ≥2 groups)
  const allPhase1Done = trn.ipt.groups.every(g => g.status === 'finished');
  if (allPhase1Done && !trn.ipt.phase2Groups && trn.ipt.groups.length >= 2) {
    trn.ipt.phase2Groups = generateIPTPhase2Groups(trn);
    saveTournaments(arr);
    if (typeof syncDivLock === 'function') syncDivLock();
    setTimeout(() => showToast('🔥 Фаза 1 завершена! Открыты финалы: ХАРД · АДВАНС · МЕДИУМ · ЛАЙТ', 'success'), 800);
  }

  _iptRerender();
}

// ══ Phase 2 — Finals redistribution ══════════════════════════

/**
 * Redistribute Phase 1 standings into 4 finals groups.
 * Rank 1 from each group → ХАРД, rank 2 → АДВАНС, rank 3 → МЕДИУМ, rank 4 → ЛАЙТ.
 * Higher ranks cycle back (rank 5 → ХАРД, etc.).
 */
function generateIPTPhase2Groups(trn) {
  const ipt = trn.ipt;
  // Number of finals = number of Phase 1 groups (2 → ХАРД/ЛАЙТ, 4 → ХАРД/АДВАНС/МЕДИУМ/ЛАЙТ)
  const numBuckets = Math.min(ipt.groups.length, 4);
  const NAMES_MAP = {
    2: ['ХАРД', 'ЛАЙТ'],
    3: ['ХАРД', 'АДВАНС', 'ЛАЙТ'],
    4: ['ХАРД', 'АДВАНС', 'МЕДИУМ', 'ЛАЙТ'],
  };
  const NAMES = NAMES_MAP[numBuckets] || NAMES_MAP[4];
  const buckets = Array.from({ length: numBuckets }, () => []);

  const maxRank = Math.max(...ipt.groups.map(g => g.players.length));
  // Block-partition: top (maxRank/numBuckets) ranks → ХАРД, next block → АДВАНС, etc.
  // This ensures each finals group gets equal players (8 per group).
  const ranksPerBucket = maxRank / numBuckets;
  for (let rank = 0; rank < maxRank; rank++) {
    const bi = Math.min(Math.floor(rank / ranksPerBucket), numBuckets - 1);
    ipt.groups.forEach(g => {
      const st = calcIPTGroupStandings(g, ipt.pointLimit, ipt.finishType);
      if (st[rank]) buckets[bi].push(st[rank].playerId);
    });
  }

  return NAMES.map((name, i) => {
    const players = buckets[i];
    if (players.length < 4) return { name, players, currentRound: 0, status: 'skip', rounds: [] };
    const rounds = players.length === 8
      ? generateIPTRounds(players)
      : generateDynamicIPTRounds(players);
    return { name, players, currentRound: 0, status: 'active', rounds };
  });
}

/** Apply score delta in a Phase 2 group court */
function iptApplyScoreP2(trnId, groupIdx, roundNum, courtNum, team, delta) {
  const arr = getTournaments();
  const trn = arr.find(t => t.id === trnId);
  if (!trn?.ipt?.phase2Groups) return;
  const group = trn.ipt.phase2Groups[groupIdx];
  if (!group) return;
  const round = group.rounds[roundNum];
  if (!round) return;
  const court = round.courts[courtNum];
  if (!court || court.status === 'finished') return;

  const key = team === 1 ? 'score1' : 'score2';
  court[key] = Math.max(0, court[key] + delta);

  if (iptMatchFinished(court, trn.ipt.pointLimit, trn.ipt.finishType)) {
    court.status = 'finished';
    showToast(`✅ Матч завершён: ${court.score1} : ${court.score2}`, 'success');
    playScoreSound && playScoreSound(1);
  }

  saveTournaments(arr);
  _iptRerender();
}

/** Finish current round of a Phase 2 group, activate next */
function finishIPTPhase2Round(trnId, groupIdx) {
  const arr = getTournaments();
  const trn = arr.find(t => t.id === trnId);
  if (!trn?.ipt?.phase2Groups) return;
  const group = trn.ipt.phase2Groups[groupIdx];
  if (!group) return;

  const rn = group.currentRound;
  group.rounds[rn].status = 'finished';

  if (rn + 1 < group.rounds.length) {
    group.currentRound = rn + 1;
    group.rounds[rn + 1].status = 'active';
    group.rounds[rn + 1].courts.forEach(c => c.status = 'active');
    showToast(`▶ ${group.name} — Раунд ${rn + 2} начат`, 'success');
  } else {
    group.status = 'finished';
    showToast(`🏁 Финал ${group.name} завершён!`, 'success');
  }

  saveTournaments(arr);
  _iptRerender();
}

/** Switch displayed round within a Phase 2 group */
function setIPTPhase2Round(gi, roundNum) {
  const trnId = _iptActiveTrnId
    || (typeof localStorage !== 'undefined' ? localStorage.getItem('kotc3_ipt_active') : null);
  if (!trnId) return;
  const arr = getTournaments();
  const trn = arr.find(t => t.id === trnId);
  if (!trn?.ipt?.phase2Groups?.[gi]) return;
  trn.ipt.phase2Groups[gi].currentRound = roundNum;
  saveTournaments(arr);
  _iptRerender();
}

/**
 * Finalize IPT tournament: compute standings per group → write winners[] → mark finished.
 */
async function finishIPT(trnId) {
  const ok = await showConfirm('Завершить IPT турнир и зафиксировать результаты?');
  if (!ok) return;

  const arr = getTournaments();
  const trn = arr.find(t => t.id === trnId);
  if (!trn?.ipt) return;
  _migrateIPTLegacy(trn);

  const ipt = trn.ipt;
  // Mark all groups finished
  ipt.groups.forEach(g => { g.status = 'finished'; });
  if (ipt.phase2Groups) ipt.phase2Groups.forEach(g => { if (g.status !== 'skip') g.status = 'finished'; });

  // Build combined winners
  trn.winners = [];
  if (ipt.phase2Groups) {
    // Phase 2 exists: winners come from Phase 2 standings (sequential overall places)
    let overallPlace = 1;
    ipt.phase2Groups.forEach(group => {
      if (group.status === 'skip' || !group.players.length) return;
      const standings = calcIPTGroupStandings(group, ipt.pointLimit, ipt.finishType);
      standings.forEach(s => {
        trn.winners.push({
          place:     overallPlace,
          group:     group.name,
          playerIds: [s.playerId],
          points:    calculateRanking(overallPlace),
          iptStats:  { wins: s.wins, diff: s.diff, pts: s.pts, matches: s.matches, wr: s.wr },
        });
        overallPlace++;
      });
    });
  } else {
    // Phase 1 only: winners per group
    ipt.groups.forEach(group => {
      const standings = calcIPTGroupStandings(group, ipt.pointLimit, ipt.finishType);
      standings.forEach((s, i) => {
        trn.winners.push({
          place:     i + 1,
          group:     group.name,
          playerIds: [s.playerId],
          points:    calculateRanking(i + 1),
          iptStats:  { wins: s.wins, diff: s.diff, pts: s.pts, matches: s.matches, wr: s.wr },
        });
      });
    });
  }

  trn.status = 'finished';
  trn.history = trn.history || [];
  trn.history.push({ action: 'finished', ts: Date.now(), by: 'ipt' });

  saveTournaments(arr);
  recalcAllPlayerStats(false);
  switchTab('home');
  showToast('🏆 IPT турнир завершён! Результаты записаны.', 'success');
}

/** Internal: re-render IPT screen if it's currently active */
function _iptRerender() {
  const trnId = typeof _iptActiveTrnId !== 'undefined' ? _iptActiveTrnId : null;
  if (!trnId) return;
  // Phase 1: numeric court tabs
  if (typeof activeTabId === 'number') {
    const s = document.getElementById(`screen-${activeTabId}`);
    if (s) { s.innerHTML = renderIPTGroup(activeTabId); return; }
  }
  // Phase 2: division tabs
  const _p2Map = { hard: 0, advance: 1, medium: 2, lite: 3 };
  if (activeTabId in _p2Map) {
    const s = document.getElementById(`screen-${activeTabId}`);
    if (s) { s.innerHTML = renderIPTPhase2Group(_p2Map[activeTabId]); return; }
  }
  // Legacy fallback
  if (activeTabId === 'ipt') {
    const s = document.getElementById('screen-ipt');
    if (s) s.innerHTML = renderIPT();
  }
}
