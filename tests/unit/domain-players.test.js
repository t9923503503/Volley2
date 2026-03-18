import { describe, test, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

// ── Bootstrap: run domain/players.js in a jsdom-like VM context ──────────────

const root = process.cwd();
const abs  = (...p) => path.join(root, ...p);

function buildContext() {
  const ctx = vm.createContext({
    // localStorage mock
    localStorage: (() => {
      const store = {};
      return {
        getItem:    k      => store[k] ?? null,
        setItem:    (k, v) => { store[k] = String(v); },
        removeItem: k      => { delete store[k]; },
        clear:      ()     => { Object.keys(store).forEach(k => delete store[k]); },
      };
    })(),
    Date,
    Math,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    console,
    // stubs for cross-module dependencies (players.js calls getTournaments/saveTournaments)
    getTournaments:  () => [],
    saveTournaments: () => {},
    AppLogger: { warn: () => {}, error: () => {}, info: () => {} },
  });
  // Run players.js in context
  const code = readFileSync(abs('assets', 'js', 'domain', 'players.js'), 'utf8');
  vm.runInContext(code, ctx, { filename: 'players.js' });
  return ctx;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('fromLocalPlayer', () => {
  let ctx;
  beforeEach(() => { ctx = buildContext(); });

  test('возвращает null для невалидного input', () => {
    expect(ctx.fromLocalPlayer(null)).toBe(null);
    expect(ctx.fromLocalPlayer('строка')).toBe(null);
    expect(ctx.fromLocalPlayer(42)).toBe(null);
  });

  test('нормализует пустой объект с дефолтными значениями', () => {
    const p = ctx.fromLocalPlayer({});
    expect(p).not.toBeNull();
    expect(p.gender).toBe('M');
    expect(p.tournaments).toBe(0);
    expect(p.totalPts).toBe(0);
    expect(p.wins).toBe(0);
    expect(p.ratingM).toBe(0);
  });

  test('принимает Supabase-поля (total_pts, tournaments_played)', () => {
    const p = ctx.fromLocalPlayer({
      name: 'Тест', gender: 'M',
      total_pts: 500,
      tournaments_played: 10,
      last_seen: '2025-01-01',
    });
    expect(p.totalPts).toBe(500);
    expect(p.tournaments).toBe(10);
    expect(p.lastSeen).toBe('2025-01-01');
  });

  test('приоритет camelCase над snake_case', () => {
    const p = ctx.fromLocalPlayer({ name: 'А', totalPts: 100, total_pts: 999 });
    expect(p.totalPts).toBe(100);
  });

  test('gender W распознаётся корректно', () => {
    const p = ctx.fromLocalPlayer({ name: 'Лена', gender: 'W' });
    expect(p.gender).toBe('W');
  });

  test('любой gender кроме W → M', () => {
    const p = ctx.fromLocalPlayer({ name: 'Иван', gender: 'unknown' });
    expect(p.gender).toBe('M');
  });

  test('обрезает пробелы в имени', () => {
    const p = ctx.fromLocalPlayer({ name: '  Фамилия  ' });
    expect(p.name).toBe('Фамилия');
  });
});

describe('addPlayerToDB', () => {
  let ctx;
  beforeEach(() => { ctx = buildContext(); ctx.localStorage.clear(); });

  test('добавляет нового игрока', () => {
    const ok = ctx.addPlayerToDB('Иванов', 'M');
    expect(ok).toBe(true);
    const db = ctx.loadPlayerDB();
    expect(db).toHaveLength(1);
    expect(db[0].name).toBe('Иванов');
    expect(db[0].gender).toBe('M');
  });

  test('не добавляет дубликат (регистронезависимо)', () => {
    ctx.addPlayerToDB('Иванов', 'M');
    const ok = ctx.addPlayerToDB('иванов', 'M');
    expect(ok).toBe(false);
    expect(ctx.loadPlayerDB()).toHaveLength(1);
  });

  test('разные гендеры — разные записи', () => {
    ctx.addPlayerToDB('Иванова', 'M');
    const ok = ctx.addPlayerToDB('Иванова', 'W');
    expect(ok).toBe(true);
    expect(ctx.loadPlayerDB()).toHaveLength(2);
  });

  test('отклоняет пустое имя', () => {
    expect(ctx.addPlayerToDB('', 'M')).toBe(false);
    expect(ctx.addPlayerToDB('   ', 'M')).toBe(false);
  });

  test('отклоняет имя длиннее 50 символов', () => {
    const long = 'А'.repeat(51);
    expect(ctx.addPlayerToDB(long, 'M')).toBe(false);
  });

  test('принимает имя ровно 50 символов', () => {
    const exact = 'А'.repeat(50);
    expect(ctx.addPlayerToDB(exact, 'M')).toBe(true);
  });
});

describe('upsertPlayerInDB', () => {
  let ctx;
  beforeEach(() => { ctx = buildContext(); ctx.localStorage.clear(); });

  test('создаёт нового игрока если не найден', () => {
    const p = ctx.upsertPlayerInDB({ name: 'Новый', gender: 'M' });
    expect(p).not.toBeNull();
    expect(p.name).toBe('Новый');
    expect(ctx.loadPlayerDB()).toHaveLength(1);
  });

  test('обновляет существующего игрока по имени+гендеру', () => {
    ctx.addPlayerToDB('Петров', 'M');
    const updated = ctx.upsertPlayerInDB({ name: 'Петров', gender: 'M', totalPts: 150 });
    expect(updated.totalPts).toBe(150);
    expect(ctx.loadPlayerDB()).toHaveLength(1);
  });

  test('возвращает null для игрока без имени', () => {
    const p = ctx.upsertPlayerInDB({ gender: 'M' });
    expect(p).toBeNull();
  });
});

describe('savePlayerDB / loadPlayerDB', () => {
  let ctx;
  beforeEach(() => { ctx = buildContext(); ctx.localStorage.clear(); });

  test('сохраняет и загружает игроков', () => {
    ctx.addPlayerToDB('Смирнов', 'M');
    ctx.addPlayerToDB('Смирнова', 'W');

    // Simulate fresh load (invalidate cache)
    const ctx2 = buildContext();
    // Copy localStorage state
    const raw = ctx.localStorage.getItem('kotc3_playerdb');
    const ts  = ctx.localStorage.getItem('kotc3_playerdb_ts');
    ctx2.localStorage.setItem('kotc3_playerdb', raw);
    ctx2.localStorage.setItem('kotc3_playerdb_ts', ts);

    const db = ctx2.loadPlayerDB();
    expect(db).toHaveLength(2);
    expect(db.map(p => p.name).sort()).toEqual(['Смирнов', 'Смирнова'].sort());
  });

  test('возвращает [] при пустом storage', () => {
    expect(ctx.loadPlayerDB()).toEqual([]);
  });

  test('возвращает [] при повреждённом JSON', () => {
    ctx.localStorage.setItem('kotc3_playerdb', '{ broken json }');
    expect(ctx.loadPlayerDB()).toEqual([]);
  });
});

describe('removePlayerFromDB', () => {
  let ctx;
  beforeEach(() => { ctx = buildContext(); ctx.localStorage.clear(); });

  test('удаляет игрока по id', () => {
    ctx.addPlayerToDB('Удаляемый', 'M');
    const db = ctx.loadPlayerDB();
    expect(db).toHaveLength(1);
    ctx.removePlayerFromDB(db[0].id);
    expect(ctx.loadPlayerDB()).toHaveLength(0);
  });

  test('не падает если id не найден', () => {
    ctx.addPlayerToDB('Кто-то', 'M');
    expect(() => ctx.removePlayerFromDB('несуществующий-id')).not.toThrow();
    expect(ctx.loadPlayerDB()).toHaveLength(1);
  });
});
