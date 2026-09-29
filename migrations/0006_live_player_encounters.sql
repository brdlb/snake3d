CREATE TABLE live_player_encounters (
  id TEXT PRIMARY KEY,
  room_seed INTEGER NOT NULL REFERENCES rooms(seed),
  user_a_id TEXT NOT NULL REFERENCES users(id),
  user_b_id TEXT NOT NULL REFERENCES users(id),
  met_at TEXT NOT NULL,
  CHECK (user_a_id < user_b_id)
);
CREATE INDEX live_player_encounters_room_time ON live_player_encounters(room_seed, met_at);
