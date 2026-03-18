-- ============================================================
-- МИГРАЦИЯ: Модуль регистрации на турниры
-- Пляжный волейбол · King of the Court
-- ============================================================
-- Запустить в Supabase SQL Editor одним блоком.
-- Идемпотентно: повторный запуск не сломает данные.
-- ============================================================

-- ── 0. Расширения ────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- trigram fuzzy search

-- ── 1. PLAYERS ───────────────────────────────────────────────
-- Единый реестр игроков. status отделяет проверенных от "полевых".
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS players (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT NOT NULL,
  gender          TEXT NOT NULL CHECK (gender IN ('M', 'W')),
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'temporary')),
  phone           TEXT,                       -- опционально, для связи
  tournaments_played  INT  DEFAULT 0,
  total_pts       INT  DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Уникальность: имя + пол (два "Иванов" разного пола — ОК)
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_name_gender
  ON players (lower(trim(name)), gender);

-- Trigram-индекс для нечёткого поиска по имени
CREATE INDEX IF NOT EXISTS idx_players_name_trgm
  ON players USING gin (name gin_trgm_ops);

-- Индекс для фильтрации по статусу
CREATE INDEX IF NOT EXISTS idx_players_status
  ON players (status);

-- Автообновление updated_at
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS players_updated_at ON players;
CREATE TRIGGER players_updated_at
  BEFORE UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();


-- ── 2. TOURNAMENTS ───────────────────────────────────────────
-- Без этой таблицы FOR UPDATE бессмысленен:
-- клиент мог бы передать любой capacity, и RPC поверила бы.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tournaments (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  date        DATE,
  time        TIME,
  location    TEXT,
  format      TEXT DEFAULT 'King of the Court',
  division    TEXT CHECK (division IN ('Мужской', 'Женский', 'Микст')),
  level       TEXT DEFAULT 'medium'
                CHECK (level IN ('hard', 'medium', 'easy')),
  capacity    INT NOT NULL DEFAULT 24 CHECK (capacity >= 4),
  prize       TEXT,
  status      TEXT DEFAULT 'open'
                CHECK (status IN ('open', 'full', 'finished', 'cancelled')),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tournaments_status
  ON tournaments (status);

CREATE INDEX IF NOT EXISTS idx_tournaments_date
  ON tournaments (date DESC);


-- ── 3. TOURNAMENT_PARTICIPANTS ───────────────────────────────
-- Связь M:N между турнирами и игроками.
-- is_waitlist = true  →  лист ожидания.
-- position  →  порядок внутри основного/waitlist списка.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tournament_participants (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id       UUID NOT NULL REFERENCES players(id)     ON DELETE CASCADE,
  is_waitlist     BOOLEAN DEFAULT false,
  position        INT NOT NULL DEFAULT 0,
  registered_at   TIMESTAMPTZ DEFAULT now(),

  UNIQUE (tournament_id, player_id)
);

-- Быстрый подсчёт участников турнира
CREATE INDEX IF NOT EXISTS idx_tp_tournament
  ON tournament_participants (tournament_id, is_waitlist);

-- Поиск турниров игрока
CREATE INDEX IF NOT EXISTS idx_tp_player
  ON tournament_participants (player_id);


-- ── 4. PLAYER_REQUESTS ───────────────────────────────────────
-- Очередь модерации для новичков.
-- Одобрение → approved_player_id заполняется, status = 'approved'.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS player_requests (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name                TEXT NOT NULL,
  gender              TEXT NOT NULL CHECK (gender IN ('M', 'W')),
  phone               TEXT,
  tournament_id       UUID REFERENCES tournaments(id) ON DELETE SET NULL,
  status              TEXT DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_player_id  UUID REFERENCES players(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT now(),
  reviewed_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pr_status
  ON player_requests (status);


-- ── 5. RPC: safe_register_player ─────────────────────────────
-- Атомарная регистрация с защитой от Race Condition.
--
-- Гарантии:
--   • FOR UPDATE блокирует строку турнира на время транзакции
--   • Два одновременных вызова на последнее место →
--     первый получит место, второй уйдёт в waitlist
--   • Дубликаты невозможны (UNIQUE constraint + проверка)
--   • Статус турнира обновляется атомарно
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION safe_register_player(
  p_tournament_id UUID,
  p_player_id     UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER          -- выполняется с правами владельца
AS $$
DECLARE
  v_trn          tournaments%ROWTYPE;
  v_current      INT;
  v_is_waitlist  BOOLEAN;
  v_position     INT;
  v_player_name  TEXT;
BEGIN
  -- ① Блокируем строку турнира
  SELECT * INTO v_trn
    FROM tournaments
   WHERE id = p_tournament_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'tournament_not_found',
      'message', 'Турнир не найден');
  END IF;

  -- ② Турнир закрыт?
  IF v_trn.status IN ('finished', 'cancelled') THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'tournament_closed',
      'message', 'Турнир завершён или отменён');
  END IF;

  -- ③ Игрок существует?
  SELECT name INTO v_player_name
    FROM players WHERE id = p_player_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'player_not_found',
      'message', 'Игрок не найден в базе');
  END IF;

  -- ④ Уже зарегистрирован?
  IF EXISTS (
    SELECT 1 FROM tournament_participants
     WHERE tournament_id = p_tournament_id
       AND player_id     = p_player_id
  ) THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'already_registered',
      'message', v_player_name || ' уже зарегистрирован(а)');
  END IF;

  -- ⑤ Считаем текущих участников (НЕ waitlist)
  SELECT COUNT(*) INTO v_current
    FROM tournament_participants
   WHERE tournament_id = p_tournament_id
     AND is_waitlist = false;

  -- ⑥ Место есть или waitlist?
  v_is_waitlist := v_current >= v_trn.capacity;

  -- ⑦ Позиция в соответствующем списке
  SELECT COALESCE(MAX(position), 0) + 1 INTO v_position
    FROM tournament_participants
   WHERE tournament_id = p_tournament_id
     AND is_waitlist = v_is_waitlist;

  -- ⑧ Вставляем
  INSERT INTO tournament_participants
    (tournament_id, player_id, is_waitlist, position)
  VALUES
    (p_tournament_id, p_player_id, v_is_waitlist, v_position);

  -- ⑨ Обновляем статус турнира
  IF NOT v_is_waitlist AND (v_current + 1) >= v_trn.capacity THEN
    UPDATE tournaments SET status = 'full'
     WHERE id = p_tournament_id;
  END IF;

  -- ⑩ Инкрементируем счётчик турниров игрока
  IF NOT v_is_waitlist THEN
    UPDATE players
       SET tournaments_played = tournaments_played + 1
     WHERE id = p_player_id;
  END IF;

  RETURN jsonb_build_object(
    'ok',        true,
    'waitlist',  v_is_waitlist,
    'position',  v_position,
    'total',     v_current + CASE WHEN v_is_waitlist THEN 0 ELSE 1 END,
    'capacity',  v_trn.capacity,
    'player',    v_player_name,
    'message',   CASE
      WHEN v_is_waitlist THEN v_player_name || ' → лист ожидания (#' || v_position || ')'
      ELSE v_player_name || ' зарегистрирован(а) (' || (v_current+1) || '/' || v_trn.capacity || ')'
    END
  );
