import { ROOM_LIST_QUERY } from './roomQueries';
import {
  addPlayer,
  chooseLowestPhantom,
  createSimulation,
  foodEffect,
  safeSpawn,
  validInput,
  validOrientation,
  type Axis,
  type ReplayTrajectory,
  type SimPlayer,
  type SimulationState,
} from '../shared/simulation';
import { createRandomSnakeAppearance, isSnakeAppearance, normalizeSnakeAppearance, type SnakeAppearance } from '../shared/appearance';
import { adjacentRoom, crossedPortal, portalOffset, roomCoordinates, roomSeed, FIRST_ROOM_SEED, PORTAL_MIN_LENGTH, type PortalDirection } from '../shared/roomCoordinates';
import type { PauseInput } from '../shared/realtime';
import type {
  DeathInput,
  DirectionInput,
  RealtimeClientMessage,
  StateInput,
} from '../shared/realtime';
import { ADVENTURE_VERSION, advanceCoatings, applyInteractions, checkPortal, checkpointBlocked, copy, enterAdventure, moveAdventure, newAdventure, samePosition, transitionAdventure, validAdventureRoom, type AdventureSnake, type EntryCheckpoint, type RoomDefinition } from '../shared/adventure';
import { adventureEnabled, adventureStatement, loadAdventure } from './adventureStore';
import { generateSharedRoom, validateRoomDefinition } from '../shared/adventureGeneration';
export interface Env {
  ADVENTURE_ENABLED?: string;
  DB: D1Database;
  ROOMS: DurableObjectNamespace;
  ASSETS: Fetcher;
  CF_VERSION_METADATA: WorkerVersionMetadata;
}
type User = {
  id: string;
  username: string;
  createdAt: string;
  lastSeen: string;
  highScore: number;
  highScoreSeed?: number;
  highScoreReplayId?: string;
  highScoreDate?: string;
  gamesPlayed: number;
  totalScore: number;
  elo: number;
  settings: { musicVolume: number; sfxVolume: number; snakeAppearance?: SnakeAppearance };
};
type RoomAction = 'initial' | 'resume' | 'restart' | 'next' | 'join' | 'spectate';
type RoomData = {
  definition?: RoomDefinition;
  initialState?: AdventureSnake;
  seed: number;
  phantoms: unknown[];
  playerSpawnIndex: number;
  playerSpawn?: {
    position: { x: number; y: number; z: number };
    direction: { x: number; y: number; z: number };
    up: { x: number; y: number; z: number };
  };
};
const COOKIE = 'snake3d_session',
  YEAR = 31_536_000;
const now = () => new Date().toISOString();
const json = (value: unknown, status = 200, requestId?: string) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(requestId ? { 'x-request-id': requestId } : {}),
    },
  });
const fail = (code: string, status: number, requestId: string) =>
  json({ error: { code, requestId } }, status, requestId);
const cookie = (r: Request, n: string) =>
  r.headers
    .get('cookie')
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${n}=`))
    ?.slice(n.length + 1);
const hash = async (v: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
const username = () =>
  `${['Swift', 'Stellar', 'Neon', 'Cosmic'][Math.floor(Math.random() * 4)]}${['Snake', 'Viper', 'Cobra', 'Runner'][Math.floor(Math.random() * 4)]}${Math.floor(Math.random() * 1000)}`;
function toUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    username: String(row.username),
    createdAt: String(row.created_at),
    lastSeen: String(row.last_seen),
    highScore: Number(row.high_score),
    highScoreSeed: row.high_score_seed == null ? undefined : Number(row.high_score_seed),
    highScoreReplayId: row.high_score_replay_id as string | undefined,
    highScoreDate: row.high_score_date as string | undefined,
    gamesPlayed: Number(row.games_played),
    totalScore: Number(row.total_score),
    elo: Number(row.elo),
    settings: JSON.parse(String(row.settings_json)),
  };
}
async function userFor(r: Request, e: Env) {
  const token = cookie(r, COOKIE);
  if (!token) return null;
  const row = await e.DB.prepare(
    'SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',
  )
    .bind(await hash(token), now())
    .first<Record<string, unknown>>();
  return row ? toUser(row) : null;
}
const mutationAllowed = (r: Request) => {
  const o = r.headers.get('origin');
  return (
    !o ||
    o === new URL(r.url).origin ||
    o.startsWith('http://localhost:') ||
    o.startsWith('http://127.0.0.1:')
  );
};
async function body(r: Request, requestId: string): Promise<unknown | Response> {
  if (Number(r.headers.get('content-length') || 0) > 524288)
    return fail('PAYLOAD_TOO_LARGE', 413, requestId);
  try {
    return await r.json();
  } catch {
    return fail('INVALID_JSON', 400, requestId);
  }
}
function position(v: unknown) {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return [p.x, p.y, p.z].every((x) => typeof x === 'number' && Number.isFinite(x));
}
function sequence(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function snakeState(value: unknown): value is Omit<StateInput, 'type' | 'seq' | 'step' | 'reason'> {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  return (
    Array.isArray(state.segments) &&
    state.segments.length > 0 &&
    state.segments.length <= 10000 &&
    state.segments.every(
      (segment) =>
        position(segment) &&
        Object.values(segment as Record<string, number>).every(Number.isInteger),
    ) &&
    validOrientation(state.direction, state.up) &&
    typeof state.score === 'number' &&
    Number.isSafeInteger(state.score) &&
    state.score >= 0 &&
    typeof state.speed === 'number' &&
    Number.isFinite(state.speed) &&
    state.speed >= 60
  );
}
function stateInput(value: unknown): value is StateInput {
  if (!snakeState(value)) return false;
  const action = value as Record<string, unknown>;
  return (
    action.type === 'state' &&
    sequence(action.seq) &&
    sequence(action.step) &&
    (action.eatenFood === undefined ||
      (action.reason === 'food' && position(action.eatenFood))) &&
    (action.reason === 'food' ||
      action.reason === 'speed' ||
      action.reason === 'reconnect' ||
      action.reason === 'spawn' ||
      action.reason === 'spectator-sync')
  );
}
function pauseInput(value: unknown): value is PauseInput {
  if (!snakeState(value)) return false;
  const action = value as Record<string, unknown>;
  return action.type === 'pause' && sequence(action.seq) && sequence(action.step) && typeof action.paused === 'boolean';
}
function deathInput(value: unknown): value is DeathInput {
  if (!snakeState(value)) return false;
  const action = value as Record<string, unknown>;
  return (
    action.type === 'death' &&
    typeof action.submissionId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(action.submissionId) &&
    sequence(action.seq) &&
    sequence(action.step) &&
    typeof action.reason === 'string'
  );
}
function directionInput(value: unknown): value is DirectionInput {
  if (!value || typeof value !== 'object') return false;
  const action = value as Record<string, unknown>;
  return (
    action.type === 'direction' &&
    sequence(action.seq) &&
    sequence(action.step) &&
    position(action.head) &&
    Object.values(action.head as Record<string, number>).every(Number.isInteger) &&
    Array.isArray(action.segments) &&
    action.segments.length > 0 &&
    action.segments.length <= 10000 &&
    action.segments.every(
      (segment) =>
        position(segment) &&
        Object.values(segment as Record<string, number>).every(Number.isInteger),
    ) &&
    validOrientation(action.direction, action.up)
  );
}
const roomActions = new Set<RoomAction>([
  'initial',
  'resume',
  'restart',
  'next',
  'join',
  'spectate',
]);
async function createRoomSeed(env: Env, user: User) {
  for (let x = 0; x <= 65535; x++) {
    const seed = roomSeed({ x, y: 0, z: 0 }),
      result = await env.DB.prepare(
        'INSERT OR IGNORE INTO rooms(seed,elo_bucket,updated_at) VALUES(?,?,?)',
      )
        .bind(seed, Math.floor(user.elo / 100), now())
        .run();
    if (result.meta.changes === 1) return seed;
  }
  throw new Error('ROOM_COORDINATES_EXHAUSTED');
}
async function ensureFirstRoom(env: Env, user: User) {
  await env.DB.prepare('INSERT OR IGNORE INTO rooms(seed,elo_bucket,updated_at) VALUES(?,?,?)')
    .bind(FIRST_ROOM_SEED, Math.floor(user.elo / 100), now()).run();
  return FIRST_ROOM_SEED;
}
export function parseRoomSeed(value: string | null) {
  if (value === null || !/^\d+$/.test(value)) return null;
  const seed = Number(value);
  return Number.isSafeInteger(seed) ? seed : null;
}
export function chooseSpawn(
  phantoms: Array<{ score?: number; elo?: number; startParams?: { spawnIndex?: number } }>,
  previousSpawnIndex?: number,
) {
  const used = new Set(
    phantoms
      .map((p) => p.startParams?.spawnIndex)
      .filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 4),
  );
  const free = [0, 1, 2, 3].filter((index) => !used.has(index));
  const alternatives = free.filter((index) => index !== previousSpawnIndex);
  if (alternatives.length) return alternatives[Math.floor(Math.random() * alternatives.length)];
  if (free.length) return free[Math.floor(Math.random() * free.length)];
  const replacementCandidates = phantoms.filter((phantom) => {
    const index = phantom.startParams?.spawnIndex;
    return Number.isInteger(index);
  });
  if (replacementCandidates.length) {
    return replacementCandidates.reduce((best, phantom) => {
      const bestScore = Number(best.score ?? best.elo ?? 1000);
      const phantomScore = Number(phantom.score ?? phantom.elo ?? 1000);
      return phantomScore < bestScore ? phantom : best;
    }).startParams!.spawnIndex!;
  }
  return previousSpawnIndex === undefined ? 0 : (previousSpawnIndex + 1) % 4;
}
export function replayReplacementOrder(replaySaved: boolean, evictRoomReplay: boolean) {
  if (!replaySaved) return [];
  return [...(evictRoomReplay ? ['deleteRoomMinimum'] : []), 'insertReplay'] as const;
}



async function transferAdventure(env: Env, user: User, input: { fromSeed: number; direction: PortalDirection; state: StateInput; transferId: string }, requestId: string): Promise<Response> {
  const { fromSeed, direction, transferId } = input;
  if (typeof transferId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(transferId)) return fail('INVALID_TRANSFER_ID', 400, requestId);
  const old = await env.DB.prepare('SELECT user_id,from_seed,to_seed,status,result_json FROM adventure_transfers WHERE id=?').bind(transferId).first<{ user_id: string; from_seed: number; to_seed: number; status: string; result_json: string }>();
  const targetSeed = roomSeed(adjacentRoom(roomCoordinates(fromSeed)!, direction));
  if (!validAdventureRoom(targetSeed)) return fail('WORLD_EDGE', 409, requestId);
  if (old && (old.user_id !== user.id || old.from_seed !== fromSeed || old.to_seed !== targetSeed)) return fail('TRANSFER_CONTEXT_MISMATCH', 409, requestId);
  const source = env.ROOMS.get(env.ROOMS.idFromName(String(fromSeed)));
  const target = env.ROOMS.get(env.ROOMS.idFromName(String(targetSeed)));
  const call = (room: DurableObjectStub, path: string, data: unknown) => room.fetch(`https://room/${path}`, { method: 'POST', body: JSON.stringify(data) });
  if (old?.status === 'COMMITTED') {
    const result = JSON.parse(old.result_json) as RoomData & { checkpoint: EntryCheckpoint };
    await call(source, 'adventure-release', { userId: user.id, transferId, committed: true });
    const committed = await call(target, 'adventure-commit', { user, transferId, checkpoint: result.checkpoint });
    if (!committed.ok) return fail('PORTAL_TRANSFER_PENDING', 503, requestId);
    await call(source, 'adventure-release', { userId: user.id, transferId, committed: true });
    return json(result, 200, requestId);
  }
  const assignment = await env.DB.prepare('SELECT room_seed FROM room_assignments WHERE user_id=?').bind(user.id).first<{ room_seed: number }>();
  if (assignment?.room_seed !== fromSeed) return fail('ROOM_CONTEXT_MISMATCH', 409, requestId);
  const prepared = await call(source, 'adventure-prepare', { userId: user.id, ...input });
  if (!prepared.ok) return prepared;
  const { checkpoint } = await prepared.json<{ checkpoint: EntryCheckpoint }>();
  let reserved: Response;
  try { reserved = await call(target, 'adventure-reserve', { user, transferId, checkpoint }); }
  catch (error) { await call(source, 'adventure-release', { userId: user.id, transferId, committed: false }); throw error; }
  if (!reserved.ok) {
    await call(source, 'adventure-release', { userId: user.id, transferId, committed: false });
    return reserved;
  }
  const reservedData = await reserved.json<{ definition: RoomDefinition }>();
  const result: RoomData & { checkpoint: EntryCheckpoint } = { seed: targetSeed, phantoms: [], playerSpawnIndex: 0, definition: reservedData.definition, initialState: checkpoint.snake, playerSpawn: { position: checkpoint.snake.segments[0], direction: checkpoint.snake.direction, up: checkpoint.snake.up }, checkpoint };
  const time = now();
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO rooms(seed,elo_bucket,updated_at) VALUES(?,?,?)').bind(targetSeed, Math.floor(user.elo / 100), time),
      adventureStatement(env, user.id, checkpoint, checkpoint.snake.adventure.path),
      env.DB.prepare('INSERT INTO adventure_transfers(id,user_id,from_seed,to_seed,status,result_json,updated_at) VALUES(?,?,?,?,?,?,?)').bind(transferId, user.id, fromSeed, targetSeed, 'COMMITTED', JSON.stringify(result), time),
      env.DB.prepare('UPDATE users SET last_room_seed=?,last_seen=? WHERE id=?').bind(targetSeed, time, user.id),
      env.DB.prepare('UPDATE room_assignments SET room_seed=?,spawn_index=0,assigned_at=? WHERE user_id=?').bind(targetSeed, time, user.id),
      env.DB.prepare('DELETE FROM room_players WHERE user_id=?').bind(user.id),
      env.DB.prepare('INSERT INTO room_players(room_seed,user_id,spawn_index,joined_at) VALUES(?,?,0,?)').bind(targetSeed, user.id, time),
      env.DB.prepare('INSERT INTO user_room_visits(user_id,room_seed,visited_at) VALUES(?,?,?) ON CONFLICT(user_id,room_seed) DO NOTHING').bind(user.id, targetSeed, time),
    ]);
  } catch (error) {
    // A lost D1 response may conceal a successful transaction. Consult the
    // idempotency row before releasing either side's reservation.
    const committed = await env.DB.prepare('SELECT status FROM adventure_transfers WHERE id=?').bind(transferId).first<{ status: string }>();
    if (committed?.status !== 'COMMITTED') {
      await call(target, 'adventure-cancel', { transferId });
      await call(source, 'adventure-release', { userId: user.id, transferId, committed: false });
      throw error;
    }
  }
  await call(source, 'adventure-release', { userId: user.id, transferId, committed: true });
  const committed = await call(target, 'adventure-commit', { user, transferId, checkpoint });
  if (!committed.ok) return fail('PORTAL_TRANSFER_PENDING', 503, requestId);
  await call(source, 'adventure-release', { userId: user.id, transferId, committed: true });
  return json(result, 200, requestId);
}

