/**
 * IPT tournament — full lifecycle integration tests.
 *
 * Загружает 5 модулей в изолированный VM-контекст (app-state → players →
 * tournaments → stats-recalc → ipt-format) и проверяет весь жизненный цикл:
 * создание → игроки → генерация раундов → очки → финиш → статистика.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const root = process.cwd();
const abs  = (...p) => path.join(root, ...p);

// ── Isolated VM context ────────────────────────────────────────────────────────
function buildContext() {
  const store = {};
  const ls = {
    getItem:    k      => store[k] ?? null,
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: k      => { delete store[k]; },
    clear:      ()     => { Object.keys(store).forEach(k => delete store[k]); },
  };

  const ctx = vm.createContext({
    localStorage: ls,
    Date, Math, JSON, Array, Object, String, Number, Boolean, Set, Map,
    Promise, console,
    setTimeout: (fn) => fn(), // execute immediately in tests
    clearTimeout: () => {},
    // UI stubs
    showToast:      () => {},
    showConfirm:    async () => true,
    playScoreSound: () => {},
    switchTab:      () => {},
    AppLogger:      { warn: () => {}, error: () => {}, info: () => {} },
    // IPT screen stubs (no DOM during tests)
    _iptActiveTrnId: null,
    activeTabId:     null,
    document: { getElementById: () => null },
  });

  const run = relPath => {
    const code = readFileSync(abs(relPath), 'utf8');
    vm.runInContext(code, ctx, { filename: relPath });
  };

  run('assets/js/state/app-state.js');
  run('assets/js/domain/players.js');
  run('assets/js/domain/tournaments.js');
  run('assets/js/ui/stats-recalc.js');
  run('assets/js/ui/ipt-format.js');

  return ctx;
}

// ── Test helpers ───────────────────────────────────────────────────────────────

/** Создаёт N игроков в playerDB и возвращает массив их ID */
function seedPlayers(ctx, n) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const id = `p${i + 1}`;
    ctx.upsertPlayerInDB({ id, name: `Игрок${i + 1}`, gender: 'M' });
    ids.push(id);
  }
  return ids;
}

/** Создаёт IPT-турнир с N игроками и сохраняет в localStorage */
function createIPTTournament(ctx, playerIds, trnId = 't_ipt') {
  const trn = {
    id:           trnId,
    name:         'Test IPT',
    date:         '2026-03-20',
    format:       'IPT Mixed',
    division:     'Мужской',
    level:        'hard',
    capacity:     playerIds.length,
    prize:        '',
    status:       'active',
    participants: [...playerIds],
    waitlist:     [],
    winners:      [],
    ipt: {
      pointLimit:   21,
      finishType:   'hard',
      currentGroup: 0,
      groups:       ctx.generateIPTGroups(playerIds),
    },
  };
  const arr = ctx.getTournaments();
  arr.push(trn);
  ctx.saveTournaments(arr);
  return trn;
}

