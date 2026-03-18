# ПЛАН ИСПРАВЛЕНИЙ — Volley (КОТС)

> Сгенерировано по результатам code review от 16.03.2026
> Общий объём: ~10,600 строк кода, 31 файл
> Статусы проверены и обновлены 2026-03-18

---

## ФАЗА 1: БЕЗОПАСНОСТЬ (P0 — Critical)

### 1.1 XSS: Экранирование данных в innerHTML
- [x] `home.js` — обернуть `t.name`, `t.format`, `t.location`, `t.division`, `t.date`, `t.time`, `t.prize` в `esc()` в `cardHtml()` и `calRow()` — всё экранировано
- [x] `home.js` — `escAttr(t.id)` в onclick — выполнено
- [x] `home.js` — `escAttr(topM.name)` / `escAttr(topW.name)` в title-атрибутах — выполнено
- [x] `core.js` — `escAttr(p.name)` в onmousedown — выполнено (строка 53)
- [x] `core.js` — `escAttr(p.id)` во всех onclick — выполнено
- [x] `registration.js` — `escAttr(p.id)` в onclick — выполнено
- [x] `registration.js` — `esc(_regStatusMsg.text)` — выполнено
- [x] `registration.js` — `escAttr(t.id)` в onclick — выполнено
- [x] `integrations.js` — `esc(p.name)` в exportTournamentPDF — выполнено
- [x] `integrations.js` — `esc(t.name)` — выполнено
- [x] `integrations.js` — `escAttr(sbConfig.roomCode)` — выполнено
- [x] `integrations.js` — `escAttr(gshConfig.clientId)` и `escAttr(gshConfig.spreadsheetId)` — выполнено

### 1.2 CSV Formula Injection
- [x] `core.js` — `csvSafe()` экранирует `=`, `+`, `-`, `@`, `\t`, `\r` с префиксом `'` — уже было реализовано
- [x] Двойные кавычки внутри имён (`"` → `""`) — обрабатывается в `csvSafe()`

### 1.3 Content Security Policy
- [x] `index.html` — CSP-заголовок с белым списком присутствует

### 1.4 Subresource Integrity
- [x] `index.html` — Supabase JS подключён с `integrity="sha384-..."` + `crossorigin="anonymous"`

---

## ФАЗА 2: КРИТИЧЕСКИЕ БАГИ (P1)

### 2.1 Мёртвое условие `|| true`
- [x] `core.js` — убрано `|| true`, восстановлено условие `wlist.length > 0` — 2026-03-17

### 2.2 Строковое сравнение версий
- [x] `screens/core.js` — заменено на числовое сравнение через `split('.').map(Number)` — 2026-03-17

### 2.3 Мёртвый код
- [x] `core.js` — удалена неиспользуемая функция `_syncWinnerStats` — 2026-03-17

### 2.4 Blob URL memory leak
- [x] `integrations.js` — `URL.revokeObjectURL(url)` вызывается после `load` события; null-check на `window.open()` тоже есть — уже было реализовано

### 2.5 Offline-очередь без flush
- [x] `integrations.js` — `syncPendingPlayerRequests()` вызывается в `sbConnect()` при восстановлении связи — уже было реализовано

---

## ФАЗА 3: ПРОИЗВОДИТЕЛЬНОСТЬ (P2)

### 3.1 Мемоизация `getAllRanked()`
- [ ] Создать кэш с инвалидацией по `scoreTs` — вызывать расчёт 1 раз за цикл рендера вместо 30
  > Отложено: вызывается по 1 разу в каждой render-функции (не в петле); риск инвалидации кэша высок

### 3.2 Кэширование `loadPlayerDB()`
- [x] `domain/players.js` — `_playerDbCache` с invalidation по timestamp — уже было реализовано
- [x] `core.js` — дублирующие вызовы в `_rdbBodyHtml` убраны, один `allDb` на всю функцию — 2026-03-17

### 3.3 Debounce поиска
- [x] `core.js` — `ptSetSearch()` использует `setTimeout(150ms)` через `_ptSearchTimer` — выполнено
- [x] `registration.js` — debounce 300мс работает корректно — уже было

### 3.4 `_buildPlayerMap()` — поднять из цикла
- [x] `core.js` — `allDb` строится один раз и передаётся в `_slotHtml()` — уже было реализовано

### 3.5 AudioContext — переиспользование
- [x] `runtime.js` — `getAudioCtx()` возвращает singleton — уже было реализовано

### 3.6 Supabase Realtime
- [x] `integrations.js` — Broadcast-канал `room:{roomCode}` вместо postgres_changes; polling замедляется до 15s при активном канале, fallback 1.5s при ошибке — 2026-03-17

---

## ФАЗА 4: ОБРАБОТКА ОШИБОК (P2)

### 4.1 Заменить тихие `catch(e){}` на feedback
- [x] `screens/core.js` (`saveState`) — `console.error('[saveState] ...')` — 2026-03-17
- [x] `screens/core.js` (`loadState`) — `console.error('[loadState] ...')` — 2026-03-17
- [x] `integrations.js` (`sbPush`) — `console.warn('Supabase push error:', e)` — выполнено
- [x] `integrations.js:464` (`syncPending`) — `console.warn('[sbConnect] syncPending failed:', e)` — 2026-03-18
- [x] `registration.js:525` — `console.error('[addToTournament] saveTournaments failed:', e)` — 2026-03-18

