# 🏐 Лютые Пляжники — King of the Court

Статическое веб-приложение для организации турниров по пляжному волейболу в формате **King of the Court**. Оптимизировано под телефон и работает без интернета: счёт, таймеры, ростер, рейтинг, история турниров, синхронизация между устройствами.

## Возможности

| Функция | Описание |
|---------|----------|
| 🏐 Несколько кортов | Счёт и таймеры на каждом корте и финале независимо |
| 📋 Ростер | Список игроков, очередь ожидания, деление по полу |
| 🏆 Рейтинг игроков | Очки по системе Professional Points (места 1–40) |
| 📅 История турниров | Все завершённые турниры с топ-3 и статистикой |
| 🌐 Публичный рейтинг | `rating.html` — страница без авторизации, видна всем |
| ☁️ Синхронизация | Реальное время через Supabase room_code + room_secret |
| 📊 Google Sheets | Экспорт результатов в таблицы |
| 📱 PWA | Устанавливается на телефон, работает офлайн |

## Структура проекта

```
/
├── index.html                  — Каркас приложения
├── rating.html                 — Публичная страница рейтинга (без авторизации)
├── data/
│   ├── leaderboard.json        — Рейтинг по типам (M / W / Mix)
│   └── history.json            — История завершённых турниров
├── assets/
│   ├── app.css                 — Главный стиль
│   └── js/
│       ├── main.js             — Bootstrap: загружает скрипты по порядку
│       ├── core.js             — Общие хелперы, finishTournament, recalcAllPlayerStats
│       ├── registration.js     — Регистрация игроков на турниры
│       ├── integrations.js     — Supabase sync, Google Sheets
│       ├── runtime.js          — Runtime обвязка
│       ├── state/
│       │   └── app-state.js    — Общий state, POINTS_TABLE, calculateRanking
│       ├── domain/
│       │   ├── players.js      — loadPlayerDB / savePlayerDB / recalc
│       │   ├── tournaments.js  — getTournaments / saveTournaments
│       │   └── timers.js       — Таймеры по кортам
│       ├── screens/
│       │   ├── core.js         — switchTab, finishTournament, навигация
│       │   ├── home.js         — Главный экран, ввод счёта
│       │   ├── courts.js       — Корты и разделение по дивизионам
│       │   ├── roster.js       — Ростер с защитой паролем
│       │   ├── players.js      — Рейтинг игроков + экспорт JSON для GitHub
│       │   ├── stats.js        — Статистика
│       │   ├── svod.js         — Сводный экран
│       │   └── components.js   — Переиспользуемые компоненты
│       └── ui/
│           └── roster-auth.js  — Локальная защита ростера паролем
├── supabase_migration.sql      — SQL для создания таблиц и RPC
├── sw.js                       — Service Worker (PWA, офлайн)
├── manifest.webmanifest        — PWA манифест
└── scripts/
    └── validate-static.mjs     — Проверка целостности перед деплоем
```

## Публичный рейтинг

`rating.html` — отдельная страница, доступная **всем без авторизации**.

### Как это работает

Данные хранятся как статические JSON-файлы прямо в репозитории:
- `data/leaderboard.json` — рейтинг М / Ж / Микст
- `data/history.json` — история турниров с топ-3

**Публикация защищена двумя уровнями:**

1. **Пароль ростера** — только организатор с паролем видит кнопку экспорта в приложении
2. **Права GitHub** — только владелец репозитория (с push-доступом) может опубликовать данные

### Публикация обновления рейтинга

```bash
# 1. В приложении: Игроки → кнопка «Скачать data/leaderboard.json + data/history.json»
# 2. Поместить скачанные файлы в папку data/
# 3. Опубликовать:
git add data/
git commit -m "Update ratings $(date +%Y-%m-%d)"
git push
```

После push все посетители сайта видят обновлённый рейтинг.

## Система очков (Professional Points)

| Место | Очки | | Место | Очки |
|-------|------|-|-------|------|
| 1     | 100  | | 6     | 55   |
| 2     | 90   | | 7     | 45   |
| 3     | 80   | | 8     | 38   |
| 4     | 72   | | 9     | 32   |
| 5     | 63   | | 10    | 26   |

Места 11–40 убывают линейно. Разные таблицы для М / Ж / Микст турниров.

## Локальный запуск

```bash
# Python
python3 -m http.server 8000

# Node.js
npx http-server . -p 8000
```

Открыть `http://localhost:8000` — приложение, `http://localhost:8000/rating.html` — публичный рейтинг.

## Проверка перед деплоем

```bash
node scripts/validate-static.mjs
```

Проверяет: наличие обязательных файлов, валидность манифеста, ссылки в HTML/JS, синтаксис всех скриптов.

## Supabase (опционально)

Нужен только для **синхронизации между устройствами** в реальном времени. Без него всё работает локально.

### Таблицы

| Таблица | Назначение |
|---------|-----------|
| `kotc_sessions` | Room-based state sync (room_code + room_secret) |
| `players` | База игроков |
| `tournaments` | Турниры |
| `tournament_participants` | Участники |
| `player_requests` | Заявки |

### RPC

Синхронизация комнат: `create_room`, `get_room_state`, `push_room_state`, `rotate_room_secret`

Регистрация: `search_players`, `safe_register_player`, `submit_player_request`, `approve_player_request`, `create_temporary_player`, `safe_cancel_registration`, `merge_players`

> Прямой доступ к `kotc_sessions` закрыт — все операции идут через SECURITY DEFINER RPC.

### Настройка Supabase

Создать `config.js` в корне (не коммитить в git):

```js
window.APP_CONFIG = {
  supabaseUrl:     'https://XXXXXXXX.supabase.co',
  supabaseAnonKey: 'eyJ...',
};
```

## Защита ростера

Пароль ростера задаётся прямо в приложении (экран Ростер → ⚙️):

- **Не хранится в репозитории** и не отправляется на сервер
- Хранится в `localStorage` как SHA-256(соль:пароль)
- `rosterUnlocked` — флаг в `sessionStorage`, сбрасывается при закрытии вкладки
- Без пароля ростер открыт для всех на устройстве

## Использование

1. Открыть `index.html`
2. Перейти в **Ростер** → добавить игроков, выбрать дивизион и формат
3. Вести счёт по кортам на главном экране
4. Завершить турнир → очки автоматически записываются в рейтинг
5. Перейти в **Игроки** — посмотреть актуальный рейтинг (М / Ж / Микст)
6. При необходимости: скачать JSON и опубликовать на `rating.html` через git
