// DEPRECATED: этот файл разбит на модули в integrations/.
// Используются: supabase.js, admin.js, google-sheets.js, export.js
// Этот файл больше не загружается (удалён из main.js и sw.js).
'use strict';

// ════════════════════════════════════════════════════════════
// SUPABASE SYNC MODULE
// Безопасная комнатная синхронизация через room_code + room_secret
// ════════════════════════════════════════════════════════════
let sbConfig = { ...DEFAULT_SB_CONFIG };
let sbClient  = null;    // Supabase client instance
let sbStatus  = 'idle';  // idle | connecting | live | offline
let sbIsApplying = false; // prevent echo loop when we apply remote state
let sbSaveTimer  = null;  // debounce remote saves
let sbPollTimer  = null;  // polling interval fallback
let sbIsPolling  = false;
let sbLastRemoteUpdatedAt = '';
let sbRealtimeChannel = null;  // Supabase Broadcast channel
let sbRealtimeFailed  = false; // true when Realtime is unavailable → use polling
const SB_POLL_MS      = 1500;
const SB_POLL_MAX_MS  = 30000; // max backoff for polling fallback
let   sbPollCurrentMs = SB_POLL_MS;
const SB_SYNC_SQL = String.raw`-- ============================================================
-- SECURE ROOM SYNC FOR KOTC
-- Комната защищена secret'ом. Прямой SELECT/UPDATE по таблице закрыт.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS kotc_sessions (
  room_code         TEXT PRIMARY KEY,
  room_secret_hash  TEXT NOT NULL,
  state             JSONB DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE kotc_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kotc_sessions_select ON kotc_sessions;
DROP POLICY IF EXISTS kotc_sessions_insert ON kotc_sessions;
DROP POLICY IF EXISTS kotc_sessions_update ON kotc_sessions;

REVOKE ALL ON TABLE kotc_sessions FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION room_secret_sha256(p_secret TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(digest(coalesce(p_secret, ''), 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION create_room(
  p_room_code     TEXT,
  p_room_secret   TEXT,
  p_initial_state JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_code TEXT := upper(trim(coalesce(p_room_code, '')));
  v_secret TEXT := trim(coalesce(p_room_secret, ''));
  v_row kotc_sessions%ROWTYPE;
BEGIN
  IF v_code = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROOM_CODE_REQUIRED', 'message', 'Укажите код комнаты');
  END IF;
  IF length(v_secret) < 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROOM_SECRET_SHORT', 'message', 'Секрет комнаты должен быть не короче 6 символов');
  END IF;

  SELECT * INTO v_row FROM kotc_sessions WHERE room_code = v_code FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO kotc_sessions (room_code, room_secret_hash, state)
    VALUES (v_code, room_secret_sha256(v_secret), coalesce(p_initial_state, '{}'::jsonb))
    RETURNING * INTO v_row;

    RETURN jsonb_build_object(
      'ok', true,
      'created', true,
      'room_code', v_row.room_code,
      'state', v_row.state,
      'updated_at', v_row.updated_at,
      'message', 'Комната создана'
    );
  END IF;

  IF v_row.room_secret_hash <> room_secret_sha256(v_secret) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'ROOM_SECRET_MISMATCH',
      'message', 'Неверный секрет комнаты'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'created', false,
    'room_code', v_row.room_code,
    'state', v_row.state,
    'updated_at', v_row.updated_at,
    'message', 'Комната подключена'
  );
END;
$$;

CREATE OR REPLACE FUNCTION get_room_state(
  p_room_code   TEXT,
  p_room_secret TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row kotc_sessions%ROWTYPE;
  v_code TEXT := upper(trim(coalesce(p_room_code, '')));
  v_secret TEXT := trim(coalesce(p_room_secret, ''));
BEGIN
  SELECT * INTO v_row FROM kotc_sessions WHERE room_code = v_code;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROOM_NOT_FOUND', 'message', 'Комната не найдена');
  END IF;
  IF v_row.room_secret_hash <> room_secret_sha256(v_secret) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROOM_SECRET_MISMATCH', 'message', 'Неверный секрет комнаты');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'room_code', v_row.room_code,
    'state', v_row.state,
    'updated_at', v_row.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION push_room_state(
  p_room_code   TEXT,
  p_room_secret TEXT,
  p_state       JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row kotc_sessions%ROWTYPE;
  v_code TEXT := upper(trim(coalesce(p_room_code, '')));
  v_secret TEXT := trim(coalesce(p_room_secret, ''));
BEGIN
  SELECT * INTO v_row FROM kotc_sessions WHERE room_code = v_code FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROOM_NOT_FOUND', 'message', 'Комната не найдена');
  END IF;
  IF v_row.room_secret_hash <> room_secret_sha256(v_secret) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROOM_SECRET_MISMATCH', 'message', 'Неверный секрет комнаты');
  END IF;

  UPDATE kotc_sessions
     SET state = coalesce(p_state, '{}'::jsonb),
         updated_at = now()
   WHERE room_code = v_code
   RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'updated_at', v_row.updated_at,
    'message', 'Состояние комнаты сохранено'
  );
END;
$$;

CREATE OR REPLACE FUNCTION rotate_room_secret(
  p_room_code        TEXT,
  p_room_secret      TEXT,
  p_new_room_secret  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row kotc_sessions%ROWTYPE;
  v_code TEXT := upper(trim(coalesce(p_room_code, '')));
  v_secret TEXT := trim(coalesce(p_room_secret, ''));
  v_new_secret TEXT := trim(coalesce(p_new_room_secret, ''));
BEGIN
  IF length(v_new_secret) < 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROOM_SECRET_SHORT', 'message', 'Новый секрет должен быть не короче 6 символов');
  END IF;

  SELECT * INTO v_row FROM kotc_sessions WHERE room_code = v_code FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROOM_NOT_FOUND', 'message', 'Комната не найдена');
  END IF;
  IF v_row.room_secret_hash <> room_secret_sha256(v_secret) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROOM_SECRET_MISMATCH', 'message', 'Неверный текущий секрет');
  END IF;

  UPDATE kotc_sessions
     SET room_secret_hash = room_secret_sha256(v_new_secret),
         updated_at = now()
   WHERE room_code = v_code
   RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'updated_at', v_row.updated_at,
    'message', 'Секрет комнаты обновлён'
  );
END;
$$;

REVOKE ALL ON FUNCTION room_secret_sha256(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_room(TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_room_state(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION push_room_state(TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION rotate_room_secret(TEXT, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION create_room(TEXT, TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_room_state(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION push_room_state(TEXT, TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rotate_room_secret(TEXT, TEXT, TEXT) TO anon, authenticated;`;

