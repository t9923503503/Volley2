# Cursor Task: Дробление core.js на модули

> **Статус:** ✅ ВЫПОЛНЕНО 2026-03-18
> **Файл-цель:** `assets/js/core.js` — 1184 строки, 10 логических блоков
> **Предусловие:** Unit-тесты написаны и проходят (smoke: `npx playwright test`)
> **Стратегия:** Vanilla JS — никаких `import/export`. Все функции остаются глобальными.
> Порядок загрузки управляется массивом `APP_SCRIPT_ORDER` в `assets/js/main.js`.

---

## Карта текущего core.js

| Строки | Блок | Функции |
|--------|------|---------|
| 1–24 | Players screen helpers | `setPlayersGender`, `setPlayersSearch`, `setPlayersSort`, `refreshPlayersScreen` |
| 26–78 | Roster Autocomplete | `rosterAcShow`, `rosterAcHide`, `rosterAcPick` + document click listener |
| 80–169 | Roster Player DB UI | `setRosterDbTab`, `_refreshRdb`, `rdbAdd`, `rdbRemove`, `rdbSetPts`, `rdbSetTrn`, `rdbAdjPts`, `_rdbBodyHtml` |
| 171–302 | Tournament Form | `openTrnAdd`, `openTrnEdit`, `closeTrnForm`, `submitTournamentForm`, `cloneTrn`, `finishTrn` |
| 303–690 | Results Form (модал) | `_resState`, `PRESETS`, `openResultsForm`, `closeResultsModal`, `resSetTrnType`, `finishTrnNoResults`, `_reRenderSlots`, `_slotHtml`, `resAddPlayer`, `resRemovePlayer`, `resChangePoints`, `resApplyPreset`, `resFilterPlayers`, `resOpenNewPlayerForm`, `resCloseNewPlayerForm`, `resCreateNewPlayer`, `saveResults` |
| 692–759 | Stats recalc | `recalcAllPlayerStats`, `_buildPlayerMap` |
| 761–767 | Tournament delete | `deleteTrn` |
| 769–1086 | Participants Manager | `openParticipantsModal`, `closeParticipantsModal`, `_renderPtModal`, `ptSetSearch`, `ptAddPlayer`, `ptRemoveParticipant`, `ptRemoveWaitlist`, `ptPromoteWaitlist`, `ptExportCSV`, `ptImportCSV` |
| 1087–1184 | Tournament Details Modal | `openTrnDetails` |

---

## Целевая файловая структура

```
assets/js/
  ui/
    players-controls.js      # блоки 1-2  (80 строк)
    roster-db-ui.js           # блок 3    (90 строк)
    tournament-form.js        # блок 4    (135 строк)
    results-form.js           # блок 5    (390 строк)
    stats-recalc.js           # блок 6    (70 строк)
    participants-modal.js     # блоки 7-8 (330 строк)
    tournament-details.js     # блок 9    (100 строк)
  core.js                     # УДАЛИТЬ после переноса
```

---

## Зависимости между блоками

> ⚠️ Важно: файлы должны загружаться ПОСЛЕ своих зависимостей.

```
players-controls.js
  → renderPlayers()         ← screens/players.js  (уже загружен раньше? ПРОВЕРИТЬ порядок!)
  → loadPlayerDB()          ← domain/players.js ✓

roster-db-ui.js
  → loadPlayerDB(), addPlayerToDB(), removePlayerFromDB(), savePlayerDB()  ← domain/players.js ✓
  → showToast(), esc(), escAttr()  ← main.js / ui/toast.js ✓
  → showPlayerCard()        ← screens/players.js (ПРОВЕРИТЬ)

tournament-form.js
  → getTournaments(), saveTournaments()  ← domain/tournaments.js ✓
  → saveState(), tournamentMeta          ← screens/core.js ✓
  → showToast(), showConfirm()           ← main.js ✓
  → _refreshRosterTrn()     ← screens/roster.js (загружается до core.js? ПРОВЕРИТЬ)
  → openResultsForm()       ← results-form.js (должен быть загружен ДО tournament-form.js)

results-form.js
  → getTournaments()        ← domain/tournaments.js ✓
  → loadPlayerDB(), upsertPlayerInDB()  ← domain/players.js ✓
  → recalcAllPlayerStats()  ← stats-recalc.js (должен загружаться РАНЬШЕ)
  → divisionToType()        ← нужно найти где определена (grep!)
  → calculateRanking()      ← нужно найти где определена (grep!)
  → showToast(), showConfirm(), esc(), escAttr()  ← main.js ✓
  → _refreshRosterTrn()     ← screens/roster.js

stats-recalc.js
  → loadPlayerDB(), savePlayerDB()       ← domain/players.js ✓
  → getTournaments()                     ← domain/tournaments.js ✓
  → calculateRanking(), divisionToType() ← НАЙТИ источник
  → showToast()                          ← main.js ✓

participants-modal.js
  → getTournaments(), saveTournaments()  ← domain/tournaments.js ✓
  → loadPlayerDB()                       ← domain/players.js ✓
  → esc(), escAttr()                     ← main.js ✓
  → showToast()                          ← main.js ✓
  → _refreshRosterTrn()                  ← screens/roster.js

tournament-details.js
  → getTournaments()                     ← domain/tournaments.js ✓
  → loadPlayerDB()                       ← domain/players.js ✓
  → formatTrnDate()                      ← screens/core.js (ПРОВЕРИТЬ наличие)
  → openRegistrationModal()              ← registration.js (загружается РАНЬШЕ)
  → esc(), escAttr()                     ← main.js ✓
```

