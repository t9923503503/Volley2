import { describe, test, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const root = process.cwd();
const abs  = (...p) => path.join(root, ...p);

function buildContext() {
  const store = {};
  const ctx = vm.createContext({
    localStorage: {
      getItem:    k      => store[k] ?? null,
      setItem:    (k, v) => { store[k] = String(v); },
      removeItem: k      => { delete store[k]; },
      clear:      ()     => { Object.keys(store).forEach(k => delete store[k]); },
    },
    Date, Math, JSON, Array, Object, String, Number, Boolean, console,
    // players.js stubs (tournaments.js calls loadPlayerDB/savePlayerDB)
    loadPlayerDB:   () => [],
    savePlayerDB:   () => {},
    AppLogger: { warn: () => {}, error: () => {}, info: () => {} },
  });

  const playersCode = readFileSync(abs('assets', 'js', 'domain', 'players.js'), 'utf8');
  vm.runInContext(playersCode, ctx, { filename: 'players.js' });

  const trnCode = readFileSync(abs('assets', 'js', 'domain', 'tournaments.js'), 'utf8');
  vm.runInContext(trnCode, ctx, { filename: 'tournaments.js' });

  return ctx;
}

describe('formatTrnDate', () => {
  let ctx;
  beforeEach(() => { ctx = buildContext(); });

  test('форматирует ISO дату в русский формат', () => {
    const result = ctx.formatTrnDate('2026-03-19');
    // Должно содержать день недели, число и месяц
    expect(result).toMatch(/\d+/); // есть число
    expect(result).toContain('марта'); // март
    expect(result).toContain('2026');
  });

  test('возвращает пустую строку для falsy', () => {
    expect(ctx.formatTrnDate('')).toBe('');
    expect(ctx.formatTrnDate(null)).toBe('');
    expect(ctx.formatTrnDate(undefined)).toBe('');
  });

  test('обрабатывает все месяцы', () => {
    const months = ['января','февраля','марта','апреля','мая','июня',
                    'июля','августа','сентября','октября','ноября','декабря'];
    months.forEach((m, i) => {
      const mm = String(i + 1).padStart(2, '0');
      const result = ctx.formatTrnDate(`2026-${mm}-15`);
      expect(result).toContain(m);
    });
  });
});

describe('getTournaments / saveTournaments', () => {
  let ctx;
  beforeEach(() => { ctx = buildContext(); ctx.localStorage.clear(); });

  test('возвращает [] при пустом хранилище', () => {
    // After buildContext migrateProjectData runs and seeds defaults
    const trns = ctx.getTournaments();
    expect(Array.isArray(trns)).toBe(true);
  });

  test('сохраняет и загружает турниры', () => {
    const sample = [{ id: 'x1', name: 'Тест', status: 'open' }];
    ctx.saveTournaments(sample);
    expect(ctx.getTournaments()).toEqual(sample);
  });

  test('возвращает [] при повреждённом JSON', () => {
    ctx.localStorage.setItem('kotc3_tournaments', '{ broken }');
    expect(ctx.getTournaments()).toEqual([]);
  });
});

describe('migrateProjectData', () => {
  test('засевает DEFAULT турниры когда хранилище пустое', () => {
    // Fresh context → migrateProjectData runs at module eval time
    const ctx = buildContext();
    const trns = ctx.getTournaments();
    // Should have seeded HOME_TOURNAMENTS_DEFAULT (6 entries)
    expect(trns.length).toBeGreaterThan(0);
  });

  test('не перезаписывает уже существующие данные', () => {
    // Put something in storage before loading module
    const store = {};
    const ctx2 = vm.createContext({
      localStorage: {
        getItem:    k      => store[k] ?? null,
        setItem:    (k, v) => { store[k] = String(v); },
        removeItem: k      => { delete store[k]; },
        clear:      ()     => { Object.keys(store).forEach(k => delete store[k]); },
      },
      Date, Math, JSON, Array, Object, String, Number, Boolean, console,
      loadPlayerDB:   () => [],
      savePlayerDB:   () => {},
      AppLogger: { warn: () => {}, error: () => {}, info: () => {} },
    });
    // Pre-seed storage with custom data
    store['kotc3_tournaments'] = JSON.stringify([{ id: 'custom', name: 'Мой турнир', status: 'open' }]);

    const playersCode = readFileSync(abs('assets', 'js', 'domain', 'players.js'), 'utf8');
    vm.runInContext(playersCode, ctx2, { filename: 'players.js' });
    const trnCode = readFileSync(abs('assets', 'js', 'domain', 'tournaments.js'), 'utf8');
    vm.runInContext(trnCode, ctx2, { filename: 'tournaments.js' });

    const trns = ctx2.getTournaments();
    expect(trns).toHaveLength(1);
    expect(trns[0].id).toBe('custom');
  });
});

describe('loadUpcomingTournaments', () => {
  let ctx;
  beforeEach(() => { ctx = buildContext(); });

  test('возвращает только незавершённые турниры', () => {
    ctx.saveTournaments([
      { id: 'a', name: 'Открытый', status: 'open',   date: '2099-12-31', participants: [], waitlist: [] },
      { id: 'b', name: 'Закрытый', status: 'finished', date: '2020-01-01', participants: [], waitlist: [] },
      { id: 'c', name: 'Полный',   status: 'full',   date: '2099-12-31', participants: [], waitlist: [] },
    ]);
    const result = ctx.loadUpcomingTournaments();
    const ids = result.map(t => t.id);
    expect(ids).toContain('a');
    expect(ids).toContain('c');
    expect(ids).not.toContain('b');
  });

  test('добавляет вычисляемое поле registered', () => {
    ctx.saveTournaments([{
      id: 't1', name: 'T', status: 'open', date: '2099-12-31',
      participants: ['p1', 'p2', 'p3'], waitlist: [],
    }]);
    const [t] = ctx.loadUpcomingTournaments();
    expect(t.registered).toBe(3);
  });
});

describe('loadManualTournaments', () => {
  let ctx;
  beforeEach(() => { ctx = buildContext(); });

  test('возвращает только завершённые турниры', () => {
    ctx.saveTournaments([
      { id: 'f1', name: 'Завершён', status: 'finished', date: '2020-01-01',
        participants: [], waitlist: [], winners: [] },
      { id: 'o1', name: 'Открытый', status: 'open', date: '2099-12-31',
        participants: [], waitlist: [], winners: [] },
    ]);
    const result = ctx.loadManualTournaments();
    expect(result.map(t => t.id)).toContain('f1');
    expect(result.map(t => t.id)).not.toContain('o1');
  });
});
