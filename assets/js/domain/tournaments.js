'use strict';

// Tournament storage and migration helpers.

// ── Tournament storage — Single Source of Truth ───────────────
const _TRN_DAY_NAMES   = ['ВС','ПН','ВТ','СР','ЧТ','ПТ','СБ'];
const _TRN_MONTH_NAMES = ['января','февраля','марта','апреля','мая','июня',
                           'июля','августа','сентября','октября','ноября','декабря'];

// Display mapping: latin storage key → Russian label
const TRN_LEVEL_LABELS = { hard: 'Хард', medium: 'Средний', easy: 'Лайт' };

/** Format ISO date (YYYY-MM-DD) into a human-readable Russian string */
function formatTrnDate(iso) {
  if (!iso) return '';
  const d  = new Date(iso + 'T12:00:00');
  const dn = _TRN_DAY_NAMES[d.getDay()];
  const mn = _TRN_MONTH_NAMES[d.getMonth()];
  return dn.charAt(0) + dn.slice(1).toLowerCase()
       + ', ' + d.getDate() + ' ' + mn + ' ' + d.getFullYear();
}

// ── Storage API ───────────────────────────────────────────────
const TRN_STORAGE_KEY = 'kotc3_tournaments';

/**
 * Загружает все турниры из localStorage.
 * @returns {object[]} Массив турниров в новом формате (может быть [])
 */
function getTournaments() {
  try { return JSON.parse(localStorage.getItem(TRN_STORAGE_KEY) || '[]'); }
  catch(e) { return []; }
}

/**
 * Сохраняет массив турниров в localStorage (полная перезапись).
 * @param {object[]} data Массив объектов турниров в новом формате
 */
function saveTournaments(data) {
  localStorage.setItem(TRN_STORAGE_KEY, JSON.stringify(data));
}

// Seed data — new schema: no `registered`, no `isoDate`, participants as ID arrays
const HOME_TOURNAMENTS_DEFAULT = [
  { id:'t1', level:'hard',   division:'Мужской', format:'King of the Court',
    name:'Открытый чемпионат — Мужской',
    date:'2026-03-15', time:'09:00', location:'Пляж «Золотые Пески»',
    capacity:30, prize:'₽50 000', status:'open',
    participants:[], waitlist:[], winners:[] },
  { id:'t2', level:'medium', division:'Женский', format:'Round Robin',
    name:'Весенний кубок — Женский',
    date:'2026-03-21', time:'10:00', location:'Центральный пляж',
    capacity:30, prize:'₽30 000', status:'full',
    participants:[], waitlist:[], winners:[] },
  { id:'t3', level:'easy',   division:'Микст',   format:'King of the Court',
    name:'Любительский турнир — Микст',
    date:'2026-03-22', time:'11:00', location:'Южный пляж',
    capacity:24, prize:'₽20 000', status:'open',
    participants:[], waitlist:[], winners:[] },
  { id:'t4', level:'hard',   division:'Мужской', format:'Олимпийская система',
    name:'Grand Prix — Мужской',
    date:'2026-03-28', time:'08:00', location:'Пляж «Авангард»',
    capacity:30, prize:'₽75 000', status:'open',
    participants:[], waitlist:[], winners:[] },
  { id:'t5', level:'medium', division:'Микст',   format:'Round Robin',
    name:'Апрельский кубок — Микст',
    date:'2026-04-05', time:'10:00', location:'Городской пляж',
    capacity:30, prize:'₽25 000', status:'full',
    participants:[], waitlist:[], winners:[] },
  { id:'t6', level:'easy',   division:'Женский', format:'King of the Court',
    name:'Открытый кубок — Женский',
    date:'2026-04-12', time:'09:30', location:'Пляж «Ривьера»',
    capacity:30, prize:'₽15 000', status:'open',
    participants:[], waitlist:[], winners:[] },
];

// ── Migration (runs every page load; Phase 1 is idempotent) ──
/**
 * Однократная миграция данных при загрузке страницы.
 * Phase 1: нормализует ID игроков к формату 'p_<ts>_<rand>' (идемпотентно).
 * Phase 2: консолидирует устаревшие ключи kotc3_upcoming + kotc3_past_manual
 *          в единый kotc3_tournaments (выполняется один раз при наличии старых данных).
 */