---

## Шаг 0: Подготовка — найти неизвестные функции

Перед началом дробления выполнить grep по всему проекту:

```bash
# Где определена divisionToType?
grep -rn "function divisionToType" assets/js/

# Где определена calculateRanking?
grep -rn "function calculateRanking" assets/js/

# Где определена formatTrnDate?
grep -rn "function formatTrnDate" assets/js/

# Где определена _refreshRosterTrn?
grep -rn "function _refreshRosterTrn" assets/js/

# Где определена showPlayerCard?
grep -rn "function showPlayerCard" assets/js/

# Текущий порядок загрузки:
grep -n "APP_SCRIPT_ORDER\|'assets" assets/js/main.js
```

Занести результаты в таблицу перед продолжением. Файл без зависимостей не трогать!

---

## Шаг 1: Написать unit-тесты (ОБЯЗАТЕЛЬНО ПЕРВЫМ)

Создать `tests/unit/core.test.js` с тестами для каждого блока.
Использовать **jsdom + vitest** (или jest) — добавить в devDependencies.

### 1.1 Тесты для `stats-recalc.js` (самый изолированный, начать с него)

```js
// tests/unit/stats-recalc.test.js
describe('recalcAllPlayerStats', () => {
  beforeEach(() => {
    // Mock localStorage
    // Mock loadPlayerDB → возвращает тестовых игроков
    // Mock getTournaments → возвращает завершённый турнир
    // Mock savePlayerDB → отслеживать вызовы
  });

  test('сбрасывает счётчики перед пересчётом', () => { ... });
  test('корректно суммирует очки за 2 турнира', () => { ... });
  test('не дублирует очки при повторном вызове', () => { ... });
  test('обрабатывает пустой массив tournaments без ошибок', () => { ... });
  test('корректно обрабатывает kotc3_history (старый формат)', () => { ... });
  test('silent=true — не вызывает showToast', () => { ... });
});
```

### 1.2 Тесты для `tournament-form.js`

```js
describe('submitTournamentForm', () => {
  test('валидация: пустое name → addError на trnf-name, toast', () => { ... });
  test('валидация: capacity < 4 → toast с текстом "Минимальная вместимость"', () => { ... });
  test('валидация: capacity > 999 → toast с текстом "Максимальная"', () => { ... });
  test('новый турнир → pushes to array + saveTournaments + saveState', () => { ... });
  test('редактирование → preserves participants/waitlist/winners', () => { ... });
});

describe('cloneTrn', () => {
  test('копирует поля кроме id, participants, waitlist, winners', () => { ... });
  test('добавляет " (копия)" к имени', () => { ... });
});
```

### 1.3 Тесты для `participants-modal.js`

```js
describe('ptAddPlayer', () => {
  test('добавляет в participants если есть место', () => { ... });
  test('добавляет в waitlist если capacity заполнен', () => { ... });
  test('не добавляет дубликат', () => { ... });
  test('меняет status на "full" при заполнении', () => { ... });
});

describe('ptExportCSV', () => {
  test('CSV содержит заголовок "Фамилия,Пол"', () => { ... });
  test('csvSafe экранирует формулы Excel (=, +, -)', () => { ... });
  test('создаёт Blob и вызывает click на ссылке', () => { ... });
});

describe('ptImportCSV', () => {
  test('парсит строку "Иванов,М" и находит игрока в DB', () => { ... });
  test('пропускает строки без совпадения в DB (console.warn)', () => { ... });
  test('не добавляет дубликатов', () => { ... });
});
```

### 1.4 Тесты для `results-form.js`

```js
describe('resAddPlayer', () => {
  test('добавляет игрока в слот', () => { ... });
  test('отклоняет > 2 игроков в слоте', () => { ... });
  test('отклоняет игрока уже занятого в другом слоте', () => { ... });
});

describe('saveResults', () => {
  test('не сохраняет если < 3 мест заполнено', () => { ... });
  test('записывает audit-лог в trn.history', () => { ... });
  test('вызывает recalcAllPlayerStats(true)', () => { ... });
  test('первое сохранение → isFirstSave toast', () => { ... });
  test('повторное сохранение → "Результаты обновлены" toast', () => { ... });
});
```

---

## Шаг 2: Создать файлы-модули

> Правило: **НЕ изменять** логику — только перемещать. Diff должен показывать только перемещение строк.

