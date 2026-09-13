CREATE TABLE room_spawn_records (
  room_seed INTEGER NOT NULL REFERENCES rooms(seed),
  spawn_index INTEGER NOT NULL CHECK (spawn_index BETWEEN 0 AND 3),
  best_score INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (room_seed, spawn_index)
);

INSERT INTO room_spawn_records(room_seed, spawn_index, best_score, updated_at)
SELECT
  room_seed,
  CAST(json_extract(payload_json, '$.startParams.spawnIndex') AS INTEGER),
  MAX(score),
  MAX(created_at)
FROM replays
WHERE json_extract(payload_json, '$.startParams.spawnIndex') BETWEEN 0 AND 3
GROUP BY room_seed, json_extract(payload_json, '$.startParams.spawnIndex');
