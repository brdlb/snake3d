CREATE TABLE IF NOT EXISTS player_adventures (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  version INTEGER NOT NULL,
  checkpoint_json TEXT NOT NULL,
  path_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS adventure_transfers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  from_seed INTEGER NOT NULL,
  to_seed INTEGER NOT NULL,
  status TEXT NOT NULL,
  result_json TEXT,
  updated_at TEXT NOT NULL
);