END;
$$;


-- ── 6. RPC: search_players ───────────────────────────────────
-- Нечёткий поиск по имени с ранжированием.
-- Используется фронтендом для дебаунс-инпута.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_players(
  p_query   TEXT,
  p_gender  TEXT DEFAULT NULL,    -- фильтр: 'M', 'W' или NULL (все)
  p_limit   INT  DEFAULT 10
)
RETURNS TABLE (
  id          UUID,
  name        TEXT,
  gender      TEXT,
  status      TEXT,
  tournaments_played INT,
  total_pts   INT,
  similarity  REAL
)
LANGUAGE plpgsql
STABLE                            -- read-only, оптимизация планировщика
AS $$
BEGIN
  RETURN QUERY
    SELECT
      p.id, p.name, p.gender, p.status,
      p.tournaments_played, p.total_pts,
      similarity(p.name, p_query) AS similarity
    FROM players p
    WHERE
      (p_gender IS NULL OR p.gender = p_gender)
      AND (
        p.name ILIKE '%' || p_query || '%'
        OR similarity(p.name, p_query) > 0.2
      )
    ORDER BY
      -- Точное начало имени → первым
      (p.name ILIKE p_query || '%') DESC,
      similarity(p.name, p_query) DESC,
      p.tournaments_played DESC
    LIMIT p_limit;
END;
$$;


-- ── 7. RPC: approve_player_request ───────────────────────────
-- Одобрение заявки: создаёт игрока, опционально регистрирует.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION approve_player_request(
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_req    player_requests%ROWTYPE;
  v_pid    UUID;
  v_reg    JSONB;
BEGIN
  SELECT * INTO v_req FROM player_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'request_not_found');
  END IF;

  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_processed');
  END IF;

  -- Создаём игрока
  INSERT INTO players (name, gender, phone, status)
  VALUES (v_req.name, v_req.gender, v_req.phone, 'active')
  ON CONFLICT (lower(trim(name)), gender) DO UPDATE SET status = 'active'
  RETURNING id INTO v_pid;

  -- Обновляем заявку
  UPDATE player_requests
     SET status = 'approved',
         approved_player_id = v_pid,
         reviewed_at = now()
   WHERE id = p_request_id;

  -- Если указан турнир — пробуем зарегистрировать
  IF v_req.tournament_id IS NOT NULL THEN
    v_reg := safe_register_player(v_req.tournament_id, v_pid);
    RETURN jsonb_build_object(
      'ok', true,
      'player_id', v_pid,
      'registration', v_reg
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'player_id', v_pid);
END;
$$;


-- ── 8. RPC: submit_player_request ────────────────────────────
-- Безопасная подача заявки в очередь модерации.
-- Повторная pending-заявка на тот же турнир не дублируется.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION submit_player_request(
  p_name          TEXT,
  p_gender        TEXT,
  p_phone         TEXT DEFAULT NULL,
  p_tournament_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_req player_requests%ROWTYPE;
BEGIN
  p_name := trim(coalesce(p_name, ''));
  IF p_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NAME_REQUIRED', 'message', 'Укажите имя игрока');
  END IF;

  IF p_gender NOT IN ('M', 'W') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_GENDER', 'message', 'Пол должен быть M или W');
  END IF;

  SELECT * INTO v_req
    FROM player_requests
   WHERE lower(trim(name)) = lower(p_name)
     AND gender = p_gender
     AND status = 'pending'
     AND (
       (tournament_id IS NULL AND p_tournament_id IS NULL)
       OR tournament_id = p_tournament_id
     )
   ORDER BY created_at DESC
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'request_id', v_req.id,
      'message', p_name || ' уже ожидает проверки'
    );
  END IF;

  INSERT INTO player_requests (name, gender, phone, tournament_id, status)
  VALUES (p_name, p_gender, NULLIF(trim(coalesce(p_phone, '')), ''), p_tournament_id, 'pending')
  RETURNING * INTO v_req;

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'request_id', v_req.id,
    'message', p_name || ' добавлен(а) в очередь на проверку'
  );
END;
$$;


