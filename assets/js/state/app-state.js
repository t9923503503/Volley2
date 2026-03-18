'use strict';
// ════════════════════════════════════════════════════════════
// 1. STATE
// ════════════════════════════════════════════════════════════
// ppc  = players per court (4 or 5)
// nc   = number of active courts (1..4)
let ppc = 5;
let nc  = 3;
let fixedPairs = false;  // режим фиксированных пар — напарник не меняется
const courtRound = [0, 0, 0, 0]; // текущий отображаемый раунд для каждого корта
const divRoundState = { hard:0, advance:0, medium:0, lite:0 }; // текущий раунд дивизиона
// Индекс таймера для каждого дивизиона (slots 4-7)
const DIV_TIMER_IDX = { hard:4, advance:5, medium:6, lite:7 };

// ── Tournament meta ─────────────────────────────────────────
let tournamentMeta    = { name: '', date: '' };
let tournamentHistory = [];   // Лента событий (макс. 450 записей)
let historyFilter = 'all';    // 'all' | 'k0'..'k3' | 'hard'|'advance'|'medium'|'lite'
let svodGenderFilter  = 'all'; // 'all' | 'M' | 'W'

// pending values while user fiddles with seg buttons (not yet applied)
let _ppc = ppc;
let _nc  = nc;

const COURT_META = [
  { name:'👑 КОРТ 1', color:'#FFD700' },
  { name:'🔵 КОРТ 2', color:'#4DA8DA' },
  { name:'🟢 КОРТ 3', color:'#6ABF69' },
  { name:'🟣 КОРТ 4', color:'#C77DFF' },
];

// ALL_COURTS[ci] = {men:[...], women:[...]}  always length 5
const ALL_COURTS = [
  { men:['Яковлев','Жидков','Алик','Куанбеков','Юшманов'],
    women:['Лебедева','Чемерис В','Настя НМ','Сайдуллина','Маргарита'] },
  { men:['Обухов','Соболев','Иванов','Грузин','Шперлинг'],
    women:['Шперлинг','Шерметова','Сабанцева','Микишева','Базутова'] },
  { men:['Сайдуллин','Лебедев','Камалов','Привет','Анашкин'],
    women:['Носкова','Арефьева','Кузьмина','Яковлева','Маша Привет'] },
  { men:['Игрок М1','Игрок М2','Игрок М3','Игрок М4','Игрок М5'],
    women:['Игрок Ж1','Игрок Ж2','Игрок Ж3','Игрок Ж4','Игрок Ж5'] },
];

// scores[ci][mi][ri] — allocated dynamically based on nc × ppc
let scores = makeBlankScores();
// Timestamps for smart merge (race condition prevention)
let scoreTs = {}; // { 'c0': ms, 'c1': ms, 'hard': ms, ... }
/**
 * Создаёт пустую матрицу очков для 4 кортов.
 * scores[courtIndex][playerIndex][roundIndex] = null | number
 * @returns {Array} 4×ppc×ppc матрица, заполненная null
 */
function makeBlankScores() {
  return Array.from({length:4}, () =>
    Array.from({length:ppc}, () => Array(ppc).fill(null))
  );
}

// Division state
const DIV_KEYS = ['hard','advance','medium','lite'];

// Активные дивизионы зависят от числа кортов
// nc=1→[hard], nc=2→[hard,lite], nc=3→[hard,medium,lite], nc=4→все
/**
 * Возвращает список активных ключей дивизионов в зависимости от числа кортов (nc).
 * nc=1→['hard'], nc=2→['hard','lite'], nc=3→['hard','medium','lite'], nc=4→все 4
 * @returns {string[]} Подмножество ['hard','advance','medium','lite']
 */
function activeDivKeys() {
  if (nc <= 1) return ['hard'];
  if (nc === 2) return ['hard','lite'];
  if (nc === 3) return ['hard','medium','lite'];
  return ['hard','advance','medium','lite'];
}