/** Устанавливает все матчи раунда в статус finished с заданным счётом */
function completeRound(ctx, trnId, groupIdx, roundIdx, score1 = 21, score2 = 10) {
  const arr = ctx.getTournaments();
  const trn = arr.find(t => t.id === trnId);
  const round = trn.ipt.groups[groupIdx].rounds[roundIdx];
  round.courts.forEach(c => {
    c.score1 = score1;
    c.score2 = score2;
    c.status = 'finished';
  });
  ctx.saveTournaments(arr);
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. ГЕНЕРАЦИЯ ГРУПП
// ══════════════════════════════════════════════════════════════════════════════

describe('generateIPTGroups — формирование групп', () => {
  let ctx;
  beforeEach(() => { ctx = buildContext(); });

  test('8 игроков → 1 группа "IPT", 4 раунда, 2 корта на раунд', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `p${i}`);
    const groups = ctx.generateIPTGroups(ids);

    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('IPT');
    expect(groups[0].players).toHaveLength(8);
    expect(groups[0].rounds).toHaveLength(4);
    groups[0].rounds.forEach(r => expect(r.courts).toHaveLength(2));
  });

  test('8 игроков → каждый игрок участвует ровно в 4 матчах', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `p${i}`);
    const group = ctx.generateIPTGroups(ids)[0];

    const matchCount = {};
    ids.forEach(id => { matchCount[id] = 0; });
    group.rounds.forEach(r =>
      r.courts.forEach(c => {
        [...c.team1, ...c.team2].forEach(id => { matchCount[id]++; });
      })
    );
    ids.forEach(id => expect(matchCount[id]).toBe(4));
  });

  test('16 игроков → 2 группы (ХАРД / ЛАЙТ), по 8 игроков каждая', () => {
    const ids = Array.from({ length: 16 }, (_, i) => `p${i}`);
    const groups = ctx.generateIPTGroups(ids);

    expect(groups).toHaveLength(2);
    expect(groups[0].name).toBe('ХАРД');
    expect(groups[1].name).toBe('ЛАЙТ');
    groups.forEach(g => expect(g.players).toHaveLength(8));
  });

  test('10 игроков → 1 группа с dynamic rounds (> 4 раундов)', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const groups = ctx.generateIPTGroups(ids);

    expect(groups).toHaveLength(1);
    expect(groups[0].players).toHaveLength(10);
    // Dynamic: numRounds = ceil(4 * 10 / (floor(10/4)*4)) = ceil(40/8) = 5
    expect(groups[0].rounds.length).toBeGreaterThanOrEqual(4);
  });

  test('первый раунд active, остальные waiting', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `p${i}`);
    const group = ctx.generateIPTGroups(ids)[0];

    expect(group.rounds[0].status).toBe('active');
    group.rounds.slice(1).forEach(r => expect(r.status).toBe('waiting'));
  });

  test('нет повторяющихся пар напарников (IPT_SCHEDULE гарантирует)', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `p${i}`);
    const group = ctx.generateIPTGroups(ids)[0];
    const pairCount = {};
    group.rounds.forEach(r =>
      r.courts.forEach(c => {
        const teams = [c.team1, c.team2];
        teams.forEach(t => {
          const key = [t[0], t[1]].sort().join('|');
          pairCount[key] = (pairCount[key] || 0) + 1;
        });
      })
    );
    // Каждая пара не должна встречаться более 1 раза
    Object.values(pairCount).forEach(v => expect(v).toBe(1));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. ЗАПИСЬ ОЧКОВ
// ══════════════════════════════════════════════════════════════════════════════