function sbNormalizeRoomCode(value) {
  return (value || '').toUpperCase().trim();
}
function sbEnsureClient() {
  if (sbClient) return sbClient;
  if (typeof supabase !== 'undefined' && sbConfig.url && sbConfig.anonKey) {
    sbClient = supabase.createClient(sbConfig.url, sbConfig.anonKey);
    return sbClient;
  }
  return null;
}
function sbCompareTs(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return new Date(a).getTime() - new Date(b).getTime();
}
function sbRandomSecret() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return chars.match(/.{1,4}/g).join('-');
}

function sbLoadConfig() {
  try {
    const c = localStorage.getItem('kotc3_sb');
    if (c) sbConfig = { ...sbConfig, ...JSON.parse(c) };
  } catch(e) { console.warn('[sbLoadConfig] Config parse error:', e); }
  sbConfig.roomCode = sbNormalizeRoomCode(sbConfig.roomCode);
  sbConfig.roomSecret = (sbConfig.roomSecret || '').trim();
}
async function syncPendingPlayerRequests() {
  if (!_regSb()) return { synced: 0, remaining: 0 };
  let queue = [];
  try { queue = JSON.parse(localStorage.getItem('kotc3_player_requests') || '[]'); } catch(e) {}
  if (!queue.length) return { synced: 0, remaining: 0 };

  let synced = 0;
  const remaining = [];
  for (const item of queue) {
    try {
      const { data, error } = await _regSb().rpc('submit_player_request', {
        p_name:          item.name,
        p_gender:        item.gender,
        p_phone:         item.phone || null,
        p_tournament_id: item.trnId || null
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.message || data?.error || 'Ошибка RPC');
      synced++;
    } catch (err) {
      remaining.push(item);
    }
  }
  localStorage.setItem('kotc3_player_requests', JSON.stringify(remaining));
  if (synced > 0) {
    showToast('📝 Отправлено локальных заявок: ' + synced);
  }
  return { synced, remaining: remaining.length };
}

function sbSaveConfig() {
  sbConfig.roomCode = sbNormalizeRoomCode(sbConfig.roomCode);
  sbConfig.roomSecret = (sbConfig.roomSecret || '').trim();
  localStorage.setItem('kotc3_sb', JSON.stringify(sbConfig));
}
function sbGenerateSecret(refresh = true) {
  sbConfig.roomSecret = sbRandomSecret();
  sbSaveConfig();
  if (refresh) sbRefreshCard();
  return sbConfig.roomSecret;
}
function sbCopyAccess() {
  if (!sbConfig.roomCode || !sbConfig.roomSecret) {
    showToast('⚠️ Укажите код и секрет комнаты');
    return;
  }
  const payload = `Код комнаты: ${sbConfig.roomCode}\nСекрет комнаты: ${sbConfig.roomSecret}`;
  navigator.clipboard?.writeText(payload).then(() => showToast('✅ Доступ к комнате скопирован'));
}
function sbStopPolling() {
  if (sbPollTimer) clearInterval(sbPollTimer);
  sbPollTimer = null;
  sbIsPolling = false;
  sbPollCurrentMs = SB_POLL_MS;
}

function sbStartPollingFallback() {
  sbStopPolling();
  sbPollTimer = setInterval(() => { sbPollOnce(); }, sbPollCurrentMs);
}

// ── Supabase Realtime Broadcast ──────────────────────────
function sbStartRealtime() {
  sbStopRealtime();
  if (!sbClient || !sbConfig.roomCode) return;
  try {
    sbRealtimeChannel = sbClient
      .channel('room:' + sbConfig.roomCode)
      .on('broadcast', { event: 'state_updated' }, () => {
        // Signal received — fetch actual state via secure RPC
        sbPollOnce();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Realtime is working — stop/slow polling as redundant safety net only
          sbRealtimeFailed = false;
          sbPollCurrentMs = 15000; // check every 15s as fallback only
          sbStartPollingFallback();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Realtime failed — fall back to faster polling
          console.warn('[Realtime] Channel error, falling back to polling');
          sbRealtimeFailed = true;
          sbPollCurrentMs = SB_POLL_MS;
          sbStartPollingFallback();
        }
      });
  } catch (e) {
    console.warn('[Realtime] Init error, falling back to polling:', e);
    sbRealtimeFailed = true;
    sbPollCurrentMs = SB_POLL_MS;
    sbStartPollingFallback();
  }
}

function sbStopRealtime() {
  if (sbRealtimeChannel) {
    try { sbClient?.removeChannel(sbRealtimeChannel); } catch(e) {}
    sbRealtimeChannel = null;
  }
  sbRealtimeFailed = false;
}

function sbStartPolling() {
  // Try Realtime first; it falls back to polling internally
  sbStartRealtime();
}

window.addEventListener('beforeunload', () => { sbStopPolling(); sbStopRealtime(); clearTimeout(sbSaveTimer); });
async function sbPollOnce() {
  if (!sbEnsureClient() || sbStatus !== 'live' || sbIsApplying || sbIsPolling) return;
  sbIsPolling = true;
  try {
    const { data, error } = await sbClient.rpc('get_room_state', {
      p_room_code:   sbConfig.roomCode,
      p_room_secret: sbConfig.roomSecret
    });
    if (error) throw error;
    if (!data?.ok) {
      if (data?.error === 'ROOM_SECRET_MISMATCH' || data?.error === 'ROOM_NOT_FOUND') {
        sbSetStatus('offline');
        sbStopPolling();
        showToast('❌ ' + (data.message || 'Доступ к комнате потерян'));
        sbRefreshCard();
      }
      return;
    }

    if (sbCompareTs(data.updated_at, sbLastRemoteUpdatedAt) > 0) {
      sbLastRemoteUpdatedAt = data.updated_at || sbLastRemoteUpdatedAt;
      if (data.state) sbApplyRemoteState(data.state);
    }
  } catch (e) {
    console.warn('Supabase poll error:', e);
    sbSetStatus('offline');
    sbStopPolling();
    sbRefreshCard();
  } finally {
    sbIsPolling = false;
  }
}

function sbSetStatus(s) {
  sbStatus = s;
  // Update dot in roster card if visible
  document.querySelectorAll('.sb-dot').forEach(d => {
    d.className = 'sb-dot ' + s;
  });
  document.querySelectorAll('.sb-status-text').forEach(el => {
    el.textContent = {
      idle:        '⬤ Не подключено',
      connecting:  '⬤ Подключение...',
      live:        '⬤ Синхронизация активна',
      offline:     '⬤ Ошибка соединения',
    }[s] || s;
    el.style.color = {idle:'#555',connecting:'#f5a623',live:'#3ecf8e',offline:'#e94560'}[s]||'#555';
  });
  document.querySelectorAll('.sb-room-badge').forEach(el => {
    el.textContent = s === 'live' ? (sbConfig.roomCode || '') : '';
  });
}