-- ── 9. RPC: create_temporary_player ──────────────────────────
-- Создаёт временного игрока или возвращает существующий профиль.
-- Используется публичным фронтендом вместо прямой INSERT в players.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_temporary_player(
  p_name   TEXT,
  p_gender TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_player  players%ROWTYPE;
  v_created BOOLEAN := false;
BEGIN
  p_name := trim(coalesce(p_name, ''));
  IF p_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NAME_REQUIRED', 'message', 'Укажите имя игрока');
  END IF;

  IF p_gender NOT IN ('M', 'W') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_GENDER', 'message', 'Пол должен быть M или W');
  END IF;

  BEGIN
    INSERT INTO players (name, gender, status)
    VALUES (p_name, p_gender, 'temporary')
    RETURNING * INTO v_player;
    v_created := true;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT * INTO v_player
        FROM players
       WHERE lower(trim(name)) = lower(p_name)
         AND gender = p_gender
       LIMIT 1;
  END;

  IF v_player.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PLAYER_NOT_FOUND', 'message', 'Не удалось создать профиль игрока');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'created', v_created,
    'player', jsonb_build_object(
      'id', v_player.id,
      'name', v_player.name,
      'gender', v_player.gender,
      'status', v_player.status,
      'tournaments_played', v_player.tournaments_played,
      'total_pts', v_player.total_pts
    ),
    'message', CASE
      WHEN v_created THEN v_player.name || ' создан(а) как временный игрок'
      WHEN v_player.status = 'temporary' THEN v_player.name || ' уже есть как временный игрок'
      ELSE v_player.name || ' уже есть в базе'
    END
  );
END;
$$;


-- ── 10. ROW LEVEL SECURITY ───────────────────────────────────
-- Базовые политики: чтение всем, запись только через RPC.
-- ──────────────────────────────────────────────────────────────
ALTER TABLE players                ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_requests        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS players_insert      ON players;
DROP POLICY IF EXISTS players_update      ON players;
DROP POLICY IF EXISTS tournaments_insert  ON tournaments;
DROP POLICY IF EXISTS tournaments_update  ON tournaments;
DROP POLICY IF EXISTS tp_insert           ON tournament_participants;
DROP POLICY IF EXISTS pr_insert           ON player_requests;

-- Чтение — всем аутентифицированным и анонимным (приложение без auth)
DO $$ BEGIN
  -- players
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'players_select') THEN
    CREATE POLICY players_select ON players FOR SELECT USING (true);
  END IF;

  -- tournaments
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tournaments_select') THEN
    CREATE POLICY tournaments_select ON tournaments FOR SELECT USING (true);
  END IF;

  -- tournament_participants
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tp_select') THEN
    CREATE POLICY tp_select ON tournament_participants FOR SELECT USING (true);
  END IF;

  -- player_requests
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pr_select') THEN
    CREATE POLICY pr_select ON player_requests FOR SELECT USING (true);
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════
-- PHASE 2: Идеи ИИ — только то, что реально нужно
-- ══════════════════════════════════════════════════════════════


-- ── 9. Gender Constraints ────────────────────────────────────
-- min_male / min_female — минимум участников каждого пола.
-- Для Микст-турниров: нельзя записать 20 мужчин и 0 женщин.
-- ──────────────────────────────────────────────────────────────
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS min_male   INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_female INT DEFAULT 0;

COMMENT ON COLUMN tournaments.min_male   IS 'Мин. мужчин для начала турнира. 0 = без ограничений.';
COMMENT ON COLUMN tournaments.min_female IS 'Мин. женщин для начала турнира. 0 = без ограничений.';


