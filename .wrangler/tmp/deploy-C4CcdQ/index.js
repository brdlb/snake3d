var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// shared/appearance.ts
var DEFAULT_SNAKE_APPEARANCE = {
  patternSeed: 1847,
  backgroundColor: "#311a1a",
  patternColor: "#d98c8c"
};
var HEX_COLOR = /^#[0-9a-f]{6}$/i;
function normalizeSnakeAppearance(value) {
  const appearance = value && typeof value === "object" ? value : {};
  return {
    patternSeed: Number.isInteger(appearance.patternSeed) && appearance.patternSeed >= 0 ? appearance.patternSeed >>> 0 : DEFAULT_SNAKE_APPEARANCE.patternSeed,
    backgroundColor: HEX_COLOR.test(appearance.backgroundColor ?? "") ? appearance.backgroundColor.toLowerCase() : DEFAULT_SNAKE_APPEARANCE.backgroundColor,
    patternColor: HEX_COLOR.test(appearance.patternColor ?? "") ? appearance.patternColor.toLowerCase() : DEFAULT_SNAKE_APPEARANCE.patternColor
  };
}
__name(normalizeSnakeAppearance, "normalizeSnakeAppearance");
function isSnakeAppearance(value) {
  if (!value || typeof value !== "object") return false;
  const candidate = value;
  return Number.isInteger(candidate.patternSeed) && candidate.patternSeed >= 0 && candidate.patternSeed <= 4294967295 && HEX_COLOR.test(candidate.backgroundColor ?? "") && HEX_COLOR.test(candidate.patternColor ?? "");
}
__name(isSnakeAppearance, "isSnakeAppearance");

// shared/simulation.ts
var WORLD_SIZE = 50;
var FOOD_COUNT = 200;
var BASE_SPEED = 300;
var directions = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 }
];
var spawnPoints = [
  { position: { x: 5, y: 5, z: 5 }, direction: { x: 0, y: 0, z: 1 } },
  { position: { x: 45, y: 5, z: 5 }, direction: { x: -1, y: 0, z: 0 } },
  { position: { x: 5, y: 5, z: 45 }, direction: { x: 1, y: 0, z: 0 } },
  { position: { x: 45, y: 5, z: 45 }, direction: { x: 0, y: 0, z: -1 } }
];
var key = /* @__PURE__ */ __name((v) => `${v.x},${v.y},${v.z}`, "key");
var same = /* @__PURE__ */ __name((a, b) => a.x === b.x && a.y === b.y && a.z === b.z, "same");
var add = /* @__PURE__ */ __name((a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }), "add");
var inBounds = /* @__PURE__ */ __name((p) => p.x >= 0 && p.x <= WORLD_SIZE && p.y >= 0 && p.y <= WORLD_SIZE && p.z >= 0 && p.z <= WORLD_SIZE, "inBounds");
var rng = /* @__PURE__ */ __name((seed) => () => {
  let t = seed += 1831565813;
  t = Math.imul(t ^ t >>> 15, t | 1);
  t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}, "rng");
function createSimulation(seed) {
  const random = rng(seed), food = [];
  while (food.length < FOOD_COUNT) {
    const p = {
      x: Math.floor(random() * 51),
      y: Math.floor(random() * 51),
      z: Math.floor(random() * 51)
    };
    if (!food.some((f) => same(f, p)))
      food.push({ ...p, kind: random() < 0.5 ? "blue" : random() < 0.8 ? "green" : "pink" });
  }
  return { seed, tick: 0, food, players: {} };
}
__name(createSimulation, "createSimulation");
function safeSpawn(state, _random = rng(state.seed + state.tick + Object.keys(state.players).length), requestedIndex) {
  void _random;
  const blocked = new Set(
    Object.values(state.players).flatMap((p) => p.segments).map(key)
  );
  const start = Number.isInteger(requestedIndex) ? (requestedIndex % spawnPoints.length + spawnPoints.length) % spawnPoints.length : 0;
  for (let offset = 0; offset < spawnPoints.length; offset++) {
    const spawn = spawnPoints[(start + offset) % spawnPoints.length];
    const tail = {
      x: spawn.position.x - spawn.direction.x * 2,
      y: spawn.position.y - spawn.direction.y * 2,
      z: spawn.position.z - spawn.direction.z * 2
    };
    if (inBounds(tail) && !blocked.has(key(spawn.position)) && !blocked.has(key(tail)))
      return {
        position: { ...spawn.position },
        direction: { ...spawn.direction },
        spawnIndex: (start + offset) % spawnPoints.length,
        safe: true
      };
  }
  return {
    position: { ...spawnPoints[start].position },
    direction: { ...spawnPoints[start].direction },
    spawnIndex: start,
    safe: false
  };
}
__name(safeSpawn, "safeSpawn");
function addPlayer(state, id, name, now2, options = {}) {
  const spawn = safeSpawn(state, void 0, options.spawnIndex);
  const direction = options.direction ?? spawn.direction, up = options.up ?? { x: 0, y: 1, z: 0 }, head = options.startPosition ?? options.segments?.[0] ?? spawn.position, entityId = options.entityId ?? `${id}:${now2}:${Object.keys(state.players).length}`;
  state.players[entityId] = {
    id,
    entityId,
    name,
    segments: options.segments ?? [
      head,
      add(head, { x: -direction.x, y: -direction.y, z: -direction.z }),
      add(head, { x: -2 * direction.x, y: -2 * direction.y, z: -2 * direction.z })
    ],
    direction,
    up,
    score: options.score ?? 0,
    speed: BASE_SPEED,
    growth: 0,
    alive: true,
    paused: false,
    phantom: options.phantom,
    color: options.color ?? (options.phantom ? "#7dd3fc" : "#ffffff"),
    appearance: normalizeSnakeAppearance(options.appearance ?? (options.phantom ? {
      ...DEFAULT_SNAKE_APPEARANCE,
      backgroundColor: "#16333a",
      patternColor: "#7dd3fc"
    } : void 0)),
    nextStepAt: now2 + 200,
    instanceId: options.instanceId,
    spawnIndex: spawn.spawnIndex
  };
  return state.players[entityId];
}
__name(addPlayer, "addPlayer");
function validOrientation(direction, up) {
  if (!direction || !up || typeof direction !== "object" || typeof up !== "object") return false;
  const d = direction, u = up;
  const dLength = d.x ** 2 + d.y ** 2 + d.z ** 2, uLength = u.x ** 2 + u.y ** 2 + u.z ** 2;
  return directions.some((v) => same(v, d)) && directions.some((v) => same(v, u)) && Math.abs(dLength - 1) < 1e-9 && Math.abs(uLength - 1) < 1e-9 && Math.abs(d.x * u.x + d.y * u.y + d.z * u.z) < 1e-9;
}
__name(validOrientation, "validOrientation");
function validInput(current, next, _currentUp, nextUp) {
  if (!next || typeof next !== "object") return false;
  const v = next;
  return directions.some((d) => same(d, v)) && !(v.x === -current.x && v.y === -current.y && v.z === -current.z) && (nextUp === void 0 || validOrientation(v, nextUp));
}
__name(validInput, "validInput");
function chooseLowestPhantom(players) {
  return players.filter((p) => p.phantom).sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))[0];
}
__name(chooseLowestPhantom, "chooseLowestPhantom");