function migrateProjectData() {
  // Phase 1 — Normalize player IDs to string format "p_<ts>_<rand>"
  // Old IDs were numbers: Date.now() + Math.random() (float)
  const db = loadPlayerDB();
  let playersMigrated = false;
  db.forEach(p => {
    if (typeof p.id !== 'string' || !p.id.startsWith('p_')) {
      p.id = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      playersMigrated = true;
    }
  });
  if (playersMigrated) savePlayerDB(db);

  // Phase 2 — One-time tournament key consolidation (guarded: skip if done)
  if (localStorage.getItem(TRN_STORAGE_KEY)) return;

  const _parse = key => {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) { return []; }
  };

  /** Convert a legacy kotc3_upcoming record to new schema */
  const toNewTrn = t => ({
    id:       t.id ? String(t.id) : ('t_' + Date.now()),
    name:     t.name     || '',
    // isoDate was the real ISO field; old t.date was a display string
    date:     t.isoDate  || '',
    time:     t.time     || '',
    location: t.location || '',
    format:   t.format   || 'King of the Court',
    division: t.division === 'Смешанный' ? 'Микст' : (t.division || 'Мужской'),
    level:    ['hard','medium','easy'].includes(t.level) ? t.level : 'medium',
    capacity: Math.max(4, Number(t.capacity) || 24),
    prize:    t.prize    || '',
    status:   ['open','full','finished','cancelled'].includes(t.status)
                ? t.status
                : (Number(t.registered) >= Number(t.capacity) ? 'full' : 'open'),
    participants: [],
    waitlist:     [],
    winners:      [],
  });

  /** Convert a legacy kotc3_past_manual record to new schema */
  const toFinishedTrn = t => ({
    id:       String(t.id || ('t_' + Date.now())),
    name:     t.name   || '',
    // arch-inp-date is type="date" → value is already ISO format
    date:     t.date   || '',
    time: '', location: '',
    format:   t.format   || 'King of the Court',
    division: t.division === 'Смешанный' ? 'Микст' : (t.division || 'Мужской'),
    level:    'medium',
    capacity: t.playersCount || 0,
    prize:    '',
    status:   'finished',
    source:   'manual',
    participants: [],
    waitlist:     [],
    winners:      t.winner ? [t.winner] : [],
  });

  const upcoming   = _parse('kotc3_upcoming').map(toNewTrn);
  const pastManual = _parse('kotc3_past_manual').map(toFinishedTrn);
  const merged     = [...upcoming, ...pastManual];

  // If both legacy stores were empty, seed with defaults
  saveTournaments(merged.length ? merged : HOME_TOURNAMENTS_DEFAULT.map(t => ({...t})));

  // Remove legacy keys after successful migration
  localStorage.removeItem('kotc3_upcoming');
  localStorage.removeItem('kotc3_past_manual');
}

// ── Backward-compat shims (home screen render uses these) ─────
/** Non-finished tournaments with computed `registered` for old home render */
function loadUpcomingTournaments() {
  const today = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
  const MON_NAMES_SHORT = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                           'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  return getTournaments()
    .filter(t => t.status !== 'finished' && t.status !== 'cancelled')
    .filter(t => !t.date || t.date >= today) // скрываем прошедшие с главной
    .map(t => {
      const d = t.date ? new Date(t.date + 'T12:00:00') : null;
      return {
        ...t,
        registered: t.participants.length,
        dayNum: d ? d.getDate() : '',
        dayStr: d ? _TRN_DAY_NAMES[d.getDay()] : '',
        month:  d ? MON_NAMES_SHORT[d.getMonth()] + ' ' + d.getFullYear() : '',
      };
    });
}
/** Finished tournaments in the legacy manual-archive shape */
function loadManualTournaments() {
  const pMap = new Map(); loadPlayerDB().forEach(p => pMap.set(p.id, p));
  return getTournaments()
    .filter(t => t.status === 'finished')
    .map(t => {
      // Resolve winner name from structured winners array
      let winnerName = '';
      const w0 = t.winners?.[0];
      if (typeof w0 === 'string') winnerName = w0;
      else if (w0?.playerIds?.[0]) winnerName = pMap.get(w0.playerIds[0])?.name || '';
      // Build playerResults for medal display
      const pResults = (t.winners || [])
        .filter(w => typeof w === 'object' && w.playerIds?.length)
        .flatMap(w => w.playerIds.map(pid => ({
          name: pMap.get(pid)?.name || '?', pts: w.points, place: w.place
        })));
      return {
        id: t.id, name: t.name, date: t.date,
        format: t.format, division: t.division,
        source: t.source || 'manual',
        playersCount: t.participants?.length || 0,
        winner: winnerName,
        playerResults: pResults,
      };
    });
}
/** Replaces all finished entries in the store (called by home archive CRUD) */
function saveManualTournaments(manualRecords) {
  const nonFinished = getTournaments().filter(t => t.status !== 'finished');
  const finished = manualRecords.map(t => ({
    id:       String(t.id || ('t_' + Date.now())),
    name:     t.name || '',
    date:     t.date || '',
    time: '', location: '',
    format:   t.format   || 'King of the Court',
    division: t.division === 'Смешанный' ? 'Микст' : (t.division || 'Мужской'),
    level: 'medium', capacity: t.playersCount || 0, prize: '',
    status: 'finished', source: t.source || 'manual',
    participants: [], waitlist: [], winners: t.winner ? [t.winner] : [],
  }));
  saveTournaments([...nonFinished, ...finished]);
}

// Run migration before anything else touches tournament data
migrateProjectData();
