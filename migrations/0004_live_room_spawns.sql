-- Dynamic live-room spawns are kept independently of legacy spawn_index so
-- historical replay payloads and existing assignments remain readable.
ALTER TABLE room_assignments ADD COLUMN spawn_json TEXT;

CREATE TABLE IF NOT EXISTS live_room_assignments (
  room_seed INTEGER NOT NULL REFERENCES rooms(seed),
  user_id TEXT NOT NULL REFERENCES users(id),
  spawn_json TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (room_seed, user_id)
);
