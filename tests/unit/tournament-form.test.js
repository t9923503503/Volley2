import { describe, test, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadVolleyCoreWithBridges } from './_load-volley-scripts.js';

function ensureLoaded() {
  if (!globalThis.__coreBridge) loadVolleyCoreWithBridges(process.cwd());
}

function mountFormDom() {
  document.body.innerHTML = `
    <input id="trnf-name" value="">
    <input id="trnf-date" value="">
    <input id="trnf-time" value="">
    <input id="trnf-loc" value="">
    <input id="trnf-format" value="">
    <input id="trnf-div" value="">
    <input id="trnf-level" value="">
    <input id="trnf-cap" value="">
    <input id="trnf-prize" value="">
    <input id="trnf-prize-toggle" type="checkbox">
  `;
}

describe('submitTournamentForm', () => {
  beforeAll(() => ensureLoaded());

  beforeEach(() => {
    mountFormDom();
    globalThis.showToast = vi.fn();
    globalThis._refreshRosterTrn = vi.fn();
    globalThis.saveState = vi.fn();
    globalThis.saveTournaments = vi.fn();
    globalThis.getTournaments = vi.fn(() => []);
    globalThis.__coreBridge.setRosterTrnEditId(null);
  });

  test('валидация: пустое name → error-class на trnf-name, toast', () => {
    document.getElementById('trnf-date').value = '2026-03-01';
    document.getElementById('trnf-time').value = '09:00';
    document.getElementById('trnf-loc').value = 'X';
    document.getElementById('trnf-format').value = 'King of the Court';
    document.getElementById('trnf-div').value = 'Мужской';
    document.getElementById('trnf-level').value = 'medium';
    document.getElementById('trnf-cap').value = '24';

    globalThis.submitTournamentForm();

    expect(document.getElementById('trnf-name').classList.contains('trn-form-inp--error')).toBe(true);
    expect(globalThis.showToast).toHaveBeenCalled();
    expect(globalThis.saveTournaments).not.toHaveBeenCalled();
  });

  test('валидация: capacity < 4 → toast "Минимальная вместимость"', () => {
    document.getElementById('trnf-name').value = 'T';
    document.getElementById('trnf-date').value = '2026-03-01';
    document.getElementById('trnf-time').value = '09:00';
    document.getElementById('trnf-loc').value = 'X';
    document.getElementById('trnf-format').value = 'King of the Court';
    document.getElementById('trnf-div').value = 'Мужской';
    document.getElementById('trnf-level').value = 'medium';
    document.getElementById('trnf-cap').value = '3';

    globalThis.submitTournamentForm();

    expect(globalThis.showToast.mock.calls[0][0]).toMatch(/Минимальная вместимость/);
    expect(globalThis.saveTournaments).not.toHaveBeenCalled();
  });

  test('валидация: capacity > 999 → toast "Максимальная"', () => {
    document.getElementById('trnf-name').value = 'T';
    document.getElementById('trnf-date').value = '2026-03-01';
    document.getElementById('trnf-time').value = '09:00';
    document.getElementById('trnf-loc').value = 'X';
    document.getElementById('trnf-format').value = 'King of the Court';
    document.getElementById('trnf-div').value = 'Мужской';
    document.getElementById('trnf-level').value = 'medium';
    document.getElementById('trnf-cap').value = '1000';

    globalThis.submitTournamentForm();

    expect(globalThis.showToast.mock.calls[0][0]).toMatch(/Максимальная/);
    expect(globalThis.saveTournaments).not.toHaveBeenCalled();
  });

  test('новый турнир → pushes to array + saveTournaments + saveState', () => {
    vi.spyOn(Date, 'now').mockReturnValue(12345);
    document.getElementById('trnf-name').value = 'Турнир 1';
    document.getElementById('trnf-date').value = '2026-03-01';
    document.getElementById('trnf-time').value = '09:00';
    document.getElementById('trnf-loc').value = 'X';
    document.getElementById('trnf-format').value = 'King of the Court';
    document.getElementById('trnf-div').value = 'Мужской';
    document.getElementById('trnf-level').value = 'medium';
    document.getElementById('trnf-cap').value = '24';

    const arr = [];
    globalThis.getTournaments = vi.fn(() => arr);

    globalThis.submitTournamentForm();

    expect(arr).toHaveLength(1);
    expect(arr[0]).toMatchObject({
      id: 't_12345',
      name: 'Турнир 1',
      status: 'open',
      participants: [],
      waitlist: [],
      winners: [],
    });
    expect(globalThis.saveTournaments).toHaveBeenCalledWith(arr);
    expect(globalThis.saveState).toHaveBeenCalledTimes(1);
  });

  test('редактирование → preserves participants/waitlist/winners/status/source', () => {
    const arr = [
      {
        id: 't1',
        name: 'Old',
        date: '2026-03-01',
        time: '09:00',
        location: 'X',
        format: 'King of the Court',
        division: 'Мужской',
        level: 'medium',
        capacity: 24,
        prize: '',
        status: 'full',
        source: 'manual',
        participants: ['p1'],
        waitlist: ['p2'],
        winners: [{ place: 1, playerIds: ['p1'], points: 100 }],
      },
    ];
    globalThis.getTournaments = vi.fn(() => arr);
    globalThis.__coreBridge.setRosterTrnEditId('t1');

    document.getElementById('trnf-name').value = 'New name';
    document.getElementById('trnf-date').value = '2026-03-02';
    document.getElementById('trnf-time').value = '10:00';
    document.getElementById('trnf-loc').value = 'Y';
    document.getElementById('trnf-format').value = 'Round Robin';
    document.getElementById('trnf-div').value = 'Женский';
    document.getElementById('trnf-level').value = 'hard';
    document.getElementById('trnf-cap').value = '30';

    globalThis.submitTournamentForm();

    expect(arr[0]).toMatchObject({
      id: 't1',
      name: 'New name',
      date: '2026-03-02',
      status: 'full',
      source: 'manual',
      participants: ['p1'],
      waitlist: ['p2'],
      winners: [{ place: 1, playerIds: ['p1'], points: 100 }],
    });
    expect(globalThis.saveTournaments).toHaveBeenCalledWith(arr);
  });
});

describe('cloneTrn', () => {
  beforeAll(() => ensureLoaded());

  beforeEach(() => {
    mountFormDom();
    globalThis._refreshRosterTrn = vi.fn();
    globalThis.showToast = vi.fn();
  });

  test('копирует поля кроме id, participants, waitlist, winners; добавляет " (копия)"', async () => {
    vi.useFakeTimers();
    const src = {
      id: 't1',
      name: 'Name',
      date: '2026-03-01',
      time: '09:00',
      location: 'X',
      format: 'King of the Court',
      division: 'Мужской',
      level: 'medium',
      prize: '₽',
      capacity: 24,
      participants: ['p1'],
      waitlist: ['p2'],
      winners: ['legacy'],
    };
    globalThis.getTournaments = vi.fn(() => [src]);

    globalThis.cloneTrn('t1');
    await vi.advanceTimersByTimeAsync(80);

    expect(document.getElementById('trnf-name').value).toBe('Name (копия)');
    expect(document.getElementById('trnf-date').value).toBe('2026-03-01');
    expect(document.getElementById('trnf-cap').value).toBe('24');
    vi.useRealTimers();
  });
});