### 4.2 Валидация данных
- [x] `integrations.js` (`sbApplyRemoteState`) — smart merge: применяется только если `state.scores` существует и `remoteTs >= localTs` — базовая защита есть
- [x] `domain/players.js` — `addPlayerToDB()` проверяет `name.length > 50` — 2026-03-17
- [x] `core.js` — `rdbAdd()` проверяет `name.length > 50` — 2026-03-17
- [ ] `registration.js` — явная проверка телефона (формат) в форме регистрации

### 4.3 Clipboard и popup-блокировка
- [x] `integrations.js` — `navigator.clipboard?.writeText(...)` с optional chaining — уже было
- [x] `integrations.js:1454` — `window.open()` PDF: null-check + `showToast` + `URL.revokeObjectURL` — выполнено
- [x] `integrations.js:1255` — `window.open()` Google Sheets: null-check + `showToast('⚠️ Разрешите всплывающие окна...')` — 2026-03-18

---

## ФАЗА 5: РЕФАКТОРИНГ АРХИТЕКТУРЫ (P3)

### 5.1 Разделение модулей по ответственности
- [ ] Вынести экспорт/импорт бэкапа из `registration.js` → `backup.js`
- [ ] Вынести рендер турниров из `registration.js` → оставить в `core.js` или отдельный модуль
- [ ] Вынести PDF-экспорт из `integrations.js` → `pdf-export.js`
- [ ] Вынести `deleteHistory` из `integrations.js` → `stats.js` или `history.js`

### 5.2 Устранение дубликатов
- [ ] Извлечь offline-регистрацию в хелпер `_regLocalRegister()` (3 копии → 1)
- [ ] Извлечь `loadHistory()` хелпер (6+ копий `JSON.parse(localStorage.getItem('kotc3_history'))`)
- [ ] Извлечь `safeParseLS(key, fallback)` — общий хелпер для localStorage
- [ ] Объединить `sbRefreshCard()` и `gshRefreshCard()` в одну функцию
- [ ] Извлечь общий sort-компаратор для рейтинга (3 копии)
- [ ] Извлечь `buildPairMap()` для химии (2 копии)

### 5.3 Улучшение state management
- [ ] Обернуть глобальные переменные из `app-state.js` в объект/класс `AppState`
- [ ] Добавить подписки на изменения (простой EventEmitter) вместо ручных вызовов `saveState()`
- [x] `screens/roster.js` (`clearRoster`) — добавлен вызов `saveState()` — 2026-03-17

### 5.4 Удаление хардкода
- [ ] `home.js` — убрать хардкод "Epic Player Card" (MAMEDOV / РАНГ: 3850) или привязать к реальным данным
- [ ] `integrations.js` — вынести SQL-миграцию из JS в отдельный `.sql` файл, подгружать по требованию

---

## ФАЗА 6: PWA / DEPLOY / ДОСТУПНОСТЬ (P3)

### 6.1 PWA-иконки
- [x] `manifest.webmanifest` — разделены записи `"purpose": "any"` и `"purpose": "maskable"` — 2026-03-17
- [x] `manifest.webmanifest` — добавлены записи PNG 192×192 и 512×512 — 2026-03-17
- [x] `index.html` — `apple-touch-icon` переведён на `assets/logo_lp_192.png` — 2026-03-17
- [ ] Физически сгенерировать PNG-иконки через `copy_logo.js` (нужны файлы в Downloads)

### 6.2 Service Worker
- [x] `sw.js` — `self.skipWaiting()` вызывается в install-хендлере — уже было
- [ ] Унифицировать список файлов — генерировать из одного источника (sw.js, validate-static.mjs, main.js)

### 6.3 Деплой
- [x] `static.yml` — добавлен шаг `Prepare public files`: копирует только `index.html`, `manifest.webmanifest`, `icon.svg`, `sw.js`, `config.example.js`, `assets/`, `prototypes/` в `_site/`; деплой из `_site/` — 2026-03-18
- [x] `.nojekyll` — создаётся автоматически в шаге `Prepare public files` командой `touch _site/.nojekyll` — 2026-03-18

### 6.4 Доступность (a11y)
- [x] `index.html` — убрано `user-scalable=no` и `maximum-scale=1.0` из viewport — 2026-03-17
- [x] `index.html` — `scrollTopBtn` уже имеет `aria-label="Наверх"` — уже было
- [x] `index.html` — `autocomplete="current-password"` / `autocomplete="new-password"` на полях пароля — уже было
- [ ] `index.html` — добавить `<label>` или `aria-label` к полям пароля (сейчас только `placeholder`)
- [ ] `index.html` — добавить `<noscript>` fallback

---

## ПОРЯДОК ВЫПОЛНЕНИЯ

```
Фаза 1 (Безопасность)     ████████████████████  ✅ ВЫПОЛНЕНО 2026-03-17
Фаза 2 (Критические баги) ████████████           ✅ ВЫПОЛНЕНО 2026-03-17
Фаза 3 (Производительность) ██████████████       ✅ ВЫПОЛНЕНО (3.1 отложено)
Фаза 4 (Обработка ошибок) ████████████           🔶 ЧАСТИЧНО (phone validation — не нужно для клуба)
Фаза 5 (Рефакторинг)      ████████████████████   ⬜ НЕ ВЫПОЛНЕНО (высокий риск, нужны unit-тесты)
Фаза 6 (PWA/Deploy/a11y)  ████████████           🔶 ЧАСТИЧНО (PNG иконки физически, label/noscript)
```

**Осталось незакрытых задач:** ~11 из 70
- Фаза 4: 1 задача (валидация телефона — низкий приоритет, частный клуб)
- Фаза 5: ~10 задач (рефактор — после unit-тестов)
- Фаза 6: 2 задачи (PNG иконки требуют copy_logo.js; label/noscript — косметика)
