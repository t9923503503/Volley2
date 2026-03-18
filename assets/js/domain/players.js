'use strict';

// Player store and roster sync helpers.
// Внутри приложения все игроки имеют один формат (canonical). Совместимость со старым
// localStorage и с полями Supabase (total_pts, tournaments_played) — только в адаптерах ниже.
// Canonical frontend player shape (normalized):
// {
//   id: string|number,
//   name: string,
//   gender: 'M'|'W',
//   status: string,           // 'active' | 'temporary' | etc.
//   addedAt: string,          // 'YYYY-MM-DD'
//   tournaments: number,
//   totalPts: number,
//   wins: number,
//   ratingM: number,
//   ratingW: number,
//   ratingMix: number,
//   tournamentsM: number,
//   tournamentsW: number,
//   tournamentsMix: number,
//   lastSeen: string
// }

/**
 * Нормализует сырую запись игрока (из localStorage или Supabase) в канонический формат.
 * Поддерживает как camelCase-поля (frontend), так и snake_case (Supabase API).
 * @param {object} raw  Сырой объект. Может содержать: name|full_name|display_name,
 *                      totalPts|total_pts, tournaments|tournaments_played, lastSeen|last_seen
 * @returns {object|null} Канонический объект игрока или null при невалидном input
 */
function fromLocalPlayer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id != null ? raw.id : (raw.player_id != null ? raw.player_id : (Date.now() + Math.random()));
  const name = (raw.name || raw.full_name || raw.display_name || '').trim();
  const gender = raw.gender === 'W' ? 'W' : 'M';
  const status = raw.status || 'active';
  const addedAt = raw.addedAt || raw.created_at || new Date().toISOString().split('T')[0];

  const tournaments =
    raw.tournaments != null ? raw.tournaments :
    raw.tournaments_played != null ? raw.tournaments_played : 0;

  const totalPts =
    raw.totalPts != null ? raw.totalPts :
    raw.total_pts != null ? raw.total_pts : 0;

  const wins = raw.wins != null ? raw.wins : 0;

  const ratingM     = raw.ratingM     != null ? raw.ratingM     : 0;
  const ratingW     = raw.ratingW     != null ? raw.ratingW     : 0;
  const ratingMix   = raw.ratingMix   != null ? raw.ratingMix   : 0;
  const tournamentsM   = raw.tournamentsM   != null ? raw.tournamentsM   : 0;
  const tournamentsW   = raw.tournamentsW   != null ? raw.tournamentsW   : 0;
  const tournamentsMix = raw.tournamentsMix != null ? raw.tournamentsMix : 0;

  const lastSeen = raw.lastSeen || raw.last_seen || '';

  // IPT stats (optional; computed via recalcAllPlayerStats)
  const iptWins =
    raw.iptWins != null ? raw.iptWins : 0;
  const iptDiff =
    raw.iptDiff != null ? raw.iptDiff : 0;
  const iptPts =
    raw.iptPts != null ? raw.iptPts : 0;
  const iptMatches =
    raw.iptMatches != null ? raw.iptMatches : 0;

  return {
    id,
    name,
    gender,
    status,
    addedAt,
    tournaments,
    totalPts,
    wins,
    ratingM,
    ratingW,
    ratingMix,
    tournamentsM,
    tournamentsW,
    tournamentsMix,
    lastSeen,
    iptWins,
    iptDiff,
    iptPts,
    iptMatches,
  };
}

function toLocalPlayer(player) {
  // For now we persist the canonical shape 1:1.
  // If we ever need to change storage schema, this is the only place.
  return { ...player };
}

// Supabase row → canonical player
function fromSupabasePlayer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // Reuse local adapter where possible, but Supabase often uses *_played / total_pts fields.
  const base = fromLocalPlayer(raw);
  if (!base) return null;
  // Preserve Supabase-specific status if present.
  base.status = raw.status || base.status || 'active';
  return base;
}

let _playerDbCache = null;
let _playerDbCacheTs = 0;

