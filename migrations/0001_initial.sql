CREATE TABLE users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL, created_at TEXT NOT NULL, last_seen TEXT NOT NULL,
  high_score INTEGER NOT NULL DEFAULT 0, high_score_seed INTEGER, high_score_replay_id TEXT, high_score_date TEXT,
  games_played INTEGER NOT NULL DEFAULT 0, total_score INTEGER NOT NULL DEFAULT 0, elo INTEGER NOT NULL DEFAULT 1000,
  settings_json TEXT NOT NULL DEFAULT '{"musicVolume":0.5,"sfxVolume":0.7}'
);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX sessions_expires_at ON sessions(expires_at);
CREATE TABLE rooms (seed INTEGER PRIMARY KEY, elo_bucket INTEGER NOT NULL, total_games_played INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
CREATE INDEX rooms_elo_bucket ON rooms(elo_bucket);
CREATE TABLE room_players (room_seed INTEGER NOT NULL REFERENCES rooms(seed), user_id TEXT NOT NULL REFERENCES users(id), spawn_index INTEGER NOT NULL, joined_at TEXT NOT NULL, PRIMARY KEY(room_seed, user_id));
CREATE TABLE replays (id TEXT PRIMARY KEY, room_seed INTEGER NOT NULL REFERENCES rooms(seed), user_id TEXT NOT NULL REFERENCES users(id), score INTEGER NOT NULL, created_at TEXT NOT NULL, payload_json TEXT NOT NULL);
CREATE INDEX replays_room_created ON replays(room_seed, created_at DESC);
CREATE TABLE game_submissions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), room_seed INTEGER NOT NULL, replay_id TEXT, result_json TEXT NOT NULL, created_at TEXT NOT NULL);
