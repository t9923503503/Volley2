import { describe, test, expect, beforeAll } from 'vitest';
import { loadVolleyCoreWithBridges } from './_load-volley-scripts.js';

function ensureLoaded() {
  if (!globalThis.__volleyLoaded) loadVolleyCoreWithBridges(process.cwd());
}

describe('iptMatchFinished', () => {
  beforeAll(() => ensureLoaded());

  test('hard: матч завершён при достижении лимита любой командой', () => {
    expect(globalThis.iptMatchFinished({ score1: 21, score2: 0 }, 21, 'hard')).toBe(true);
    expect(globalThis.iptMatchFinished({ score1: 20, score2: 21 }, 21, 'hard')).toBe(true);
    expect(globalThis.iptMatchFinished({ score1: 20, score2: 20 }, 21, 'hard')).toBe(false);
  });

  test('balance: до разницы 2, без потолка', () => {
    // ещё не достигли лимита
    expect(globalThis.iptMatchFinished({ score1: 14, score2: 13 }, 15, 'balance')).toBe(false);
    // достигли лимита, но разница < 2
    expect(globalThis.iptMatchFinished({ score1: 15, score2: 14 }, 15, 'balance')).toBe(false);
    // классическая победа в 2
    expect(globalThis.iptMatchFinished({ score1: 16, score2: 14 }, 15, 'balance')).toBe(true);
    // продолжение после «дьюса» без потолка
    expect(globalThis.iptMatchFinished({ score1: 23, score2: 22 }, 21, 'balance')).toBe(false);
    expect(globalThis.iptMatchFinished({ score1: 24, score2: 22 }, 21, 'balance')).toBe(true);
  });
});

describe('buildIPTMatchHistory', () => {
  beforeAll(() => ensureLoaded());

  test('считает партнёров и оппонентов по courts', () => {
    const rounds = [
      { courts: [{ team1: ['a', 'b'], team2: ['c', 'd'], score1: 0, score2: 0 }] },
      { courts: [{ team1: ['a', 'c'], team2: ['b', 'd'], score1: 0, score2: 0 }] },
    ];
    const h = globalThis.buildIPTMatchHistory(rounds);
    expect(h.partners['a|b']).toBe(1);
    expect(h.partners['c|d']).toBe(1);
    expect(h.partners['a|c']).toBe(1);
    expect(h.partners['b|d']).toBe(1);
    // opponent pairs accumulate
    expect(h.opponents['a|c']).toBeGreaterThanOrEqual(1);
    expect(h.opponents['b|d']).toBeGreaterThanOrEqual(1);
  });
});