/**
 * Загружает базу игроков из localStorage с кешированием.
 * Кеш инвалидируется при изменении `kotc3_playerdb_ts`.
 * @returns {object[]} Массив канонических объектов игроков (может быть [])
 */
function loadPlayerDB() {
  const ts = +(localStorage.getItem('kotc3_playerdb_ts') || 0);
  if (_playerDbCache && ts === _playerDbCacheTs) return _playerDbCache;
  try {
    const raw = JSON.parse(localStorage.getItem('kotc3_playerdb') || '[]');
    if (!Array.isArray(raw)) { _playerDbCache = []; _playerDbCacheTs = ts; return []; }
    _playerDbCache = raw.map(fromLocalPlayer).filter(Boolean);
    _playerDbCacheTs = ts;
    return _playerDbCache;
  } catch(e){
    return [];
  }
}
/**
 * Сохраняет базу игроков в localStorage и инвалидирует кеш.
 * @param {object[]} db Массив канонических объектов игроков
 */
function savePlayerDB(db) {
  const ts = Date.now();
  localStorage.setItem('kotc3_playerdb', JSON.stringify((db || []).map(toLocalPlayer)));
  localStorage.setItem('kotc3_playerdb_ts', String(ts));
  _playerDbCache = null; // invalidate cache
}
function remapPlayerIdInTournaments(oldId, newId) {
  if (oldId === newId) return;
  const arr = getTournaments();
  let changed = false;
  const mapIds = ids => {
    if (!Array.isArray(ids)) return ids;
    let localChanged = false;
    const next = ids.map(id => {
      if (id === oldId) { localChanged = true; return newId; }
      return id;
    });
    changed = changed || localChanged;
    return next;
  };
  arr.forEach(t => {
    t.participants = mapIds(t.participants);
    t.waitlist     = mapIds(t.waitlist);
    if (Array.isArray(t.winners)) {
      t.winners = t.winners.map(w => {
        if (!w || typeof w !== 'object' || !Array.isArray(w.playerIds)) return w;
        return { ...w, playerIds: mapIds(w.playerIds) };
      });
    }
    if (Array.isArray(t.history)) {
      t.history = t.history.map(entry => {
        if (!entry || typeof entry !== 'object') return entry;
        if (!Array.isArray(entry.winnersSnapshot)) return entry;
        return {
          ...entry,
          winnersSnapshot: entry.winnersSnapshot.map(w => {
            if (!w || typeof w !== 'object' || !Array.isArray(w.playerIds)) return w;
            return { ...w, playerIds: mapIds(w.playerIds) };
          })
        };
      });
    }
  });
  if (changed) saveTournaments(arr);
}
/**
 * Создаёт или обновляет игрока в базе.
 * Поиск: сначала по id, затем по name+gender (регистронезависимо).
 * @param {object} player Объект с полями игрока (частичный или полный)
 * @returns {object|null} Обновлённый/созданный канонический объект или null при ошибке
 */