// ── Connect ──────────────────────────────────────────────
async function sbConnect() {
  if (!sbNormalizeRoomCode(sbConfig.roomCode)) {
    showToast('⚠️ Введите код комнаты'); return;
  }
  if (!(sbConfig.roomSecret || '').trim()) {
    showToast('⚠️ Введите секрет комнаты'); return;
  }
  sbStopPolling();
  clearTimeout(sbSaveTimer);
  sbClient = sbEnsureClient();
  if (!sbClient) {
    sbSetStatus('offline');
    showToast('Синхронизация недоступна: Supabase не загружен (проверьте сеть или блокировку скриптов)');
    sbRefreshCard();
    return;
  }
  sbSetStatus('connecting');
  try {
    const { data, error } = await sbClient.rpc('create_room', {
      p_room_code:     sbConfig.roomCode,
      p_room_secret:   sbConfig.roomSecret,
      p_initial_state: sbGetLocalState()
    });
    if (error) throw error;
    if (!data?.ok) {
      sbSetStatus('offline');
      showToast('❌ ' + (data.message || data.error || 'Ошибка синхронизации'));
      sbRefreshCard();
      return;
    }

    sbLastRemoteUpdatedAt = data.updated_at || '';
    if (!data.created && data.state) {
      sbApplyRemoteState(data.state);
      showToast('📥 ' + (data.message || 'Состояние комнаты загружено'));
    } else {
      showToast('🟢 ' + (data.message || 'Комната создана') + ' — сохраните код и секрет');
    }

    sbSetStatus('live');
    sbStartPolling();
    try { await syncPendingPlayerRequests(); } catch(e) { console.warn('[sbConnect] syncPending failed:', e); }
    sbRefreshCard();
  } catch(e) {
    sbSetStatus('offline');
    const msg = e.message || '';
    if (msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network') || msg.toLowerCase().includes('failed') || msg.toLowerCase().includes('functions')) {
      showToast('❌ Нет соединения или не применена миграция для комнат');
    } else {
      showToast('❌ Ошибка: ' + msg);
    }
    sbRefreshCard();
  }
}

function sbCopySql() {
  navigator.clipboard?.writeText(SB_SYNC_SQL).then(() => showToast('✅ SQL для комнатной синхронизации скопирован'));
}
async function sbRotateSecret() {
  if (sbStatus !== 'live') {
    showToast('⚠️ Сначала подключитесь к комнате');
    return;
  }
  if (!await showConfirm('Сгенерировать новый секрет комнаты?\nСтарый секрет перестанет работать на других устройствах.')) return;

  const nextSecret = sbRandomSecret();
  try {
    const { data, error } = await sbClient.rpc('rotate_room_secret', {
      p_room_code:       sbConfig.roomCode,
      p_room_secret:     sbConfig.roomSecret,
      p_new_room_secret: nextSecret
    });
    if (error) throw error;
    if (!data?.ok) throw new Error(data.message || data.error || 'Не удалось обновить секрет');

    sbConfig.roomSecret = nextSecret;
    sbSaveConfig();
    sbLastRemoteUpdatedAt = data.updated_at || sbLastRemoteUpdatedAt;
    sbRefreshCard();
    sbCopyAccess();
    showToast('🔐 Секрет комнаты обновлён');
  } catch (e) {
    showToast('❌ ' + (e.message || 'Ошибка обновления секрета'));
  }
}

function sbDisconnect() {
  sbStopRealtime();
  sbStopPolling();
  clearTimeout(sbSaveTimer);
  sbClient = null;
  sbLastRemoteUpdatedAt = '';
  sbSetStatus('idle');
  showToast('🔌 Синхронизация отключена');
  sbRefreshCard();
}

