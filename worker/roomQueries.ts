export const ROOM_LIST_QUERY = `SELECT
  r.seed AS seed,
  r.total_games_played AS gamesPlayed,
  MAX(CASE WHEN s.spawn_index = 0 THEN s.best_score END) AS spawn0,
  MAX(CASE WHEN s.spawn_index = 1 THEN s.best_score END) AS spawn1,
  MAX(CASE WHEN s.spawn_index = 2 THEN s.best_score END) AS spawn2,
  MAX(CASE WHEN s.spawn_index = 3 THEN s.best_score END) AS spawn3
FROM rooms r
LEFT JOIN room_spawn_records s ON s.room_seed = r.seed
GROUP BY r.seed, r.total_games_played
ORDER BY r.updated_at DESC, r.seed ASC`;