export default {
  async fetch(request, env): Promise<Response> {
    const requestId = crypto.randomUUID(),
      url = new URL(request.url),
      path = url.pathname;
    if (!path.startsWith('/api/')) {
      const response = await env.ASSETS.fetch(request),
        headers = new Headers(response.headers);
      headers.set('x-content-type-options', 'nosniff');
      headers.set('referrer-policy', 'same-origin');
      headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
      return new Response(response.body, { status: response.status, headers });
    }
    if (request.method !== 'GET' && !mutationAllowed(request))
      return fail('INVALID_ORIGIN', 403, requestId);
    if (path === '/api/v1/version' && request.method === 'GET') {
      return new Response(JSON.stringify({ id: env.CF_VERSION_METADATA.id }), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }
    if (path === '/api/v1/session' && request.method === 'POST') {
      const token = [...crypto.getRandomValues(new Uint8Array(32))]
          .map((x) => x.toString(16).padStart(2, '0'))
          .join(''),
        id = crypto.randomUUID(),
        time = now(),
        secure = url.protocol === 'https:' ? ' Secure;' : '';
      const user: User = {
        id,
        username: username(),
        createdAt: time,
        lastSeen: time,
        highScore: 0,
        gamesPlayed: 0,
        totalScore: 0,
        elo: 1000,
        settings: { musicVolume: 0.5, sfxVolume: 0.7, snakeAppearance: createRandomSnakeAppearance() },
      };
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO users (id,username,created_at,last_seen,settings_json) VALUES (?,?,?,?,?)',
        ).bind(id, user.username, time, time, JSON.stringify(user.settings)),
        env.DB.prepare(
          'INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)',
        ).bind(await hash(token), id, new Date(Date.now() + YEAR * 1000).toISOString(), time),
      ]);
      return new Response(JSON.stringify({ user, isNew: true }), {
        headers: {
          'content-type': 'application/json',
          'set-cookie': `${COOKIE}=${token}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${YEAR}`,
          'x-request-id': requestId,
        },
      });
    }
    const user = await userFor(request, env);
    if (!user) return fail('UNAUTHENTICATED', 401, requestId);
    if (path === '/api/v1/me' && request.method === 'GET') return json({ user }, 200, requestId);
    if (path === '/api/v1/me/settings' && request.method === 'PATCH') {
      const data = await body(request, requestId);
      if (data instanceof Response) return data;
      const settings = (data as { settings?: unknown }).settings;
      if (!settings || typeof settings !== 'object')
        return fail('INVALID_SETTINGS', 400, requestId);
      const next = { ...user.settings, ...(settings as object) };
      if (
        ![next.musicVolume, next.sfxVolume].every((v) => typeof v === 'number' && v >= 0 && v <= 1)
      )
        return fail('INVALID_SETTINGS', 400, requestId);
      if (next.snakeAppearance !== undefined && !isSnakeAppearance(next.snakeAppearance))
        return fail('INVALID_SETTINGS', 400, requestId);
      await env.DB.prepare('UPDATE users SET settings_json=?,last_seen=? WHERE id=?')
        .bind(JSON.stringify(next), now(), user.id)
        .run();
      return json({ user: { ...user, settings: next } }, 200, requestId);
    }
    if (path === '/api/v1/rooms' && request.method === 'GET') {
      const rows = await env.DB.prepare(ROOM_LIST_QUERY).all<{
        seed: number;
        gamesPlayed: number;
        spawn0: number | null;
        spawn1: number | null;
        spawn2: number | null;
        spawn3: number | null;
      }>();
      return json(
        rows.results.map((row) => ({
          seed: Number(row.seed),
          gamesPlayed: Number(row.gamesPlayed),
          bestScores: [row.spawn0, row.spawn1, row.spawn2, row.spawn3].map((score) =>
            score === null ? null : Number(score),
          ),
        })),
        200,
        requestId,
      );
    }
    if (path === '/api/v1/rooms/enter' && request.method === 'GET') {
      return json({ seed: await ensureFirstRoom(env, user) }, 200, requestId);
    }
    if (path === '/api/v1/rooms/stats' && request.method === 'GET') {
      const totals = await env.DB.prepare(
        'SELECT (SELECT COUNT(*) FROM rooms) AS rooms, (SELECT COUNT(*) FROM replays) AS phantoms',
      ).first<{ rooms: number; phantoms: number }>();
      const seeds = await env.DB.prepare('SELECT seed FROM rooms').all<{ seed: number }>();
      const occupancy = await Promise.all(seeds.results.map(async ({ seed }) => {
        const response = await env.ROOMS.get(env.ROOMS.idFromName(String(seed))).fetch('https://room/occupancy');
        return (await response.json<{ count: number }>()).count;
      }));
      return json({
        phantoms: Number(totals?.phantoms ?? 0),
        rooms: Number(totals?.rooms ?? 0),
        playersOnline: occupancy.reduce((sum, count) => sum + count, 0),
      }, 200, requestId);
    }
    if (path === '/api/v1/rooms/encounters' && request.method === 'GET') {
      const totals = await env.DB.prepare(
        'SELECT room_seed AS seed, COUNT(*) AS encounters, COUNT(DISTINCT user_a_id || char(0) || user_b_id) AS uniquePairs FROM live_player_encounters GROUP BY room_seed ORDER BY encounters DESC, room_seed',
      ).all<{ seed: number; encounters: number; uniquePairs: number }>();
      return json({
        totalEncounters: totals.results.reduce((sum, row) => sum + Number(row.encounters), 0),
        rooms: totals.results.map((row) => ({
          seed: Number(row.seed), encounters: Number(row.encounters), uniquePairs: Number(row.uniquePairs),
        })),
      }, 200, requestId);
    }
    if (path === '/api/v1/rooms' && request.method === 'POST') {
      const data = await body(request, requestId);
      if (data instanceof Response) return data;
      if (!data || typeof data !== 'object') return fail('INVALID_ROOM_COORDINATES', 400, requestId);
      const coordinates = data as { x?: unknown; y?: unknown; z?: unknown };
      if (Object.keys(coordinates).length === 0)
        return json({ seed: await createRoomSeed(env, user) }, 201, requestId);
      if (![coordinates.x, coordinates.y, coordinates.z].every(Number.isInteger))
        return fail('INVALID_ROOM_COORDINATES', 400, requestId);
      let seed: number;
      try { seed = roomSeed(coordinates as { x: number; y: number; z: number }); }
      catch { return fail('WORLD_EDGE', 400, requestId); }
      if (adventureEnabled(env) && !validAdventureRoom(seed)) return fail('WORLD_EDGE', 400, requestId);
      await env.DB.prepare('INSERT OR IGNORE INTO rooms(seed,elo_bucket,updated_at) VALUES(?,?,?)')
        .bind(seed, Math.floor(user.elo / 100), now()).run();
      return json({ seed }, 200, requestId);
    }
    if (path === '/api/v1/rooms/portal' && request.method === 'POST') {
      const data = await body(request, requestId);
      if (data instanceof Response) return data;
      if (!data || typeof data !== 'object') return fail('INVALID_PORTAL', 400, requestId);
      const { fromSeed, direction, state } = data as { fromSeed?: unknown; direction?: unknown; state?: unknown };
      if (!Number.isSafeInteger(fromSeed) || typeof direction !== 'string' ||
          !['xp', 'xn', 'yp', 'yn', 'zp', 'zn'].includes(direction) || !snakeState(state))
        return fail('INVALID_PORTAL', 400, requestId);
      const source = roomCoordinates(fromSeed as number);
      if (adventureEnabled(env)) {
        if (!source || !validAdventureRoom(fromSeed as number)) return fail('WORLD_EDGE', 409, requestId);
        return transferAdventure(env, user, data as { fromSeed: number; direction: PortalDirection; state: StateInput; transferId: string }, requestId);
      }
      if (!source || crossedPortal(state.segments[0], state.segments.length) !== direction)
        return fail('PORTAL_CLOSED', 409, requestId);
      const offset = portalOffset(direction as PortalDirection);
      if (state.direction.x !== Math.sign(offset.x) ||
          state.direction.y !== Math.sign(offset.y) ||
          state.direction.z !== Math.sign(offset.z))
        return fail('INVALID_PORTAL_DIRECTION', 409, requestId);
      const assignment = await env.DB.prepare('SELECT room_seed FROM room_assignments WHERE user_id=?')
        .bind(user.id).first<{ room_seed: number }>();
      if (assignment?.room_seed !== fromSeed) return fail('ROOM_CONTEXT_MISMATCH', 409, requestId);
      const sourceRoom = env.ROOMS.get(env.ROOMS.idFromName(String(fromSeed)));
      const check = await sourceRoom.fetch('https://room/portal-check', {
        method: 'POST', body: JSON.stringify({ userId: user.id, state }),
      });
      if (!check.ok) return fail('PORTAL_CLOSED', 409, requestId);
      const { length } = await check.json<{ length: number }>();
      if (length < PORTAL_MIN_LENGTH) return fail('PORTAL_CLOSED', 409, requestId);
      let targetSeed: number;
      try { targetSeed = roomSeed(adjacentRoom(source, direction as PortalDirection)); }
      catch { return fail('WORLD_EDGE', 409, requestId); }
      const transferred = {
        ...state,
        segments: state.segments.map((segment) => ({
          x: segment.x - offset.x, y: segment.y - offset.y, z: segment.z - offset.z,
        })),
      };
      const time = now();
      await env.DB.prepare('INSERT OR IGNORE INTO rooms(seed,elo_bucket,updated_at) VALUES(?,?,?)')
        .bind(targetSeed, Math.floor(user.elo / 100), time).run();
      const targetRoom = env.ROOMS.get(env.ROOMS.idFromName(String(targetSeed)));
      const arrival = await targetRoom.fetch('https://room/portal-enter', {
        method: 'POST', body: JSON.stringify({ user, seed: targetSeed, state: transferred }),
      });
      if (!arrival.ok) return fail(arrival.status === 409 ? 'PORTAL_BLOCKED' : 'PORTAL_TRANSFER_FAILED', arrival.status === 409 ? 409 : 502, requestId);
      try {
        await env.DB.batch([
        env.DB.prepare('INSERT INTO user_room_visits(user_id,room_seed,visited_at) VALUES(?,?,?) ON CONFLICT(user_id,room_seed) DO NOTHING').bind(user.id, targetSeed, time),
        env.DB.prepare('UPDATE users SET last_room_seed=?,last_seen=? WHERE id=?').bind(targetSeed, time, user.id),
        env.DB.prepare('INSERT INTO room_assignments(user_id,room_seed,spawn_index,assigned_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET room_seed=excluded.room_seed,spawn_index=excluded.spawn_index,assigned_at=excluded.assigned_at').bind(user.id, targetSeed, 0, time),
        env.DB.prepare('INSERT INTO room_players(room_seed,user_id,spawn_index,joined_at) VALUES(?,?,?,?) ON CONFLICT(room_seed,user_id) DO UPDATE SET spawn_index=excluded.spawn_index,joined_at=excluded.joined_at').bind(targetSeed, user.id, 0, time),
        env.DB.prepare('UPDATE rooms SET updated_at=? WHERE seed=?').bind(time, targetSeed),
        ]);
      } catch (error) {
        await targetRoom.fetch('https://room/portal-leave', {
          method: 'POST', body: JSON.stringify({ userId: user.id }),
        });
        throw error;
      }
      try {
        await sourceRoom.fetch('https://room/portal-leave', {
          method: 'POST', body: JSON.stringify({ userId: user.id }),
        });
      } catch (error) {
        console.error('Failed to remove portal player from previous room:', error);
      }
      return arrival;
    }
    const roomResource = path.match(/^\/api\/v1\/rooms\/(\d+)$/);
    const roomDiagnostics = path.match(/^\/api\/v1\/rooms\/(\d+)\/diagnostics$/);
    if (roomDiagnostics && request.method === 'GET') {
      const seed = Number(roomDiagnostics[1]);
      const assigned = await env.DB.prepare('SELECT 1 FROM room_assignments WHERE room_seed=? AND user_id=?')
        .bind(seed, user.id).first();
      if (!assigned) return fail('ROOM_CONTEXT_MISMATCH', 403, requestId);
      const [room, latest] = await Promise.all([
        env.DB.prepare('SELECT seed,total_games_played,updated_at FROM rooms WHERE seed=?').bind(seed).first(),
        env.DB.prepare('SELECT id,created_at,result_json FROM game_submissions WHERE room_seed=? AND user_id=? ORDER BY created_at DESC LIMIT 1')
          .bind(seed, user.id).first<{ id: string; created_at: string; result_json: string }>(),
      ]);
      if (!room) return fail('ROOM_NOT_FOUND', 404, requestId);
      const response = await env.ROOMS.get(env.ROOMS.idFromName(String(seed))).fetch('https://room/diagnostics', {
        headers: { 'x-user-id': user.id, 'x-seed': String(seed) },
      });
      if (!response.ok) return fail('ROOM_DIAGNOSTICS_UNAVAILABLE', 502, requestId);
      return json({ room, live: await response.json(), latestSubmission: latest ? {
        id: latest.id, createdAt: latest.created_at, result: JSON.parse(latest.result_json),
      } : null }, 200, requestId);
    }
    if (roomResource && request.method === 'DELETE') {
      const seed = Number(roomResource[1]);
      const exists = await env.DB.prepare('SELECT 1 FROM rooms WHERE seed=?').bind(seed).first();
      if (!exists) return fail('ROOM_NOT_FOUND', 404, requestId);
      await env.ROOMS.get(env.ROOMS.idFromName(String(seed))).fetch('https://room/delete', {
        method: 'POST',
      });
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET last_room_seed=NULL WHERE last_room_seed=?').bind(seed),
        env.DB.prepare('DELETE FROM live_room_assignments WHERE room_seed=?').bind(seed),
        env.DB.prepare('DELETE FROM room_assignments WHERE room_seed=?').bind(seed),
        env.DB.prepare('DELETE FROM room_players WHERE room_seed=?').bind(seed),
        env.DB.prepare('DELETE FROM user_room_visits WHERE room_seed=?').bind(seed),
        env.DB.prepare('DELETE FROM room_spawn_records WHERE room_seed=?').bind(seed),
        env.DB.prepare('DELETE FROM game_submissions WHERE room_seed=?').bind(seed),
        env.DB.prepare('DELETE FROM replays WHERE room_seed=?').bind(seed),
        env.DB.prepare('DELETE FROM rooms WHERE seed=?').bind(seed),
      ]);
      return json({ deleted: true, seed }, 200, requestId);
    }
    if (path === '/api/v1/matches' && request.method === 'POST') {
      const data = await body(request, requestId);
      if (data instanceof Response) return data;
      const p = data as { action?: unknown; contextSeed?: unknown; seed?: unknown };
      if (
        typeof p.action !== 'string' ||
        !roomActions.has(p.action as RoomAction) ||
        (p.contextSeed !== undefined && !Number.isSafeInteger(p.contextSeed)) ||
        (p.seed !== undefined && !Number.isSafeInteger(p.seed))
      )
        return fail('INVALID_ROOM_ACTION', 400, requestId);
      if (p.action === 'join' || (p.action === 'spectate' && Number.isSafeInteger(p.seed))) {
        if (!Number.isSafeInteger(p.seed)) return fail('INVALID_ROOM_LINK', 400, requestId);
        if (adventureEnabled(env) && !validAdventureRoom(p.seed as number)) return fail('WORLD_EDGE', 400, requestId);
        const exists = await env.DB.prepare('SELECT 1 FROM rooms WHERE seed=?')
          .bind(p.seed)
          .first();
        if (!exists) return fail('ROOM_NOT_FOUND', 404, requestId);
        return env.ROOMS.get(env.ROOMS.idFromName(String(p.seed))).fetch(
          `https://room/${p.action}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ user, seed: p.seed }),
          },
        );
      }
      if (p.action === 'join') return fail('INVALID_ROOM_LINK', 400, requestId);
      return env.ROOMS.get(env.ROOMS.idFromName(`user:${user.id}`)).fetch('https://room/assign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: p.action, contextSeed: p.contextSeed, user }),
      });
    }
    const socket = path.match(/^\/api\/v1\/rooms\/(-?\d+)\/socket$/);
    if (socket && request.headers.get('upgrade') === 'websocket') {
      if (adventureEnabled(env) && !validAdventureRoom(Number(socket[1]))) return fail('WORLD_EDGE', 400, requestId);
      const spectator = url.searchParams.get('spectator') === '1',
        restarting = url.searchParams.get('restart') === '1';
      if (spectator) {
        const exists = await env.DB.prepare('SELECT 1 FROM rooms WHERE seed=?')
          .bind(Number(socket[1]))
          .first();
        if (!exists) return fail('ROOM_NOT_FOUND', 404, requestId);
      } else {
        const assigned = await env.DB.prepare(
          'SELECT 1 FROM room_assignments WHERE user_id=? AND room_seed=?',
        )
          .bind(user.id, Number(socket[1]))
          .first();
        if (!assigned) return fail('ROOM_CONTEXT_MISMATCH', 409, requestId);
      }
      return env.ROOMS.get(env.ROOMS.idFromName(socket[1])).fetch('https://room/socket', {
        headers: {
          upgrade: 'websocket',
          'x-user': JSON.stringify(user),
          'x-seed': socket[1],
          'x-spectator': spectator ? '1' : '0',
          'x-restart': restarting ? '1' : '0',
        },
      });
    }
    if (path === '/api/v1/leaderboard' && request.method === 'GET') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 50),
        rows = await env.DB.prepare(
          'SELECT username AS playerName,high_score AS score,high_score_seed AS seed,high_score_date AS date,high_score_replay_id AS replayId FROM users WHERE high_score>0 ORDER BY high_score DESC LIMIT ?',
        )
          .bind(limit)
          .all();
      return json(rows.results, 200, requestId);
    }
    return fail('NOT_FOUND', 404, requestId);
  },
} satisfies ExportedHandler<Env>;

export class RoomDurableObject {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}
  private simulation: SimulationState | null = null;
  private restartUserId: string | null = null;
  private lastSpectatorSyncRequestAt = 0;
  private async recordLiveEncounters(seed: number, userId: string, state: SimulationState) {
    const connectedPeers = new Set<string>();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as { userId?: string; spectator?: boolean } | null;
      if (attachment?.userId && attachment.userId !== userId && !attachment.spectator)
        connectedPeers.add(attachment.userId);
    }
    for (const peerId of connectedPeers) {
      const peer = Object.values(state.players).find((candidate) =>
        candidate.id === peerId && candidate.alive && !candidate.phantom);
      if (!peer) continue;
      const [a, b] = [userId, peerId].sort();
      const key = `encounter:${a}:${b}`;
      if (await this.ctx.storage.get(key)) continue;
      await this.env.DB.prepare(
        'INSERT INTO live_player_encounters(id,room_seed,user_a_id,user_b_id,met_at) VALUES(?,?,?,?,?)',
      ).bind(crypto.randomUUID(), seed, a, b, now()).run();
      await this.ctx.storage.put(key, true);
    }
  }
  private async saveStage(seed: number, userId: string, submissionId: string, stage: string, code?: string) {
    const trace = { seed, submissionId, stage, code, at: now() };
    console.log(JSON.stringify({ event: 'game.save', ...trace }));
    await this.ctx.storage.put(`save-trace:${userId}`, trace);
  }
  private definition(state: SimulationState): RoomDefinition {
    return state.definition ??= generateSharedRoom(state.seed).room;
  }
  private snapshot(state: SimulationState) {
    return {
      ...(adventureEnabled(this.env) && validAdventureRoom(state.seed) ? { definition: this.definition(state) } : {}),
      seed: state.seed,
      tick: state.tick,
      serverTime: Date.now(),
      food: state.food,
      players: Object.values(state.players),
    };
  }
  private async persist(state: SimulationState) {
    await this.ctx.storage.put('simulation', state);
    const deadlines = Object.values(state.players)
      .map((player) => player.disconnectedAt)
      .filter((value): value is number => Number.isFinite(value));
    const next = Math.min(...deadlines);
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }
  private cleanupDisconnected(state: SimulationState, now: number) {
    for (const [id, player] of Object.entries(state.players))
      if (player.disconnectedAt !== undefined && player.disconnectedAt <= now)
        delete state.players[id];
  }
  private startTrajectory(state: SimulationState, player: SimPlayer, spawnIndex: number) {
    (state.trajectories ??= {})[player.id] = {
      startPosition: { ...player.segments[0] },
      startDirection: { ...player.direction },
      startSegments: player.segments.map((segment) => ({ ...segment })),
      initialScore: player.score,
      spawnIndex,
      initialSpeed: player.speed,
      changes: [],
      ...(player.adventure ? { adventureVersion: ADVENTURE_VERSION, initialAdventure: copy(player.adventure), initialGrowth: player.growth, events: [] } : {}),
    };
  }
  private recordDirection(state: SimulationState, player: SimPlayer, position: Axis) {
    let trajectory = state.trajectories?.[player.id];
    // Durable Object storage can contain the pre-recording trajectory array.
    if (!trajectory || Array.isArray(trajectory)) {
      this.startTrajectory(state, player, 0);
      trajectory = state.trajectories![player.id];
    }
    trajectory.changes.push({ position: { ...position }, direction: { ...player.direction } });
    if (trajectory.changes.length > 10000)
      trajectory.changes.splice(0, trajectory.changes.length - 10000);
  }
  private adventureSnake(player: SimPlayer): AdventureSnake {
    return { segments: copy(player.segments), direction: { ...player.direction }, up: { ...player.up }, speed: player.speed, score: player.score, growth: player.growth, adventure: copy(player.adventure ?? newAdventure(player.segments.length, player.speed)) };
  }
  private installAdventure(state: SimulationState, user: User, checkpoint: EntryCheckpoint): SimPlayer {
    for (const [id, p] of Object.entries(state.players)) if (p.id === user.id && !p.phantom) delete state.players[id];
    const s = copy(checkpoint.snake);
    const player = addPlayer(state, user.id, user.username, Date.now(), { segments: s.segments, direction: s.direction, up: s.up, score: s.score, entityId: crypto.randomUUID(), spawnIndex: 0, appearance: normalizeSnakeAppearance(user.settings?.snakeAppearance) });
    Object.assign(player, { speed: s.speed, growth: s.growth, adventure: s.adventure, adventureStep: 0, disconnectedAt: Date.now() + 15000 });
    this.startTrajectory(state, player, 0);
    return player;
  }
  private async adventureRequest(path: string, request: Request): Promise<Response> {
    if (!adventureEnabled(this.env)) return json({ error: { code: 'ADVENTURE_DISABLED' } }, 404);
    const input = await request.json<any>();
    if (path === '/adventure-assign') return this.assignAdventureRoom(input.action, input.contextSeed, input.user);
    if (path === '/adventure-prepare') {
      const { userId, direction, transferId, state: incoming } = input;
      const simulation = this.simulation ?? await this.ctx.storage.get<SimulationState>('simulation');
      const player = simulation && Object.values(simulation.players).find(p => p.id === userId && p.alive && !p.phantom);
      if (!simulation || !player?.adventure || !snakeState(incoming) || crossedPortal(incoming.segments[0]) !== direction) return json({ error: { code: 'PORTAL_CLOSED' } }, 409);
      const previous = await this.ctx.storage.get<{ transferId: string; checkpoint: EntryCheckpoint }>(`departure:${userId}`);
      if (previous) return previous.transferId === transferId ? json(previous) : json({ error: { code: 'TRANSFER_IN_PROGRESS' } }, 409);
      const offset = portalOffset(direction);
      const axis = { x: Math.sign(offset.x), y: Math.sign(offset.y), z: Math.sign(offset.z) };
      if (!samePosition(axis, incoming.direction) || !samePosition(incoming.segments[0], { x: player.segments[0].x + axis.x, y: player.segments[0].y + axis.y, z: player.segments[0].z + axis.z })) return json({ error: { code: 'INVALID_PORTAL_DIRECTION' } }, 409);
      const moved = this.adventureSnake(player);
      if (axis.x * moved.direction.x + axis.y * moved.direction.y + axis.z * moved.direction.z === -1 || (moved.growth > 0 ? moved.segments : moved.segments.slice(0, -1)).some(p => samePosition(p, incoming.segments[0]))) return json({ error: { code: 'INVALID_PORTAL_DIRECTION' } }, 409);
      moved.segments.unshift(copy(incoming.segments[0]));
      if (moved.growth > 0) moved.growth--; else moved.segments.pop();
      moved.adventure.coatings = advanceCoatings(moved.adventure.coatings, moved.segments.length);
      moved.direction = axis; moved.up = copy(incoming.up);
      const transition = transitionAdventure(this.definition(simulation), direction, moved);
      if (!transition) return json({ error: { code: checkPortal(this.definition(simulation), direction, moved).reason } }, 409);
      transition.snake.segments = transition.snake.segments.map(p => ({ x: p.x - offset.x, y: p.y - offset.y, z: p.z - offset.z }));
      const seed = roomSeed(adjacentRoom(roomCoordinates(simulation.seed)!, direction));
      const checkpoint = enterAdventure(transition.snake, seed, transition.path);
      await this.ctx.storage.put(`departure:${userId}`, { transferId, checkpoint, createdAt: Date.now() });
      return json({ checkpoint });
    }
    if (path === '/adventure-reserve') {
      const { user, checkpoint, transferId } = input as { user: User; checkpoint: EntryCheckpoint; transferId: string };
      const state = await this.liveState(checkpoint.seed);
      const validation = validateRoomDefinition(this.definition(state), checkpoint.snake);
      if (validation.witnesses.some(w => !w.valid)) return json({ error: { code: 'ENTRY_ROUTE_UNAVAILABLE', detail: validation.rejected } }, 409);
      const reservations = await this.ctx.storage.list<EntryCheckpoint>({ prefix: 'arrival:' });
      const others = Object.values(state.players).filter(p => p.id !== user.id);
      for (const [id, reservation] of reservations) if (id !== `arrival:${transferId}`) {
        const meta = await this.ctx.storage.get<{ createdAt: number; userId: string }>(id.replace('arrival:', 'arrival-meta:'));
        if (meta?.userId === user.id) continue;
        if (!meta || Date.now() - meta.createdAt > 15000) {
          const receipt = await this.env.DB.prepare('SELECT status FROM adventure_transfers WHERE id=?').bind(id.slice('arrival:'.length)).first<{ status: string }>();
          if (receipt?.status !== 'COMMITTED') { await this.ctx.storage.delete(id); await this.ctx.storage.delete(id.replace('arrival:', 'arrival-meta:')); continue; }
        }
        others.push({ segments: reservation.snake.segments, alive: true } as SimPlayer);
      }
      if (checkpointBlocked(checkpoint, others)) return json({ error: { code: 'PORTAL_BLOCKED' } }, 409);
      await this.ctx.storage.put({ [`arrival:${transferId}`]: checkpoint, [`arrival-meta:${transferId}`]: { createdAt: Date.now(), userId: user.id } });
      return json({ reserved: true, definition: this.definition(state) });
    }
    if (path === '/adventure-cancel') { await this.ctx.storage.delete(`arrival:${input.transferId}`); await this.ctx.storage.delete(`arrival-meta:${input.transferId}`); return json({ cancelled: true }); }
    if (path === '/adventure-commit') {
      const { user, checkpoint, transferId } = input as { user: User; checkpoint: EntryCheckpoint; transferId: string };
      if (await this.ctx.storage.get(`committed:${transferId}`)) return json({ committed: true });
      const state = await this.liveState(checkpoint.seed);
      if (checkpointBlocked(checkpoint, Object.values(state.players).filter(p => p.id !== user.id))) return json({ error: { code: 'PORTAL_BLOCKED' } }, 409);
      this.installAdventure(state, user, checkpoint);
      // Persist the player and receipt together, so retries never restore an
      // old entry checkpoint over a player who has already continued moving.
      await this.ctx.storage.put({ simulation: state, [`committed:${transferId}`]: true });
      await this.ctx.storage.delete(`arrival:${transferId}`);
      await this.ctx.storage.delete(`arrival-meta:${transferId}`);
      this.broadcast({ v: 2, type: 'room.state', payload: this.snapshot(state) });
      return json({ committed: true });
    }
    if (path === '/adventure-release') {
      const departure = await this.ctx.storage.get<{ transferId: string }>(`departure:${input.userId}`);
      if (departure?.transferId === input.transferId) {
        if (input.committed && this.simulation) for (const [id, p] of Object.entries(this.simulation.players)) if (p.id === input.userId && !p.phantom) delete this.simulation.players[id];
        await this.ctx.storage.delete(`departure:${input.userId}`);
        if (this.simulation) { await this.persist(this.simulation); this.broadcast({ v: 2, type: 'room.state', payload: this.snapshot(this.simulation) }); }
      }
      return json({ released: true });
    }
    return json({ error: { code: 'NOT_FOUND' } }, 404);
  }
  async alarm() {
    const state = this.simulation ?? (await this.ctx.storage.get<SimulationState>('simulation'));
    if (!state) return;
    this.simulation = state;
    this.cleanupDisconnected(state, Date.now());
    await this.persist(state);
  }
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/adventure-')) return this.adventureRequest(path, request);
    if (path === '/diagnostics') {
      const userId = request.headers.get('x-user-id');
      const seed = Number(request.headers.get('x-seed'));
      if (!userId || !Number.isSafeInteger(seed)) return new Response(null, { status: 403 });
      const state = this.simulation ?? await this.ctx.storage.get<SimulationState>('simulation');
      const sockets = new Set(this.ctx.getWebSockets().map((socket) => {
        const attachment = socket.deserializeAttachment() as { entityId?: string } | null;
        return attachment?.entityId;
      }));
      const terminal = await this.ctx.storage.get<{ player: SimPlayer; createdAt?: number }>(`terminal:${userId}`);
      return json({
        seed,
        tick: state?.tick ?? null,
        players: state ? Object.values(state.players).map((player) => ({
          entityId: player.entityId,
          spawnIndex: player.spawnIndex,
          phantom: player.phantom,
          alive: player.alive,
          connected: sockets.has(player.entityId),
          lastStateSeq: player.lastStateSeq ?? null,
        })) : [],
        terminal: terminal ? { instanceId: terminal.player.instanceId, score: terminal.player.score, createdAt: terminal.createdAt } : null,
        save: await this.ctx.storage.get(`save-trace:${userId}`) ?? null,
      });
    }
    if (path === '/occupancy') {
      const state = this.simulation ?? (await this.ctx.storage.get<SimulationState>('simulation'));
      const connected = new Set(this.ctx.getWebSockets().map((socket) => {
        const attachment = socket.deserializeAttachment() as { userId?: string; spectator?: boolean } | null;
        return attachment?.spectator ? null : attachment?.userId;
      }));
      return json({ count: state ? Object.values(state.players).filter((player) =>
        player.alive && !player.phantom && connected.has(player.id)).length : 0 });
    }
    if (path === '/portal-check') {
      const { userId, state: incoming } = await request.json<{ userId: string; state: unknown }>();
      const state = this.simulation ?? await this.ctx.storage.get<SimulationState>('simulation');
      const player = state && Object.values(state.players).find((item) => item.id === userId && item.alive && !item.phantom);
      if (!player || !snakeState(incoming) || incoming.segments.length < PORTAL_MIN_LENGTH)
        return new Response(null, { status: 409 });
      return json({ length: incoming.segments.length });
    }
    if (path === '/portal-enter') {
      const { user, seed, state: incoming } = await request.json<{ user: User; seed: number; state: Omit<StateInput, 'type' | 'seq' | 'step' | 'reason'> }>();
      if (!snakeState(incoming) || incoming.segments.length < PORTAL_MIN_LENGTH)
        return new Response(null, { status: 400 });
      const state = await this.liveState(seed);
      const head = incoming.segments[0];
      if (Object.values(state.players).some((candidate) =>
        candidate.alive && candidate.id !== user.id && candidate.segments.some((segment) =>
          segment.x === head.x && segment.y === head.y && segment.z === head.z)))
        return new Response(null, { status: 409 });
      for (const [id, player] of Object.entries(state.players))
        if (player.id === user.id && !player.phantom) delete state.players[id];
      const player = addPlayer(state, user.id, user.username, Date.now(), {
        segments: incoming.segments, direction: incoming.direction, up: incoming.up,
        score: incoming.score, appearance: normalizeSnakeAppearance(user.settings?.snakeAppearance),
        entityId: crypto.randomUUID(), spawnIndex: 0,
      });
      player.speed = incoming.speed;
      this.startTrajectory(state, player, 0);
      await this.persist(state);
      this.broadcast({
        v: 2, type: 'player.joined', payload: {
          user: { id: user.id, username: user.username }, timestamp: Date.now(),
          action: { type: 'spawn', entityId: player.entityId,
            position: player.segments[0], direction: player.direction, up: player.up },
        },
      });
      return json(await this.roomData(seed, user, {
        position: incoming.segments[0], direction: incoming.direction, up: incoming.up,
      }));
    }
    if (path === '/portal-leave') {
      const { userId } = await request.json<{ userId: string }>();
      const state = this.simulation ?? await this.ctx.storage.get<SimulationState>('simulation');
      if (state) {
        for (const [id, player] of Object.entries(state.players))
          if (player.id === userId && !player.phantom) {
            delete state.players[id];
            delete state.trajectories?.[userId];
            this.broadcast({ v: 2, type: 'room.left', payload: { entityId: id, userId } });
          }
        await this.persist(state);
      }
      return new Response(null, { status: 204 });
    }
    if (path === '/socket') {
      if (request.headers.get('x-restart') === '1')
        this.restartUserId = (JSON.parse(request.headers.get('x-user') || '{}') as User).id;
      return this.socket(request);
    }
    if (path === '/delete') {
      for (const socket of this.ctx.getWebSockets()) socket.close(1001, 'Room deleted');
      this.simulation = null;
      this.restartUserId = null;
      await this.ctx.storage.deleteAll();
      return new Response(null, { status: 204 });
    }
    const data = await request.json<any>();
    return path === '/assign'
      ? this.assign(data)
      : path === '/join'
        ? this.join(data)
        : path === '/spectate'
          ? this.spectate(data)
          : new Response('Not found', { status: 404 });
  }
  private removePhantoms(state: SimulationState) {
    const restartingUserId = this.restartUserId;
    if (restartingUserId) {
      const anotherOnlinePlayer = this.ctx.getWebSockets().some((socket) => {
        const attachment = socket.deserializeAttachment() as {
          userId?: string;
          spectator?: boolean;
        } | null;
        return attachment?.userId !== restartingUserId && !attachment?.spectator;
      });
      this.restartUserId = null;
      if (!anotherOnlinePlayer)
        for (const [entityId, player] of Object.entries(state.players))
          if (player.id === restartingUserId && !player.phantom) delete state.players[entityId];
    }
    for (const id of Object.keys(state.players))
      if (state.players[id].phantom) delete state.players[id];
  }
  private async loadState(seed: number) {
    this.simulation ??=
      (await this.ctx.storage.get<SimulationState>('simulation')) ?? createSimulation(seed);
    for (const player of Object.values(this.simulation.players)) player.paused ??= false;
    this.removePhantoms(this.simulation);
    this.cleanupDisconnected(this.simulation, Date.now());
    const connected = new Set(this.ctx.getWebSockets().map((socket) => {
      const attachment = socket.deserializeAttachment() as { instanceId?: string; spectator?: boolean } | null;
      return attachment?.spectator ? undefined : attachment?.instanceId;
    }));
    // Recover stale persisted players whose socket disappeared without a close event.
    for (const [entityId, player] of Object.entries(this.simulation.players))
      if (player.disconnectedAt === undefined && (
        (player.instanceId && !connected.has(player.instanceId)) ||
        (!player.instanceId && player.nextStepAt + 15000 <= Date.now())
      ))
        delete this.simulation.players[entityId];
    return this.simulation;
  }
  private async prepareState(seed: number) {
    const state = await this.loadState(seed);
    return state;
  }
  private async liveState(seed: number) {
    return this.loadState(seed);
  }
  private async roomData(
    seed: number,
    user: User,
    playerSpawn?: RoomData['playerSpawn'],
  ): Promise<RoomData> {
    const assignment = await this.env.DB.prepare(
      'SELECT spawn_index FROM room_assignments WHERE user_id=? AND room_seed=?',
    )
      .bind(user.id, seed)
      .first<{ spawn_index: number }>();
    const playerSpawnIndex = assignment?.spawn_index ?? 0;
    return {
      ...(adventureEnabled(this.env) && validAdventureRoom(seed) ? { definition: this.simulation?.seed === seed ? this.definition(this.simulation) : generateSharedRoom(seed).room } : {}),
      seed,
      phantoms: [],
      playerSpawnIndex,
      playerSpawn,
    };
  }
  private async assignAdventure(action: RoomAction, contextSeed: number | undefined, user: User): Promise<Response> {
    const record = await loadAdventure(this.env, user.id);
    const seed = record && validAdventureRoom(record.checkpoint.seed) && action !== 'initial' ? record.checkpoint.seed : await ensureFirstRoom(this.env, user);
    return this.env.ROOMS.get(this.env.ROOMS.idFromName(String(seed))).fetch('https://room/adventure-assign', { method: 'POST', body: JSON.stringify({ action, contextSeed, user }) });
  }
  private async assignAdventureRoom(action: RoomAction, contextSeed: number | undefined, user: User): Promise<Response> {
    if (action === 'next') return json({ error: { code: 'USE_PORTAL' } }, 409);
    const record = await loadAdventure(this.env, user.id);
    const seed = record && validAdventureRoom(record.checkpoint.seed) && action !== 'initial' ? record.checkpoint.seed : await ensureFirstRoom(this.env, user);
    if (action === 'restart' && contextSeed !== seed) return json({ error: { code: 'ROOM_CONTEXT_MISMATCH' } }, 409);
    const state = await this.liveState(seed);
    let player = Object.values(state.players).find(p => p.id === user.id && !p.phantom && p.alive && p.adventure);
    let installedCheckpoint: EntryCheckpoint | undefined;
    if (action === 'restart' || !player || action === 'initial') {
      let checkpoint = record && action !== 'initial' && record.checkpoint.seed === seed ? record.checkpoint : null;
      if (!checkpoint) {
        const spawn = safeSpawn({ ...state, players: Object.fromEntries(Object.entries(state.players).filter(([, p]) => p.id !== user.id)) });
        if (!spawn.safe) return json({ error: { code: 'RESPAWN BLOCKED' } }, 409);
        const temporary = createSimulation(seed);
        const initial = addPlayer(temporary, user.id, user.username, Date.now(), { spawnIndex: spawn.spawnIndex });
        initial.adventure = newAdventure(initial.segments.length, initial.speed);
        checkpoint = enterAdventure(this.adventureSnake(initial), seed, []);
      }
      if (checkpointBlocked(checkpoint, Object.values(state.players).filter(p => p.id !== user.id))) return json({ error: { code: 'RESPAWN BLOCKED' } }, 409);
      const validation = validateRoomDefinition(this.definition(state), checkpoint.snake);
      if (validation.witnesses.some(w => !w.valid)) return json({ error: { code: 'ENTRY_ROUTE_UNAVAILABLE', detail: validation.rejected } }, 409);
      installedCheckpoint = checkpoint;
    }
    const time = now();
    await this.env.DB.batch([
      ...(installedCheckpoint ? [adventureStatement(this.env, user.id, installedCheckpoint, installedCheckpoint.snake.adventure.path)] : []),
      this.env.DB.prepare('INSERT INTO room_assignments(user_id,room_seed,spawn_index,assigned_at) VALUES(?,?,0,?) ON CONFLICT(user_id) DO UPDATE SET room_seed=excluded.room_seed,spawn_index=0,assigned_at=excluded.assigned_at').bind(user.id, seed, time),
      this.env.DB.prepare('INSERT INTO room_players(room_seed,user_id,spawn_index,joined_at) VALUES(?,?,0,?) ON CONFLICT(room_seed,user_id) DO UPDATE SET joined_at=excluded.joined_at').bind(seed, user.id, time),
      this.env.DB.prepare('UPDATE users SET last_room_seed=?,last_seen=? WHERE id=?').bind(seed, time, user.id),
      this.env.DB.prepare('INSERT INTO user_room_visits(user_id,room_seed,visited_at) VALUES(?,?,?) ON CONFLICT(user_id,room_seed) DO NOTHING').bind(user.id, seed, time),
    ]);
    if (installedCheckpoint) player = this.installAdventure(state, user, installedCheckpoint);
    if (!player) return json({ error: { code: 'RESTART REQUIRED' } }, 409);
    await this.persist(state);
    return json({ ...await this.roomData(seed, user), initialState: this.adventureSnake(player), playerSpawn: { position: player.segments[0], direction: player.direction, up: player.up } });
  }
  private async assign({
    action,
    contextSeed,
    user,
  }: {
    action: RoomAction;
    contextSeed?: number;
    user: User;
  }) {
    if (action === 'spectate')
      return json(await this.roomData(contextSeed ?? (await ensureFirstRoom(this.env, user)), user));
    if (adventureEnabled(this.env)) return this.assignAdventure(action, contextSeed, user);
    const current = await this.env.DB.prepare(
      'SELECT room_seed,spawn_index FROM room_assignments WHERE user_id=?',
    )
      .bind(user.id)
      .first<{ room_seed: number; spawn_index: number }>();
    if (
      (action === 'restart' || action === 'next') &&
      (!current || contextSeed !== current.room_seed)
    )
      return json({ error: { code: 'ROOM_CONTEXT_MISMATCH' } }, 409);
    let seed: number;
    if (action === 'restart') seed = current!.room_seed;
    else if (action === 'initial') seed = await ensureFirstRoom(this.env, user);
    else if (action === 'resume') {
      const last = await this.env.DB.prepare('SELECT last_room_seed FROM users WHERE id=?')
        .bind(user.id)
        .first<{ last_room_seed: number | null }>();
      seed = last?.last_room_seed ?? (await ensureFirstRoom(this.env, user));
    } else if (action === 'next') {
      const source = roomCoordinates(current!.room_seed);
      const target = source ? adjacentRoom(source, 'xp') : { x: 0, y: 0, z: 0 };
      try { seed = roomSeed(target); }
      catch { return json({ error: { code: 'WORLD_EDGE' } }, 409); }
      await this.env.DB.prepare('INSERT OR IGNORE INTO rooms(seed,elo_bucket,updated_at) VALUES(?,?,?)')
        .bind(seed, Math.floor(user.elo / 100), now()).run();
    } else return json({ error: { code: 'INVALID_ROOM_ACTION' } }, 400);
    const spawn = chooseSpawn([], action === 'restart' ? current!.spawn_index : undefined);
    const time = now();
    await this.env.DB.batch([
      this.env.DB.prepare(
        'INSERT INTO user_room_visits(user_id,room_seed,visited_at) VALUES(?,?,?) ON CONFLICT(user_id,room_seed) DO NOTHING',
      ).bind(user.id, seed, time),
      this.env.DB.prepare('UPDATE users SET last_room_seed=?,last_seen=? WHERE id=?').bind(
        seed,
        time,
        user.id,
      ),
      this.env.DB.prepare(
        'INSERT INTO room_assignments(user_id,room_seed,spawn_index,assigned_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET room_seed=excluded.room_seed,spawn_index=excluded.spawn_index,assigned_at=excluded.assigned_at',
      ).bind(user.id, seed, spawn, time),
      this.env.DB.prepare(
        'INSERT INTO room_players(room_seed,user_id,spawn_index,joined_at) VALUES(?,?,?,?) ON CONFLICT(room_seed,user_id) DO UPDATE SET spawn_index=excluded.spawn_index,joined_at=excluded.joined_at',
      ).bind(seed, user.id, spawn, time),
      this.env.DB.prepare('UPDATE rooms SET updated_at=? WHERE seed=?').bind(time, seed),
    ]);
    return json(await this.roomData(seed, user));
  }
  private async join({ user, seed }: { user: User; seed: number }) {
    if (adventureEnabled(this.env) && !validAdventureRoom(seed)) return json({ error: { code: 'WORLD_EDGE' } }, 409);
    const exists = await this.env.DB.prepare('SELECT 1 FROM rooms WHERE seed=?').bind(seed).first();
    if (!exists) return json({ error: { code: 'ROOM_NOT_FOUND' } }, 404);
    const state = await this.prepareState(seed);
    const spawn = chooseSpawn([]);
    const spawnState = { ...state, players: Object.fromEntries(
      Object.entries(state.players).filter(([, player]) => player.id !== user.id),
    ) };
    let availableSpawn = safeSpawn(spawnState, undefined, spawn);
    if (!availableSpawn.safe) {
      const weakest = chooseLowestPhantom(Object.values(state.players));
      if (!weakest) return json({ error: { code: 'ROOM_FULL' } }, 409);
      delete state.players[weakest.entityId];
      delete spawnState.players[weakest.entityId];
      availableSpawn = safeSpawn(spawnState, undefined, weakest.spawnIndex ?? spawn);
      if (!availableSpawn.safe) return json({ error: { code: 'ROOM_FULL' } }, 409);
    }
    for (const [entityId, player] of Object.entries(state.players))
      if (player.id === user.id && !player.phantom) delete state.players[entityId];
    const player = addPlayer(state, user.id, user.username, Date.now(), {
      spawnIndex: availableSpawn.spawnIndex,
      entityId: crypto.randomUUID(),
      appearance: normalizeSnakeAppearance(user.settings?.snakeAppearance),
    });
    const actualSpawn = player.spawnIndex ?? availableSpawn.spawnIndex;
    // Expire a reservation if the HTTP join is never followed by a socket.
    player.disconnectedAt = Date.now() + 15000;
    if (adventureEnabled(this.env)) {
      player.adventure = newAdventure(player.segments.length, player.speed);
      player.adventureStep = 0;
      const checkpoint = enterAdventure(this.adventureSnake(player), seed, []);
      await adventureStatement(this.env, user.id, checkpoint, []).run();
    }
    this.startTrajectory(state, player, actualSpawn);
    const time = now();
    await this.env.DB.batch([
      this.env.DB.prepare(
        'INSERT INTO user_room_visits(user_id,room_seed,visited_at) VALUES(?,?,?) ON CONFLICT(user_id,room_seed) DO NOTHING',
      ).bind(user.id, seed, time),
      this.env.DB.prepare('UPDATE users SET last_room_seed=?,last_seen=? WHERE id=?').bind(
        seed,
        time,
        user.id,
      ),
      this.env.DB.prepare(
        'INSERT INTO room_assignments(user_id,room_seed,spawn_index,assigned_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET room_seed=excluded.room_seed,spawn_index=excluded.spawn_index,assigned_at=excluded.assigned_at',
      ).bind(user.id, seed, actualSpawn, time),
      this.env.DB.prepare(
        'INSERT INTO room_players(room_seed,user_id,spawn_index,joined_at) VALUES(?,?,?,?) ON CONFLICT(room_seed,user_id) DO UPDATE SET spawn_index=excluded.spawn_index,joined_at=excluded.joined_at',
      ).bind(seed, user.id, actualSpawn, time),
      this.env.DB.prepare(
        'INSERT INTO live_room_assignments(room_seed,user_id,spawn_json,assigned_at) VALUES(?,?,?,?) ON CONFLICT(room_seed,user_id) DO UPDATE SET spawn_json=excluded.spawn_json,assigned_at=excluded.assigned_at',
      ).bind(
        seed,
        user.id,
        JSON.stringify({
          position: player.segments[0],
          direction: player.direction,
          up: player.up,
        }),
        time,
      ),
    ]);
    await this.persist(state);
    this.broadcast({
      v: 2,
      type: 'player.joined',
      payload: {
        user: { id: user.id, username: user.username },
        timestamp: Date.now(),
        action: {
          type: 'spawn',
          position: player.segments[0],
          direction: player.direction,
          up: player.up,
        },
      },
    });
    return json(
      await this.roomData(
        seed,
        user,
        {
          position: player.segments[0],
          direction: player.direction,
          up: player.up,
        },
      ),
    );
  }
  private async spectate({ user, seed }: { user: User; seed: number }) {
    return json(await this.roomData(seed, user));
  }
  private async submit({
    seed,
    submissionId,
    user,
  }: {
    seed: number;
    submissionId: string;
    user: User;
  }) {
    const old = await this.env.DB.prepare(
      'SELECT result_json FROM game_submissions WHERE id=? AND user_id=?',
    )
      .bind(submissionId, user.id)
      .first<{ result_json: string }>();
    if (old) return json(JSON.parse(old.result_json));
    const terminal = await this.ctx.storage.get<{
        player: SimPlayer;
        deathPosition: unknown;
        reason: string;
        trajectory: ReplayTrajectory;
      }>(`terminal:${user.id}`),
      state = await this.loadState(seed);
    if (!terminal) return json({ error: { code: 'NO_AUTHORITATIVE_TERMINAL_RECORD' } }, 409);
    const current = state.players[user.id];
    if (current?.alive || current?.instanceId !== terminal.player.instanceId)
      return json({ error: { code: 'TERMINAL_RECORD_SUPERSEDED' } }, 409);
    const id = crypto.randomUUID(),
      time = now(),
      score = terminal.player.score,
      stored = {
        id,
        playerId: user.id,
        playerName: user.username,
        finalScore: score,
        deathPosition: terminal.deathPosition,
        startParams: {
          seed,
          spawnIndex: terminal.trajectory.spawnIndex,
          initialSpeed: terminal.trajectory.initialSpeed,
          startPosition: terminal.trajectory.startPosition,
          startDirection: terminal.trajectory.startDirection,
          startSegments: terminal.trajectory.startSegments,
          initialScore: terminal.trajectory.initialScore,
          adventureVersion: terminal.trajectory.adventureVersion,
          initialAdventure: terminal.trajectory.initialAdventure,
          initialGrowth: terminal.trajectory.initialGrowth,
        },
        trajectoryLog: terminal.trajectory.changes,
        adventureEvents: terminal.trajectory.events,
        timestamp: Date.now(),
        elo: user.elo,
        appearance: terminal.player.appearance,
        terminalReason: terminal.reason,
      };
    const worst = await this.env.DB.prepare(
      'SELECT id,score FROM replays WHERE room_seed=? ORDER BY score ASC,created_at ASC LIMIT 1',
    )
      .bind(seed)
      .first<{ id: string; score: number }>();
    const count = await this.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM replays WHERE room_seed=?',
    )
      .bind(seed)
      .first<{ count: number }>();
    const replaySaved =
      Number(count?.count ?? 0) < 3 || score > Number(worst?.score ?? Number.MAX_SAFE_INTEGER);
    const result = {
      saved: true,
      replaySaved,
      replayId: replaySaved ? id : undefined,
      message: replaySaved
        ? 'Game and replay saved'
        : 'Game saved; replay did not beat the room minimum',
    };
    const statements = [
      this.env.DB.prepare(
        'UPDATE rooms SET total_games_played=total_games_played+1,updated_at=? WHERE seed=?',
      ).bind(time, seed),
      this.env.DB.prepare(
        `INSERT INTO room_spawn_records(room_seed,spawn_index,best_score,updated_at) VALUES(?,?,?,?)
         ON CONFLICT(room_seed,spawn_index) DO UPDATE SET
           best_score=MAX(best_score,excluded.best_score),
           updated_at=CASE WHEN excluded.best_score>best_score THEN excluded.updated_at ELSE updated_at END`,
      ).bind(seed, terminal.trajectory.spawnIndex, score, time),
      this.env.DB.prepare(
        'UPDATE users SET games_played=games_played+1,total_score=total_score+?,high_score=CASE WHEN ?>high_score THEN ? ELSE high_score END,high_score_seed=CASE WHEN ?>high_score THEN ? ELSE high_score_seed END,high_score_replay_id=CASE WHEN ?>high_score THEN ? ELSE high_score_replay_id END,high_score_date=CASE WHEN ?>high_score THEN ? ELSE high_score_date END,elo=CASE WHEN ?>high_score THEN ? ELSE elo END,last_seen=? WHERE id=?',
      ).bind(score, score, score, score, seed, score, id, score, time, score, score, time, user.id),
      this.env.DB.prepare(
        'INSERT INTO game_submissions(id,user_id,room_seed,replay_id,result_json,created_at) VALUES(?,?,?,?,?,?)',
      ).bind(submissionId, user.id, seed, replaySaved ? id : null, JSON.stringify(result), time),
    ];
    if (replaySaved) {
      for (const operation of replayReplacementOrder(
        true,
        Boolean(worst && Number(count?.count) >= 3),
      ))
        statements.unshift(
          operation === 'deleteRoomMinimum'
            ? this.env.DB.prepare('DELETE FROM replays WHERE id=?').bind(worst!.id)
            : this.env.DB.prepare(
                'INSERT INTO replays(id,room_seed,user_id,score,created_at,payload_json) VALUES(?,?,?,?,?,?)',
              ).bind(id, seed, user.id, score, time, JSON.stringify(stored)),
        );
    }
    await this.env.DB.batch(statements);
    return json(result);
  }
  private async saveTerminal(
    seed: number,
    submissionId: string,
    terminal: {
      player: SimPlayer;
      deathPosition: unknown;
      reason: string;
      trajectory: ReplayTrajectory;
    },
  ) {
    if (terminal.player.phantom) return null;
    const userRow = await this.env.DB.prepare('SELECT * FROM users WHERE id=?')
      .bind(terminal.player.id)
      .first<Record<string, unknown>>();
    if (!userRow) return null;
    const user = toUser(userRow),
      old = await this.env.DB.prepare(
        'SELECT result_json FROM game_submissions WHERE id=? AND user_id=?',
      )
        .bind(submissionId, user.id)
        .first<{ result_json: string }>();
    if (old) return JSON.parse(old.result_json);
    const id = crypto.randomUUID(),
      time = now(),
      score = terminal.player.score,
      stored = {
        id,
        playerId: user.id,
        playerName: user.username,
        finalScore: score,
        deathPosition: terminal.deathPosition,
        startParams: {
          seed,
          spawnIndex: terminal.trajectory.spawnIndex,
          initialSpeed: terminal.trajectory.initialSpeed,
          startPosition: terminal.trajectory.startPosition,
          startDirection: terminal.trajectory.startDirection,
          startSegments: terminal.trajectory.startSegments,
          initialScore: terminal.trajectory.initialScore,
          initialGrowth: terminal.trajectory.initialGrowth,
          adventureVersion: terminal.trajectory.adventureVersion,
          initialAdventure: terminal.trajectory.initialAdventure,
        },
        trajectoryLog: terminal.trajectory.changes,
        adventureEvents: terminal.trajectory.events,
        timestamp: Date.now(),
        elo: user.elo,
        appearance: terminal.player.appearance,
        terminalReason: terminal.reason,
      };
    const worst = await this.env.DB.prepare(
      'SELECT id,score FROM replays WHERE room_seed=? ORDER BY score ASC,created_at ASC LIMIT 1',
    )
      .bind(seed)
      .first<{ id: string; score: number }>();
    const count = await this.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM replays WHERE room_seed=?',
    )
      .bind(seed)
      .first<{ count: number }>();
    const replaySaved =
      Number(count?.count ?? 0) < 3 || score > Number(worst?.score ?? Number.MAX_SAFE_INTEGER);
    const result = {
      saved: true,
      replaySaved,
      replayId: replaySaved ? id : undefined,
      message: replaySaved
        ? 'Game and replay saved'
        : 'Game saved; replay did not beat the room minimum',
    };
    const statements = [
      this.env.DB.prepare(
        'UPDATE rooms SET total_games_played=total_games_played+1,updated_at=? WHERE seed=?',
      ).bind(time, seed),
      this.env.DB.prepare(
        `INSERT INTO room_spawn_records(room_seed,spawn_index,best_score,updated_at) VALUES(?,?,?,?)
         ON CONFLICT(room_seed,spawn_index) DO UPDATE SET
           best_score=MAX(best_score,excluded.best_score),
           updated_at=CASE WHEN excluded.best_score>best_score THEN excluded.updated_at ELSE updated_at END`,
      ).bind(seed, terminal.trajectory.spawnIndex, score, time),
      this.env.DB.prepare(
        'UPDATE users SET games_played=games_played+1,total_score=total_score+?,high_score=CASE WHEN ?>high_score THEN ? ELSE high_score END,high_score_seed=CASE WHEN ?>high_score THEN ? ELSE high_score_seed END,high_score_replay_id=CASE WHEN ?>high_score THEN ? ELSE high_score_replay_id END,high_score_date=CASE WHEN ?>high_score THEN ? ELSE high_score_date END,elo=CASE WHEN ?>high_score THEN ? ELSE elo END,last_seen=? WHERE id=?',
      ).bind(score, score, score, score, seed, score, id, score, time, score, score, time, user.id),
      this.env.DB.prepare(
        'INSERT INTO game_submissions(id,user_id,room_seed,replay_id,result_json,created_at) VALUES(?,?,?,?,?,?)',
      ).bind(submissionId, user.id, seed, replaySaved ? id : null, JSON.stringify(result), time),
    ];
    if (replaySaved) {
      for (const operation of replayReplacementOrder(
        true,
        Boolean(worst && Number(count?.count) >= 3),
      ))
        statements.unshift(
          operation === 'deleteRoomMinimum'
            ? this.env.DB.prepare('DELETE FROM replays WHERE id=?').bind(worst!.id)
            : this.env.DB.prepare(
                'INSERT INTO replays(id,room_seed,user_id,score,created_at,payload_json) VALUES(?,?,?,?,?,?)',
              ).bind(id, seed, user.id, score, time, JSON.stringify(stored)),
        );
    }
    await this.env.DB.batch(statements);
    return result;
  }
  private async socket(request: Request) {
    if (request.headers.get('upgrade') !== 'websocket')
      return new Response('Upgrade required', { status: 426 });
    const pair = new WebSocketPair(),
      [client, server] = Object.values(pair),
      user = JSON.parse(request.headers.get('x-user') || '{}') as User,
      seed = Number(request.headers.get('x-seed')),
      spectator = request.headers.get('x-spectator') === '1',
      state = await this.liveState(seed);
    let player = Object.values(state.players).find(
      (candidate) => candidate.id === user.id && !candidate.phantom,
    );
    let playerJoined = false;
    const connectionId = crypto.randomUUID();
    if (!spectator) {
      const assigned = await this.env.DB.prepare(
        'SELECT spawn_index FROM room_assignments WHERE room_seed=? AND user_id=?',
      )
        .bind(seed, user.id)
        .first<{ spawn_index: number }>();
      const spawnIndex = assigned?.spawn_index ?? 0;
      if (adventureEnabled(this.env) && (!player || !player.alive || !player.adventure)) {
        const record = await loadAdventure(this.env, user.id);
        if (!record || record.checkpoint.seed !== seed) return json({ error: { code: 'RESTART REQUIRED' } }, 409);
        if (checkpointBlocked(record.checkpoint, Object.values(state.players).filter(p => p.id !== user.id))) return json({ error: { code: 'RESPAWN BLOCKED' } }, 409);
        player = this.installAdventure(state, user, record.checkpoint);
      }
      if (!player || !player.alive) {
        const availableSpawn = safeSpawn(state, undefined, spawnIndex);
        if (!availableSpawn.safe) return json({ error: { code: 'ROOM_FULL' } }, 409);
        if (player) delete state.players[player.entityId];
        player = addPlayer(state, user.id, user.username, Date.now(), {
          spawnIndex,
          instanceId: connectionId,
          appearance: normalizeSnakeAppearance(user.settings?.snakeAppearance),
        });
        this.startTrajectory(state, player, player.spawnIndex ?? availableSpawn.spawnIndex);
        playerJoined = true;
      } else {
        player.instanceId = connectionId;
        // Sequence numbers belong to the WebSocket session. A client that
        // re-enters an existing room may start them again from zero.
        player.lastStateSeq = undefined;
        player.lastInputSeq = undefined;
        player.appearance = normalizeSnakeAppearance(user.settings?.snakeAppearance ?? player.appearance);
        player.disconnectedAt = undefined;
        for (const socket of this.ctx.getWebSockets())
          try {
            const attachment = socket.deserializeAttachment() as { userId?: string } | null;
            if (attachment?.userId === user.id)
              socket.close(4001, 'Replaced by a newer connection');
          } catch {}
      }
      await this.persist(state);
    }
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      userId: user.id,
      entityId: player?.entityId,
      seed,
      user,
      spectator,
      instanceId: player?.instanceId,
    });
    if (!spectator) {
      try { await this.recordLiveEncounters(seed, user.id, state); }
      catch (error) { console.error('Failed to record live player encounter', error); }
    }
    server.send(JSON.stringify({ v: 2, type: 'room.state', payload: this.snapshot(state) }));
    if (spectator) this.requestSpectatorSync();
    if (playerJoined)
      this.broadcast({
        v: 2,
        type: 'player.joined',
        payload: {
          user: { id: user.id, username: user.username },
          timestamp: Date.now(),
          action: {
            type: 'spawn',
            entityId: player!.entityId,
            position: player!.segments[0],
            direction: player!.direction,
            up: player!.up,
          },
        },
      });
    this.presence();
    return new Response(null, { status: 101, webSocket: client });
  }
  private messageQueue: Promise<void> = Promise.resolve();
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const task = this.messageQueue.then(() => this.receiveWebSocketMessage(ws, message));
    this.messageQueue = task.catch(() => {});
    await task;
  }
  private async receiveWebSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    let deathContext: { seed: number; submissionId: string } | null = null;
    try {
      const event = JSON.parse(String(message)) as RealtimeClientMessage,
        attachment = ws.deserializeAttachment() as {
          userId: string;
          entityId?: string;
          seed: number;
          user: User;
          spectator?: boolean;
          instanceId?: string;
        };
      if (event?.type === 'player.died' && typeof event.payload?.action?.submissionId === 'string')
        deathContext = { seed: attachment.seed, submissionId: event.payload.action.submissionId };
      if (event?.v !== 2 && event?.v !== 3) {
        if (deathContext) {
          await this.saveStage(attachment.seed, attachment.userId, deathContext.submissionId, 'rejected', 'INVALID_PROTOCOL_VERSION');
          ws.send(JSON.stringify({ v: 2, type: 'game.saveFailed', payload: {
            submissionId: deathContext.submissionId, code: 'INVALID_PROTOCOL_VERSION', retryable: false,
          } }));
        } else {
          ws.send(JSON.stringify({ v: 2, type: 'error', payload: { code: 'INVALID_PROTOCOL_VERSION' } }));
        }
        return;
      }
      if (event.type === 'ping') {
        ws.send(JSON.stringify({ v: 2, type: 'pong' }));
        return;
      }
      const state = await this.liveState(attachment.seed);
      if (event.type === 'room.resync') {
        ws.send(JSON.stringify({ v: 2, type: 'room.state', payload: this.snapshot(state) }));
        return;
      }
      if (attachment.spectator) {
        if (deathContext) {
          await this.saveStage(attachment.seed, attachment.userId, deathContext.submissionId, 'rejected', 'SPECTATOR_CANNOT_SAVE');
          ws.send(JSON.stringify({ v: 2, type: 'game.saveFailed', payload: {
            submissionId: deathContext.submissionId, code: 'SPECTATOR_CANNOT_SAVE', retryable: false,
          } }));
        } else {
          ws.send(JSON.stringify({ v: 2, type: 'error', payload: { code: 'SPECTATOR_READ_ONLY' } }));
        }
        return;
      }
      const action = 'payload' in event && 'action' in event.payload ? event.payload.action : undefined;
      const deathSubmissionId = event.type === 'player.died' && action && typeof action === 'object' &&
        'submissionId' in action && typeof action.submissionId === 'string' ? action.submissionId : null;
      const player = attachment.entityId ? state.players[attachment.entityId] : undefined;
      if (!player || player.instanceId !== attachment.instanceId) {
        if (deathSubmissionId) await this.saveStage(state.seed, attachment.userId, deathSubmissionId, 'rejected', 'STALE_CONNECTION');
        ws.send(JSON.stringify(deathSubmissionId
          ? { v: 2, type: 'game.saveFailed', payload: { submissionId: deathSubmissionId, code: 'STALE_CONNECTION', retryable: false } }
          : { v: 2, type: 'error', payload: { code: 'STALE_CONNECTION' } }));
        return;
      }
      if (player.adventure && await this.ctx.storage.get(`departure:${player.id}`)) return;
      if (event.type === 'adventure.step') {
        if (!player.adventure || event.v !== 3 || player.paused || !player.alive || !snakeState(action)) return;
        const step = (action as { step?: number }).step;
        if (step !== (player.adventureStep ?? 0) + 1) {
          ws.send(JSON.stringify({ v: 3, type: 'adventure.state', payload: { entityId: player.entityId, step: player.adventureStep ?? 0, state: this.adventureSnake(player) } }));
          return;
        }
        const previous = this.adventureSnake(player);
        const next = moveAdventure(previous, action.direction);
        if (!next || !samePosition(next.segments[0], action.segments[0])) {
          ws.send(JSON.stringify({ v: 3, type: 'adventure.state', payload: { entityId: player.entityId, step: player.adventureStep ?? 0, state: previous } }));
          return;
        }
        next.up = copy(action.up);
        const eaten = state.food.findIndex(food => samePosition(food, next.segments[0]));
        if (eaten >= 0) {
          const removed = state.food.splice(eaten, 1)[0];
          const effect = foodEffect(removed.kind);
          next.score += effect.score; next.speed = Math.max(60, next.speed + effect.speed); next.growth += effect.growth;
          const available = createSimulation(state.seed + state.tick).food.find(food => !state.food.some(p => samePosition(p, food)) && !Object.values(state.players).some(p => p.segments.some(s => samePosition(s, food))) && !this.definition(state).interactions.some(o => samePosition(o.position, food)));
          if (available) state.food.push(available);
        }
        const triggered = applyInteractions(this.definition(state), next, 60000 / previous.speed);
        if (!samePosition(player.direction, next.direction)) { player.direction = next.direction; this.recordDirection(state, player, previous.segments[0]); }
        Object.assign(player, next, { adventureStep: step });
        state.tick++;
        const trajectory = state.trajectories?.[player.id];
        if (trajectory && (triggered.length || eaten >= 0 || JSON.stringify(next.adventure.coatings) !== JSON.stringify(previous.adventure.coatings) || JSON.stringify(next.adventure.completed) !== JSON.stringify(previous.adventure.completed))) (trajectory.events ??= []).push({ step: step!, snake: copy(next) });
        await this.persist(state);
        this.broadcast({ v: 3, type: 'adventure.state', payload: { entityId: player.entityId, step: step!, state: next } });
        if (eaten >= 0) this.broadcast({ v: 2, type: 'room.state', payload: this.snapshot(state) });
        return;
      }
      if (player.adventure && (event.type === 'player.state' || event.type === 'player.directionChanged')) return;
      if (event.type === 'player.died' && !deathInput(action)) {
        if (deathSubmissionId) await this.saveStage(state.seed, player.id, deathSubmissionId, 'rejected', 'INVALID_DEATH_PAYLOAD');
        ws.send(JSON.stringify(deathSubmissionId
          ? { v: 2, type: 'game.saveFailed', payload: { submissionId: deathSubmissionId, code: 'INVALID_DEATH_PAYLOAD', retryable: false } }
          : { v: 2, type: 'error', payload: { code: 'INVALID_DEATH_PAYLOAD' } }));
        return;
      }
      if (!player.alive && event.type === 'player.died' && deathInput(action)) {
        const terminal = await this.ctx.storage.get<{
          player: SimPlayer; deathPosition: Axis; reason: string; trajectory: ReplayTrajectory; submissionId: string;
        }>(`terminal:${player.id}`);
        if (!terminal || terminal.player.instanceId !== player.instanceId || terminal.submissionId !== action.submissionId) {
          await this.saveStage(state.seed, player.id, action.submissionId, 'rejected', 'TERMINAL_NOT_AVAILABLE');
          ws.send(JSON.stringify({ v: 2, type: 'game.saveFailed', payload: {
            submissionId: action.submissionId, code: 'TERMINAL_NOT_AVAILABLE', retryable: false,
          } }));
          return;
        }
        try {
          await this.saveStage(state.seed, player.id, action.submissionId, 'retrying');
          ws.send(JSON.stringify({ v: 2, type: 'game.saveStarted', payload: { submissionId: action.submissionId, stage: 'retrying' } }));
          const result = await this.saveTerminal(state.seed, action.submissionId, terminal);
          if (!result) throw new Error('USER_NOT_FOUND');
          await this.saveStage(state.seed, player.id, action.submissionId, 'databaseCommitted');
          await this.saveStage(state.seed, player.id, action.submissionId, 'saved');
          ws.send(JSON.stringify({ v: 2, type: 'game.saved', payload: { ...result, submissionId: action.submissionId } }));
        } catch (error) {
          const code = error instanceof Error && error.message === 'USER_NOT_FOUND' ? 'USER_NOT_FOUND' : 'SAVE_FAILED';
          console.error(JSON.stringify({ event: 'game.saveError', seed: state.seed, submissionId: action.submissionId, error: String(error) }));
          await this.saveStage(state.seed, player.id, action.submissionId, 'failed', code);
          ws.send(JSON.stringify({ v: 2, type: 'game.saveFailed', payload: {
            submissionId: action.submissionId, code, retryable: code === 'SAVE_FAILED',
          } }));
        }
        return;
      }
      if (!player.alive) {
        ws.send(JSON.stringify({ v: 2, type: 'error', payload: { code: 'PLAYER_NOT_ALIVE' } }));
        return;
      }
      if (event.type === 'player.appearance') {
        if (!isSnakeAppearance(event.payload.appearance)) {
          ws.send(JSON.stringify({ v: 2, type: 'error', payload: { code: 'INVALID_MESSAGE' } }));
          return;
        }
        player.appearance = normalizeSnakeAppearance(event.payload.appearance);
        await this.persist(state);
        this.broadcast({
          v: 2,
          type: 'player.appearance',
          payload: { entityId: player.entityId, appearance: player.appearance },
        });
        return;
      }
      if (event.type === 'player.state' && stateInput(action)) {
        if (action.seq <= (player.lastStateSeq ?? -1)) return;
        player.segments = action.segments;
        player.direction = action.direction;
        player.up = action.up;
        player.score = action.score;
        player.speed = action.speed;
        player.lastStateSeq = action.seq;
        state.tick++;
        await this.persist(state);
        this.broadcast(
          {
            v: 2,
            type: 'player.state',
            payload: {
              entityId: player.entityId,
              segments: player.segments,
              direction: player.direction,
              up: player.up,
              score: player.score,
              speed: player.speed,
              seq: action.seq,
              step: action.step,
              reason: action.reason,
              eatenFood: action.eatenFood,
              serverTime: Date.now(),
            },
          },
          ws,
        );
        return;
      }
      /** UC 1: persist and broadcast a pause checkpoint without recording replay trajectory. */
      if (event.type === 'player.pauseChanged' && pauseInput(action)) {
        if (action.seq <= (player.lastStateSeq ?? -1)) return;
        if (!player.adventure) {
          player.segments = action.segments;
          player.direction = action.direction;
          player.up = action.up;
          player.score = action.score;
          player.speed = action.speed;
        }
        player.paused = action.paused;
        player.lastStateSeq = action.seq;
        await this.persist(state);
        this.broadcast(
          {
            v: 2,
            type: 'player.pauseChanged',
            payload: {
              entityId: player.entityId,
              seq: action.seq,
              step: action.step,
              paused: player.paused,
              segments: player.segments,
              direction: player.direction,
              up: player.up,
              score: player.score,
              speed: player.speed,
              serverTime: Date.now(),
            },
          },
          ws,
        );
        return;
      }
      if (event.type === 'player.died' && deathInput(action)) {
        if (action.seq <= (player.lastStateSeq ?? -1)) {
          await this.saveStage(state.seed, player.id, action.submissionId, 'rejected', 'STALE_DEATH_SEQUENCE');
          ws.send(JSON.stringify({ v: 2, type: 'game.saveFailed', payload: {
            submissionId: action.submissionId, code: 'STALE_DEATH_SEQUENCE', retryable: false,
          } }));
          return;
        }
        try {
        await this.saveStage(state.seed, player.id, action.submissionId, 'received');
        ws.send(JSON.stringify({ v: 2, type: 'game.saveStarted', payload: { submissionId: action.submissionId, stage: 'received' } }));
        player.segments = action.segments;
        player.direction = action.direction;
        player.up = action.up;
        if (!player.adventure) { player.score = action.score; player.speed = action.speed; }
        player.lastStateSeq = action.seq;
        player.alive = false;
        state.tick++;
        const deathPosition = player.segments[0],
          trajectory = state.trajectories?.[player.id];
        if (!trajectory) throw new Error('MISSING_REPLAY_TRAJECTORY');
        await this.ctx.storage.put(`terminal:${player.id}`, {
          player,
          deathPosition,
          reason: action.reason,
          trajectory,
          tick: state.tick,
          createdAt: Date.now(),
          submissionId: action.submissionId,
        });
        await this.persist(state);
        await this.saveStage(state.seed, player.id, action.submissionId, 'terminalStored');
        const result = await this.saveTerminal(state.seed, action.submissionId, {
          player,
          deathPosition,
          reason: action.reason,
          trajectory,
        });
        if (!result) throw new Error('USER_NOT_FOUND');
        await this.saveStage(state.seed, player.id, action.submissionId, 'databaseCommitted');
        this.broadcast(
          {
            v: 2,
            type: 'player.died',
            payload: {
              player,
              position: deathPosition,
              reason: action.reason,
              serverTime: Date.now(),
            },
          },
          ws,
        );
        await this.saveStage(state.seed, player.id, action.submissionId, 'saved');
        ws.send(JSON.stringify({ v: 2, type: 'game.saved', payload: { ...result, submissionId: action.submissionId } }));
        } catch (error) {
          const code = error instanceof Error && ['MISSING_REPLAY_TRAJECTORY', 'USER_NOT_FOUND'].includes(error.message)
            ? error.message : 'SAVE_FAILED';
          console.error(JSON.stringify({ event: 'game.saveError', seed: state.seed, submissionId: action.submissionId, error: String(error) }));
          await this.saveStage(state.seed, player.id, action.submissionId, 'failed', code);
          ws.send(JSON.stringify({ v: 2, type: 'game.saveFailed', payload: {
            submissionId: action.submissionId, code, retryable: code === 'SAVE_FAILED',
          } }));
        }
        return;
      }
      if (
        event.type !== 'player.directionChanged' ||
        !directionInput(action) ||
        action.seq <= (player.lastInputSeq ?? -1) ||
        !validInput(player.direction, action.direction, player.up, action.up)
      ) {
        ws.send(JSON.stringify({ v: 2, type: 'error', payload: { code: 'INVALID_MESSAGE' } }));
        return;
      }
      player.direction = action.direction;
      player.up = action.up;
      player.segments = action.segments;
      player.lastInputSeq = action.seq;
      this.recordDirection(state, player, action.head);
      await this.persist(state);
      this.broadcast(
        {
          v: 2,
          type: 'player.directionChanged',
          payload: {
            entityId: player.entityId,
            seq: action.seq,
            step: action.step,
            head: action.head,
            segments: player.segments,
            direction: player.direction,
            up: player.up,
            speed: player.speed,
            serverTime: Date.now(),
          },
        },
        ws,
      );
    } catch (error) {
      if (deathContext) {
        console.error(JSON.stringify({ event: 'game.saveError', ...deathContext,
          error: String(error), stack: error instanceof Error ? error.stack : undefined }));
        ws.send(JSON.stringify({ v: 2, type: 'game.saveFailed', payload: {
          submissionId: deathContext.submissionId, code: 'PROCESSING_FAILED', retryable: true,
        } }));
      } else {
        ws.send(JSON.stringify({ v: 2, type: 'error', payload: { code: 'INVALID_MESSAGE' } }));
      }
    }
  }
  async webSocketClose(ws: WebSocket) {
    this.simulation ??= await this.ctx.storage.get<SimulationState>('simulation') ?? null;
    const attachment = ws.deserializeAttachment() as {
        userId: string;
        entityId?: string;
        spectator?: boolean;
        instanceId?: string;
      } | null,
      player = attachment?.entityId && this.simulation?.players[attachment.entityId];
    if (
      attachment &&
      !attachment.spectator &&
      player &&
      player.instanceId === attachment.instanceId
    ) {
      player.disconnectedAt = Date.now() + 15000;
      await this.persist(this.simulation!);
      this.broadcast({
        v: 2,
        type: 'room.left',
        payload: { entityId: player.entityId, userId: attachment.userId },
      });
    }
    ws.close();
    if (attachment && !attachment.spectator) {
      const stillConnected = this.ctx.getWebSockets().some((socket) => {
        if (socket === ws) return false;
        const other = socket.deserializeAttachment() as { userId?: string; spectator?: boolean } | null;
        return other?.userId === attachment.userId && !other.spectator;
      });
      if (!stillConnected) {
        const encounters = await this.ctx.storage.list({ prefix: 'encounter:' });
        for (const key of encounters.keys())
          if (key.split(':').slice(1).includes(attachment.userId)) await this.ctx.storage.delete(key);
      }
    }
    this.presence();
  }
  private presence() {
    this.broadcast({
      v: 2,
      type: 'presence.updated',
      payload: { count: this.ctx.getWebSockets().length },
    });
  }
  private requestSpectatorSync() {
    const requestedAt = Date.now();
    if (requestedAt - this.lastSpectatorSyncRequestAt < 500) return;
    this.lastSpectatorSyncRequestAt = requestedAt;
    const text = JSON.stringify({
      v: 2,
      type: 'room.syncRequested',
      payload: { requestId: crypto.randomUUID() },
    });
    for (const socket of this.ctx.getWebSockets())
      try {
        const attachment = socket.deserializeAttachment() as { spectator?: boolean } | null;
        if (!attachment?.spectator) socket.send(text);
      } catch {
        socket.close();
      }
  }
  private sendToUser(userId: string, message: unknown) {
    const text = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets())
      try {
        if ((socket.deserializeAttachment() as { userId?: string } | null)?.userId === userId)
          socket.send(text);
      } catch {
        socket.close();
      }
  }
  // State snapshots are retained for resync; live clients extrapolate between turns.
  private broadcast(message: unknown, except?: WebSocket) {
    const text = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets())
      try {
        if (socket !== except) socket.send(text);
      } catch {
        socket.close();
      }
  }
}