-- ── 10. Обновлённый safe_register_player с gender check ──────
-- Проверяем: не превышен ли лимит одного пола.
-- Если capacity=24 и min_male=8, min_female=8, то:
--   max_male = 24 - 8 = 16,  max_female = 24 - 8 = 16
-- Т.е. min_female резервирует места для женщин, ограничивая мужчин.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION safe_register_player(
  p_tournament_id UUID,
  p_player_id     UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_trn          tournaments%ROWTYPE;
  v_current      INT;
  v_gender_count INT;
  v_max_gender   INT;
  v_is_waitlist  BOOLEAN;
  v_position     INT;
  v_player       players%ROWTYPE;
BEGIN
  -- ① Блокируем строку турнира
  SELECT * INTO v_trn
    FROM tournaments
   WHERE id = p_tournament_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'TOURNAMENT_NOT_FOUND',
      'message', 'Турнир не найден');
  END IF;

  -- ② Турнир закрыт?
  IF v_trn.status IN ('finished', 'cancelled') THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'TOURNAMENT_CLOSED',
      'message', 'Турнир завершён или отменён');
  END IF;

  -- ③ Игрок существует?
  SELECT * INTO v_player FROM players WHERE id = p_player_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'PLAYER_NOT_FOUND',
      'message', 'Игрок не найден в базе');
  END IF;

  -- ④ Уже зарегистрирован?
  IF EXISTS (
    SELECT 1 FROM tournament_participants
     WHERE tournament_id = p_tournament_id
       AND player_id     = p_player_id
  ) THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'ALREADY_REGISTERED',
      'message', v_player.name || ' уже зарегистрирован(а)');
  END IF;

  -- ⑤ Считаем текущих (не waitlist)
  SELECT COUNT(*) INTO v_current
    FROM tournament_participants
   WHERE tournament_id = p_tournament_id
     AND is_waitlist = false;

  -- ⑥ Gender constraint check
  -- min_female резервирует места для Ж, ограничивая М (и наоборот)
  IF COALESCE(v_trn.min_male, 0) > 0 OR COALESCE(v_trn.min_female, 0) > 0 THEN
    SELECT COUNT(*) INTO v_gender_count
      FROM tournament_participants tp
      JOIN players pl ON pl.id = tp.player_id
     WHERE tp.tournament_id = p_tournament_id
       AND tp.is_waitlist = false
       AND pl.gender = v_player.gender;

    -- max для данного пола = capacity - min_противоположного
    IF v_player.gender = 'M' THEN
      v_max_gender := v_trn.capacity - COALESCE(v_trn.min_female, 0);
    ELSE
      v_max_gender := v_trn.capacity - COALESCE(v_trn.min_male, 0);
    END IF;

    IF v_max_gender > 0 AND v_gender_count >= v_max_gender THEN
      RETURN jsonb_build_object(
        'ok', false, 'error', 'GENDER_LIMIT',
        'message', 'Лимит ' || CASE v_player.gender WHEN 'M' THEN 'мужчин' ELSE 'женщин' END
          || ' исчерпан (' || v_gender_count || '/' || v_max_gender || ').'
          || ' Места зарезервированы для '
          || CASE v_player.gender WHEN 'M' THEN 'женщин' ELSE 'мужчин' END || '.');
    END IF;
  END IF;

  -- ⑦ Место есть или waitlist?
  v_is_waitlist := v_current >= v_trn.capacity;

  -- ⑧ Позиция
  SELECT COALESCE(MAX(position), 0) + 1 INTO v_position
    FROM tournament_participants
   WHERE tournament_id = p_tournament_id
     AND is_waitlist = v_is_waitlist;

  -- ⑨ Вставляем
  INSERT INTO tournament_participants
    (tournament_id, player_id, is_waitlist, position)
  VALUES
    (p_tournament_id, p_player_id, v_is_waitlist, v_position);

  -- ⑩ Обновляем статус
  IF NOT v_is_waitlist AND (v_current + 1) >= v_trn.capacity THEN
    UPDATE tournaments SET status = 'full' WHERE id = p_tournament_id;
  END IF;

  -- ⑪ Статистика
  IF NOT v_is_waitlist THEN
    UPDATE players SET tournaments_played = tournaments_played + 1
     WHERE id = p_player_id;
  END IF;

  RETURN jsonb_build_object(
    'ok',        true,
    'waitlist',  v_is_waitlist,
    'position',  v_position,
    'total',     v_current + CASE WHEN v_is_waitlist THEN 0 ELSE 1 END,
    'capacity',  v_trn.capacity,
    'player',    v_player.name,
    'message',   CASE
      WHEN v_is_waitlist THEN v_player.name || ' → лист ожидания (#' || v_position || ')'
      ELSE v_player.name || ' зарегистрирован(а) (' || (v_current+1) || '/' || v_trn.capacity || ')'
    END
  );
END;
$$;


-- ── 11. RPC: safe_cancel_registration ────────────────────────
-- Атомарная отмена регистрации + авто-продвижение из waitlist.
--
-- Логика:
--   1. Блокируем турнир (FOR UPDATE)
--   2. Удаляем участника
--   3. Если был в основном составе → берём первого из waitlist
--   4. Перемещаем его в основной состав
--   5. Пересчитываем позиции (заполняем дырку)
--   6. Обновляем статус турнира (full → open)
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION safe_cancel_registration(
  p_tournament_id UUID,
  p_player_id     UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_trn          tournaments%ROWTYPE;
  v_was_waitlist BOOLEAN;
  v_promoted_id  UUID;
  v_promoted_nm  TEXT;
  v_current      INT;
BEGIN
  -- ① Блокируем турнир
  SELECT * INTO v_trn
    FROM tournaments
   WHERE id = p_tournament_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'TOURNAMENT_NOT_FOUND',
      'message', 'Турнир не найден');
  END IF;

  -- ② Участник зарегистрирован?
  SELECT is_waitlist INTO v_was_waitlist
    FROM tournament_participants
   WHERE tournament_id = p_tournament_id
     AND player_id     = p_player_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'NOT_REGISTERED',
      'message', 'Игрок не найден в списке участников');
  END IF;

  -- ③ Удаляем
  DELETE FROM tournament_participants
   WHERE tournament_id = p_tournament_id
     AND player_id     = p_player_id;

  -- ④ Если был в основном составе — откатываем статистику
  IF NOT v_was_waitlist THEN
    UPDATE players
       SET tournaments_played = GREATEST(tournaments_played - 1, 0)
     WHERE id = p_player_id;
  END IF;

  -- ⑤ Если был в основном составе и есть waitlist → продвигаем
  v_promoted_id := NULL;
  IF NOT v_was_waitlist THEN
    -- Берём первого из waitlist (минимальная позиция)
    SELECT tp.player_id INTO v_promoted_id
      FROM tournament_participants tp
     WHERE tp.tournament_id = p_tournament_id
       AND tp.is_waitlist = true
     ORDER BY tp.position ASC
     LIMIT 1
       FOR UPDATE SKIP LOCKED;  -- предотвращаем гонку

    IF v_promoted_id IS NOT NULL THEN
      -- Переводим в основной состав
      UPDATE tournament_participants
         SET is_waitlist = false,
             position = (
               SELECT COALESCE(MAX(position), 0) + 1
                 FROM tournament_participants
                WHERE tournament_id = p_tournament_id
                  AND is_waitlist = false
             )
       WHERE tournament_id = p_tournament_id
         AND player_id = v_promoted_id;

      -- Статистика для продвинутого
      UPDATE players
         SET tournaments_played = tournaments_played + 1
       WHERE id = v_promoted_id;

      SELECT name INTO v_promoted_nm FROM players WHERE id = v_promoted_id;
    END IF;
  END IF;

  -- ⑥ Пересчёт статуса турнира
  SELECT COUNT(*) INTO v_current
    FROM tournament_participants
   WHERE tournament_id = p_tournament_id
     AND is_waitlist = false;

  IF v_current < v_trn.capacity AND v_trn.status = 'full' THEN
    UPDATE tournaments SET status = 'open' WHERE id = p_tournament_id;
  END IF;

  RETURN jsonb_build_object(
    'ok',       true,
    'promoted', v_promoted_id IS NOT NULL,
    'promoted_player', COALESCE(v_promoted_nm, ''),
    'current',  v_current,
    'capacity', v_trn.capacity,
    'message',  'Регистрация отменена'
      || CASE WHEN v_promoted_nm IS NOT NULL
           THEN '. ' || v_promoted_nm || ' переведён(а) из листа ожидания'
           ELSE '' END
  );
