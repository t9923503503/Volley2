import { describe, test, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadVolleyCoreWithBridges } from './_load-volley-scripts.js';

function ensureLoaded() {
  if (!globalThis.__coreBridge) loadVolleyCoreWithBridges(process.cwd());
}

describe('recalcAllPlayerStats', () => {
  beforeAll(() => {
    ensureLoaded();
  });

  beforeEach(() => {
    localStorage.clear();
  });

  test('сбрасывает счётчики перед пересчётом', () => {
    const db = [
      { id: 'p1', name: 'A', gender: 'M', tournaments: 9, totalPts: 999, wins: 9, ratingM: 9, ratingW: 9, ratingMix: 9, tournamentsM: 9, tournamentsW: 9, tournamentsMix: 9, lastSeen: '2020-01-01', iptWins: 9, iptDiff: 9, iptPts: 9, iptMatches: 9 },
      { id: 'p2', name: 'B', gender: 'W', tournaments: 1, totalPts: 10, wins: 1, ratingM: 1, ratingW: 1, ratingMix: 1, tournamentsM: 1, tournamentsW: 1, tournamentsMix: 1, iptWins: 1, iptDiff: 1, iptPts: 1, iptMatches: 1 },
    ];

    globalThis.loadPlayerDB = vi.fn(() => db);
    globalThis.getTournaments = vi.fn(() => []);
    globalThis.savePlayerDB = vi.fn();
    globalThis.showToast = vi.fn();

    globalThis.recalcAllPlayerStats(true);

    const saved = globalThis.savePlayerDB.mock.calls[0][0];
    expect(saved[0]).toMatchObject({
      tournaments: 0,
      totalPts: 0,
      wins: 0,
      ratingM: 0,
      ratingW: 0,
      ratingMix: 0,
      tournamentsM: 0,
      tournamentsW: 0,
      tournamentsMix: 0,
      iptWins: 0,
      iptDiff: 0,
      iptPts: 0,
      iptMatches: 0,
    });
    expect(saved[1]).toMatchObject({
      tournaments: 0,
      totalPts: 0,
      wins: 0,
      ratingM: 0,
      ratingW: 0,
      ratingMix: 0,
      tournamentsM: 0,
      tournamentsW: 0,
      tournamentsMix: 0,
      iptWins: 0,
      iptDiff: 0,
      iptPts: 0,
      iptMatches: 0,
    });
  });

  test('корректно суммирует очки за 2 турнира', () => {
    const db = [
      { id: 'p1', name: 'A', gender: 'M' },
      { id: 'p2', name: 'B', gender: 'M' },
      { id: 'p3', name: 'C', gender: 'W' },
    ];
    const tournaments = [
      {
        id: 't1',
        status: 'finished',
        division: 'Мужской',
        date: '2026-03-01',
        winners: [
          { place: 1, playerIds: ['p1'], points: 100 },
          { place: 2, playerIds: ['p2'], points: 80 },
          { place: 3, playerIds: ['p3'], points: 60 },
        ],
      },
      {
        id: 't2',
        status: 'finished',
        division: 'Женский',
        date: '2026-03-10',
        winners: [
          { place: 1, playerIds: ['p3'], points: 120 },
          { place: 2, playerIds: ['p1'], points: 70 },
          { place: 3, playerIds: ['p2'], points: 50 },
        ],
      },
    ];

    globalThis.loadPlayerDB = vi.fn(() => db);
    globalThis.getTournaments = vi.fn(() => tournaments);
    globalThis.savePlayerDB = vi.fn();
    globalThis.showToast = vi.fn();

    globalThis.recalcAllPlayerStats(true);
    const saved = globalThis.savePlayerDB.mock.calls[0][0];

    const p1 = saved.find((p) => p.id === 'p1');
    const p2 = saved.find((p) => p.id === 'p2');
    const p3 = saved.find((p) => p.id === 'p3');

    expect(p1.tournaments).toBe(2);
    expect(p1.totalPts).toBe(170);
    expect(p1.wins).toBe(1);
    expect(p1.ratingM).toBe(globalThis.calculateRanking(1)); // t1 мужской
    expect(p1.ratingW).toBe(globalThis.calculateRanking(2)); // t2 женский

    expect(p2.tournaments).toBe(2);
    expect(p2.totalPts).toBe(130);
    expect(p2.wins).toBe(0);
    expect(p2.ratingM).toBe(globalThis.calculateRanking(2));
    expect(p2.ratingW).toBe(globalThis.calculateRanking(3));

    expect(p3.tournaments).toBe(2);
    expect(p3.totalPts).toBe(180);
    expect(p3.wins).toBe(1);
    // p3 попал в мужской турнир как участник, но рейтинг идёт по типу турнира
    expect(p3.ratingM).toBe(globalThis.calculateRanking(3));
    expect(p3.ratingW).toBe(globalThis.calculateRanking(1));
    expect(p3.lastSeen).toBe('2026-03-10');
  });

  test('IPT Mixed: пересчитывает iptWins/iptDiff/iptPts/iptMatches по rounds', () => {
    const db = [
      { id: 'p1', name: 'A', gender: 'M' },
      { id: 'p2', name: 'B', gender: 'M' },
      { id: 'p3', name: 'C', gender: 'M' },
      { id: 'p4', name: 'D', gender: 'M' },
    ];
    const tournaments = [
      {
        id: 'tipt',
        format: 'IPT Mixed',
        status: 'finished',
        division: 'Микст',
        date: '2026-03-11',
        ratingType: 'Mix',
        winners: [],
        ipt: {
          pointLimit: 21,
          finishType: 'hard',
          rounds: [
            {
              num: 0,
              courts: [
                { team1: ['p1', 'p2'], team2: ['p3', 'p4'], score1: 21, score2: 18, status: 'finished' },
              ],
            },
          ],
        },
      },
    ];

    globalThis.loadPlayerDB = vi.fn(() => db);
    globalThis.getTournaments = vi.fn(() => tournaments);
    globalThis.savePlayerDB = vi.fn();
    globalThis.showToast = vi.fn();

    globalThis.recalcAllPlayerStats(true);
    const saved = globalThis.savePlayerDB.mock.calls[0][0];
    const p1 = saved.find((p) => p.id === 'p1');
    const p3 = saved.find((p) => p.id === 'p3');

    expect(p1.iptWins).toBe(1);
    expect(p1.iptMatches).toBe(1);
    expect(p1.iptPts).toBe(21);
    expect(p1.iptDiff).toBe(3);

    expect(p3.iptWins).toBe(0);
    expect(p3.iptMatches).toBe(1);
    expect(p3.iptPts).toBe(18);
    expect(p3.iptDiff).toBe(-3);
  });

  test('не дублирует очки при повторном вызове', () => {
    const db = [{ id: 'p1', name: 'A', gender: 'M' }];
    const tournaments = [
      { id: 't1', status: 'finished', division: 'Мужской', date: '2026-03-01', winners: [{ place: 1, playerIds: ['p1'], points: 100 }] },
    ];
    globalThis.loadPlayerDB = vi.fn(() => db);
    globalThis.getTournaments = vi.fn(() => tournaments);
    globalThis.savePlayerDB = vi.fn();
    globalThis.showToast = vi.fn();

    globalThis.recalcAllPlayerStats(true);
    const first = globalThis.savePlayerDB.mock.calls[0][0].find((p) => p.id === 'p1');

    globalThis.recalcAllPlayerStats(true);
    const second = globalThis.savePlayerDB.mock.calls[1][0].find((p) => p.id === 'p1');

    expect(second.totalPts).toBe(first.totalPts);
    expect(second.tournaments).toBe(first.tournaments);
    expect(second.ratingM).toBe(first.ratingM);
  });

  test('обрабатывает пустой массив tournaments без ошибок', () => {
    const db = [{ id: 'p1', name: 'A', gender: 'M' }];
    globalThis.loadPlayerDB = vi.fn(() => db);
    globalThis.getTournaments = vi.fn(() => []);
    globalThis.savePlayerDB = vi.fn();
    globalThis.showToast = vi.fn();

    expect(() => globalThis.recalcAllPlayerStats(true)).not.toThrow();
    expect(globalThis.savePlayerDB).toHaveBeenCalledTimes(1);
  });

  test('корректно обрабатывает kotc3_history (старый формат)', () => {
    const db = [
      { id: 'p1', name: 'Иванов', gender: 'M' },
      { id: 'p2', name: 'Петрова', gender: 'W' },
    ];
    globalThis.loadPlayerDB = vi.fn(() => db);
    globalThis.getTournaments = vi.fn(() => []);
    globalThis.savePlayerDB = vi.fn();
    globalThis.showToast = vi.fn();

    localStorage.setItem(
      'kotc3_history',
      JSON.stringify([
        {
          date: '2026-03-01',
          players: [
            { name: 'Иванов', gender: 'M', totalPts: 10 },
            { name: 'Петрова', gender: 'W', totalPts: 8 },
          ],
        },
      ])
    );

    globalThis.recalcAllPlayerStats(true);
    const saved = globalThis.savePlayerDB.mock.calls[0][0];
    const p1 = saved.find((p) => p.id === 'p1');
    const p2 = saved.find((p) => p.id === 'p2');

    expect(p1.tournaments).toBe(1);
    expect(p1.totalPts).toBe(10);
    expect(p1.wins).toBe(1);
    expect(p1.lastSeen).toBe('2026-03-01');

    expect(p2.tournaments).toBe(1);
    expect(p2.totalPts).toBe(8);
    expect(p2.wins).toBe(0);
    expect(p2.lastSeen).toBe('2026-03-01');
  });

  test('silent=true — не вызывает showToast', () => {
    globalThis.loadPlayerDB = vi.fn(() => []);
    globalThis.getTournaments = vi.fn(() => []);
    globalThis.savePlayerDB = vi.fn();
    globalThis.showToast = vi.fn();

    globalThis.recalcAllPlayerStats(true);
    expect(globalThis.showToast).not.toHaveBeenCalled();
  });
});