describe('iptApplyScore — изменение счёта', () => {
  let ctx;
  beforeEach(() => { ctx = buildContext(); });

  test('увеличивает счёт team1 на +1', () => {
    const ids = seedPlayers(ctx, 8);
    createIPTTournament(ctx, ids);

    ctx.iptApplyScore('t_ipt', 0, 0, 0, 1, +1);
    const trn = ctx.getTournaments().find(t => t.id === 't_ipt');
    expect(trn.ipt.groups[0].rounds[0].courts[0].score1).toBe(1);
  });

  test('уменьшает счёт до 0, не уходит в минус', () => {
    const ids = seedPlayers(ctx, 8);
    createIPTTournament(ctx, ids);

    ctx.iptApplyScore('t_ipt', 0, 0, 0, 1, -1); // уже 0 → остаётся 0
    const trn = ctx.getTournaments().find(t => t.id === 't_ipt');
    expect(trn.ipt.groups[0].rounds[0].courts[0].score1).toBe(0);
  });

  test('матч переходит в finished при достижении лимита (hard 21)', () => {
    const ids = seedPlayers(ctx, 8);
    createIPTTournament(ctx, ids);

    // Установим счёт вручную до 20:0
    const arr = ctx.getTournaments();
    arr.find(t => t.id === 't_ipt').ipt.groups[0].rounds[0].courts[0].score1 = 20;
    ctx.saveTournaments(arr);

    // +1 → 21:0 → матч завершён
    ctx.iptApplyScore('t_ipt', 0, 0, 0, 1, +1);
    const trn = ctx.getTournaments().find(t => t.id === 't_ipt');
    expect(trn.ipt.groups[0].rounds[0].courts[0].status).toBe('finished');
  });

  test('нельзя изменить счёт завершённого матча', () => {
    const ids = seedPlayers(ctx, 8);
    createIPTTournament(ctx, ids);

    // Закрываем матч вручную
    const arr = ctx.getTournaments();
    arr.find(t => t.id === 't_ipt').ipt.groups[0].rounds[0].courts[0].status = 'finished';
    ctx.saveTournaments(arr);

    ctx.iptApplyScore('t_ipt', 0, 0, 0, 1, +1);
    const trn = ctx.getTournaments().find(t => t.id === 't_ipt');
    // Счёт не изменился
    expect(trn.ipt.groups[0].rounds[0].courts[0].score1).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. ПЕРЕХОД РАУНДОВ
// ══════════════════════════════════════════════════════════════════════════════

describe('finishIPTRound — переход между раундами', () => {
  let ctx;
  beforeEach(() => { ctx = buildContext(); });

  test('переводит текущий раунд в finished и активирует следующий', () => {
    const ids = seedPlayers(ctx, 8);
    createIPTTournament(ctx, ids);
    completeRound(ctx, 't_ipt', 0, 0);

    ctx.finishIPTRound('t_ipt', 0);

    const trn = ctx.getTournaments().find(t => t.id === 't_ipt');
    const group = trn.ipt.groups[0];
    expect(group.rounds[0].status).toBe('finished');
    expect(group.rounds[1].status).toBe('active');
    expect(group.currentRound).toBe(1);
  });

  test('после финиша последнего раунда группа помечается finished', () => {
    const ids = seedPlayers(ctx, 8);
    createIPTTournament(ctx, ids);

    // Завершаем все 4 раунда последовательно
    for (let r = 0; r < 4; r++) {
      completeRound(ctx, 't_ipt', 0, r);
      ctx.finishIPTRound('t_ipt', 0);
    }

    const trn = ctx.getTournaments().find(t => t.id === 't_ipt');
    expect(trn.ipt.groups[0].status).toBe('finished');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. ПОДСЧЁТ ОЧКОВ В ТАБЛИЦЕ
// ══════════════════════════════════════════════════════════════════════════════

describe('calcIPTGroupStandings — таблица результатов', () => {
  let ctx;
  beforeEach(() => { ctx = buildContext(); });

  test('сортировка: больше побед → выше место', () => {
    // Группа с одним раундом, 2 корта
    const group = {
      rounds: [{
        courts: [
          // p1+p2 vs p3+p4 → p1+p2 выигрывают 21:5
          { team1: ['p1', 'p2'], team2: ['p3', 'p4'], score1: 21, score2: 5, status: 'finished' },
          // p5+p6 vs p7+p8 → p5+p6 выигрывают 21:0
          { team1: ['p5', 'p6'], team2: ['p7', 'p8'], score1: 21, score2: 0, status: 'finished' },
        ],
      }],
    };

    const standings = ctx.calcIPTGroupStandings(group, 21, 'hard');
    // p1-p6 имеют 1 победу, p3-p8 имеют 0
    expect(standings[0].wins).toBe(1);
    expect(standings[standings.length - 1].wins).toBe(0);
  });

  test('ничья по победам → сортировка по разнице очков (diff)', () => {
    const group = {
      rounds: [{
        courts: [
          // p1+p2 выигрывают 21:5 (diff +16)
          { team1: ['p1', 'p2'], team2: ['p3', 'p4'], score1: 21, score2: 5,  status: 'finished' },
          // p3+p4 выигрывают 21:15 (diff +6)
          { team1: ['p3', 'p4'], team2: ['p5', 'p6'], score1: 21, score2: 15, status: 'finished' },
        ],
      }],
    };

    const standings = ctx.calcIPTGroupStandings(group, 21, 'hard');
    // p1,p2 имеют diff +16 → первые, p3,p4 имеют wins=1 и diff: +6-16=-10
    const p1 = standings.find(s => s.playerId === 'p1');
    const p3 = standings.find(s => s.playerId === 'p3');
    const idx1 = standings.indexOf(p1);
    const idx3 = standings.indexOf(p3);
    expect(idx1).toBeLessThan(idx3); // p1 выше p3
  });

  test('нулевые матчи не считаются', () => {
    const group = {
      rounds: [{
        courts: [
          { team1: ['p1', 'p2'], team2: ['p3', 'p4'], score1: 0, score2: 0, status: 'active' },
        ],
      }],
    };

    const standings = ctx.calcIPTGroupStandings(group, 21, 'hard');
    standings.forEach(s => {
      expect(s.wins).toBe(0);
      expect(s.pts).toBe(0);
    });
  });

  test('calcIPTStandings — legacy wrapper работает с trn объектом', () => {
    const ids = seedPlayers(ctx, 8);
    const trn = createIPTTournament(ctx, ids);
    completeRound(ctx, 't_ipt', 0, 0, 21, 5);

    const freshTrn = ctx.getTournaments().find(t => t.id === 't_ipt');
    const standings = ctx.calcIPTStandings(freshTrn);
    expect(standings).toBeInstanceOf(Array);
    // Только игроки раунда 0 корта 0 и 1 имеют данные
    expect(standings.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. ПОЛНЫЙ ЖИЗНЕННЫЙ ЦИКЛ IPT ТУРНИРА
// ══════════════════════════════════════════════════════════════════════════════

describe('IPT — полный жизненный цикл (создание → финиш)', () => {
  let ctx;
  beforeEach(() => { ctx = buildContext(); });

  test('finishIPT: все 8 игроков записаны в winners с очками рейтинга', async () => {
    const ids = seedPlayers(ctx, 8);
    createIPTTournament(ctx, ids);

    // Проводим все 4 раунда: team1 всегда побеждает 21:10
    for (let r = 0; r < 4; r++) {
      completeRound(ctx, 't_ipt', 0, r, 21, 10);
      ctx.finishIPTRound('t_ipt', 0);
    }

    await ctx.finishIPT('t_ipt');

    const trn = ctx.getTournaments().find(t => t.id === 't_ipt');
    expect(trn.status).toBe('finished');
    // Все 8 игроков в winners
    expect(trn.winners).toHaveLength(8);
    // Каждый winner имеет place, playerIds, points
    trn.winners.forEach(w => {
      expect(w.place).toBeGreaterThanOrEqual(1);
      expect(w.playerIds).toHaveLength(1);
      expect(w.points).toBeGreaterThan(0);
      expect(typeof w.iptStats).toBe('object');
    });
    // Первое место получает 100 рейтинговых очков
    expect(trn.winners[0].place).toBe(1);
    expect(trn.winners[0].points).toBe(100);
  });

  test('finishIPT: group добавлен к winners с правильным именем', async () => {
    const ids = seedPlayers(ctx, 8);
    createIPTTournament(ctx, ids);

    for (let r = 0; r < 4; r++) {
      completeRound(ctx, 't_ipt', 0, r);
      ctx.finishIPTRound('t_ipt', 0);
    }
    await ctx.finishIPT('t_ipt');

    const trn = ctx.getTournaments().find(t => t.id === 't_ipt');
    // Группа 1 игрок = 'IPT' (8 игроков = 1 группа)
    expect(trn.winners[0].group).toBe('IPT');
  });

  test('finishIPT: отмена подтверждения не завершает турнир', async () => {
    const ids = seedPlayers(ctx, 8);
    createIPTTournament(ctx, ids);

    // Переопределяем showConfirm → отмена
    ctx.showConfirm = async () => false;

    await ctx.finishIPT('t_ipt');

    const trn = ctx.getTournaments().find(t => t.id === 't_ipt');
    expect(trn.status).toBe('active'); // не изменился
  });

  test('finishIPT: 16 игроков → 2 группы, 16 записей в winners', async () => {
    const ids = seedPlayers(ctx, 16);
    createIPTTournament(ctx, ids);

    // Завершаем обе группы
    const trn = ctx.getTournaments().find(t => t.id === 't_ipt');
    const numGroups = trn.ipt.groups.length;
    const numRounds = trn.ipt.groups[0].rounds.length;

    for (let gi = 0; gi < numGroups; gi++) {
      for (let r = 0; r < numRounds; r++) {
        completeRound(ctx, 't_ipt', gi, r);
        ctx.finishIPTRound('t_ipt', gi);
      }
    }

    await ctx.finishIPT('t_ipt');
    const finished = ctx.getTournaments().find(t => t.id === 't_ipt');
    expect(finished.status).toBe('finished');
    expect(finished.winners).toHaveLength(16);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. ПЕРЕСЧЁТ СТАТИСТИКИ ИГРОКОВ
// ══════════════════════════════════════════════════════════════════════════════

describe('recalcAllPlayerStats — IPT wallet после турнира', () => {
  let ctx;
  beforeEach(() => { ctx = buildContext(); });

  test('iptWins, iptDiff, iptPts, iptMatches заполнены для каждого игрока', async () => {
    const ids = seedPlayers(ctx, 8);
    createIPTTournament(ctx, ids);

    // Завершаем все раунды: team1 всегда побеждает 21:10
    for (let r = 0; r < 4; r++) {
      completeRound(ctx, 't_ipt', 0, r, 21, 10);
      ctx.finishIPTRound('t_ipt', 0);
    }
    await ctx.finishIPT('t_ipt');

    const db = ctx.loadPlayerDB();

    // Каждый игрок должен иметь iptMatches > 0
    db.forEach(p => {
      expect(p.iptMatches).toBeGreaterThan(0);
      expect(p.iptPts).toBeGreaterThan(0);
    });

    // Игрок с наибольшим числом побед имеет положительный diff
    const best = db.reduce((top, p) => p.iptWins > top.iptWins ? p : top, db[0]);
    expect(best.iptDiff).toBeGreaterThan(0);

    // В турнире где кто-то побеждает — кто-то проигрывает → хотя бы один игрок имеет отрицательный diff
    expect(db.some(p => p.iptDiff < 0)).toBe(true);
  });

  test('tournaments и totalPts обновлены для всех участников', async () => {
    const ids = seedPlayers(ctx, 8);
    createIPTTournament(ctx, ids);

    for (let r = 0; r < 4; r++) {
      completeRound(ctx, 't_ipt', 0, r);
      ctx.finishIPTRound('t_ipt', 0);
    }
    await ctx.finishIPT('t_ipt');

    const db = ctx.loadPlayerDB();
    db.forEach(p => {
      expect(p.tournaments).toBe(1);
      expect(p.totalPts).toBeGreaterThan(0);
    });
  });

  test('пересчёт идемпотентен — двойной вызов не удваивает очки', async () => {
    const ids = seedPlayers(ctx, 8);
    createIPTTournament(ctx, ids);

    for (let r = 0; r < 4; r++) {
      completeRound(ctx, 't_ipt', 0, r);
      ctx.finishIPTRound('t_ipt', 0);
    }
    await ctx.finishIPT('t_ipt');

    // Запоминаем после первого finishIPT (он уже вызвал recalcAllPlayerStats)
    const db1 = ctx.loadPlayerDB().map(p => ({ ...p }));

    // Вызываем пересчёт повторно
    ctx.recalcAllPlayerStats(true);
    const db2 = ctx.loadPlayerDB();

    db1.forEach(p1 => {
      const p2 = db2.find(p => p.id === p1.id);
      expect(p2.iptWins).toBe(p1.iptWins);
      expect(p2.totalPts).toBe(p1.totalPts);
      expect(p2.tournaments).toBe(p1.tournaments);
    });
  });
});