// ── Push local state to Supabase (debounced 400ms) ───────
function sbPush() {
  if (!sbEnsureClient() || sbStatus !== 'live' || sbIsApplying) return;
  clearTimeout(sbSaveTimer);
  sbSaveTimer = setTimeout(async () => {
    try {
      const state = sbGetLocalState();
      const { data, error } = await sbClient.rpc('push_room_state', {
        p_room_code:   sbConfig.roomCode,
        p_room_secret: sbConfig.roomSecret,
        p_state:       state
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.message || data?.error || 'Ошибка записи комнаты');
      sbLastRemoteUpdatedAt = data.updated_at || sbLastRemoteUpdatedAt;
      // Notify other devices via Broadcast (best-effort, no await)
      if (sbRealtimeChannel) {
        sbRealtimeChannel.send({ type: 'broadcast', event: 'state_updated', payload: {} })
          .catch(() => {}); // non-critical
      }
      // Flash top bar
      const bar = document.getElementById('sync-topbar');
      if (bar) { bar.style.display = 'block'; setTimeout(()=>{ bar.style.display='none'; }, 700); }
    } catch(e) {
      console.warn('Supabase push error:', e);
    }
  }, 400);
}

// ── Apply remote state from server ───────────────────────
function sbApplyRemoteState(state) {
  sbIsApplying = true;
  try {
    // Smart merge: apply only if incoming timestamp is newer
    if (state.scores && state.scoreTs) {
      state.scores.forEach((courtScores, ci) => {
        const remoteTs = state.scoreTs['c'+ci] || 0;
        const localTs  = scoreTs['c'+ci] || 0;
        if (remoteTs >= localTs) scores[ci] = courtScores;
      });
    } else if (state.scores) {
      scores = state.scores;
    }
    if (state.divScores && state.scoreTs) {
      Object.keys(state.divScores).forEach(key => {
        const remoteTs = state.scoreTs[key] || 0;
        const localTs  = scoreTs[key] || 0;
        if (remoteTs >= localTs) divScores[key] = state.divScores[key];
      });
    } else if (state.divScores) {
      divScores = state.divScores;
    }
    if (state.scoreTs) {
      Object.keys(state.scoreTs).forEach(k => {
        scoreTs[k] = Math.max(scoreTs[k] || 0, state.scoreTs[k] || 0);
      });
    }
    if (state.divRoster) divRoster = state.divRoster;
    if (state.roster) {
      state.roster.forEach((c, ci) => {
        if (ALL_COURTS[ci]) {
          ALL_COURTS[ci].men   = c.men   || [];
          ALL_COURTS[ci].women = c.women || [];
        }
      });
    }
    if (state.meta) tournamentMeta = { ...tournamentMeta, ...state.meta };
    if (state.cfg) { ppc = state.cfg.ppc || ppc; nc = state.cfg.nc || nc; }
    if (state.timers) {
      const now = Date.now();
      state.timers.forEach((s, ci) => {
        if (!timerState[ci]) return;
        // Smart merge: применяем только если входящий ts новее локального
        const remoteTs = (state.timerTs && state.timerTs[ci]) || 0;
        const localTs  = timerTs[ci] || 0;
        if (remoteTs < localTs) return;
        const ts = timerState[ci];
        ts.preset = s.preset ?? ts.preset;
        ts.total  = s.total  ?? ts.total;
        ts.startedAt      = s.startedAt      ?? null;
        ts.startRemaining = s.startRemaining ?? ts.startRemaining;
        ts.running = s.running ?? false;
        if (ts.running && ts.startedAt) {
          const elapsed = (now - ts.startedAt) / 1000;
          ts.remaining = Math.max(0, ts.startRemaining - elapsed);
          if (ts.remaining <= 0) ts.running = false;
        } else {
          ts.remaining = s.remaining ?? ts.remaining;
        }
        timerTs[ci] = remoteTs; // фиксируем принятый ts
      });
      saveTimerState();
    }
    // Перерисовка с сохранением скролла и фокуса
    safeRender();
  } finally {
    sbIsApplying = false;
  }
}

// ── Collect local state ───────────────────────────────────
function sbGetLocalState() {
  return {
    scores,
    divScores,
    divRoster,
    roster: ALL_COURTS.map(c => ({ men:[...c.men], women:[...c.women] })),
    meta:   tournamentMeta,
    cfg:     { ppc, nc },
    scoreTs: { ...scoreTs },
    timers: timerState.map(ts => ({
      preset: ts.preset, total: ts.total, remaining: ts.remaining,
      running: ts.running, startedAt: ts.startedAt, startRemaining: ts.startRemaining,
    })),
    timerTs: [...timerTs],
  };
}

// ════════════════════════════════════════════════════════════
// PUBLIC DATA PUBLISHING — история и рейтинг видны всем
// ════════════════════════════════════════════════════════════

/**
 * Публикует результаты завершённого турнира в Supabase.
 * Вызывается после finishTournament(). Не требует активной room-сессии —
 * достаточно настроенного Supabase URL + anonKey.
 * Идемпотентна: повторный вызов с тем же snapshot.id не создаёт дубликатов.
 *
 * @param {object} snapshot  — объект из finishTournament()
 */
async function sbPublishTournament(snapshot) {
  const client = sbEnsureClient();
  if (!client) return; // Supabase не настроен

  const db          = loadPlayerDB();
  const ratingType  = divisionToType(tournamentMeta.division || '');
  const division    = tournamentMeta.division || 'Мужской';
  const format      = tournamentMeta.format   || 'King of the Court';

  // Строим payload: данные за этот турнир + накопленная статистика из БД
  const results = snapshot.players.map((p, idx) => {
    const place     = idx + 1;
    const ratingPts = calculateRanking(place);
    const dbP = db.find(d => d.name === p.name && d.gender === p.gender)
              || db.find(d => d.name === p.name);
    return {
      name:               p.name,
      gender:             p.gender,
      place,
      game_pts:           p.totalPts            || 0,
      rating_pts:         ratingPts,
      rating_type:        ratingType,
      // Накопленные рейтинги (результат recalcAllPlayerStats на клиенте)
      rating_m:           dbP?.ratingM          ?? 0,
      rating_w:           dbP?.ratingW          ?? 0,
      rating_mix:         dbP?.ratingMix        ?? 0,
      tournaments_m:      dbP?.tournamentsM     ?? 0,
      tournaments_w:      dbP?.tournamentsW     ?? 0,
      tournaments_mix:    dbP?.tournamentsMix   ?? 0,
      wins:               dbP?.wins             ?? 0,
      last_seen:          dbP?.lastSeen         || null,
      total_pts:          dbP?.totalPts         ?? 0,
      tournaments_played: dbP?.tournaments      ?? 0,
    };
  });

  if (!results.length) return;

  try {
    const { data, error } = await client.rpc('publish_tournament_results', {
      p_external_id: String(snapshot.id),
      p_name:        snapshot.name,
      p_date:        snapshot.date,
      p_format:      format,
      p_division:    division,
      p_results:     results,
    });

    if (error) {
      console.warn('[sbPublishTournament] RPC error:', error.message);
      return;
    }

    if (data?.ok) {
      showToast(`☁️ Опубликовано: ${data.results_saved} результатов`, 'success');
    }
  } catch (e) {
    console.warn('[sbPublishTournament] exception:', e);
  }
}

/**
 * Загружает публичный рейтинг и историю турниров из Supabase.
 * Работает без room-сессии — только URL + anonKey.
 * Используется для отображения публичного экрана рейтинга.
 *
 * @param {'M'|'W'|'Mix'} type
 * @returns {{ leaderboard: Array, history: Array } | null}
 */
async function sbPublicFetch(type = 'M') {
  const client = sbEnsureClient();
  if (!client) return null;

  try {
    const [lbRes, histRes] = await Promise.all([
      client.rpc('get_public_leaderboard',        { p_type: type, p_limit: 100 }),
      client.rpc('get_public_tournament_history', { p_limit: 20, p_offset: 0  }),
    ]);

    if (lbRes.error)   console.warn('[sbPublicFetch] leaderboard error:', lbRes.error.message);
    if (histRes.error) console.warn('[sbPublicFetch] history error:',     histRes.error.message);

    return {
      leaderboard: lbRes.data  || [],
      history:     histRes.data || [],
    };
  } catch (e) {
    console.warn('[sbPublicFetch] exception:', e);
    return null;
  }
}

// ── Render config card ────────────────────────────────────
function renderSupabaseCard() {
  const live = sbStatus === 'live';
  const hasConfig = !!(sbConfig.url && sbConfig.anonKey);
  const ready = !!(sbNormalizeRoomCode(sbConfig.roomCode) && (sbConfig.roomSecret || '').trim());
  return `<div class="sb-card">
    <div class="sb-title">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M3 12L12 3l9 9-9 9-9-9z" fill="#3ecf8e" opacity=".25"/>
        <path d="M12 3v18M3 12h18" stroke="#3ecf8e" stroke-width="2" stroke-linecap="round"/>
      </svg>
      Supabase · Синхронизация
    </div>
    <div class="sb-sub">Комната защищена кодом и секретом. Для подключения другого устройства нужны оба значения.</div>

    <div class="sb-status-bar">
      <div class="sb-status-left">
        <div class="sb-dot ${sbStatus}"></div>
        <span class="sb-status-text" style="color:${{idle:'#555',connecting:'#f5a623',live:'#3ecf8e',offline:'#e94560'}[sbStatus]||'#555'}">${
          {idle:'Не подключено',connecting:'Подключение...',live:'Синхронизация активна',offline:'Ошибка соединения'}[sbStatus]
        }</span>
      </div>
      <span class="sb-room-badge">${live ? esc(sbConfig.roomCode) : ''}</span>
    </div>

    <div class="sb-input-row">
      <label>Код комнаты</label>
      <input class="sb-input" type="text" value="${escAttr(sbConfig.roomCode)}"
        placeholder="Например: SURGUT-01"
        style="text-transform:uppercase;letter-spacing:2px;font-weight:700"
        ${live ? 'readonly' : ''}
        oninput="sbConfig.roomCode=this.value;sbSaveConfig()">
      <div class="sb-hint">Одинаковый код + одинаковый секрет на всех телефонах = одна комната.</div>
    </div>

    <div class="sb-input-row">
      <label>Секрет комнаты</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input class="sb-input" type="password" value="${escAttr(sbConfig.roomSecret || '')}"
          placeholder="Например: A1B2-C3D4-E5F6"
          ${live ? 'readonly' : ''}
          oninput="sbConfig.roomSecret=this.value;sbSaveConfig()">
        <button class="btn-sb-sql-copy" type="button"
          onclick="${live ? 'sbRotateSecret()' : 'sbGenerateSecret()'}"
          title="${live ? 'Сменить секрет комнаты' : 'Сгенерировать секрет'}">🎲</button>
      </div>
      <div class="sb-hint">Первая успешная связь создаёт комнату. Если комната уже есть, секрет должен совпадать.</div>
    </div>

    <div class="sb-btns">
      ${live
        ? `<button class="btn-sb disconnect" onclick="sbDisconnect()">🔌 Отключить</button>
           <button class="btn-sb connect" onclick="sbCopyAccess()">📋 Копировать доступ</button>
           <button class="btn-sb connect" onclick="sbRotateSecret()">🔐 Новый секрет</button>`
        : `<button class="btn-sb connect" onclick="sbConnect()" ${!hasConfig || !ready ? 'disabled' : ''}>
            🟢 Подключиться
          </button>`
      }
    </div>

    <details class="sb-sql-block">
      <summary>🛠 SQL для безопасной комнатной синхронизации</summary>
      <div class="sb-sql-hint">Откройте <a href="https://supabase.com/dashboard/project/rscctyllkqcpxkxrveoz/sql/new" target="_blank" style="color:#3ecf8e">SQL Editor</a>, вставьте блок ниже или запустите обновлённый supabase_migration.sql целиком.</div>
      <pre class="sb-sql-pre">${esc(SB_SYNC_SQL)}</pre>
      <button class="btn-sb-sql-copy" onclick="sbCopySql()">📋 Копировать SQL</button>
    </details>
  </div>`;
}

function sbRefreshCard() {
  const roster = document.getElementById('screen-roster');
  if (roster && roster.classList.contains('active')) {
    roster.innerHTML = renderRoster();
  }
}

// ════════════════════════════════════════════════════════════
// ADMIN PANEL
// ════════════════════════════════════════════════════════════
let _adminRequests    = [];
let _adminTempPlayers = [];
let _adminMergeId     = null;
let _adminMergeQuery  = '';

async function adminLoadData() {
  const cl = sbEnsureClient();
  if (!cl) return;
  try {
    const [reqRes, tmpRes] = await Promise.all([
      cl.rpc('list_pending_requests'),
      cl.from('players').select('id,name,gender,status').eq('status', 'temporary').order('name'),
    ]);
    _adminRequests    = reqRes.data  || [];
    _adminTempPlayers = tmpRes.data  || [];
  } catch(e) {
    console.warn('adminLoadData failed', e);
  }
  _adminRefreshPanel();
}

async function adminApprove(requestId) {
  const cl = sbEnsureClient();
  if (!cl) return;
  const { data, error } = await cl.rpc('approve_player_request', { p_request_id: requestId });
  if (error || !data?.ok) {
    showToast('Ошибка одобрения: ' + (error?.message || data?.message || ''), 'error');
    return;
  }
  showToast('✅ Заявка одобрена');
  await adminLoadData();
}

async function adminReject(requestId) {
  const cl = sbEnsureClient();
  if (!cl) return;
  const { data, error } = await cl.rpc('reject_player_request', { p_request_id: requestId });
  if (error || !data?.ok) {
    showToast('Ошибка отклонения: ' + (error?.message || data?.message || ''), 'error');
    return;
  }
  showToast('❌ Заявка отклонена');
  await adminLoadData();
}

function adminStartMerge(tempId) {
  _adminMergeId    = tempId;
  _adminMergeQuery = '';
  _adminRefreshPanel();
  setTimeout(() => document.getElementById('admin-merge-search')?.focus(), 50);
}

function adminCancelMerge() {
  _adminMergeId    = null;
  _adminMergeQuery = '';
  _adminRefreshPanel();
}

function adminMergeSearch(q) {
  _adminMergeQuery = q;
  _adminRefreshPanel();
}

async function adminMerge(realId) {
  const tempId = _adminMergeId;
  if (!tempId || !realId) {
    showToast('Выберите игрока для слияния', 'error');
    return;
  }
  if (String(tempId) === String(realId)) {
    showToast('Нельзя слить игрока с самим собой', 'error');
    return;
  }
  const localDb = typeof loadPlayerDB === 'function' ? loadPlayerDB() : [];
  const realPlayer = localDb.find(p => String(p.id) === String(realId));
  const tempPlayer = _adminTempPlayers.find(p => String(p.id) === String(tempId));
  if (!realPlayer || realPlayer.status === 'temporary') {
    showToast('Выберите реального игрока из списка (не временного)', 'error');
    return;
  }
  const tempName = tempPlayer ? tempPlayer.name : 'Временный';
  const realName = realPlayer.name || 'Игрок';
  const msg = `Слить временного игрока «${tempName}» в «${realName}»?\n\nЗаписи с турниров и очки будут перенесены. Действие необратимо.`;
  if (!(typeof showConfirm === 'function' && (await showConfirm(msg)))) return;

  const cl = sbEnsureClient();
  if (!cl) {
    showToast('Нет подключения к Supabase', 'error');
    return;
  }
  try {
    const { data, error } = await cl.rpc('merge_players', { p_temp_id: tempId, p_real_id: realId });
    if (error || !data?.ok) {
      showToast('Ошибка слияния: ' + (error?.message || data?.message || 'неизвестная ошибка'), 'error');
      return;
    }
    _adminMergeId    = null;
    _adminMergeQuery = '';
    showToast(`✅ Слито в «${realName}». Перенесено записей: ${data.moved ?? 0}`);
    if (typeof removePlayerFromDB === 'function') removePlayerFromDB(tempId);
    if (typeof _refreshRdb === 'function') _refreshRdb();
    await adminLoadData();
  } catch (e) {
    showToast('Ошибка слияния: ' + (e?.message || 'сеть'), 'error');
  }
}

function _adminRefreshPanel() {
  const el = document.getElementById('admin-panel-inner');
  if (el) el.innerHTML = _renderAdminPanelInner();
}

function renderAdminPanel() {
  if (sbStatus !== 'live') return '';
  return `<div class="sb-card admin-panel" id="admin-panel">
    <div class="sb-title">🛡 Администрирование</div>
    <div class="sb-sub">Заявки игроков и временные профили. Требует подключения к Supabase.</div>
    <button class="btn-sb connect" style="margin-bottom:12px" onclick="adminLoadData()">🔄 Загрузить данные</button>
    <div id="admin-panel-inner">${_renderAdminPanelInner()}</div>
  </div>`;
}

function _renderAdminPanelInner() {
  return _renderPendingRequests() + _renderTempPlayers();
}

function _renderPendingRequests() {
  if (!_adminRequests.length) {
    return `<div class="admin-section-title">📋 Pending-заявки</div>
      <div class="admin-empty">Нет ожидающих заявок</div>`;
  }
  const rows = _adminRequests.map(r => `
    <div class="admin-row">
      <div class="admin-row-info">
        <span class="admin-name">${esc(r.name)}</span>
        <span class="admin-meta">${r.gender === 'M' ? '♂' : '♀'}${r.phone ? ' · ' + esc(r.phone) : ''}${r.tournament_name ? ' · ' + esc(r.tournament_name) : ''}</span>
      </div>
      <div class="admin-row-btns">
        <button class="btn-admin approve" onclick="adminApprove('${escAttr(r.id)}')">✅ Одобрить</button>
        <button class="btn-admin reject"  onclick="adminReject('${escAttr(r.id)}')">❌ Отклонить</button>
      </div>
    </div>`).join('');
  return `<div class="admin-section-title">📋 Pending-заявки (${_adminRequests.length})</div>${rows}`;
}

function _renderTempPlayers() {
  const header = `<div class="admin-section-title" style="margin-top:12px">👤 Временные игроки</div>`;
  if (!_adminTempPlayers.length) {
    return header + `<div class="admin-empty">Нет временных профилей</div>`;
  }
  const rows = _adminTempPlayers.map(p => {
    const isMerging = _adminMergeId === p.id;
    const mergeForm = isMerging ? (() => {
      const q = _adminMergeQuery.trim().toLowerCase();
      const candidates = q.length >= 2
        ? (loadPlayerDB() || [])
            .filter(c => c.status !== 'temporary' && c.id !== p.id && c.name.toLowerCase().includes(q))
            .slice(0, 6)
        : [];
      return `<div class="admin-merge-form">
        <div style="margin-bottom:6px;font-size:13px;color:var(--accent)">
          Слить <b>${esc(p.name)}</b> в реального игрока:
        </div>
        <input id="admin-merge-search" class="sb-input" type="text"
          placeholder="Введите фамилию..." value="${escAttr(_adminMergeQuery)}"
          oninput="adminMergeSearch(this.value)">
        ${candidates.map(c => `
          <div class="admin-merge-candidate" onclick="adminMerge('${escAttr(String(c.id))}')">
            ${esc(c.name)} <span class="admin-meta">${c.gender === 'M' ? '♂' : '♀'}</span>
          </div>`).join('')}
        ${q.length >= 2 && !candidates.length ? '<div class="admin-empty">Не найдено</div>' : ''}
        <button class="btn-admin reject" style="margin-top:8px" onclick="adminCancelMerge()">Отмена</button>
      </div>`;
    })() : '';
    return `<div class="admin-row">
      <div class="admin-row-info">
        <span class="admin-name">${esc(p.name)}</span>
        <span class="admin-meta">${p.gender === 'M' ? '♂' : '♀'} · временный</span>
      </div>
      <div class="admin-row-btns">
        ${isMerging ? '' : `<button class="btn-admin merge" onclick="adminStartMerge('${escAttr(p.id)}')">🔀 Слить</button>`}
      </div>
    </div>${mergeForm}`;
  }).join('');
  return header + rows;
}

// ════════════════════════════════════════════════════════════
// GOOGLE SHEETS MODULE
// ════════════════════════════════════════════════════════════
let gshConfig = { ...DEFAULT_GSH_CONFIG };
let gshToken = null;       // current OAuth access token
let gshTokenExpiry = 0;    // timestamp when token expires

function gshLoadConfig() {
  try {
    const c = localStorage.getItem('kotc3_gsh');
    if (c) gshConfig = { ...gshConfig, ...JSON.parse(c) };
  } catch(e) { console.warn('[gshLoadConfig] Config parse error:', e); }
}

function gshSaveConfig() {
  localStorage.setItem('kotc3_gsh', JSON.stringify(gshConfig));
}

function gshIsConnected() {
  return gshToken && Date.now() < gshTokenExpiry;
}

// ── Render config card (inside renderRoster) ─────────────
function renderGSheetsCard() {
  const connected = gshIsConnected();
  const hasClientId = !!gshConfig.clientId.trim();
  return `<div class="gsh-card">
    <div class="gsh-title">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style="flex-shrink:0">
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#34a853" opacity=".2"/>
        <path d="M8 8h8M8 12h8M8 16h5" stroke="#34a853" stroke-width="2" stroke-linecap="round"/>
        <rect x="14" y="11" width="7" height="7" rx="1" fill="#34a853"/>
        <path d="M16 16l1.5-1.5L19 16" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      Google Sheets
    </div>
    <div class="gsh-sub">Автоматически записывает результаты в таблицу Google при завершении турнира</div>

    <div class="gsh-status">
      <div class="gsh-dot${connected ? ' ok' : hasClientId ? '' : ' err'}"></div>
      <span style="color:${connected ? '#34a853' : 'var(--muted)'}">
        ${connected ? '✓ Подключено · токен активен' : hasClientId ? 'Не авторизован · нажмите Войти' : 'Не настроено · введите Client ID'}
      </span>
    </div>

    <div class="gsh-input-row">
      <label>OAuth 2.0 Client ID</label>
      <input class="gsh-input" type="text" id="gsh-client-id"
        value="${escAttr(gshConfig.clientId)}"
        placeholder="xxxxxxx.apps.googleusercontent.com"
        oninput="gshConfig.clientId=this.value.trim();gshSaveConfig();gshRefreshCard()">
      <div class="gsh-hint">
        <a href="https://console.cloud.google.com" target="_blank">console.cloud.google.com</a>
        → APIs & Services → Credentials → Create OAuth 2.0 Client ID (Web application)
      </div>
    </div>

    <div class="gsh-input-row">
      <label>Spreadsheet ID <span style="opacity:.5">(необязательно)</span></label>
      <input class="gsh-input" type="text" id="gsh-sheet-id"
        value="${escAttr(gshConfig.spreadsheetId)}"
        placeholder="Оставьте пустым — создаст новую таблицу"
        oninput="gshConfig.spreadsheetId=this.value.trim();gshSaveConfig()">
      <div class="gsh-hint">ID из URL: docs.google.com/spreadsheets/d/<b style="color:#34a853">ВОТ_ЭТО</b>/edit</div>
    </div>

    <div class="gsh-btns">
      ${connected
        ? `<button class="btn-gsh disconnect" onclick="gshDisconnect()">🔌 Отключить</button>`
        : `<button class="btn-gsh connect" onclick="gshConnect()" ${!hasClientId?'disabled':''}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>
            Войти через Google
          </button>`
      }
    </div>
  </div>`;
}

function gshRefreshCard() {
  const roster = document.getElementById('screen-roster');
  if (roster && roster.classList.contains('active')) {
    roster.innerHTML = renderRoster();
  }
}

// ── OAuth via Google Identity Services ───────────────────
function gshConnect() {
  if (!gshConfig.clientId) {
    showToast('⚠️ Введите Client ID'); return;
  }
  if (!window.google?.accounts?.oauth2) {
    showToast('⚠️ Нет подключения — скрипт Google не загружен'); return;
  }
  const client = google.accounts.oauth2.initTokenClient({
    client_id: gshConfig.clientId,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    callback: (resp) => {
      if (resp.error) {
        showToast('❌ Ошибка авторизации: ' + resp.error);
        return;
      }
      gshToken = resp.access_token;
      gshTokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
      showToast('✅ Google подключён!');
      gshRefreshCard();
    },
  });
  client.requestAccessToken();
}

function gshDisconnect() {
  if (gshToken && window.google?.accounts?.oauth2) {
    google.accounts.oauth2.revoke(gshToken);
  }
  gshToken = null; gshTokenExpiry = 0;
  showToast('🔌 Google отключён');
  gshRefreshCard();
}

// ── Sheets API helpers ────────────────────────────────────
async function gshFetch(url, opts = {}) {
  const resp = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': 'Bearer ' + gshToken,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!resp.ok) {
    const err = await resp.json().catch(()=>({error:{message:resp.statusText}}));
    throw new Error(err.error?.message || resp.statusText);
  }
  return resp.json();
}

