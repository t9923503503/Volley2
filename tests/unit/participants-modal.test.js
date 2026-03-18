import { describe, test, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadVolleyCoreWithBridges } from './_load-volley-scripts.js';

function ensureLoaded() {
  if (!globalThis.__coreBridge) loadVolleyCoreWithBridges(process.cwd());
}

describe('ptAddPlayer', () => {
  beforeAll(() => ensureLoaded());

  beforeEach(() => {
    globalThis.showToast = vi.fn();
    globalThis._renderPtModal = vi.fn();
    globalThis.saveTournaments = vi.fn();
  });

  test('добавляет в participants если есть место', () => {
    const trn = { id: 't1', capacity: 2, status: 'open', participants: [], waitlist: [] };
    const arr = [trn];
    globalThis.getTournaments = vi.fn(() => arr);
    globalThis.__coreBridge.setPtTrnId('t1');

    globalThis.ptAddPlayer('p1');

    expect(trn.participants).toEqual(['p1']);
    expect(trn.waitlist).toEqual([]);
    expect(globalThis.saveTournaments).toHaveBeenCalledWith(arr);
  });

  test('добавляет в waitlist если capacity заполнен', () => {
    const trn = { id: 't1', capacity: 1, status: 'full', participants: ['p1'], waitlist: [] };
    const arr = [trn];
    globalThis.getTournaments = vi.fn(() => arr);
    globalThis.__coreBridge.setPtTrnId('t1');

    globalThis.ptAddPlayer('p2');

    expect(trn.participants).toEqual(['p1']);
    expect(trn.waitlist).toEqual(['p2']);
    expect(globalThis.showToast).toHaveBeenCalledWith(
      'Места закончились — добавлен в лист ожидания',
      'info'
    );
  });

  test('не добавляет дубликат', () => {
    const trn = { id: 't1', capacity: 2, status: 'open', participants: ['p1'], waitlist: [] };
    const arr = [trn];
    globalThis.getTournaments = vi.fn(() => arr);
    globalThis.__coreBridge.setPtTrnId('t1');

    globalThis.ptAddPlayer('p1');

    expect(trn.participants).toEqual(['p1']);
    expect(globalThis.saveTournaments).not.toHaveBeenCalled();
  });

  test('меняет status на "full" при заполнении', () => {
    const trn = { id: 't1', capacity: 2, status: 'open', participants: ['p1'], waitlist: [] };
    const arr = [trn];
    globalThis.getTournaments = vi.fn(() => arr);
    globalThis.__coreBridge.setPtTrnId('t1');

    globalThis.ptAddPlayer('p2');

    expect(trn.participants).toEqual(['p1', 'p2']);
    expect(trn.status).toBe('full');
  });
});

