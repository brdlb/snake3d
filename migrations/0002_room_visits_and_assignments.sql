ALTER TABLE users ADD COLUMN last_room_seed INTEGER;

CREATE TABLE user_room_visits (
  user_id TEXT NOT NULL REFERENCES users(id),
  room_seed INTEGER NOT NULL REFERENCES rooms(seed),
  visited_at TEXT NOT NULL,
  PRIMARY KEY (user_id, room_seed)
);
CREATE INDEX user_room_visits_user ON user_room_visits(user_id, visited_at DESC);

-- One row is the user's currently assigned attempt.  It is deliberately
-- separate from the visit history: a restart changes an attempt, not history.
CREATE TABLE room_assignments (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  room_seed INTEGER NOT NULL REFERENCES rooms(seed),
  spawn_index INTEGER NOT NULL CHECK (spawn_index BETWEEN 0 AND 3),
  assigned_at TEXT NOT NULL
);
CREATE INDEX room_assignments_room ON room_assignments(room_seed);

DELETE FROM replays
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY room_seed, user_id ORDER BY score DESC, created_at DESC, id DESC
    ) AS duplicate_rank
    FROM replays
  ) WHERE duplicate_rank > 1
);
CREATE UNIQUE INDEX replays_room_user ON replays(room_seed, user_id);