async function gshGetOrCreateSpreadsheet(title) {
  if (gshConfig.spreadsheetId) return gshConfig.spreadsheetId;
  // Create new spreadsheet
  const data = await gshFetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    body: JSON.stringify({ properties: { title: 'КОТС — История турниров' } }),
  });
  const id = data.spreadsheetId;
  gshConfig.spreadsheetId = id;
  gshSaveConfig();
  gshRefreshCard();
  return id;
}

async function gshEnsureSheet(spreadsheetId, sheetTitle) {
  // Get existing sheets
  const meta = await gshFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`);
  const exists = meta.sheets?.some(s => s.properties.title === sheetTitle);
  if (exists) return;
  // Add sheet
  await gshFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: sheetTitle } } }]
    }),
  });
}

async function gshWriteTournament(tournament) {
  if (!gshIsConnected()) throw new Error('Нет авторизации Google');

  const dateStr = tournament.date || new Date().toISOString().split('T')[0];
  const sheetTitle = `${dateStr} ${tournament.name || 'Турнир'}`.slice(0, 60);

  const spreadsheetId = await gshGetOrCreateSpreadsheet();
  await gshEnsureSheet(spreadsheetId, sheetTitle);

  // Build rows
  const header = [
    ['КОРОЛЬ ПЛОЩАДКИ — ПРОТОКОЛ'],
    [tournament.name || 'Турнир'],
    [dateStr],
    [],
    ['Кортов', tournament.nc, 'Игроков на корт', tournament.ppc, 'Раундов сыграно', tournament.rPlayed, 'Сумма очков', tournament.totalScore],
    [],
    ['Место', 'Имя', 'Пол', 'Корт', 'Очки'],
  ];
  const rows = tournament.players.map((p, i) => [
    i + 1,
    p.name,
    p.gender === 'M' ? 'Мужчины' : 'Женщины',
    p.courtName || '—',
    p.totalPts,
  ]);
  const allRows = [...header, ...rows];

  await gshFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetTitle + '!A1')}:append?valueInputOption=USER_ENTERED&insertDataOption=OVERWRITE`,
    {
      method: 'POST',
      body: JSON.stringify({ values: allRows }),
    }
  );

  // Format header rows bold + color
  const sheetId = await gshFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`)
    .then(m => m.sheets?.find(s => s.properties.title === sheetTitle)?.properties?.sheetId);

  if (sheetId !== undefined) {
    await gshFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [
        // Title row bold + yellow bg
        { repeatCell: { range:{sheetId,startRowIndex:0,endRowIndex:1}, cell:{userEnteredFormat:{
          backgroundColor:{red:0.06,green:0.06,blue:0.1},
          textFormat:{bold:true,fontSize:14,foregroundColor:{red:1,green:0.78,blue:0.2}},
        }}, fields:'userEnteredFormat' }},
        // Column headers bold
        { repeatCell: { range:{sheetId,startRowIndex:6,endRowIndex:7}, cell:{userEnteredFormat:{
          backgroundColor:{red:0.12,green:0.12,blue:0.22},
          textFormat:{bold:true,foregroundColor:{red:0.53,green:0.53,blue:0.8}},
        }}, fields:'userEnteredFormat' }},
        // Auto-resize columns
        { autoResizeDimensions: { dimensions:{sheetId,dimension:'COLUMNS',startIndex:0,endIndex:5} }},
      ]})
    });
  }

  return spreadsheetId;
}

// ── Public export functions ───────────────────────────────
async function exportToSheetsFromHistory(id) {
  let history = [];
  try { history = JSON.parse(localStorage.getItem('kotc3_history') || '[]'); } catch(e){}
  const t = history.find(h => h.id === id);
  if (!t) return;
  await gshExportTournament(t, `gsh-btn-${id}`);
}

async function gshExportTournament(tournament, btnId) {
  if (!gshIsConnected()) {
    showToast('⚠️ Сначала войдите в Google (Ростер → Google Sheets)');
    return;
  }
  const btn = document.getElementById(btnId);
  if (btn) { btn.disabled = true; btn.textContent = '⏳ ...'; }
  try {
    const spreadsheetId = await gshWriteTournament(tournament);
    showToast('✅ Сохранено в Google Sheets!');
    // Open spreadsheet in new tab
    const w = window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}`, '_blank');
    if (!w) showToast('⚠️ Разрешите всплывающие окна для открытия таблицы');
  } catch(e) {
    showToast('❌ Ошибка: ' + e.message);
    console.error(e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📊 Sheets'; }
  }
}