describe('ptExportCSV', () => {
  beforeAll(() => ensureLoaded());

  beforeEach(() => {
    globalThis.showToast = vi.fn();
    globalThis.getTournaments = vi.fn(() => []);
    globalThis.loadPlayerDB = vi.fn(() => []);
  });

  test('CSV содержит заголовок "Фамилия,Пол"', async () => {
    const trn = { id: 't1', name: 'T', participants: ['p1'], waitlist: [], capacity: 10 };
    globalThis.getTournaments = vi.fn(() => [trn]);
    globalThis.loadPlayerDB = vi.fn(() => [{ id: 'p1', name: 'Иванов', gender: 'M' }]);

    const BlobOrig = globalThis.Blob;
    globalThis.Blob = vi.fn((parts, opts) => ({ __parts: parts, __opts: opts }));

    let capturedBlob = null;
    globalThis.URL.createObjectURL = vi.fn((blob) => {
      capturedBlob = blob;
      return 'blob:1';
    });
    globalThis.URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(globalThis.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    globalThis.ptExportCSV('t1');

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(globalThis.showToast).toHaveBeenCalledWith('CSV скачан', 'success');
    const text = String(capturedBlob.__parts?.[0] ?? '');
    expect(text.split('\n')[0]).toBe('Фамилия,Пол');

    globalThis.Blob = BlobOrig;
  });

  test('csvSafe экранирует формулы Excel (=, +, -)', async () => {
    const trn = { id: 't1', name: 'T', participants: ['p1', 'p2', 'p3'], waitlist: [], capacity: 10 };
    globalThis.getTournaments = vi.fn(() => [trn]);
    globalThis.loadPlayerDB = vi.fn(() => [
      { id: 'p1', name: '=1+1', gender: 'M' },
      { id: 'p2', name: '+SUM(A1)', gender: 'W' },
      { id: 'p3', name: '-10', gender: 'M' },
    ]);

    const BlobOrig = globalThis.Blob;
    globalThis.Blob = vi.fn((parts, opts) => ({ __parts: parts, __opts: opts }));

    let capturedBlob = null;
    globalThis.URL.createObjectURL = vi.fn((blob) => {
      capturedBlob = blob;
      return 'blob:1';
    });
    globalThis.URL.revokeObjectURL = vi.fn();
    vi.spyOn(globalThis.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    globalThis.ptExportCSV('t1');

    const text = String(capturedBlob.__parts?.[0] ?? '');
    expect(text).toMatch(/"'\=1\+1",М/);
    expect(text).toMatch(/"'\+SUM\(A1\)",Ж/);
    expect(text).toMatch(/"'\-10",М/);

    globalThis.Blob = BlobOrig;
  });
});

describe('ptImportCSV', () => {
  beforeAll(() => ensureLoaded());

  beforeEach(() => {
    globalThis.saveTournaments = vi.fn();
    globalThis._renderPtModal = vi.fn();
    globalThis.loadPlayerDB = vi.fn(() => []);
    globalThis.getTournaments = vi.fn(() => []);
    globalThis.showToast = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  test('парсит строку "Иванов,М" и находит игрока в DB', async () => {
    const trn = { id: 't1', name: 'T', capacity: 10, status: 'open', participants: [], waitlist: [] };
    const arr = [trn];
    globalThis.__coreBridge.setPtTrnId('t1');
    globalThis.getTournaments = vi.fn(() => arr);
    globalThis.loadPlayerDB = vi.fn(() => [{ id: 'p1', name: 'Иванов', gender: 'M' }]);

    const csv = 'Фамилия,Пол\nИванов,М\n';
    const file = new File([csv], 'r.csv', { type: 'text/csv' });

    await new Promise((resolve) => {
      globalThis.showToast = vi.fn((msg) => {
        if (String(msg).startsWith('Импортировано')) resolve();
      });
      globalThis.ptImportCSV({ target: { files: [file], value: 'x' } });
    });

    expect(trn.participants).toEqual(['p1']);
    expect(globalThis.saveTournaments).toHaveBeenCalledWith(arr);
  });

  test('пропускает строки без совпадения в DB (console.warn)', async () => {
    const trn = { id: 't1', name: 'T', capacity: 10, status: 'open', participants: [], waitlist: [] };
    const arr = [trn];
    globalThis.__coreBridge.setPtTrnId('t1');
    globalThis.getTournaments = vi.fn(() => arr);
    globalThis.loadPlayerDB = vi.fn(() => [{ id: 'p1', name: 'Иванов', gender: 'M' }]);

    const csv = 'Фамилия,Пол\nНетТакого,М\n';
    const file = new File([csv], 'r.csv', { type: 'text/csv' });

    await new Promise((resolve) => {
      globalThis.showToast = vi.fn((msg) => {
        if (String(msg).startsWith('Импортировано')) resolve();
      });
      globalThis.ptImportCSV({ target: { files: [file], value: 'x' } });
    });

    expect(console.warn).toHaveBeenCalled();
    expect(trn.participants).toEqual([]);
  });

  test('не добавляет дубликатов', async () => {
    const trn = { id: 't1', name: 'T', capacity: 10, status: 'open', participants: ['p1'], waitlist: [] };
    const arr = [trn];
    globalThis.__coreBridge.setPtTrnId('t1');
    globalThis.getTournaments = vi.fn(() => arr);
    globalThis.loadPlayerDB = vi.fn(() => [{ id: 'p1', name: 'Иванов', gender: 'M' }]);

    const csv = 'Фамилия,Пол\nИванов,М\nИванов,М\n';
    const file = new File([csv], 'r.csv', { type: 'text/csv' });

    await new Promise((resolve) => {
      globalThis.showToast = vi.fn((msg) => {
        if (String(msg).startsWith('Импортировано')) resolve();
      });
      globalThis.ptImportCSV({ target: { files: [file], value: 'x' } });
    });

    expect(trn.participants).toEqual(['p1']);
  });
});