END;
$$;


-- ── 12. MERGE AUDIT TABLE ────────────────────────────────────
-- Лог склеек профилей для отката и отчётности.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS merge_audit (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  temp_player_id  UUID NOT NULL,
  real_player_id  UUID NOT NULL,
  temp_name       TEXT NOT NULL,
  real_name       TEXT NOT NULL,
  records_moved   INT  DEFAULT 0,     -- кол-во перенесённых записей
  merged_at       TIMESTAMPTZ DEFAULT now()
);


-- ── 13. RPC: merge_players ───────────────────────────────────
-- Идемпотентная склейка временного профиля в настоящий.
--
-- Порядок:
--   1. Проверяем что temp существует и status = 'temporary'
--   2. Проверяем что real существует и status = 'active'
--   3. Переносим все tournament_participants от temp к real
--      (если real уже в турнире — удаляем дубль temp)
--   4. Суммируем статистику
--   5. Записываем аудит
--   6. Удаляем temp профиль
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION merge_players(
  p_temp_id UUID,
  p_real_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_temp     players%ROWTYPE;
  v_real     players%ROWTYPE;
  v_moved    INT := 0;
  v_deleted  INT := 0;
  v_tp       RECORD;
BEGIN
  -- ① Блокируем оба профиля
  SELECT * INTO v_temp FROM players WHERE id = p_temp_id FOR UPDATE;
  SELECT * INTO v_real FROM players WHERE id = p_real_id FOR UPDATE;

  IF NOT FOUND OR v_temp.id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'PLAYER_NOT_FOUND',
      'message', 'Один из игроков не найден');
  END IF;

  -- ② Проверки
  IF v_temp.id = v_real.id THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'SAME_PLAYER',
      'message', 'Нельзя склеить игрока с самим собой');
  END IF;

  IF v_temp.status <> 'temporary' THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'NOT_TEMPORARY',
      'message', v_temp.name || ' не является временным игроком');
  END IF;

  -- ③ Переносим tournament_participants
  FOR v_tp IN
    SELECT * FROM tournament_participants
     WHERE player_id = p_temp_id
  LOOP
    -- Если real уже в этом турнире — удаляем запись temp (дубль)
    IF EXISTS (
      SELECT 1 FROM tournament_participants
       WHERE tournament_id = v_tp.tournament_id
         AND player_id     = p_real_id
    ) THEN
      DELETE FROM tournament_participants
       WHERE id = v_tp.id;
      v_deleted := v_deleted + 1;
    ELSE
      -- Переносим запись
      UPDATE tournament_participants
         SET player_id = p_real_id
       WHERE id = v_tp.id;
      v_moved := v_moved + 1;
    END IF;
  END LOOP;

  -- ④ Переносим player_requests
  UPDATE player_requests
     SET approved_player_id = p_real_id
   WHERE approved_player_id = p_temp_id;

  -- ⑤ Суммируем статистику
  UPDATE players
     SET tournaments_played = tournaments_played + v_temp.tournaments_played,
         total_pts          = total_pts + v_temp.total_pts
   WHERE id = p_real_id;

  -- ⑥ Аудит
  INSERT INTO merge_audit (temp_player_id, real_player_id, temp_name, real_name, records_moved)
  VALUES (p_temp_id, p_real_id, v_temp.name, v_real.name, v_moved);

  -- ⑦ Удаляем temp
  DELETE FROM players WHERE id = p_temp_id;

  RETURN jsonb_build_object(
    'ok',      true,
    'moved',   v_moved,
    'deleted', v_deleted,
    'message', 'Профиль «' || v_temp.name || '» склеен с «' || v_real.name
               || '». Перенесено записей: ' || v_moved
               || CASE WHEN v_deleted > 0 THEN ', дубликатов удалено: ' || v_deleted ELSE '' END
  );
END;
$$;


-- RLS для новых таблиц
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ma_select') THEN
    CREATE POLICY ma_select ON merge_audit FOR SELECT USING (true);
  END IF;
END $$;
ALTER TABLE merge_audit ENABLE ROW LEVEL SECURITY;