function exportTournamentPDF(id) {
  let history = [];
  try { history = JSON.parse(localStorage.getItem('kotc3_history') || '[]'); } catch(e){}
  const t = history.find(h => h.id === id);
  if (!t) return;

  const dateStr = fmtDateLong(t.date);
  const medals = ['🥇','🥈','🥉','4','5'];
  const podiumColors = ['#ffc832','#c0c0c0','#cd7f32','#aaaaaa','#aaaaaa'];

  const top5rows = t.players.slice(0,5).map((p,i) => `
    <tr class="podium-row top${i+1}">
      <td class="place-cell"><span class="medal m${i+1}">${medals[i]}</span></td>
      <td class="name-cell">${p.gender==='M'?'🏋️':'👩'} ${esc(p.name)}</td>
      <td class="court-cell">${esc(p.courtName||'—')}</td>
      <td class="pts-cell">${p.totalPts}</td>
    </tr>`).join('');

  const allRows = t.players.map((p,i) => `
    <tr class="${i%2===0?'even':'odd'}${i<3?' top'+(i+1):''}">
      <td class="place-cell"><span class="rank-num">${i+1}</span></td>
      <td class="name-cell">${p.gender==='M'?'🏋️':'👩'} ${esc(p.name)}</td>
      <td class="gender-cell">${p.gender==='M'?'Муж':'Жен'}</td>
      <td class="court-cell">${esc(p.courtName||'—')}</td>
      <td class="pts-cell">${p.totalPts} оч</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>КОТС — ${esc(t.name)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@400;600;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    background:#0f0f1a; color:#fff;
    font-family:'Barlow Condensed',Arial,sans-serif;
    padding: 24px 28px;
  }
  /* ── Header ── */
  .header {
    text-align:center; padding: 24px 0 20px;
    border-bottom: 2px solid #ffc832;
    margin-bottom: 20px;
  }
  .brand {
    font-family:'Bebas Neue',sans-serif;
    font-size:12px; letter-spacing:4px; color:#ffc832; margin-bottom:8px;
  }
  .trn-name {
    font-family:'Bebas Neue',sans-serif;
    font-size:36px; letter-spacing:2px; color:#fff; line-height:1;
  }
  .trn-date { font-size:14px; color:#8888aa; margin-top:6px; }

  /* ── Stats chips ── */
  .stats-row {
    display:flex; gap:10px; justify-content:center;
    margin: 18px 0;
  }
  .chip {
    background:#1a1a2e; border:1px solid #2a2a44;
    border-radius:8px; padding:8px 16px;
    font-size:13px; font-weight:700; color:#ffc832;
    letter-spacing:.5px;
  }

  /* ── Section title ── */
  .section-title {
    font-family:'Bebas Neue',sans-serif;
    font-size:20px; letter-spacing:2px; color:#ffc832;
    margin: 22px 0 10px; padding-bottom:6px;
    border-bottom:1px solid #2a2a44;
  }

  /* ── Tables ── */
  table { width:100%; border-collapse:collapse; }
  th {
    background:#1e1e38; color:#8888cc;
    font-size:11px; font-weight:700; letter-spacing:1px;
    padding:8px 10px; text-align:left; text-transform:uppercase;
  }
  td { padding:8px 10px; font-size:14px; vertical-align:middle; }
  tr.even td { background:#16162a; }
  tr.odd  td { background:#111120; }

  .place-cell { width:44px; text-align:center; }
  .pts-cell   { text-align:right; font-weight:900; color:#ffc832; }
  .court-cell { color:#6666aa; font-size:12px; }
  .gender-cell{ color:#6666aa; font-size:12px; width:50px; }
  .name-cell  { font-weight:700; }

  /* Medals */
  .medal { font-size:20px; }
  .rank-num {
    display:inline-block; width:24px; height:24px; line-height:24px;
    border-radius:6px; background:#2a2a44; color:#aaa;
    font-size:12px; font-weight:700; text-align:center;
  }

  /* Top 3 highlight */
  tr.top1 td { background:#1f1a00 !important; }
  tr.top2 td { background:#1a1a1a !important; }
  tr.top3 td { background:#1a1000 !important; }
  tr.top1 .name-cell { color:#ffc832; }
  tr.top2 .name-cell { color:#c0c0c0; }
  tr.top3 .name-cell { color:#cd7f32; }

  /* Podium table larger */
  .podium-table td { padding:10px 12px; font-size:15px; }
  .podium-row .name-cell { font-size:16px; }

  /* ── Footer ── */
  .footer {
    margin-top:28px; padding-top:10px;
    border-top:1px solid #2a2a44;
    display:flex; justify-content:space-between;
    font-size:11px; color:#444466;
  }

  /* ── Print ── */
  @media print {
    body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .no-print { display:none !important; }
  }

  /* ── Print button (hidden on print) ── */
  .print-bar {
    position:fixed; top:16px; right:16px; z-index:999;
    display:flex; gap:8px;
  }
  .btn-print {
    background:#ffc832; color:#000; border:none; border-radius:10px;
    padding:10px 22px; font-family:'Bebas Neue',sans-serif;
    font-size:18px; letter-spacing:1px; cursor:pointer;
    box-shadow:0 4px 20px rgba(255,200,50,.4);
  }
  .btn-close {
    background:#2a2a44; color:#fff; border:none; border-radius:10px;
    padding:10px 16px; font-family:'Bebas Neue',sans-serif;
    font-size:18px; cursor:pointer;
  }
</style>
</head>
<body>

<div class="print-bar no-print">
  <button class="btn-print" onclick="window.print()">🖨 Сохранить PDF</button>
  <button class="btn-close" onclick="window.close()">✕</button>
</div>

<div class="header">
  <div class="brand">👑 КОРОЛЬ ПЛОЩАДКИ · ПРОТОКОЛ ТУРНИРА</div>
  <div class="trn-name">${esc(t.name || 'Турнир')}</div>
  <div class="trn-date">📅 ${dateStr}</div>
</div>

<div class="stats-row">
  <div class="chip">👥 ${t.players.length} игроков</div>
  <div class="chip">🏐 ${t.rPlayed} раундов</div>
  <div class="chip">⚡ ${t.totalScore} очков</div>
  <div class="chip">🏟 ${t.nc} корт(а) × ${t.ppc}</div>
</div>

<div class="section-title">🏆 ПЬЕДЕСТАЛ</div>
<table class="podium-table">
  <thead><tr>
    <th>Место</th><th>Участник</th><th>Корт</th><th style="text-align:right">Очки</th>
  </tr></thead>
  <tbody>${top5rows}</tbody>
</table>

<div class="section-title">📋 ВСЕ РЕЗУЛЬТАТЫ</div>
<table>
  <thead><tr>
    <th>#</th><th>Участник</th><th>Пол</th><th>Корт</th><th style="text-align:right">Очки</th>
  </tr></thead>
  <tbody>${allRows}</tbody>
</table>

<div class="footer">
  <span>Лютые Пляжники · КОТС · Surgut</span>
  <span>Сформировано: ${new Date().toLocaleDateString('ru-RU')}</span>
</div>

</body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const w    = window.open(url, '_blank', 'width=800,height=900');
  if (!w) { showToast('⚠️ Разрешите всплывающие окна для этого сайта'); URL.revokeObjectURL(url); return; }
  w.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
}

function deleteHistory(id) {
  let history = [];
  try { history = JSON.parse(localStorage.getItem('kotc3_history') || '[]'); } catch(e){}
  history = history.filter(t => t.id !== id);
  localStorage.setItem('kotc3_history', JSON.stringify(history));
  // Re-render stats
  const s = document.getElementById('screen-stats');
  if (s) s.innerHTML = renderStats();
}
