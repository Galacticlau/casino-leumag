CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  event_name TEXT NOT NULL DEFAULT 'Casino Escolar',
  currency_name TEXT NOT NULL DEFAULT 'fichas',
  initial_balance INTEGER NOT NULL DEFAULT 1000 CHECK (initial_balance >= 0),
  allow_negative BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS app_sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS app_sessions_expiry_idx ON app_sessions (expires_at);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(40) NOT NULL UNIQUE,
  display_name VARCHAR(80) NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('player', 'game_admin', 'superadmin')),
  balance INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS games (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  slug VARCHAR(90) NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  min_amount INTEGER NOT NULL DEFAULT 10 CHECK (min_amount > 0),
  max_amount INTEGER NOT NULL DEFAULT 500 CHECK (max_amount >= min_amount),
  max_players INTEGER NOT NULL DEFAULT 1 CHECK (max_players BETWEEN 1 AND 10),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS max_players INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_max_players_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_max_players_check
      CHECK (max_players BETWEEN 1 AND 10);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS game_admins (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, game_id)
);

CREATE TABLE IF NOT EXISTS game_rounds (
  id BIGSERIAL PRIMARY KEY,
  game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'cancelled')),
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_round_per_game
ON game_rounds (game_id)
WHERE status = 'active';

CREATE TABLE IF NOT EXISTS join_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'playing', 'used', 'cancelled', 'expired')),
  round_id BIGINT REFERENCES game_rounds(id),
  transaction_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes')
);

ALTER TABLE join_requests
  ADD COLUMN IF NOT EXISTS round_id BIGINT REFERENCES game_rounds(id);

ALTER TABLE join_requests
  DROP CONSTRAINT IF EXISTS join_requests_status_check;

ALTER TABLE join_requests
  ADD CONSTRAINT join_requests_status_check
  CHECK (status IN ('pending', 'playing', 'used', 'cancelled', 'expired'));

UPDATE join_requests
SET status = 'expired'
WHERE status = 'pending' AND expires_at <= NOW();

WITH repeated AS (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS position
  FROM join_requests
  WHERE status IN ('pending', 'playing')
)
UPDATE join_requests
SET status = 'cancelled', round_id = NULL
WHERE id IN (SELECT id FROM repeated WHERE position > 1);

DROP INDEX IF EXISTS one_pending_request_per_game;

CREATE UNIQUE INDEX IF NOT EXISTS one_active_request_per_player
ON join_requests (user_id)
WHERE status IN ('pending', 'playing');

CREATE INDEX IF NOT EXISTS join_requests_game_status_idx
ON join_requests (game_id, status, created_at);

CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  game_id BIGINT REFERENCES games(id),
  amount INTEGER NOT NULL CHECK (amount <> 0),
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('game_result', 'adjustment', 'reversal')),
  note VARCHAR(180) NOT NULL DEFAULT '',
  created_by BIGINT NOT NULL REFERENCES users(id),
  reversal_of BIGINT REFERENCES transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (balance_after = balance_before + amount)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_reversal_per_transaction
ON transactions (reversal_of)
WHERE reversal_of IS NOT NULL;

CREATE INDEX IF NOT EXISTS transactions_user_created_idx
ON transactions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS transactions_game_created_idx
ON transactions (game_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'join_requests_transaction_id_fkey'
  ) THEN
    ALTER TABLE join_requests
      ADD CONSTRAINT join_requests_transaction_id_fkey
      FOREIGN KEY (transaction_id) REFERENCES transactions(id);
  END IF;
END $$;
