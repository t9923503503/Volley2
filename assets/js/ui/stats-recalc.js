'use strict'; // ── Stats recalculation ──

// ── O(1) player lookup cache ──────────────────────────────────
function _buildPlayerMap() {
  const map = new Map();
  loadPlayerDB().forEach(p => map.set(p.id, p));
  return map;
}

/**
 * Recalculate ALL player stats from scratch by replaying every finished
 * tournament. Handles both kotc3_tournaments (new system) and kotc3_history
 * (old King of Court system). Call after bulk imports, data repairs, or edits.
 * @param {boolean} silent — skip the success toast (used after saveResults)
 */
function recalcAllPlayerStats(silent = false) {
  const db          = loadPlayerDB();
  const tournaments = getTournaments();
  let history = [];
  try { history = JSON.parse(localStorage.getItem('kotc3_history') || '[]'); } catch(e) {}

  // Reset counters — keep identity fields intact
  db.forEach(p => {
    p.tournaments = 0; p.totalPts = 0; p.wins = 0;
    p.ratingM = 0; p.ratingW = 0; p.ratingMix = 0;
    p.tournamentsM = 0; p.tournamentsW = 0; p.tournamentsMix = 0;
    // IPT wallet
    p.iptWins = 0; p.iptDiff = 0; p.iptPts = 0; p.iptMatches = 0;
  });

  // ── New system: kotc3_tournaments ────────────────────────
  tournaments
    .filter(t => t.status === 'finished' && Array.isArray(t.winners))
    .forEach(t => {
      const tType = t.ratingType || divisionToType(t.division);

      // IPT Mixed: accumulate wallet stats from raw rounds (single source of truth)
      if (t.format === 'IPT Mixed' && t.ipt) {
        const ipt = t.ipt;
        const local = {};
        const ensure = id => {
          if (!local[id]) local[id] = { wins: 0, diff: 0, pts: 0, matches: 0 };
        };
        // Support both new groups[] structure and legacy rounds[]
        const allRounds = ipt.groups
          ? ipt.groups.flatMap(g => g.rounds || [])
          : (ipt.rounds || []);
        allRounds.forEach(r => {
          (r.courts || []).forEach(c => {
            const team1 = c.team1 || [], team2 = c.team2 || [];
            const s1 = Number(c.score1) || 0, s2 = Number(c.score2) || 0;
            team1.forEach(ensure); team2.forEach(ensure);
            if (s1 === 0 && s2 === 0) return;
            const done = iptMatchFinished(c, ipt.pointLimit || 21, ipt.finishType || 'hard');
            team1.forEach(id => {
              local[id].pts += s1;
              local[id].diff += (s1 - s2);
              if (done) { local[id].matches += 1; if (s1 > s2) local[id].wins += 1; }
            });
            team2.forEach(id => {
              local[id].pts += s2;
              local[id].diff += (s2 - s1);
              if (done) { local[id].matches += 1; if (s2 > s1) local[id].wins += 1; }
            });
          });
        });
        Object.entries(local).forEach(([id, s]) => {
          const p = db.find(p => p.id === id);
          if (!p) return;
          p.iptWins    = (p.iptWins    || 0) + (s.wins    || 0);
          p.iptDiff    = (p.iptDiff    || 0) + (s.diff    || 0);
          p.iptPts     = (p.iptPts     || 0) + (s.pts     || 0);
          p.iptMatches = (p.iptMatches || 0) + (s.matches || 0);
        });
      }

      t.winners.forEach(slot => {
        if (typeof slot !== 'object' || !Array.isArray(slot.playerIds)) return;
        const ratingPts = calculateRanking(slot.place);
        slot.playerIds.forEach(id => {
          const p = db.find(p => p.id === id);
          if (!p) return;
          p.tournaments = (p.tournaments || 0) + 1;
          p.totalPts    = (p.totalPts    || 0) + (Number(slot.points) || 0);
          p.wins        = (p.wins        || 0) + (slot.place === 1 ? 1 : 0);
          if (tType === 'M')      { p.ratingM   = (p.ratingM   ||0)+ratingPts; p.tournamentsM++; }
          else if (tType === 'W') { p.ratingW   = (p.ratingW   ||0)+ratingPts; p.tournamentsW++; }
          else                    { p.ratingMix = (p.ratingMix ||0)+ratingPts; p.tournamentsMix++; }
          if (t.date > (p.lastSeen || '')) p.lastSeen = t.date;
        });
      });
    });

  // ── Old system: kotc3_history — place by sorted position ─
  // King of Court events mix M and W — credit each player in their own gender column
  history.forEach(snap => {
    if (!Array.isArray(snap.players) || !snap.players.length) return;
    const genders = new Set(snap.players.map(p => p.gender).filter(Boolean));
    const isMixed = genders.size > 1;
    snap.players.forEach((sp, idx) => {
      const p = db.find(d =>
        d.name.toLowerCase() === (sp.name||'').toLowerCase() && d.gender === sp.gender
      );
      if (!p) return;
      const ratingPts = calculateRanking(idx + 1); // sorted desc → idx 0 = 1st place
      p.tournaments = (p.tournaments || 0) + 1;
      p.totalPts    = (p.totalPts    || 0) + (sp.totalPts || 0);
      p.wins        = (p.wins        || 0) + (idx === 0 ? 1 : 0);
      // Mixed KotC: credit in player's own gender column so М/Ж tabs show data
      const tType = isMixed ? sp.gender : (genders.has('W') ? 'W' : 'M');
      if (tType === 'M')      { p.ratingM   = (p.ratingM   ||0)+ratingPts; p.tournamentsM++; }
      else if (tType === 'W') { p.ratingW   = (p.ratingW   ||0)+ratingPts; p.tournamentsW++; }
      else                    { p.ratingMix = (p.ratingMix ||0)+ratingPts; p.tournamentsMix++; }
      if (snap.date > (p.lastSeen || '')) p.lastSeen = snap.date;
    });
  });

  savePlayerDB(db);
  if (!silent) showToast('Статистика пересчитана', 'success');
}
