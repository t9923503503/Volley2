import { describe, test, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadVolleyCoreWithBridges } from './_load-volley-scripts.js';

function ensureLoaded() {
  if (!globalThis.__coreBridge) loadVolleyCoreWithBridges(process.cwd());
}

describe('resAddPlayer', () => {
  beforeAll(() => ensureLoaded());

  beforeEach(() => {
    globalThis.showToast = vi.fn();
    globalThis._reRenderSlots = vi.fn();
    globalThis.__coreBridge.setResState({
      trnId: 't1',
      preset: 'standard',
      trnType: 'M',
      slots: [
        { place: 1, playerIds: [], points: 100 },
        { place: 2, playerIds: [], points: 80 },
        { place: 3, playerIds: [], points: 60 },
      ],
    });
  });

  test('добавляет игрока в слот', () => {
    globalThis.resAddPlayer(0, 'p1');
    expect(globalThis.__coreBridge.getResState().slots[0].playerIds).toEqual(['p1']);
  });

  test('отклоняет > 2 игроков в слоте', () => {
    const st = globalThis.__coreBridge.getResState();
    st.slots[0].playerIds = ['p1', 'p2'];
    globalThis.__coreBridge.setResState(st);

    globalThis.resAddPlayer(0, 'p3');
    expect(globalThis.showToast).toHaveBeenCalledWith('Максимум 2 игрока в слоте', 'error');
    expect(globalThis.__coreBridge.getResState().slots[0].playerIds).toEqual(['p1', 'p2']);
  });

  test('отклоняет игрока уже занятого в другом слоте', () => {
    const st = globalThis.__coreBridge.getResState();
    st.slots[1].playerIds = ['p9'];
    globalThis.__coreBridge.setResState(st);

    globalThis.resAddPlayer(0, 'p9');
    expect(globalThis.showToast).toHaveBeenCalledWith('Игрок уже назначен в другой слот', 'error');
    expect(globalThis.__coreBridge.getResState().slots[0].playerIds).toEqual([]);
  });
});

describe('saveResults', () => {
  beforeAll(() => ensureLoaded());

  beforeEach(() => {
    globalThis.showToast = vi.fn();
    globalThis.saveTournaments = vi.fn();
    globalThis.closeResultsModal = vi.fn(() => globalThis.__coreBridge.setResState(null));
    globalThis._refreshRosterTrn = vi.fn();
    globalThis.recalcAllPlayerStats = vi.fn();
    globalThis.getTournaments = vi.fn(() => []);
  });

  test('не сохраняет если < 3 мест заполнено', () => {
    const trn = { id: 't1', status: 'open', division: 'Мужской', winners: [] };
    const arr = [trn];
    globalThis.getTournaments = vi.fn(() => arr);
    globalThis.__coreBridge.setResState({
      trnId: 't1',
      trnType: 'M',
      slots: [
        { place: 1, playerIds: ['p1'], points: 100 },
        { place: 2, playerIds: [], points: 80 },
        { place: 3, playerIds: [], points: 60 },
      ],
    });

    globalThis.saveResults();

    expect(globalThis.showToast).toHaveBeenCalledWith('Заполните все 3 призовых места', 'error');
    expect(globalThis.saveTournaments).not.toHaveBeenCalled();
  });

  test('записывает audit-лог в trn.history', () => {
    const trn = { id: 't1', status: 'open', division: 'Мужской', winners: [] };
    const arr = [trn];
    globalThis.getTournaments = vi.fn(() => arr);
    globalThis.__coreBridge.setResState({
      trnId: 't1',
      trnType: 'M',
      slots: [
        { place: 1, playerIds: ['p1'], points: 100 },
        { place: 2, playerIds: ['p2'], points: 80 },
        { place: 3, playerIds: ['p3'], points: 60 },
      ],
    });

    globalThis.saveResults();

    expect(Array.isArray(trn.history)).toBe(true);
    expect(trn.history.length).toBe(1);
    expect(trn.history[0]).toMatchObject({ action: 'finished' });
    expect(trn.history[0].winnersSnapshot).toEqual([
      { place: 1, playerIds: ['p1'], points: 100 },
      { place: 2, playerIds: ['p2'], points: 80 },
      { place: 3, playerIds: ['p3'], points: 60 },
    ]);
  });

  test('вызывает recalcAllPlayerStats(true)', () => {
    const trn = { id: 't1', status: 'open', division: 'Мужской', winners: [] };
    const arr = [trn];
    globalThis.getTournaments = vi.fn(() => arr);
    globalThis.__coreBridge.setResState({
      trnId: 't1',
      trnType: 'M',
      slots: [
        { place: 1, playerIds: ['p1'], points: 100 },
        { place: 2, playerIds: ['p2'], points: 80 },
        { place: 3, playerIds: ['p3'], points: 60 },
      ],
    });

    globalThis.saveResults();
    expect(globalThis.recalcAllPlayerStats).toHaveBeenCalledWith(true);
  });

  test('первое сохранение → isFirstSave toast', () => {
    const trn = { id: 't1', status: 'open', division: 'Мужской', winners: [] };
    const arr = [trn];
    globalThis.getTournaments = vi.fn(() => arr);
    globalThis.__coreBridge.setResState({
      trnId: 't1',
      trnType: 'M',
      slots: [
        { place: 1, playerIds: ['p1'], points: 100 },
        { place: 2, playerIds: ['p2'], points: 80 },
        { place: 3, playerIds: ['p3'], points: 60 },
      ],
    });

    globalThis.saveResults();
    expect(globalThis.showToast).toHaveBeenCalledWith('🏆 Турнир завершён!', 'success');
  });

  test('повторное сохранение → "Результаты обновлены" toast', () => {
    const trn = { id: 't1', status: 'finished', division: 'Мужской', winners: [] };
    const arr = [trn];
    globalThis.getTournaments = vi.fn(() => arr);
    globalThis.__coreBridge.setResState({
      trnId: 't1',
      trnType: 'M',
      slots: [
        { place: 1, playerIds: ['p1'], points: 100 },
        { place: 2, playerIds: ['p2'], points: 80 },
        { place: 3, playerIds: ['p3'], points: 60 },
      ],
    });

    globalThis.saveResults();
    expect(globalThis.showToast).toHaveBeenCalledWith('✏️ Результаты обновлены!', 'success');
    expect(trn.history?.[0]?.action).toBe('edited');
  });
});