// worker/index.ts
var COOKIE = "snake3d_session";
var YEAR = 31536e3;
var now = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString(), "now");
var json = /* @__PURE__ */ __name((value, status = 200, requestId) => new Response(JSON.stringify(value), {
  status,
  headers: {
    "content-type": "application/json",
    ...requestId ? { "x-request-id": requestId } : {}
  }
}), "json");
var fail = /* @__PURE__ */ __name((code, status, requestId) => json({ error: { code, requestId } }, status, requestId), "fail");
var cookie = /* @__PURE__ */ __name((r, n) => r.headers.get("cookie")?.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${n}=`))?.slice(n.length + 1), "cookie");
var hash = /* @__PURE__ */ __name(async (v) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))].map((x) => x.toString(16).padStart(2, "0")).join(""), "hash");
var username = /* @__PURE__ */ __name(() => `${["Swift", "Stellar", "Neon", "Cosmic"][Math.floor(Math.random() * 4)]}${["Snake", "Viper", "Cobra", "Runner"][Math.floor(Math.random() * 4)]}${Math.floor(Math.random() * 1e3)}`, "username");
function toUser(row) {
  return {
    id: String(row.id),
    username: String(row.username),
    createdAt: String(row.created_at),
    lastSeen: String(row.last_seen),
    highScore: Number(row.high_score),
    highScoreSeed: row.high_score_seed == null ? void 0 : Number(row.high_score_seed),
    highScoreReplayId: row.high_score_replay_id,
    highScoreDate: row.high_score_date,
    gamesPlayed: Number(row.games_played),
    totalScore: Number(row.total_score),
    elo: Number(row.elo),
    settings: JSON.parse(String(row.settings_json))
  };
}
__name(toUser, "toUser");
async function userFor(r, e) {
  const token = cookie(r, COOKIE);
  if (!token) return null;
  const row = await e.DB.prepare(
    "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?"
  ).bind(await hash(token), now()).first();
  return row ? toUser(row) : null;
}
__name(userFor, "userFor");
var mutationAllowed = /* @__PURE__ */ __name((r) => {
  const o = r.headers.get("origin");
  return !o || o === new URL(r.url).origin || o.startsWith("http://localhost:") || o.startsWith("http://127.0.0.1:");
}, "mutationAllowed");
async function body(r, requestId) {
  if (Number(r.headers.get("content-length") || 0) > 524288)
    return fail("PAYLOAD_TOO_LARGE", 413, requestId);
  try {
    return await r.json();
  } catch {
    return fail("INVALID_JSON", 400, requestId);
  }
}
__name(body, "body");
function position(v) {
  if (!v || typeof v !== "object") return false;
  const p = v;
  return [p.x, p.y, p.z].every((x) => typeof x === "number" && Number.isFinite(x));
}
__name(position, "position");
function sequence(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
__name(sequence, "sequence");
function snakeState(value) {
  if (!value || typeof value !== "object") return false;
  const state = value;
  return Array.isArray(state.segments) && state.segments.length > 0 && state.segments.length <= 1e4 && state.segments.every(
    (segment) => position(segment) && Object.values(segment).every(Number.isInteger)
  ) && validOrientation(state.direction, state.up) && typeof state.score === "number" && Number.isSafeInteger(state.score) && state.score >= 0 && typeof state.speed === "number" && Number.isFinite(state.speed) && state.speed >= 60;
}
__name(snakeState, "snakeState");
function stateInput(value) {
  if (!snakeState(value)) return false;
  const action = value;
  return action.type === "state" && sequence(action.seq) && sequence(action.step) && (action.reason === "food" || action.reason === "speed" || action.reason === "reconnect" || action.reason === "spawn" || action.reason === "spectator-sync");
}
__name(stateInput, "stateInput");
function pauseInput(value) {
  if (!snakeState(value)) return false;
  const action = value;
  return action.type === "pause" && sequence(action.seq) && sequence(action.step) && typeof action.paused === "boolean";
}
__name(pauseInput, "pauseInput");
function deathInput(value) {
  if (!snakeState(value)) return false;
  const action = value;
  return action.type === "death" && sequence(action.seq) && sequence(action.step) && typeof action.reason === "string";
}
__name(deathInput, "deathInput");
function directionInput(value) {
  if (!value || typeof value !== "object") return false;
  const action = value;
  return action.type === "direction" && sequence(action.seq) && sequence(action.step) && position(action.head) && Object.values(action.head).every(Number.isInteger) && Array.isArray(action.segments) && action.segments.length > 0 && action.segments.length <= 1e4 && action.segments.every(
    (segment) => position(segment) && Object.values(segment).every(Number.isInteger)
  ) && validOrientation(action.direction, action.up);
}
__name(directionInput, "directionInput");
var roomActions = /* @__PURE__ */ new Set([
  "initial",
  "resume",
  "restart",
  "next",
  "join",
  "spectate"
]);
var randomSeed = /* @__PURE__ */ __name(() => crypto.getRandomValues(new Uint32Array(1))[0] & 2147483647, "randomSeed");
async function createRoomSeed(env, user) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const seed = randomSeed(), result = await env.DB.prepare(
      "INSERT OR IGNORE INTO rooms(seed,elo_bucket,updated_at) VALUES(?,?,?)"
    ).bind(seed, Math.floor(user.elo / 100), now()).run();
    if (result.meta.changes === 1) return seed;
  }
  throw new Error("ROOM_SEED_COLLISION");
}
__name(createRoomSeed, "createRoomSeed");
function parseRoomSeed(value) {
  if (value === null || !/^\d+$/.test(value)) return null;
  const seed = Number(value);
  return Number.isSafeInteger(seed) ? seed : null;
}
__name(parseRoomSeed, "parseRoomSeed");
function chooseSpawn(phantoms, previousSpawnIndex) {
  const used = new Set(
    phantoms.map((p) => p.startParams?.spawnIndex).filter((v) => Number.isInteger(v) && v >= 0 && v < 4)
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
      const bestScore = Number(best.score ?? best.elo ?? 1e3);
      const phantomScore = Number(phantom.score ?? phantom.elo ?? 1e3);
      return phantomScore < bestScore ? phantom : best;
    }).startParams.spawnIndex;
  }
  return previousSpawnIndex === void 0 ? 0 : (previousSpawnIndex + 1) % 4;
}
__name(chooseSpawn, "chooseSpawn");
function rankNextRooms(rooms, playerElo, random = Math.random) {
  return [...rooms].sort(
    (a, b) => Math.abs(a.averageElo - playerElo) - Math.abs(b.averageElo - playerElo) || b.phantomCount - a.phantomCount || random() - 0.5
  );
}
__name(rankNextRooms, "rankNextRooms");
function replayReplacementOrder(replaySaved, evictRoomReplay) {
  if (!replaySaved) return [];
  return [...evictRoomReplay ? ["deleteRoomMinimum"] : [], "insertReplay"];
}
__name(replayReplacementOrder, "replayReplacementOrder");
var ROOM_REPLAYS_QUERY = `SELECT payload_json FROM (
  SELECT payload_json, ROW_NUMBER() OVER (
    PARTITION BY json_extract(payload_json, '$.startParams.spawnIndex')
    ORDER BY score DESC, created_at ASC
  ) AS spawn_rank
  FROM replays
  WHERE room_seed=?
) WHERE spawn_rank=1`;
var ROOM_LIST_QUERY = `SELECT
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
var index_default = {
  async fetch(request, env) {
    const requestId = crypto.randomUUID(), url = new URL(request.url), path = url.pathname;
    if (!path.startsWith("/api/")) {
      const response = await env.ASSETS.fetch(request), headers = new Headers(response.headers);
      headers.set("x-content-type-options", "nosniff");
      headers.set("referrer-policy", "same-origin");
      headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
      return new Response(response.body, { status: response.status, headers });
    }
    if (request.method !== "GET" && !mutationAllowed(request))
      return fail("INVALID_ORIGIN", 403, requestId);
    if (path === "/api/v1/session" && request.method === "POST") {
      const token = [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join(""), id = crypto.randomUUID(), time = now(), secure = url.protocol === "https:" ? " Secure;" : "";
      const user2 = {
        id,
        username: username(),
        createdAt: time,
        lastSeen: time,
        highScore: 0,
        gamesPlayed: 0,
        totalScore: 0,
        elo: 1e3,
        settings: { musicVolume: 0.5, sfxVolume: 0.7, snakeAppearance: DEFAULT_SNAKE_APPEARANCE }
      };
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO users (id,username,created_at,last_seen,settings_json) VALUES (?,?,?,?,?)"
        ).bind(id, user2.username, time, time, JSON.stringify(user2.settings)),
        env.DB.prepare(
          "INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)"
        ).bind(await hash(token), id, new Date(Date.now() + YEAR * 1e3).toISOString(), time)
      ]);
      return new Response(JSON.stringify({ user: user2, isNew: true }), {
        headers: {
          "content-type": "application/json",
          "set-cookie": `${COOKIE}=${token}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${YEAR}`,
          "x-request-id": requestId
        }
      });
    }
    const user = await userFor(request, env);
    if (!user) return fail("UNAUTHENTICATED", 401, requestId);
    if (path === "/api/v1/me" && request.method === "GET") return json({ user }, 200, requestId);
    if (path === "/api/v1/me/settings" && request.method === "PATCH") {
      const data = await body(request, requestId);
      if (data instanceof Response) return data;
      const settings = data.settings;
      if (!settings || typeof settings !== "object")
        return fail("INVALID_SETTINGS", 400, requestId);
      const next = { ...user.settings, ...settings };
      if (![next.musicVolume, next.sfxVolume].every((v) => typeof v === "number" && v >= 0 && v <= 1))
        return fail("INVALID_SETTINGS", 400, requestId);
      if (next.snakeAppearance !== void 0 && !isSnakeAppearance(next.snakeAppearance))
        return fail("INVALID_SETTINGS", 400, requestId);
      await env.DB.prepare("UPDATE users SET settings_json=?,last_seen=? WHERE id=?").bind(JSON.stringify(next), now(), user.id).run();
      return json({ user: { ...user, settings: next } }, 200, requestId);
    }
    if (path === "/api/v1/rooms" && request.method === "GET") {
      const rows = await env.DB.prepare(ROOM_LIST_QUERY).all();
      return json(
        rows.results.map((row) => ({
          seed: Number(row.seed),
          gamesPlayed: Number(row.gamesPlayed),
          bestScores: [row.spawn0, row.spawn1, row.spawn2, row.spawn3].map(
            (score) => score === null ? null : Number(score)
          )
        })),
        200,
        requestId
      );
    }
    if (path === "/api/v1/rooms" && request.method === "POST") {
      return json({ seed: await createRoomSeed(env, user) }, 201, requestId);
    }
    const roomResource = path.match(/^\/api\/v1\/rooms\/(\d+)$/);
    if (roomResource && request.method === "DELETE") {
      const seed = Number(roomResource[1]);
      const exists = await env.DB.prepare("SELECT 1 FROM rooms WHERE seed=?").bind(seed).first();
      if (!exists) return fail("ROOM_NOT_FOUND", 404, requestId);
      await env.ROOMS.get(env.ROOMS.idFromName(String(seed))).fetch("https://room/delete", {
        method: "POST"
      });
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET last_room_seed=NULL WHERE last_room_seed=?").bind(seed),
        env.DB.prepare("DELETE FROM live_room_assignments WHERE room_seed=?").bind(seed),
        env.DB.prepare("DELETE FROM room_assignments WHERE room_seed=?").bind(seed),
        env.DB.prepare("DELETE FROM room_players WHERE room_seed=?").bind(seed),
        env.DB.prepare("DELETE FROM user_room_visits WHERE room_seed=?").bind(seed),
        env.DB.prepare("DELETE FROM room_spawn_records WHERE room_seed=?").bind(seed),
        env.DB.prepare("DELETE FROM game_submissions WHERE room_seed=?").bind(seed),
        env.DB.prepare("DELETE FROM replays WHERE room_seed=?").bind(seed),
        env.DB.prepare("DELETE FROM rooms WHERE seed=?").bind(seed)
      ]);
      return json({ deleted: true, seed }, 200, requestId);
    }
    if (path === "/api/v1/matches" && request.method === "POST") {
      const data = await body(request, requestId);
      if (data instanceof Response) return data;
      const p = data;
      if (typeof p.action !== "string" || !roomActions.has(p.action) || p.contextSeed !== void 0 && !Number.isSafeInteger(p.contextSeed) || p.seed !== void 0 && !Number.isSafeInteger(p.seed))
        return fail("INVALID_ROOM_ACTION", 400, requestId);
      if (p.action === "join" || p.action === "spectate" && Number.isSafeInteger(p.seed)) {
        if (!Number.isSafeInteger(p.seed)) return fail("INVALID_ROOM_LINK", 400, requestId);
        const exists = await env.DB.prepare("SELECT 1 FROM rooms WHERE seed=?").bind(p.seed).first();
        if (!exists) return fail("ROOM_NOT_FOUND", 404, requestId);
        return env.ROOMS.get(env.ROOMS.idFromName(String(p.seed))).fetch(
          `https://room/${p.action}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ user, seed: p.seed })
          }
        );
      }
      if (p.action === "join") return fail("INVALID_ROOM_LINK", 400, requestId);
      return env.ROOMS.get(env.ROOMS.idFromName(`user:${user.id}`)).fetch("https://room/assign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: p.action, contextSeed: p.contextSeed, user })
      });
    }
    const socket = path.match(/^\/api\/v1\/rooms\/(-?\d+)\/socket$/);
    if (socket && request.headers.get("upgrade") === "websocket") {
      const spectator = url.searchParams.get("spectator") === "1", restarting = url.searchParams.get("restart") === "1";
      if (spectator) {
        const exists = await env.DB.prepare("SELECT 1 FROM rooms WHERE seed=?").bind(Number(socket[1])).first();
        if (!exists) return fail("ROOM_NOT_FOUND", 404, requestId);
      } else {
        const assigned = await env.DB.prepare(
          "SELECT 1 FROM room_assignments WHERE user_id=? AND room_seed=?"
        ).bind(user.id, Number(socket[1])).first();
        if (!assigned) return fail("ROOM_CONTEXT_MISMATCH", 409, requestId);
      }
      return env.ROOMS.get(env.ROOMS.idFromName(socket[1])).fetch("https://room/socket", {
        headers: {
          upgrade: "websocket",
          "x-user": JSON.stringify(user),
          "x-seed": socket[1],
          "x-spectator": spectator ? "1" : "0",
          "x-restart": restarting ? "1" : "0"
        }
      });
    }
    if (path === "/api/v1/leaderboard" && request.method === "GET") {
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 50), rows = await env.DB.prepare(
        "SELECT username AS playerName,high_score AS score,high_score_seed AS seed,high_score_date AS date,high_score_replay_id AS replayId FROM users WHERE high_score>0 ORDER BY high_score DESC LIMIT ?"
      ).bind(limit).all();
      return json(rows.results, 200, requestId);
    }
    return fail("NOT_FOUND", 404, requestId);
  }
};
var RoomDurableObject = class {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
  ctx;
  env;
  static {
    __name(this, "RoomDurableObject");
  }
  simulation = null;
  restartUserId = null;
  lastSpectatorSyncRequestAt = 0;
  snapshot(state) {
    return {
      seed: state.seed,
      tick: state.tick,
      serverTime: Date.now(),
      food: state.food,
      players: Object.values(state.players)
    };
  }
  async persist(state) {
    await this.ctx.storage.put("simulation", state);
    const deadlines = Object.values(state.players).map((player) => player.disconnectedAt).filter((value) => Number.isFinite(value));
    const next = Math.min(...deadlines);
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }
  cleanupDisconnected(state, now2) {
    for (const [id, player] of Object.entries(state.players))
      if (player.disconnectedAt !== void 0 && player.disconnectedAt <= now2)
        delete state.players[id];
  }
  startTrajectory(state, player, spawnIndex) {
    (state.trajectories ??= {})[player.id] = {
      startPosition: { ...player.segments[0] },
      startDirection: { ...player.direction },
      spawnIndex,
      initialSpeed: player.speed,
      changes: []
    };
  }
  recordDirection(state, player, position2) {
    let trajectory = state.trajectories?.[player.id];
    if (!trajectory || Array.isArray(trajectory)) {
      this.startTrajectory(state, player, 0);
      trajectory = state.trajectories[player.id];
    }
    trajectory.changes.push({ position: { ...position2 }, direction: { ...player.direction } });
    if (trajectory.changes.length > 1e4)
      trajectory.changes.splice(0, trajectory.changes.length - 1e4);
  }
  async alarm() {
    const state = this.simulation ?? await this.ctx.storage.get("simulation");
    if (!state) return;
    this.simulation = state;
    this.cleanupDisconnected(state, Date.now());
    await this.persist(state);
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/socket") {
      if (request.headers.get("x-restart") === "1")
        this.restartUserId = JSON.parse(request.headers.get("x-user") || "{}").id;
      return this.socket(request);
    }
    if (path === "/delete") {
      for (const socket of this.ctx.getWebSockets()) socket.close(1001, "Room deleted");
      this.simulation = null;
      this.restartUserId = null;
      await this.ctx.storage.deleteAll();
      return new Response(null, { status: 204 });
    }
    const data = await request.json();
    return path === "/assign" ? this.assign(data) : path === "/join" ? this.join(data) : path === "/spectate" ? this.spectate(data) : new Response("Not found", { status: 404 });
  }
  async restorePhantoms(state) {
    const restartingUserId = this.restartUserId;
    if (restartingUserId) {
      const anotherOnlinePlayer = this.ctx.getWebSockets().some((socket) => {
        const attachment = socket.deserializeAttachment();
        return attachment?.userId !== restartingUserId && !attachment?.spectator;
      });
      this.restartUserId = null;
      if (anotherOnlinePlayer) return;
    } else {
      if (Object.values(state.players).some((player) => player.alive && !player.phantom)) return;
      if (Object.values(state.players).some((player) => player.phantom)) return;
    }
    const reserved = /* @__PURE__ */ new Set();
    const assignments = await this.env.DB.prepare(
      "SELECT spawn_index FROM room_assignments WHERE room_seed=?"
    ).bind(state.seed).all();
    for (const assignment of assignments.results) reserved.add(assignment.spawn_index);
    for (const player of Object.values(state.players).filter((player2) => !player2.phantom)) {
      const assignment = await this.env.DB.prepare(
        "SELECT spawn_index FROM room_assignments WHERE room_seed=? AND user_id=?"
      ).bind(state.seed, player.id).first();
      if (assignment && Number.isInteger(assignment.spawn_index))
        reserved.add(assignment.spawn_index);
    }
    if (restartingUserId) {
      for (const [entityId, player] of Object.entries(state.players))
        if (player.id === restartingUserId && !player.phantom) delete state.players[entityId];
    }
    for (const id of Object.keys(state.players))
      if (state.players[id].phantom) delete state.players[id];
    const replays = await this.activeReplays(state.seed);
    for (const row of replays.results)
      try {
        const replay = JSON.parse(row.payload_json);
        const spawnIndex = replay.startParams?.spawnIndex;
        if (reserved.has(spawnIndex)) continue;
        addPlayer(state, `phantom:${replay.id}`, replay.playerName ?? "Phantom", Date.now(), {
          spawnIndex,
          entityId: `phantom:${replay.id}:${crypto.randomUUID()}`,
          phantom: true,
          score: Number(replay.finalScore ?? 0),
          color: "#7dd3fc",
          appearance: replay.appearance,
          startPosition: replay.startParams?.startPosition,
          direction: replay.startParams?.startDirection
        });
      } catch {
      }
  }
  async loadState(seed) {
    this.simulation ??= await this.ctx.storage.get("simulation") ?? createSimulation(seed);
    for (const player of Object.values(this.simulation.players)) player.paused ??= false;
    return this.simulation;
  }
  async prepareState(seed) {
    const state = await this.loadState(seed);
    await this.restorePhantoms(state);
    return state;
  }
  // Realtime messages reuse the loaded simulation; restore replay phantoms only
  // when the Durable Object wakes up or a player explicitly restarts.
  async liveState(seed) {
    const needsPreparation = this.simulation === null || this.restartUserId !== null;
    const state = await this.loadState(seed);
    if (needsPreparation) await this.restorePhantoms(state);
    return state;
  }
  async createRoom(user) {
    return createRoomSeed(this.env, user);
  }
  async activeReplays(seed, excludePlayerId) {
    const replays = await this.env.DB.prepare(ROOM_REPLAYS_QUERY).bind(seed).all();
    if (!excludePlayerId) return replays;
    return {
      ...replays,
      results: replays.results.filter(
        (row) => JSON.parse(row.payload_json).playerId !== excludePlayerId
      )
    };
  }
  async roomData(seed, user, excludeAssignedSpawn = false, playerSpawn, playerSegments = []) {
    const replays = await this.activeReplays(seed);
    const assignment = await this.env.DB.prepare(
      "SELECT spawn_index FROM room_assignments WHERE user_id=? AND room_seed=?"
    ).bind(user.id, seed).first();
    const playerSpawnIndex = assignment?.spawn_index ?? 0;
    return {
      seed,
      phantoms: replays.results.map((r) => JSON.parse(r.payload_json)).filter(
        (replay) => !excludeAssignedSpawn || replay.startParams?.spawnIndex !== playerSpawnIndex && !playerSegments.some((segment) => {
          const start = replay.startParams?.startPosition;
          return start && start.x === segment.x && start.y === segment.y && start.z === segment.z;
        })
      ),
      playerSpawnIndex,
      playerSpawn
    };
  }
  async selectRoom(user) {
    const candidates = await this.env.DB.prepare(
      `SELECT r.seed AS seed, COALESCE(AVG(CAST(json_extract(p.payload_json,'$.elo') AS REAL)),1000) AS average_elo, COUNT(p.id) AS phantom_count FROM rooms r LEFT JOIN replays p ON p.room_seed=r.seed WHERE NOT EXISTS (SELECT 1 FROM user_room_visits v WHERE v.user_id=? AND v.room_seed=r.seed) GROUP BY r.seed`
    ).bind(user.id).all();
    return rankNextRooms(
      candidates.results.map((row) => ({
        seed: Number(row.seed),
        averageElo: Number(row.average_elo),
        phantomCount: Number(row.phantom_count)
      })),
      user.elo
    )[0]?.seed ?? await this.createRoom(user);
  }
  async assign({
    action,
    contextSeed,
    user
  }) {
    if (action === "spectate")
      return json(await this.roomData(contextSeed ?? await this.selectRoom(user), user));
    const current = await this.env.DB.prepare(
      "SELECT room_seed,spawn_index FROM room_assignments WHERE user_id=?"
    ).bind(user.id).first();
    if ((action === "restart" || action === "next") && (!current || contextSeed !== current.room_seed))
      return json({ error: { code: "ROOM_CONTEXT_MISMATCH" } }, 409);
    let seed;
    if (action === "restart") seed = current.room_seed;
    else if (action === "resume" || action === "initial") {
      const last = await this.env.DB.prepare("SELECT last_room_seed FROM users WHERE id=?").bind(user.id).first();
      seed = last?.last_room_seed ?? await this.createRoom(user);
    } else {
      seed = await this.selectRoom(user);
    }
    const existing = await this.activeReplays(seed);
    const spawn = chooseSpawn(
      existing.results.map((row) => JSON.parse(row.payload_json)),
      action === "restart" ? current.spawn_index : void 0
    );
    const time = now();
    await this.env.DB.batch([
      this.env.DB.prepare(
        "INSERT INTO user_room_visits(user_id,room_seed,visited_at) VALUES(?,?,?) ON CONFLICT(user_id,room_seed) DO NOTHING"
      ).bind(user.id, seed, time),
      this.env.DB.prepare("UPDATE users SET last_room_seed=?,last_seen=? WHERE id=?").bind(
        seed,
        time,
        user.id
      ),
      this.env.DB.prepare(
        "INSERT INTO room_assignments(user_id,room_seed,spawn_index,assigned_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET room_seed=excluded.room_seed,spawn_index=excluded.spawn_index,assigned_at=excluded.assigned_at"
      ).bind(user.id, seed, spawn, time),
      this.env.DB.prepare(
        "INSERT INTO room_players(room_seed,user_id,spawn_index,joined_at) VALUES(?,?,?,?) ON CONFLICT(room_seed,user_id) DO UPDATE SET spawn_index=excluded.spawn_index,joined_at=excluded.joined_at"
      ).bind(seed, user.id, spawn, time),
      this.env.DB.prepare("UPDATE rooms SET updated_at=? WHERE seed=?").bind(time, seed)
    ]);
    return json(await this.roomData(seed, user, true));
  }
  async join({ user, seed }) {
    const exists = await this.env.DB.prepare("SELECT 1 FROM rooms WHERE seed=?").bind(seed).first();
    if (!exists) return json({ error: { code: "ROOM_NOT_FOUND" } }, 404);
    const state = await this.prepareState(seed);
    const existing = await this.activeReplays(seed, user.id);
    const spawn = chooseSpawn(existing.results.map((row) => JSON.parse(row.payload_json)));
    let availableSpawn = safeSpawn(state, void 0, spawn);
    if (!availableSpawn.safe) {
      const weakest = chooseLowestPhantom(Object.values(state.players));
      if (!weakest) return json({ error: { code: "ROOM_FULL" } }, 409);
      delete state.players[weakest.entityId];
      availableSpawn = safeSpawn(state, void 0, weakest.spawnIndex ?? spawn);
      if (!availableSpawn.safe) return json({ error: { code: "ROOM_FULL" } }, 409);
    }
    const player = addPlayer(state, user.id, user.username, Date.now(), {
      spawnIndex: availableSpawn.spawnIndex,
      entityId: crypto.randomUUID(),
      appearance: normalizeSnakeAppearance(user.settings?.snakeAppearance)
    });
    const actualSpawn = player.spawnIndex ?? availableSpawn.spawnIndex;
    this.startTrajectory(state, player, actualSpawn);
    const time = now();
    await this.env.DB.batch([
      this.env.DB.prepare(
        "INSERT INTO user_room_visits(user_id,room_seed,visited_at) VALUES(?,?,?) ON CONFLICT(user_id,room_seed) DO NOTHING"
      ).bind(user.id, seed, time),
      this.env.DB.prepare("UPDATE users SET last_room_seed=?,last_seen=? WHERE id=?").bind(
        seed,
        time,
        user.id
      ),
      this.env.DB.prepare(
        "INSERT INTO room_assignments(user_id,room_seed,spawn_index,assigned_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET room_seed=excluded.room_seed,spawn_index=excluded.spawn_index,assigned_at=excluded.assigned_at"
      ).bind(user.id, seed, actualSpawn, time),
      this.env.DB.prepare(
        "INSERT INTO room_players(room_seed,user_id,spawn_index,joined_at) VALUES(?,?,?,?) ON CONFLICT(room_seed,user_id) DO UPDATE SET spawn_index=excluded.spawn_index,joined_at=excluded.joined_at"
      ).bind(seed, user.id, actualSpawn, time),
      this.env.DB.prepare(
        "INSERT INTO live_room_assignments(room_seed,user_id,spawn_json,assigned_at) VALUES(?,?,?,?) ON CONFLICT(room_seed,user_id) DO UPDATE SET spawn_json=excluded.spawn_json,assigned_at=excluded.assigned_at"
      ).bind(
        seed,
        user.id,
        JSON.stringify({
          position: player.segments[0],
          direction: player.direction,
          up: player.up
        }),
        time
      )
    ]);
    await this.ctx.storage.put("simulation", state);
    this.broadcast({
      v: 2,
      type: "player.joined",
      payload: {
        user: { id: user.id, username: user.username },
        timestamp: Date.now(),
        action: {
          type: "spawn",
          position: player.segments[0],
          direction: player.direction,
          up: player.up
        }
      }
    });
    return json(
      await this.roomData(
        seed,
        user,
        true,
        {
          position: player.segments[0],
          direction: player.direction,
          up: player.up
        },
        player.segments
      )
    );
  }
  async spectate({ user, seed }) {
    return json(await this.roomData(seed, user));
  }
  async submit({
    seed,
    submissionId,
    user
  }) {
    const old = await this.env.DB.prepare(
      "SELECT result_json FROM game_submissions WHERE id=? AND user_id=?"
    ).bind(submissionId, user.id).first();
    if (old) return json(JSON.parse(old.result_json));
    const terminal = await this.ctx.storage.get(`terminal:${user.id}`), state = await this.loadState(seed);
    if (!terminal) return json({ error: { code: "NO_AUTHORITATIVE_TERMINAL_RECORD" } }, 409);
    const current = state.players[user.id];
    if (current?.alive || current?.instanceId !== terminal.player.instanceId)
      return json({ error: { code: "TERMINAL_RECORD_SUPERSEDED" } }, 409);
    const id = crypto.randomUUID(), time = now(), score = terminal.player.score, stored = {
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
        startDirection: terminal.trajectory.startDirection
      },
      trajectoryLog: terminal.trajectory.changes,
      timestamp: Date.now(),
      elo: user.elo,
      appearance: terminal.player.appearance,
      terminalReason: terminal.reason
    };
    const worst = await this.env.DB.prepare(
      "SELECT id,score FROM replays WHERE room_seed=? ORDER BY score ASC,created_at ASC LIMIT 1"
    ).bind(seed).first();
    const count = await this.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM replays WHERE room_seed=?"
    ).bind(seed).first();
    const replaySaved = Number(count?.count ?? 0) < 3 || score > Number(worst?.score ?? Number.MAX_SAFE_INTEGER);
    const result = {
      saved: true,
      replaySaved,
      replayId: replaySaved ? id : void 0,
      message: replaySaved ? "Game and replay saved" : "Game saved; replay did not beat the room minimum"
    };
    const statements = [
      this.env.DB.prepare(
        "UPDATE rooms SET total_games_played=total_games_played+1,updated_at=? WHERE seed=?"
      ).bind(time, seed),
      this.env.DB.prepare(
        `INSERT INTO room_spawn_records(room_seed,spawn_index,best_score,updated_at) VALUES(?,?,?,?)
         ON CONFLICT(room_seed,spawn_index) DO UPDATE SET
           best_score=MAX(best_score,excluded.best_score),
           updated_at=CASE WHEN excluded.best_score>best_score THEN excluded.updated_at ELSE updated_at END`
      ).bind(seed, terminal.trajectory.spawnIndex, score, time),
      this.env.DB.prepare(
        "UPDATE users SET games_played=games_played+1,total_score=total_score+?,high_score=CASE WHEN ?>high_score THEN ? ELSE high_score END,high_score_seed=CASE WHEN ?>high_score THEN ? ELSE high_score_seed END,high_score_replay_id=CASE WHEN ?>high_score THEN ? ELSE high_score_replay_id END,high_score_date=CASE WHEN ?>high_score THEN ? ELSE high_score_date END,elo=CASE WHEN ?>high_score THEN ? ELSE elo END,last_seen=? WHERE id=?"
      ).bind(score, score, score, score, seed, score, id, score, time, score, score, time, user.id),
      this.env.DB.prepare(
        "INSERT INTO game_submissions(id,user_id,room_seed,replay_id,result_json,created_at) VALUES(?,?,?,?,?,?)"
      ).bind(submissionId, user.id, seed, replaySaved ? id : null, JSON.stringify(result), time)
    ];
    if (replaySaved) {
      for (const operation of replayReplacementOrder(
        true,
        Boolean(worst && Number(count?.count) >= 3)
      ))
        statements.unshift(
          operation === "deleteRoomMinimum" ? this.env.DB.prepare("DELETE FROM replays WHERE id=?").bind(worst.id) : this.env.DB.prepare(
            "INSERT INTO replays(id,room_seed,user_id,score,created_at,payload_json) VALUES(?,?,?,?,?,?)"
          ).bind(id, seed, user.id, score, time, JSON.stringify(stored))
        );
    }
    await this.env.DB.batch(statements);
    return json(result);
  }
  async saveTerminal(seed, terminal) {
    if (terminal.player.phantom) return null;
    const userRow = await this.env.DB.prepare("SELECT * FROM users WHERE id=?").bind(terminal.player.id).first();
    if (!userRow) return null;
    const user = toUser(userRow), submissionId = `terminal:${seed}:${user.id}:${terminal.player.instanceId ?? "none"}`, old = await this.env.DB.prepare(
      "SELECT result_json FROM game_submissions WHERE id=? AND user_id=?"
    ).bind(submissionId, user.id).first();
    if (old) return JSON.parse(old.result_json);
    const id = crypto.randomUUID(), time = now(), score = terminal.player.score, stored = {
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
        startDirection: terminal.trajectory.startDirection
      },
      trajectoryLog: terminal.trajectory.changes,
      timestamp: Date.now(),
      elo: user.elo,
      appearance: terminal.player.appearance,
      terminalReason: terminal.reason
    };
    const worst = await this.env.DB.prepare(
      "SELECT id,score FROM replays WHERE room_seed=? ORDER BY score ASC,created_at ASC LIMIT 1"
    ).bind(seed).first();
    const count = await this.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM replays WHERE room_seed=?"
    ).bind(seed).first();
    const replaySaved = Number(count?.count ?? 0) < 3 || score > Number(worst?.score ?? Number.MAX_SAFE_INTEGER);
    const result = {
      saved: true,
      replaySaved,
      replayId: replaySaved ? id : void 0,
      message: replaySaved ? "Game and replay saved" : "Game saved; replay did not beat the room minimum"
    };
    const statements = [
      this.env.DB.prepare(
        "UPDATE rooms SET total_games_played=total_games_played+1,updated_at=? WHERE seed=?"
      ).bind(time, seed),
      this.env.DB.prepare(
        `INSERT INTO room_spawn_records(room_seed,spawn_index,best_score,updated_at) VALUES(?,?,?,?)
         ON CONFLICT(room_seed,spawn_index) DO UPDATE SET
           best_score=MAX(best_score,excluded.best_score),
           updated_at=CASE WHEN excluded.best_score>best_score THEN excluded.updated_at ELSE updated_at END`
      ).bind(seed, terminal.trajectory.spawnIndex, score, time),
      this.env.DB.prepare(
        "UPDATE users SET games_played=games_played+1,total_score=total_score+?,high_score=CASE WHEN ?>high_score THEN ? ELSE high_score END,high_score_seed=CASE WHEN ?>high_score THEN ? ELSE high_score_seed END,high_score_replay_id=CASE WHEN ?>high_score THEN ? ELSE high_score_replay_id END,high_score_date=CASE WHEN ?>high_score THEN ? ELSE high_score_date END,elo=CASE WHEN ?>high_score THEN ? ELSE elo END,last_seen=? WHERE id=?"
      ).bind(score, score, score, score, seed, score, id, score, time, score, score, time, user.id),
      this.env.DB.prepare(
        "INSERT INTO game_submissions(id,user_id,room_seed,replay_id,result_json,created_at) VALUES(?,?,?,?,?,?)"
      ).bind(submissionId, user.id, seed, replaySaved ? id : null, JSON.stringify(result), time)
    ];
    if (replaySaved) {
      for (const operation of replayReplacementOrder(
        true,
        Boolean(worst && Number(count?.count) >= 3)
      ))
        statements.unshift(
          operation === "deleteRoomMinimum" ? this.env.DB.prepare("DELETE FROM replays WHERE id=?").bind(worst.id) : this.env.DB.prepare(
            "INSERT INTO replays(id,room_seed,user_id,score,created_at,payload_json) VALUES(?,?,?,?,?,?)"
          ).bind(id, seed, user.id, score, time, JSON.stringify(stored))
        );
    }
    await this.env.DB.batch(statements);
    return result;
  }
  async socket(request) {
    if (request.headers.get("upgrade") !== "websocket")
      return new Response("Upgrade required", { status: 426 });
    const pair = new WebSocketPair(), [client, server] = Object.values(pair), user = JSON.parse(request.headers.get("x-user") || "{}"), seed = Number(request.headers.get("x-seed")), spectator = request.headers.get("x-spectator") === "1", state = await this.liveState(seed);
    let player = Object.values(state.players).find(
      (candidate) => candidate.id === user.id && !candidate.phantom
    );
    let playerJoined = false;
    const connectionId = crypto.randomUUID();
    if (!spectator) {
      const assigned = await this.env.DB.prepare(
        "SELECT spawn_index FROM room_assignments WHERE room_seed=? AND user_id=?"
      ).bind(seed, user.id).first();
      const spawnIndex = assigned?.spawn_index ?? 0;
      if (!player || !player.alive) {
        if (player) delete state.players[player.entityId];
        player = addPlayer(state, user.id, user.username, Date.now(), {
          spawnIndex,
          instanceId: connectionId,
          appearance: normalizeSnakeAppearance(user.settings?.snakeAppearance)
        });
        this.startTrajectory(state, player, spawnIndex);
        playerJoined = true;
      } else {
        player.instanceId = connectionId;
        player.appearance = normalizeSnakeAppearance(user.settings?.snakeAppearance ?? player.appearance);
        player.disconnectedAt = void 0;
        for (const socket of this.ctx.getWebSockets())
          try {
            const attachment = socket.deserializeAttachment();
            if (attachment?.userId === user.id)
              socket.close(4001, "Replaced by a newer connection");
          } catch {
          }
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
      instanceId: player?.instanceId
    });
    server.send(JSON.stringify({ v: 2, type: "room.state", payload: this.snapshot(state) }));
    if (spectator) this.requestSpectatorSync();
    if (playerJoined)
      this.broadcast({
        v: 2,
        type: "player.joined",
        payload: {
          user: { id: user.id, username: user.username },
          timestamp: Date.now(),
          action: {
            type: "spawn",
            entityId: player.entityId,
            position: player.segments[0],
            direction: player.direction,
            up: player.up
          }
        }
      });
    this.presence();
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, message) {
    try {
      const event = JSON.parse(String(message)), attachment = ws.deserializeAttachment();
      if (event?.v !== 2) throw new Error();
      if (event.type === "ping") {
        ws.send(JSON.stringify({ v: 2, type: "pong" }));
        return;
      }
      const state = await this.liveState(attachment.seed);
      if (event.type === "room.resync") {
        ws.send(JSON.stringify({ v: 2, type: "room.state", payload: this.snapshot(state) }));
        return;
      }
      if (attachment.spectator) throw new Error();
      const player = attachment.entityId ? state.players[attachment.entityId] : void 0;
      if (!player || player.instanceId !== attachment.instanceId) {
        ws.send(JSON.stringify({ v: 2, type: "error", payload: { code: "STALE_CONNECTION" } }));
        return;
      }
      if (!player.alive) {
        ws.send(JSON.stringify({ v: 2, type: "error", payload: { code: "PLAYER_NOT_ALIVE" } }));
        return;
      }
      if (event.type === "player.appearance") {
        if (!isSnakeAppearance(event.payload.appearance)) {
          ws.send(JSON.stringify({ v: 2, type: "error", payload: { code: "INVALID_MESSAGE" } }));
          return;
        }
        player.appearance = normalizeSnakeAppearance(event.payload.appearance);
        await this.persist(state);
        this.broadcast({
          v: 2,
          type: "player.appearance",
          payload: { entityId: player.entityId, appearance: player.appearance }
        });
        return;
      }
      const action = "payload" in event && "action" in event.payload ? event.payload.action : void 0;
      if (event.type === "player.state" && stateInput(action)) {
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
            type: "player.state",
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
              serverTime: Date.now()
            }
          },
          ws
        );
        return;
      }
      if (event.type === "player.pauseChanged" && pauseInput(action)) {
        if (action.seq <= (player.lastStateSeq ?? -1)) return;
        player.segments = action.segments;
        player.direction = action.direction;
        player.up = action.up;
        player.score = action.score;
        player.speed = action.speed;
        player.paused = action.paused;
        player.lastStateSeq = action.seq;
        await this.persist(state);
        this.broadcast(
          {
            v: 2,
            type: "player.pauseChanged",
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
              serverTime: Date.now()
            }
          },
          ws
        );
        return;
      }
      if (event.type === "player.died" && deathInput(action)) {
        if (action.seq <= (player.lastStateSeq ?? -1)) return;
        player.segments = action.segments;
        player.direction = action.direction;
        player.up = action.up;
        player.score = action.score;
        player.speed = action.speed;
        player.lastStateSeq = action.seq;
        player.alive = false;
        state.tick++;
        const deathPosition = player.segments[0], trajectory = state.trajectories?.[player.id];
        if (!trajectory) throw new Error("MISSING_REPLAY_TRAJECTORY");
        await this.ctx.storage.put(`terminal:${player.id}`, {
          player,
          deathPosition,
          reason: action.reason,
          trajectory,
          tick: state.tick,
          createdAt: Date.now()
        });
        await this.persist(state);
        const result = await this.saveTerminal(state.seed, {
          player,
          deathPosition,
          reason: action.reason,
          trajectory
        });
        this.broadcast(
          {
            v: 2,
            type: "player.died",
            payload: {
              player,
              position: deathPosition,
              reason: action.reason,
              serverTime: Date.now()
            }
          },
          ws
        );
        if (result) this.sendToUser(player.id, { v: 2, type: "game.saved", payload: result });
        return;
      }
      if (event.type !== "player.directionChanged" || !directionInput(action) || action.seq <= (player.lastInputSeq ?? -1) || !validInput(player.direction, action.direction, player.up, action.up)) {
        ws.send(JSON.stringify({ v: 2, type: "error", payload: { code: "INVALID_MESSAGE" } }));
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
          type: "player.directionChanged",
          payload: {
            entityId: player.entityId,
            seq: action.seq,
            step: action.step,
            head: action.head,
            segments: player.segments,
            direction: player.direction,
            up: player.up,
            speed: player.speed,
            serverTime: Date.now()
          }
        },
        ws
      );
    } catch {
      ws.send(JSON.stringify({ v: 2, type: "error", payload: { code: "INVALID_MESSAGE" } }));
    }
  }
  async webSocketClose(ws) {
    const attachment = ws.deserializeAttachment(), player = attachment?.entityId && this.simulation?.players[attachment.entityId];
    if (attachment && !attachment.spectator && player && player.instanceId === attachment.instanceId) {
      player.disconnectedAt = Date.now() + 15e3;
      await this.persist(this.simulation);
      this.broadcast({
        v: 2,
        type: "room.left",
        payload: { entityId: player.entityId, userId: attachment.userId }
      });
    }
    ws.close();
    this.presence();
  }
  presence() {
    this.broadcast({
      v: 2,
      type: "presence.updated",
      payload: { count: this.ctx.getWebSockets().length }
    });
  }
  requestSpectatorSync() {
    const requestedAt = Date.now();
    if (requestedAt - this.lastSpectatorSyncRequestAt < 500) return;
    this.lastSpectatorSyncRequestAt = requestedAt;
    const text = JSON.stringify({
      v: 2,
      type: "room.syncRequested",
      payload: { requestId: crypto.randomUUID() }
    });
    for (const socket of this.ctx.getWebSockets())
      try {
        const attachment = socket.deserializeAttachment();
        if (!attachment?.spectator) socket.send(text);
      } catch {
        socket.close();
      }
  }
  sendToUser(userId, message) {
    const text = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets())
      try {
        if (socket.deserializeAttachment()?.userId === userId)
          socket.send(text);
      } catch {
        socket.close();
      }
  }
  // State snapshots are retained for resync; live clients extrapolate between turns.
  broadcast(message, except) {
    const text = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets())
      try {
        if (socket !== except) socket.send(text);
      } catch {
        socket.close();
      }
  }
};
export {
  ROOM_LIST_QUERY,
  ROOM_REPLAYS_QUERY,
  RoomDurableObject,
  chooseSpawn,
  index_default as default,
  parseRoomSeed,
  rankNextRooms,
  replayReplacementOrder
};
//# sourceMappingURL=index.js.map
