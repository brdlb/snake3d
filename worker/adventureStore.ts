import { ADVENTURE_VERSION, copy, type AdventureRecord, type EntryCheckpoint } from '../shared/adventure';
import type { Env } from './index';

export const adventureEnabled = (env: Env) => env.ADVENTURE_ENABLED === 'true';
export async function loadAdventure(env: Env, userId: string): Promise<AdventureRecord | null> {
  const row = await env.DB.prepare('SELECT version,checkpoint_json,path_json FROM player_adventures WHERE user_id=?').bind(userId).first<{ version: number; checkpoint_json: string; path_json: string }>();
  if (!row || row.version !== ADVENTURE_VERSION) return null;
  return { version: row.version, checkpoint: JSON.parse(row.checkpoint_json) as EntryCheckpoint, path: JSON.parse(row.path_json) as number[] };
}
export function adventureStatement(env: Env, userId: string, checkpoint: EntryCheckpoint, path: number[]) {
  return env.DB.prepare('INSERT INTO player_adventures(user_id,version,checkpoint_json,path_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET version=excluded.version,checkpoint_json=excluded.checkpoint_json,path_json=excluded.path_json,updated_at=excluded.updated_at').bind(userId, ADVENTURE_VERSION, JSON.stringify(copy(checkpoint)), JSON.stringify(path), new Date().toISOString());
}