function upsertPlayerInDB(player) {
  const canonical = fromLocalPlayer(player || {});
  const name   = canonical.name;
  const gender = canonical.gender;
  if (!name) return null;

  const db = loadPlayerDB();
  let existing = player.id != null ? db.find(p => String(p.id) === String(player.id)) : null;
  if (!existing) {
    existing = db.find(p => p.name.toLowerCase() === name.toLowerCase() && p.gender === gender);
  }

  if (existing) {
    const oldId = existing.id;
    if (canonical.id != null) existing.id = canonical.id;
    existing.name   = name;
    existing.gender = gender;
    if (canonical.status) existing.status = canonical.status;
    if (canonical.addedAt) existing.addedAt = canonical.addedAt;
    if (canonical.tournaments != null) existing.tournaments = canonical.tournaments;
    if (canonical.totalPts != null)    existing.totalPts    = canonical.totalPts;
    if (canonical.wins != null)        existing.wins        = canonical.wins;
    if (canonical.lastSeen != null)    existing.lastSeen    = canonical.lastSeen;
    ['ratingM','ratingW','ratingMix','tournamentsM','tournamentsW','tournamentsMix']
      .forEach(key => {
        if (canonical[key] != null) existing[key] = canonical[key];
        else if (existing[key] == null) existing[key] = 0;
      });
    if (existing.addedAt == null) existing.addedAt = new Date().toISOString().split('T')[0];
    if (existing.tournaments == null) existing.tournaments = 0;
    if (existing.totalPts == null) existing.totalPts = 0;
    if (existing.wins == null) existing.wins = 0;

    savePlayerDB(db);
    if (oldId !== existing.id) remapPlayerIdInTournaments(oldId, existing.id);
    return existing;
  }

  const created = {
    id: canonical.id ?? (Date.now() + Math.random()),
    name,
    gender,
    status: canonical.status || 'active',
    addedAt: canonical.addedAt || new Date().toISOString().split('T')[0],
    tournaments: canonical.tournaments ?? 0,
    totalPts: canonical.totalPts ?? 0,
    wins: canonical.wins ?? 0,
    ratingM: canonical.ratingM ?? 0,
    ratingW: canonical.ratingW ?? 0,
    ratingMix: canonical.ratingMix ?? 0,
    tournamentsM: canonical.tournamentsM ?? 0,
    tournamentsW: canonical.tournamentsW ?? 0,
    tournamentsMix: canonical.tournamentsMix ?? 0,
    lastSeen: canonical.lastSeen || '',
  };
  db.push(created);
  savePlayerDB(db);
  return created;
}
/**
 * Добавляет нового игрока в базу (без дубликатов).
 * @param {string} name   Фамилия игрока (1–50 символов)
 * @param {'M'|'W'} gender Пол
 * @returns {boolean} true если добавлен, false если дубликат или невалидные данные
 */
function addPlayerToDB(name, gender) {
  name = name.trim();
  if (!name || name.length > 50) return false;
  const db = loadPlayerDB();
  if (db.find(p => p.name.toLowerCase() === name.toLowerCase() && p.gender === gender)) return false;
  db.push({ id: Date.now() + Math.random(), name, gender,
            addedAt: new Date().toISOString().split('T')[0],
            tournaments: 0, totalPts: 0, wins: 0,
            ratingM: 0, ratingW: 0, ratingMix: 0,
            tournamentsM: 0, tournamentsW: 0, tournamentsMix: 0,
            lastSeen: '' });
  savePlayerDB(db);
  return true;
}
function removePlayerFromDB(id) {
  const db = loadPlayerDB().filter(p => p.id !== id);
  savePlayerDB(db);
}
/**
 * Вызывается при завершении турнира — обновляет статистику всех участников.
 * Если игрок не найден в базе — создаёт новую запись.
 * @param {{ name: string, gender: 'M'|'W', totalPts: number }[]} players
 * @param {string} date  ISO дата турнира (YYYY-MM-DD)
 */
function syncPlayersFromTournament(players, date) {
  const db = loadPlayerDB();
  players.forEach(p => {
    const existing = db.find(d => d.name.toLowerCase() === p.name.toLowerCase() && d.gender === p.gender);
    if (existing) {
      existing.tournaments = (existing.tournaments || 0) + 1;
      existing.totalPts    = (existing.totalPts    || 0) + (p.totalPts || 0);
      existing.lastSeen    = date;
    } else {
      const created = fromLocalPlayer({
        name: p.name,
        gender: p.gender,
        addedAt: date,
        tournaments: 1,
        totalPts: p.totalPts || 0,
        lastSeen: date,
      });
      if (!created.id) created.id = Date.now() + Math.random();
      db.push(created);
    }
  });
  savePlayerDB(db);
}
// Import names currently in the roster inputs (without score data)
function syncPlayersFromRoster() {
  const date = new Date().toISOString().split('T')[0];
  let added = 0;
  for (let ci = 0; ci < nc; ci++) {
    ALL_COURTS[ci].men.forEach(n => { if (n.trim() && addPlayerToDB(n.trim(), 'M')) added++; });
    ALL_COURTS[ci].women.forEach(n => { if (n.trim() && addPlayerToDB(n.trim(), 'W')) added++; });
  }
  return added;
}