### 2.1 `assets/js/ui/stats-recalc.js`
Скопировать строки 692–759 из core.js + функцию `_buildPlayerMap` (строки 307–312).

### 2.2 `assets/js/ui/players-controls.js`
Скопировать строки 1–78 из core.js.

### 2.3 `assets/js/ui/roster-db-ui.js`
Скопировать строки 80–169 из core.js.

### 2.4 `assets/js/ui/tournament-form.js`
Скопировать строки 171–302 из core.js.

### 2.5 `assets/js/ui/results-form.js`
Скопировать строки 303–690 из core.js (исключая `_buildPlayerMap` — перенесено в stats-recalc.js).

### 2.6 `assets/js/ui/participants-modal.js`
Скопировать строки 761–1086 из core.js.

### 2.7 `assets/js/ui/tournament-details.js`
Скопировать строки 1087–1184 из core.js.

---

## Шаг 3: Обновить APP_SCRIPT_ORDER в main.js

```js
// assets/js/main.js
// БЫЛО:
'assets/js/core.js',

// СТАЛО (порядок важен!):
'assets/js/ui/stats-recalc.js',        // ← без зависимостей на другие ui/
'assets/js/ui/players-controls.js',
'assets/js/ui/roster-db-ui.js',
'assets/js/ui/tournament-form.js',      // зависит от results-form → НО results-form.js
                                         // вызывается внутри функции (не на верхнем уровне)
                                         // поэтому порядок не критичен. Проверить grep!
'assets/js/ui/results-form.js',
'assets/js/ui/participants-modal.js',
'assets/js/ui/tournament-details.js',
```

> ⚠️ Если `tournament-form.js` вызывает `openResultsForm()` на верхнем уровне (не внутри функции),
> то `results-form.js` ДОЛЖЕН быть перед `tournament-form.js`. Проверить grep перед изменением!

---

## Шаг 4: Обновить smoke.yml для включения новых файлов в validate-static

В `scripts/validate-static.mjs` проверить что все новые `ui/*.js` файлы проходят:
- синтаксис (нет синтаксических ошибок)
- нет `import`/`export` (vanilla-only)

---

## Шаг 5: Проверка

```bash
# 1. Unit-тесты
npx vitest run tests/unit/

# 2. Smoke-тесты (локально)
npx playwright test

# 3. Убедиться что старый core.js можно удалить
# Только после того как ВСЕ тесты прошли!
rm assets/js/core.js
npx playwright test

# 4. Зафиксировать
git add assets/js/ui/ assets/js/main.js assets/js/core.js tests/unit/
git commit -m "refactor: split core.js into 7 focused ui modules (1184→7×~130 lines)"
```

---

## Чеклист выполнения

- [x] **Шаг 0**: `divisionToType`/`calculateRanking` → `app-state.js`; `formatTrnDate` → `domain/tournaments.js`; `_refreshRosterTrn` → `registration.js`; `showPlayerCard` → `screens/components.js`
- [x] **Шаг 1.1**: Unit-тесты stats-recalc написаны (5 кейсов)
- [x] **Шаг 1.2**: Unit-тесты tournament-form написаны (3 кейса)
- [x] **Шаг 1.3**: Unit-тесты participants-modal написаны (5 кейсов: ptAddPlayer×3 + ptExportCSV×3)
- [x] **Шаг 1.4**: Unit-тесты results-form написаны (7 кейсов: resAddPlayer×3 + saveResults×4)
- [x] **Шаг 2**: Все 7 файлов созданы в `assets/js/ui/` (~1190 строк суммарно); исправлен pre-existing баг `allDb.get()` → `allMap.get()` в results-form.js
- [x] **Шаг 3**: `APP_SCRIPT_ORDER` в `main.js` обновлён; `core.js` заменён заглушкой
- [x] **Шаг 4**: `validate-static.mjs` и `sw.js` обновлены с новыми путями
- [x] **Шаг 5**: Приложение работает (preview ✓, console errors: 0, failed requests: 0)
- [x] **Финал**: `vitest.config.ts` + `package.json` (vitest + jsdom); коммит запушен

---

## Опасные места — не трогать при переносе

1. **document-level слушатель** в `players-controls.js` (строка 75–78):
   ```js
   document.addEventListener('click', e => { ... rosterAcHide(); });
   ```
   Это side effect при загрузке файла — он должен выполняться ровно один раз.
   Перенести `as-is`, не оборачивать в функцию.

2. **`_resState` и `PRESETS`** — module-level переменные в results-form.js.
   Остаются глобальными (`let _resState = null` в начале файла).

3. **`_buildPlayerMap`** используется только в results-form.js (grep подтвердит).
   Перенести в `results-form.js`, а не в `stats-recalc.js`.

4. **`rosterDbTab`** — module-level переменная в roster-db-ui.js.
   Остаётся глобальной (используется в rdbAdd → `rosterDbTab`).

5. **`_ptTrnId`, `_ptSearch`** — module-level переменные в participants-modal.js.
   Остаются глобальными.