let divScores = makeBlankDivScores();
let divRoster = makeBlankDivRoster();
function makeBlankDivScores(){
  const o={};
  DIV_KEYS.forEach(k=>{ o[k]=Array.from({length:5},()=>Array(5).fill(null)); });
  return o;
}
function makeBlankDivRoster(){
  const o={};
  DIV_KEYS.forEach(k=>{ o[k]={men:[],women:[]}; });
  return o;
}

let activeTabId = 0;  // current tab id (number = court index, or string)

// ── HOME DASHBOARD STATE ────────────────────────────────────
let homeActiveTab = 'schedule';   // 'schedule' | 'calendar' | 'archive'
let homeArchiveFormOpen = false;
let homeArchiveFormPlayers = [];   // [{name, pts, gender}]
let homeArchiveFormGender  = 'M';  // default gender for next player

// ── ARCHIVE FILTERS STATE ─────────────────────────────────
let archiveSearch = '';
let archiveSort   = 'date_desc'; // 'date_desc' | 'date_asc' | 'players' | 'pts'

// ── PLAYER DATABASE STATE ───────────────────────────────────
let playersGender = 'M';
let playersSearch = '';
let playersSort   = 'pts'; // 'pts' | 'avg' | 'trn'

// ── RATING SYSTEM — Professional Points ─────────────────────
const POINTS_TABLE = [
  100,90,82,76,70,65,60,56,52,48,  // 1-10  (HARD зона)
  44,42,40,38,36,34,32,30,28,26,   // 11-20 (MEDIUM зона)
  24,22,20,18,16,14,12,10,8,7,     // 21-30
  6,5,4,3,2,2,1,1,1,1              // 31-40 (LITE зона)
];
/**
 * Возвращает рейтинговые очки за место в турнире по таблице POINTS_TABLE.
 * @param {number} place Занятое место (1 = победитель)
 * @returns {number} Рейтинговые очки (минимум 1)
 */
function calculateRanking(place) {
  if (place < 1 || place > POINTS_TABLE.length) return 1;
  return POINTS_TABLE[place - 1];
}
function getPlayerZone(rank) {
  if (rank <= 10) return 'hard';
  if (rank <= 20) return 'medium';
  return 'lite';
}
/**
 * Преобразует название дивизиона в тип рейтинга для Supabase.
 * @param {string} division Например: 'Мужской', 'Женский', 'Микст', 'Смешанный'
 * @returns {'M'|'W'|'Mix'}
 */
function divisionToType(division) {
  if (!division) return 'M';
  const d = division.toLowerCase();
  if (d.includes('женск')) return 'W';
  if (d.includes('микст') || d.includes('смешан')) return 'Mix';
  return 'M';
}

// ════════════════════════════════════════════════════════════
// AppState — структурированный namespace для чтения состояния.
// Все оригинальные глобальные переменные остаются на месте
// (обратная совместимость с 28 модулями).
// AppState предоставляет единую точку входа для диагностики
// и будущей миграции к управляемому состоянию.
// ════════════════════════════════════════════════════════════
const AppState = {
  /** Настройки турнира */
  get config()   { return { ppc, nc, fixedPairs }; },
  /** Мета-данные текущего турнира */
  get meta()     { return { ...tournamentMeta }; },
  /** Активные ключи дивизионов */
  get divKeys()  { return activeDivKeys(); },
  /** Текущий id активного таба */
  get activeTab(){ return activeTabId; },
  /** Состояние фильтров игроков */
  get players()  { return { gender: playersGender, search: playersSearch, sort: playersSort }; },
  /** Состояние фильтров архива */
  get archive()  { return { search: archiveSearch, sort: archiveSort }; },
  /** Возвращает roster корта по индексу (read-only копия) */
  courtRoster(ci) {
    const c = ALL_COURTS[ci];
    if (!c) return null;
    return { men: [...c.men], women: [...c.women] };
  },
  /** Снимок всего состояния для отладки (вызвать AppState.snapshot() в DevTools) */
  snapshot() {
    return {
      config:  this.config,
      meta:    this.meta,
      divKeys: this.divKeys,
      players: this.players,
      archive: this.archive,
      courts:  ALL_COURTS.map((c, i) => ({ index: i, ...this.courtRoster(i) })),
    };
  },
};
