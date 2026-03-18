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
  try { queue = JSON.parse(localStorage.getItem('kotc3_player_requests') || '[]'); } catch(e) { AppLogger.warn('supabase', 'Failed to parse player requests queue', e); }
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