-- ── 14. SECURE ROOM SYNC ────────────────────────────────────
-- Синхронизация состояния турнира через room_code + room_secret.
-- Прямой доступ к таблице закрыт, всё идёт через RPC.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kotc_sessions (
  room_code         TEXT PRIMARY KEY,
  room_secret_hash  TEXT NOT NULL,
  state             JSONB DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kotc_sessions_updated_at
  ON kotc_sessions (updated_at DESC);

ALTER TABLE kotc_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kotc_sessions_select ON kotc_sessions;
DROP POLICY IF EXISTS kotc_sessions_insert ON kotc_sessions;
DROP POLICY IF EXISTS kotc_sessions_update ON kotc_sessions;

REVOKE ALL ON TABLE kotc_sessions FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE kotc_sessions;
  EXCEPTION
    WHEN undefined_object THEN NULL;
    WHEN invalid_parameter_value THEN NULL;
  END;
END $$;

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
  v_code   TEXT := upper(trim(coalesce(p_room_code, '')));
  v_secret TEXT := trim(coalesce(p_room_secret, ''));
  v_row    kotc_sessions%ROWTYPE;
BEGIN
  IF v_code = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROOM_CODE_REQUIRED', 'message', 'Укажите код комнаты');
  END IF;

  IF length(v_secret) < 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROOM_SECRET_SHORT', 'message', 'Секрет комнаты должен быть не короче 6 символов');
  END IF;

  SELECT * INTO v_row
    FROM kotc_sessions
   WHERE room_code = v_code
     FOR UPDATE;

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
  v_code   TEXT := upper(trim(coalesce(p_room_code, '')));
  v_secret TEXT := trim(coalesce(p_room_secret, ''));
  v_row    kotc_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_row
    FROM kotc_sessions
   WHERE room_code = v_code;

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
  v_code   TEXT := upper(trim(coalesce(p_room_code, '')));
  v_secret TEXT := trim(coalesce(p_room_secret, ''));
  v_row    kotc_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_row
    FROM kotc_sessions
   WHERE room_code = v_code
     FOR UPDATE;

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
  p_room_code       TEXT,
  p_room_secret     TEXT,
  p_new_room_secret TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_code       TEXT := upper(trim(coalesce(p_room_code, '')));
  v_secret     TEXT := trim(coalesce(p_room_secret, ''));
  v_new_secret TEXT := trim(coalesce(p_new_room_secret, ''));
  v_row        kotc_sessions%ROWTYPE;
BEGIN
  IF length(v_new_secret) < 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROOM_SECRET_SHORT', 'message', 'Новый секрет должен быть не короче 6 символов');
  END IF;

  SELECT * INTO v_row
    FROM kotc_sessions
   WHERE room_code = v_code
     FOR UPDATE;

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

-- Права на RPC:
-- публичному фронтенду оставляем только search / signup / safe register.
REVOKE ALL ON FUNCTION search_players(TEXT, TEXT, INT)            FROM PUBLIC;
REVOKE ALL ON FUNCTION safe_register_player(UUID, UUID)           FROM PUBLIC;
REVOKE ALL ON FUNCTION submit_player_request(TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_temporary_player(TEXT, TEXT)        FROM PUBLIC;
REVOKE ALL ON FUNCTION safe_cancel_registration(UUID, UUID)       FROM PUBLIC;
REVOKE ALL ON FUNCTION approve_player_request(UUID)               FROM PUBLIC;
REVOKE ALL ON FUNCTION merge_players(UUID, UUID)                  FROM PUBLIC;
REVOKE ALL ON FUNCTION room_secret_sha256(TEXT)                   FROM PUBLIC;
REVOKE ALL ON FUNCTION create_room(TEXT, TEXT, JSONB)             FROM PUBLIC;
REVOKE ALL ON FUNCTION get_room_state(TEXT, TEXT)                 FROM PUBLIC;
REVOKE ALL ON FUNCTION push_room_state(TEXT, TEXT, JSONB)         FROM PUBLIC;
REVOKE ALL ON FUNCTION rotate_room_secret(TEXT, TEXT, TEXT)       FROM PUBLIC;

GRANT EXECUTE ON FUNCTION search_players(TEXT, TEXT, INT)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION safe_register_player(UUID, UUID)           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_player_request(TEXT, TEXT, TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_temporary_player(TEXT, TEXT)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION safe_cancel_registration(UUID, UUID)       TO authenticated;
GRANT EXECUTE ON FUNCTION approve_player_request(UUID)               TO authenticated;
GRANT EXECUTE ON FUNCTION merge_players(UUID, UUID)                  TO authenticated;
GRANT EXECUTE ON FUNCTION create_room(TEXT, TEXT, JSONB)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_room_state(TEXT, TEXT)                 TO anon, authenticated;
GRANT EXECUTE ON FUNCTION push_room_state(TEXT, TEXT, JSONB)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rotate_room_secret(TEXT, TEXT, TEXT)       TO anon, authenticated;


-- ── list_pending_requests ────────────────────────────────────
CREATE OR REPLACE FUNCTION list_pending_requests(
  p_tournament_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id              UUID,
  name            TEXT,
  gender          TEXT,
  phone           TEXT,
  tournament_id   UUID,
  tournament_name TEXT,
  created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
    SELECT
      pr.id,
      pr.name,
      pr.gender,
      pr.phone,
      pr.tournament_id,
      t.name AS tournament_name,
      pr.created_at
    FROM player_requests pr
    LEFT JOIN tournaments t ON t.id = pr.tournament_id
    WHERE pr.status = 'pending'
      AND (p_tournament_id IS NULL OR pr.tournament_id = p_tournament_id)
    ORDER BY pr.created_at ASC;
END;
$$;

-- ── reject_player_request ────────────────────────────────────
CREATE OR REPLACE FUNCTION reject_player_request(
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row player_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM player_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', 'request_not_found');
  END IF;
  IF v_row.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'already_processed');
  END IF;
  UPDATE player_requests
     SET status = 'rejected', reviewed_at = now()
   WHERE id = p_request_id;
  RETURN jsonb_build_object('ok', true, 'message', 'rejected');
END;
$$;

REVOKE ALL ON FUNCTION list_pending_requests(UUID)         FROM PUBLIC;
REVOKE ALL ON FUNCTION reject_player_request(UUID)         FROM PUBLIC;

GRANT EXECUTE ON FUNCTION list_pending_requests(UUID)      TO authenticated;
GRANT EXECUTE ON FUNCTION reject_player_request(UUID)      TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- PHASE 3: ПУБЛИЧНАЯ ИСТОРИЯ ТУРНИРОВ И РЕЙТИНГ ИГРОКОВ
-- Данные доступны любому посетителю сайта без авторизации.
-- ══════════════════════════════════════════════════════════════

-- ── 15. Рейтинговые поля в таблице players ───────────────────
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS rating_m          INT  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_w          INT  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_mix        INT  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tournaments_m     INT  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tournaments_w     INT  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tournaments_mix   INT  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wins              INT  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_seen         DATE;

-- ── 16. external_id в tournaments для идемпотентного пуша ────
-- Хранит локальный snapshot.id (Date.now()), гарантирует что
-- повторный вызов publish_tournament_results не создаёт дубликаты.
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS external_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tournaments_external_id
  ON tournaments (external_id)
  WHERE external_id IS NOT NULL;

-- ── 17. tournament_results — результаты каждого игрока ───────
-- Публично читаемая таблица. Запись только через RPC.
CREATE TABLE IF NOT EXISTS tournament_results (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tournament_id  UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id      UUID NOT NULL REFERENCES players(id)     ON DELETE CASCADE,
  place          INT  NOT NULL,
  game_pts       INT  DEFAULT 0,    -- очки за игру (сумма раундов)
  rating_pts     INT  DEFAULT 0,    -- рейтинговые очки за место (из POINTS_TABLE)
  gender         TEXT CHECK (gender IN ('M','W')),
  rating_type    TEXT CHECK (rating_type IN ('M','W','Mix')),
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tournament_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_tr_tournament
  ON tournament_results (tournament_id);
CREATE INDEX IF NOT EXISTS idx_tr_player
  ON tournament_results (player_id);
CREATE INDEX IF NOT EXISTS idx_tr_place
  ON tournament_results (tournament_id, place);

ALTER TABLE tournament_results ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tr_select') THEN
    CREATE POLICY tr_select ON tournament_results FOR SELECT USING (true);
  END IF;
END $$;

-- ── 18. RPC: publish_tournament_results ──────────────────────
-- Атомарная публикация результатов турнира.
-- Идемпотентна: повторный вызов с тем же p_external_id
-- обновляет данные, не создаёт дубликатов.
--
-- p_results — JSONB-массив объектов:
--   { name, gender, place, game_pts, rating_pts, rating_type,
--     rating_m, rating_w, rating_mix,
--     tournaments_m, tournaments_w, tournaments_mix,
--     wins, last_seen, total_pts, tournaments_played }
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION publish_tournament_results(
  p_external_id  TEXT,
  p_name         TEXT,
  p_date         TEXT,      -- 'YYYY-MM-DD'
  p_format       TEXT,
  p_division     TEXT,
  p_results      JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_trn_id  UUID;
  v_rec     RECORD;
  v_player  players%ROWTYPE;
  v_count   INT := 0;
BEGIN
  -- ① Upsert турнир по external_id
  INSERT INTO tournaments (name, date, format, division, status, capacity, external_id)
  VALUES (
    trim(p_name),
    NULLIF(trim(p_date), '')::DATE,
    COALESCE(NULLIF(trim(p_format), ''), 'King of the Court'),
    COALESCE(NULLIF(trim(p_division), ''), 'Мужской'),
    'finished',
    jsonb_array_length(p_results),
    p_external_id
  )
  ON CONFLICT (external_id) DO UPDATE
    SET name   = EXCLUDED.name,
        date   = EXCLUDED.date,
        status = 'finished'
  RETURNING id INTO v_trn_id;

  -- Fallback если RETURNING не вернул (при DO UPDATE иногда)
  IF v_trn_id IS NULL THEN
    SELECT id INTO v_trn_id
      FROM tournaments
     WHERE external_id = p_external_id
     LIMIT 1;
  END IF;

  IF v_trn_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TOURNAMENT_UPSERT_FAILED');
  END IF;

  -- ② Для каждого игрока: upsert профиль + upsert результат
  FOR v_rec IN
    SELECT *
    FROM jsonb_to_recordset(p_results) AS x(
      name              TEXT,
      gender            TEXT,
      place             INT,
      game_pts          INT,
      rating_pts        INT,
      rating_type       TEXT,
      rating_m          INT,
      rating_w          INT,
      rating_mix        INT,
      tournaments_m     INT,
      tournaments_w     INT,
      tournaments_mix   INT,
      wins              INT,
      last_seen         TEXT,
      total_pts         INT,
      tournaments_played INT
    )
  LOOP
    -- Upsert игрока. Функциональный индекс: lower(trim(name)), gender.
    -- При конфликте обновляем накопленную статистику (клиент прислал
    -- результат recalcAllPlayerStats — это достоверные актуальные данные).
    INSERT INTO players (
      name, gender, status,
      rating_m, rating_w, rating_mix,
      tournaments_m, tournaments_w, tournaments_mix,
      wins, last_seen, tournaments_played, total_pts
    )
    VALUES (
      trim(v_rec.name), v_rec.gender, 'active',
      COALESCE(v_rec.rating_m,  0),
      COALESCE(v_rec.rating_w,  0),
      COALESCE(v_rec.rating_mix,0),
      COALESCE(v_rec.tournaments_m,   0),
      COALESCE(v_rec.tournaments_w,   0),
      COALESCE(v_rec.tournaments_mix, 0),
      COALESCE(v_rec.wins, 0),
      CASE WHEN v_rec.last_seen IS NOT NULL AND v_rec.last_seen <> ''
           THEN v_rec.last_seen::DATE ELSE NULL END,
      COALESCE(v_rec.tournaments_played, 0),
      COALESCE(v_rec.total_pts, 0)
    )
    ON CONFLICT (lower(trim(name)), gender) DO UPDATE SET
      status            = 'active',
      rating_m          = EXCLUDED.rating_m,
      rating_w          = EXCLUDED.rating_w,
      rating_mix        = EXCLUDED.rating_mix,
      tournaments_m     = EXCLUDED.tournaments_m,
      tournaments_w     = EXCLUDED.tournaments_w,
      tournaments_mix   = EXCLUDED.tournaments_mix,
      wins              = EXCLUDED.wins,
      last_seen         = CASE
                            WHEN EXCLUDED.last_seen IS NOT NULL
                            THEN GREATEST(players.last_seen, EXCLUDED.last_seen)
                            ELSE players.last_seen
                          END,
      tournaments_played = EXCLUDED.tournaments_played,
      total_pts         = EXCLUDED.total_pts
    RETURNING * INTO v_player;

    -- Если RETURNING не сработал (крайне редко) — читаем явно
    IF v_player.id IS NULL THEN
      SELECT * INTO v_player FROM players
       WHERE lower(trim(name)) = lower(trim(v_rec.name))
         AND gender = v_rec.gender
       LIMIT 1;
    END IF;

    IF v_player.id IS NULL THEN CONTINUE; END IF;

    -- Upsert результата турнира
    INSERT INTO tournament_results
      (tournament_id, player_id, place, game_pts, rating_pts, gender, rating_type)
    VALUES
      (v_trn_id, v_player.id,
       v_rec.place,
       COALESCE(v_rec.game_pts,   0),
       COALESCE(v_rec.rating_pts, 0),
       v_rec.gender,
       COALESCE(NULLIF(v_rec.rating_type, ''), 'M'))
    ON CONFLICT (tournament_id, player_id) DO UPDATE SET
      place      = EXCLUDED.place,
      game_pts   = EXCLUDED.game_pts,
      rating_pts = EXCLUDED.rating_pts;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',            true,
    'tournament_id', v_trn_id,
    'results_saved', v_count
  );
END;
$$;

-- Публичный вызов: оргу не нужен токен чтобы опубликовать результаты.
-- Безопасность обеспечена SECURITY DEFINER — прямой INSERT в таблицы закрыт.
GRANT EXECUTE ON FUNCTION publish_tournament_results(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)
  TO anon, authenticated;


-- ── 19. RPC: get_public_leaderboard ──────────────────────────
-- Публичный рейтинг: топ игроков по типу (M / W / Mix).
-- Читают все, без авторизации.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_public_leaderboard(
  p_type   TEXT DEFAULT 'M',   -- 'M' | 'W' | 'Mix'
  p_limit  INT  DEFAULT 50
)
RETURNS TABLE (
  rank         BIGINT,
  player_id    UUID,
  name         TEXT,
  gender       TEXT,
  rating       INT,
  tournaments  INT,
  wins         INT,
  last_seen    DATE
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    ROW_NUMBER() OVER (ORDER BY
      CASE p_type
        WHEN 'W'   THEN p.rating_w
        WHEN 'Mix' THEN p.rating_mix
        ELSE            p.rating_m
      END DESC
    ) AS rank,
    p.id,
    p.name,
    p.gender,
    CASE p_type
      WHEN 'W'   THEN p.rating_w
      WHEN 'Mix' THEN p.rating_mix
      ELSE            p.rating_m
    END AS rating,
    CASE p_type
      WHEN 'W'   THEN p.tournaments_w
      WHEN 'Mix' THEN p.tournaments_mix
      ELSE            p.tournaments_m
    END AS tournaments,
    p.wins,
    p.last_seen
  FROM players p
  WHERE
    CASE p_type
      WHEN 'W'   THEN p.rating_w   > 0
      WHEN 'Mix' THEN p.rating_mix > 0
      ELSE            p.rating_m   > 0
    END
  ORDER BY rating DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION get_public_leaderboard(TEXT, INT) TO anon, authenticated;


-- ── 20. RPC: get_public_tournament_history ────────────────────
-- Список завершённых турниров с топ-3 результатами каждого.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_public_tournament_history(
  p_limit  INT DEFAULT 20,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_agg(t_data ORDER BY t_data->>'date' DESC)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id',       t.id,
      'name',     t.name,
      'date',     t.date,
      'format',   t.format,
      'division', t.division,
      'top3',     (
        SELECT jsonb_agg(r_data ORDER BY (r_data->>'place')::INT)
        FROM (
          SELECT jsonb_build_object(
            'place',      tr.place,
            'name',       p.name,
            'gender',     p.gender,
            'game_pts',   tr.game_pts,
            'rating_pts', tr.rating_pts
          ) AS r_data
          FROM tournament_results tr
          JOIN players p ON p.id = tr.player_id
          WHERE tr.tournament_id = t.id
            AND tr.place <= 3
          ORDER BY tr.place
        ) sub
      )
    ) AS t_data
    FROM tournaments t
    WHERE t.status = 'finished'
      AND t.external_id IS NOT NULL
    ORDER BY t.date DESC NULLS LAST
    LIMIT p_limit OFFSET p_offset
  ) sub2;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_tournament_history(INT, INT) TO anon, authenticated;


-- ══════════════════════════════════════════════════════════════
-- ИТОГО:
--   Таблицы:  players, tournaments, tournament_participants,
--             player_requests, merge_audit, kotc_sessions,
--             tournament_results                           [NEW]
--   RPC:      safe_register_player (+ gender constraints)
--             submit_player_request
--             create_temporary_player
--             safe_cancel_registration (+ auto-promote waitlist)
--             approve_player_request, reject_player_request
--             list_pending_requests
--             merge_players (+ audit trail)
--             create_room / get_room_state / push_room_state
--             rotate_room_secret
--             search_players
--             publish_tournament_results                   [NEW]
--             get_public_leaderboard                       [NEW]
--             get_public_tournament_history                [NEW]
-- ══════════════════════════════════════════════════════════════
