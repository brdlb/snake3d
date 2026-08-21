var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// shared/simulation.ts
var WORLD_SIZE = 50;
var FOOD_COUNT = 200;
var BASE_SPEED = 300;
var directions = [{ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }];
var key = /* @__PURE__ */ __name((v) => `${v.x},${v.y},${v.z}`, "key");
var same = /* @__PURE__ */ __name((a, b) => a.x === b.x && a.y === b.y && a.z === b.z, "same");
var add = /* @__PURE__ */ __name((a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }), "add");
var inBounds = /* @__PURE__ */ __name((p) => p.x >= 0 && p.x <= WORLD_SIZE && p.y >= 0 && p.y <= WORLD_SIZE && p.z >= 0 && p.z <= WORLD_SIZE, "inBounds");
var clone = /* @__PURE__ */ __name((value) => JSON.parse(JSON.stringify(value)), "clone");
var rng = /* @__PURE__ */ __name((seed) => () => {
  let t = seed += 1831565813;
  t = Math.imul(t ^ t >>> 15, t | 1);
  t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}, "rng");
function foodEffect(kind) {
  return kind === "green" ? { score: 5, growth: 3, speed: 50 } : kind === "blue" ? { score: 15, growth: 5, speed: 10 } : { score: 3, growth: 3, speed: -10 };
}
__name(foodEffect, "foodEffect");
function createSimulation(seed) {
  const random = rng(seed), food = [];
  while (food.length < FOOD_COUNT) {
    const p = { x: Math.floor(random() * 51), y: Math.floor(random() * 51), z: Math.floor(random() * 51) };
    if (!food.some((f) => same(f, p))) food.push({ ...p, kind: random() < 0.5 ? "blue" : random() < 0.8 ? "green" : "pink" });
  }
  return { seed, tick: 0, food, players: {} };
}
__name(createSimulation, "createSimulation");
function safeSpawn(state, random = rng(state.seed + state.tick + Object.keys(state.players).length)) {
  const blocked = new Set(Object.values(state.players).flatMap((p) => p.segments).map(key));
  for (let i = 0; i < 4096; i++) {
    const position = { x: 1 + Math.floor(random() * 49), y: 1 + Math.floor(random() * 49), z: 1 + Math.floor(random() * 49) };
    const direction = directions[Math.floor(random() * directions.length)];
    const tail = { x: position.x - direction.x * 2, y: position.y - direction.y * 2, z: position.z - direction.z * 2 };
    if (inBounds(tail) && !blocked.has(key(position)) && !blocked.has(key(tail))) return { position, direction };
  }
  return { position: { x: 25, y: 25, z: 25 }, direction: { x: 0, y: 0, z: -1 } };
}
__name(safeSpawn, "safeSpawn");
function addPlayer(state, id, name, now2, options = {}) {
  const spawn = safeSpawn(state);
  const direction = options.direction ?? spawn.direction, head = options.segments?.[0] ?? spawn.position;
  state.players[id] = { id, name, segments: options.segments ?? [head, add(head, { x: -direction.x, y: -direction.y, z: -direction.z }), add(head, { x: -2 * direction.x, y: -2 * direction.y, z: -2 * direction.z })], direction, score: options.score ?? 0, speed: BASE_SPEED, growth: 0, alive: true, phantom: options.phantom, color: options.color ?? (options.phantom ? "#7dd3fc" : "#ffffff"), nextStepAt: now2 + 200, instanceId: options.instanceId };
  return state.players[id];
}
__name(addPlayer, "addPlayer");
function validInput(current, next) {
  if (!next || typeof next !== "object") return false;
  const v = next;
  return directions.some((d) => same(d, v)) && !(v.x === -current.x && v.y === -current.y && v.z === -current.z);
}
__name(validInput, "validInput");
function respawn(state, index) {
  const removed = clone(state.food[index]), random = rng(state.seed + state.tick * 7919 + index), occupied = new Set(Object.values(state.players).flatMap((p) => p.segments).map(key));
  for (let i = 0; i < 4096; i++) {
    const p = { x: Math.floor(random() * 51), y: Math.floor(random() * 51), z: Math.floor(random() * 51) };
    if (!occupied.has(key(p)) && !state.food.some((f, n) => n !== index && same(f, p))) {
      state.food[index] = { ...p, kind: random() < 0.5 ? "blue" : random() < 0.8 ? "green" : "pink" };
      return { removed, added: clone(state.food[index]) };
    }
  }
  return { removed, added: clone(state.food[index]) };
}
__name(respawn, "respawn");
function stepSimulationDelta(state, at) {
  const due = Object.values(state.players).filter((p) => p.alive && p.nextStepAt === at);
  if (!due.length) return null;
  const heads = new Map(due.map((p) => [p.id, add(p.segments[0], p.direction)]));
  const foodAt = new Map(due.map((p) => [p.id, state.food.findIndex((f) => same(f, heads.get(p.id)))]));
  const freed = new Set(due.filter((p) => p.growth === 0 && foodAt.get(p.id) === -1).map((p) => key(p.segments[p.segments.length - 1])));
  const occupied = new Set(Object.values(state.players).flatMap((p) => p.segments).map(key));
  for (const cell of freed) occupied.delete(cell);
  const headCounts = /* @__PURE__ */ new Map();
  for (const head of heads.values()) headCounts.set(key(head), (headCounts.get(key(head)) ?? 0) + 1);
  const changed = [], food = [], deaths = [];
  for (const player of due) {
    const head = heads.get(player.id);
    let reason;
    if (!inBounds(head)) reason = "bounds";
    else if ((headCounts.get(key(head)) ?? 0) > 1) reason = "head-to-head";
    else if (occupied.has(key(head))) reason = "body";
    if (reason) {
      player.alive = false;
      player.nextStepAt = at;
      changed.push(clone(player));
      deaths.push({ player: clone(player), position: clone(head), reason });
      continue;
    }
    const foodIndex = foodAt.get(player.id);
    if (foodIndex >= 0) {
      const effect = foodEffect(state.food[foodIndex].kind);
      player.score += effect.score;
      player.growth += effect.growth;
      player.speed = Math.max(60, player.speed + effect.speed);
      food.push(respawn(state, foodIndex));
    }
    const keepTail = player.growth > 0;
    if (keepTail) player.growth--;
    const tail = player.segments[player.segments.length - 1];
    player.segments = [clone(head), ...player.segments.slice(0, keepTail ? player.segments.length : player.segments.length - 1)];
    if (keepTail) player.segments.push(clone(tail));
    player.nextStepAt = at + 6e4 / player.speed;
    changed.push(clone(player));
  }
  state.tick++;
  return { changed, food, deaths };
}
__name(stepSimulationDelta, "stepSimulationDelta");
function advanceSimulation(state, now2) {
  const deltas = [];
  for (; ; ) {
    const due = Object.values(state.players).filter((p) => p.alive && p.nextStepAt <= now2);
    if (!due.length) break;
    const at = Math.min(...due.map((p) => p.nextStepAt));
    const delta = stepSimulationDelta(state, at);
    if (delta) deltas.push(delta);
  }
  return deltas;
}
__name(advanceSimulation, "advanceSimulation");
function chooseLowestPhantom(players) {
  return players.filter((p) => p.phantom).sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))[0];
}
__name(chooseLowestPhantom, "chooseLowestPhantom");

// worker/index.ts
var COOKIE = "snake3d_session";
var YEAR = 31536e3;
var now = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString(), "now");
var json = /* @__PURE__ */ __name((value, status = 200, requestId) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...requestId ? { "x-request-id": requestId } : {} } }), "json");
var fail = /* @__PURE__ */ __name((code, status, requestId) => json({ error: { code, requestId } }, status, requestId), "fail");
var cookie = /* @__PURE__ */ __name((r, n) => r.headers.get("cookie")?.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${n}=`))?.slice(n.length + 1), "cookie");
var hash = /* @__PURE__ */ __name(async (v) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))].map((x) => x.toString(16).padStart(2, "0")).join(""), "hash");
var username = /* @__PURE__ */ __name(() => `${["Swift", "Stellar", "Neon", "Cosmic"][Math.floor(Math.random() * 4)]}${["Snake", "Viper", "Cobra", "Runner"][Math.floor(Math.random() * 4)]}${Math.floor(Math.random() * 1e3)}`, "username");
function toUser(row) {
  return { id: String(row.id), username: String(row.username), createdAt: String(row.created_at), lastSeen: String(row.last_seen), highScore: Number(row.high_score), highScoreSeed: row.high_score_seed == null ? void 0 : Number(row.high_score_seed), highScoreReplayId: row.high_score_replay_id, highScoreDate: row.high_score_date, gamesPlayed: Number(row.games_played), totalScore: Number(row.total_score), elo: Number(row.elo), settings: JSON.parse(String(row.settings_json)) };
}
__name(toUser, "toUser");
async function userFor(r, e) {
  const token = cookie(r, COOKIE);
  if (!token) return null;
  const row = await e.DB.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?").bind(await hash(token), now()).first();
  return row ? toUser(row) : null;
}
__name(userFor, "userFor");
var mutationAllowed = /* @__PURE__ */ __name((r) => {
  const o = r.headers.get("origin");
  return !o || o === new URL(r.url).origin || o.startsWith("http://localhost:") || o.startsWith("http://127.0.0.1:");
}, "mutationAllowed");
async function body(r, requestId) {
  if (Number(r.headers.get("content-length") || 0) > 524288) return fail("PAYLOAD_TOO_LARGE", 413, requestId);
  try {
    return await r.json();
  } catch {
    return fail("INVALID_JSON", 400, requestId);
  }
}
__name(body, "body");
var roomActions = /* @__PURE__ */ new Set(["initial", "resume", "restart", "next", "join", "spectate"]);
var randomSeed = /* @__PURE__ */ __name(() => crypto.getRandomValues(new Uint32Array(1))[0] & 2147483647, "randomSeed");
function parseRoomSeed(value) {
  if (value === null || !/^\d+$/.test(value)) return null;
  const seed = Number(value);
  return Number.isSafeInteger(seed) ? seed : null;
}
__name(parseRoomSeed, "parseRoomSeed");
function chooseSpawn(phantoms, previousSpawnIndex) {
  const used = new Set(phantoms.map((p) => p.startParams?.spawnIndex).filter((v) => Number.isInteger(v) && v >= 0 && v < 4));
  const free = [0, 1, 2, 3].filter((index) => !used.has(index));
  const alternatives = free.filter((index) => index !== previousSpawnIndex);
  if (alternatives.length) return alternatives[Math.floor(Math.random() * alternatives.length)];
  if (free.length) return free[Math.floor(Math.random() * free.length)];
  return phantoms.reduce((best, phantom) => Number(phantom.elo ?? 1e3) < Number(best.elo ?? 1e3) ? phantom : best).startParams?.spawnIndex ?? 0;
}
__name(chooseSpawn, "chooseSpawn");
function rankNextRooms(rooms, playerElo, random = Math.random) {
  return [...rooms].sort((a, b) => Math.abs(a.averageElo - playerElo) - Math.abs(b.averageElo - playerElo) || b.phantomCount - a.phantomCount || random() - 0.5);
}
__name(rankNextRooms, "rankNextRooms");
function replayReplacementOrder(replaySaved, evictRoomReplay) {
  if (!replaySaved) return [];
  return [...evictRoomReplay ? ["deleteRoomMinimum"] : [], "insertReplay"];
}
__name(replayReplacementOrder, "replayReplacementOrder");
var ROOM_REPLAYS_QUERY = "SELECT payload_json FROM replays WHERE room_seed=? ORDER BY score DESC, created_at ASC LIMIT 3";
var index_default = { async fetch(request, env) {
  const requestId = crypto.randomUUID(), url = new URL(request.url), path = url.pathname;
  if (!path.startsWith("/api/")) {
    const response = await env.ASSETS.fetch(request), headers = new Headers(response.headers);
    headers.set("x-content-type-options", "nosniff");
    headers.set("referrer-policy", "same-origin");
    headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
    return new Response(response.body, { status: response.status, headers });
  }
  if (request.method !== "GET" && !mutationAllowed(request)) return fail("INVALID_ORIGIN", 403, requestId);
  if (path === "/api/v1/session" && request.method === "POST") {
    const token = [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join(""), id = crypto.randomUUID(), time = now(), secure = url.protocol === "https:" ? " Secure;" : "";
    const user2 = { id, username: username(), createdAt: time, lastSeen: time, highScore: 0, gamesPlayed: 0, totalScore: 0, elo: 1e3, settings: { musicVolume: 0.5, sfxVolume: 0.7 } };
    await env.DB.batch([env.DB.prepare("INSERT INTO users (id,username,created_at,last_seen,settings_json) VALUES (?,?,?,?,?)").bind(id, user2.username, time, time, JSON.stringify(user2.settings)), env.DB.prepare("INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)").bind(await hash(token), id, new Date(Date.now() + YEAR * 1e3).toISOString(), time)]);
    return new Response(JSON.stringify({ user: user2, isNew: true }), { headers: { "content-type": "application/json", "set-cookie": `${COOKIE}=${token}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${YEAR}`, "x-request-id": requestId } });
  }
  const user = await userFor(request, env);
  if (!user) return fail("UNAUTHENTICATED", 401, requestId);
  if (path === "/api/v1/me" && request.method === "GET") return json({ user }, 200, requestId);
  if (path === "/api/v1/me/settings" && request.method === "PATCH") {
    const data = await body(request, requestId);
    if (data instanceof Response) return data;
    const settings = data.settings;
    if (!settings || typeof settings !== "object") return fail("INVALID_SETTINGS", 400, requestId);
    const next = { ...user.settings, ...settings };
    if (![next.musicVolume, next.sfxVolume].every((v) => typeof v === "number" && v >= 0 && v <= 1)) return fail("INVALID_SETTINGS", 400, requestId);
    await env.DB.prepare("UPDATE users SET settings_json=?,last_seen=? WHERE id=?").bind(JSON.stringify(next), now(), user.id).run();
    return json({ user: { ...user, settings: next } }, 200, requestId);
  }
  if (path === "/api/v1/matches" && request.method === "POST") {
    const data = await body(request, requestId);
    if (data instanceof Response) return data;
    const p = data;
    if (typeof p.action !== "string" || !roomActions.has(p.action) || p.contextSeed !== void 0 && !Number.isSafeInteger(p.contextSeed) || p.seed !== void 0 && !Number.isSafeInteger(p.seed)) return fail("INVALID_ROOM_ACTION", 400, requestId);
    if (p.action === "join" || p.action === "spectate") {
      if (!Number.isSafeInteger(p.seed)) return fail("INVALID_ROOM_LINK", 400, requestId);
      const exists = await env.DB.prepare("SELECT 1 FROM rooms WHERE seed=?").bind(p.seed).first();
      if (!exists) return fail("ROOM_NOT_FOUND", 404, requestId);
      return env.ROOMS.get(env.ROOMS.idFromName(String(p.seed))).fetch(`https://room/${p.action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user, seed: p.seed }) });
    }
    return env.ROOMS.get(env.ROOMS.idFromName(`user:${user.id}`)).fetch("https://room/assign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: p.action, contextSeed: p.contextSeed, user }) });
  }
  const socket = path.match(/^\/api\/v1\/rooms\/(-?\d+)\/socket$/);
  if (socket && request.headers.get("upgrade") === "websocket") {
    const spectator = url.searchParams.get("spectator") === "1";
    if (spectator) {
      const exists = await env.DB.prepare("SELECT 1 FROM rooms WHERE seed=?").bind(Number(socket[1])).first();
      if (!exists) return fail("ROOM_NOT_FOUND", 404, requestId);
    } else {
      const assigned = await env.DB.prepare("SELECT 1 FROM room_assignments WHERE user_id=? AND room_seed=?").bind(user.id, Number(socket[1])).first();
      if (!assigned) return fail("ROOM_CONTEXT_MISMATCH", 409, requestId);
    }
    return env.ROOMS.get(env.ROOMS.idFromName(socket[1])).fetch("https://room/socket", { headers: { upgrade: "websocket", "x-user": JSON.stringify(user), "x-seed": socket[1], "x-spectator": spectator ? "1" : "0" } });
  }
  if (path === "/api/v1/leaderboard" && request.method === "GET") {
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 50), rows = await env.DB.prepare("SELECT username AS playerName,high_score AS score,high_score_seed AS seed,high_score_date AS date,high_score_replay_id AS replayId FROM users WHERE high_score>0 ORDER BY high_score DESC LIMIT ?").bind(limit).all();
    return json(rows.results, 200, requestId);
  }
  return fail("NOT_FOUND", 404, requestId);
} };
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
  snapshot(state) {
    return { seed: state.seed, tick: state.tick, food: state.food, players: Object.values(state.players) };
  }
  async persist(state) {
    await this.ctx.storage.put("simulation", state);
    const next = Math.min(...Object.values(state.players).filter((p) => p.alive).map((p) => p.nextStepAt));
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }
  async applyDeltas(state, deltas) {
    if (!deltas.length) return;
    state.trajectories ??= {};
    for (const delta of deltas) for (const player of delta.changed) {
      const path = state.trajectories[player.id] ??= [];
      path.push(player.segments[0]);
      if (path.length > 1e4) path.splice(0, path.length - 1e4);
    }
    for (const delta of deltas) for (const death of delta.deaths) await this.ctx.storage.put(`terminal:${death.player.id}`, { player: death.player, deathPosition: death.position, reason: death.reason, trajectory: state.trajectories[death.player.id] ?? [], tick: state.tick, createdAt: Date.now() });
    await this.persist(state);
    for (const delta of deltas) {
      for (const player of delta.changed) this.broadcast({ v: 2, type: "player.changed", payload: { player, tick: state.tick } });
      for (const food of delta.food) this.broadcast({ v: 2, type: "food.changed", payload: { ...food, tick: state.tick } });
      for (const death of delta.deaths) {
        const terminal = { player: death.player, deathPosition: death.position, reason: death.reason, trajectory: state.trajectories[death.player.id] ?? [] };
        const result = await this.saveTerminal(state.seed, terminal);
        this.broadcast({ v: 2, type: "player.died", payload: { player: death.player, position: death.position, reason: death.reason, tick: state.tick } });
        if (result) this.sendToUser(death.player.id, { v: 2, type: "game.saved", payload: result });
      }
    }
  }
  async advance(state, serverNow = Date.now()) {
    await this.applyDeltas(state, advanceSimulation(state, serverNow));
  }
  async alarm() {
    const state = this.simulation ?? await this.ctx.storage.get("simulation");
    if (!state) return;
    this.simulation = state;
    await this.advance(state);
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/socket") return this.socket(request);
    const data = await request.json();
    return path === "/assign" ? this.assign(data) : path === "/join" ? this.join(data) : path === "/spectate" ? this.spectate(data) : new Response("Not found", { status: 404 });
  }
  async liveState(seed) {
    if (!this.simulation) {
      this.simulation = await this.ctx.storage.get("simulation") ?? createSimulation(seed);
      if (!Object.keys(this.simulation.players).length) {
        const replays = await this.activeReplays(seed);
        for (const row of replays.results) try {
          const replay = JSON.parse(row.payload_json);
          addPlayer(this.simulation, `phantom:${replay.id}`, replay.playerName ?? "Phantom", Date.now(), { phantom: true, score: Number(replay.finalScore ?? 0), color: "#7dd3fc", segments: replay.startParams?.startPosition ? [replay.startParams.startPosition] : void 0, direction: replay.startParams?.startDirection });
        } catch {
        }
      }
    }
    return this.simulation;
  }
  async createRoom(user) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const seed = randomSeed(), result = await this.env.DB.prepare("INSERT OR IGNORE INTO rooms(seed,elo_bucket,updated_at) VALUES(?,?,?)").bind(seed, Math.floor(user.elo / 100), now()).run();
      if (result.meta.changes === 1) return seed;
    }
    throw new Error("ROOM_SEED_COLLISION");
  }
  async activeReplays(seed) {
    return this.env.DB.prepare(ROOM_REPLAYS_QUERY).bind(seed).all();
  }
  async roomData(seed, user) {
    const replays = await this.activeReplays(seed);
    const assignment = await this.env.DB.prepare("SELECT spawn_index FROM room_assignments WHERE user_id=? AND room_seed=?").bind(user.id, seed).first();
    return { seed, phantoms: replays.results.map((r) => JSON.parse(r.payload_json)), playerSpawnIndex: assignment?.spawn_index ?? 0 };
  }
  async assign({ action, contextSeed, user }) {
    const current = await this.env.DB.prepare("SELECT room_seed,spawn_index FROM room_assignments WHERE user_id=?").bind(user.id).first();
    if ((action === "restart" || action === "next") && (!current || contextSeed !== current.room_seed)) return json({ error: { code: "ROOM_CONTEXT_MISMATCH" } }, 409);
    let seed;
    if (action === "restart") seed = current.room_seed;
    else if (action === "resume" || action === "initial") {
      const last = await this.env.DB.prepare("SELECT last_room_seed FROM users WHERE id=?").bind(user.id).first();
      seed = last?.last_room_seed ?? await this.createRoom(user);
    } else {
      const candidates = await this.env.DB.prepare(`SELECT r.seed AS seed, COALESCE(AVG(CAST(json_extract(p.payload_json,'$.elo') AS REAL)),1000) AS average_elo, COUNT(p.id) AS phantom_count FROM rooms r LEFT JOIN replays p ON p.room_seed=r.seed WHERE NOT EXISTS (SELECT 1 FROM user_room_visits v WHERE v.user_id=? AND v.room_seed=r.seed) GROUP BY r.seed`).bind(user.id).all();
      seed = rankNextRooms(candidates.results.map((row) => ({ seed: Number(row.seed), averageElo: Number(row.average_elo), phantomCount: Number(row.phantom_count) })), user.elo)[0]?.seed ?? await this.createRoom(user);
    }
    const existing = await this.activeReplays(seed);
    const spawn = chooseSpawn(existing.results.map((row) => JSON.parse(row.payload_json)), action === "restart" ? current.spawn_index : void 0);
    const time = now();
    await this.env.DB.batch([
      this.env.DB.prepare("INSERT INTO user_room_visits(user_id,room_seed,visited_at) VALUES(?,?,?) ON CONFLICT(user_id,room_seed) DO NOTHING").bind(user.id, seed, time),
      this.env.DB.prepare("UPDATE users SET last_room_seed=?,last_seen=? WHERE id=?").bind(seed, time, user.id),
      this.env.DB.prepare("INSERT INTO room_assignments(user_id,room_seed,spawn_index,assigned_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET room_seed=excluded.room_seed,spawn_index=excluded.spawn_index,assigned_at=excluded.assigned_at").bind(user.id, seed, spawn, time),
      this.env.DB.prepare("INSERT INTO room_players(room_seed,user_id,spawn_index,joined_at) VALUES(?,?,?,?) ON CONFLICT(room_seed,user_id) DO UPDATE SET spawn_index=excluded.spawn_index,joined_at=excluded.joined_at").bind(seed, user.id, spawn, time),
      this.env.DB.prepare("UPDATE rooms SET updated_at=? WHERE seed=?").bind(time, seed)
    ]);
    return json(await this.roomData(seed, user));
  }
  async join({ user, seed }) {
    const exists = await this.env.DB.prepare("SELECT 1 FROM rooms WHERE seed=?").bind(seed).first();
    if (!exists) return json({ error: { code: "ROOM_NOT_FOUND" } }, 404);
    const state = await this.liveState(seed);
    const weakest = chooseLowestPhantom(Object.values(state.players));
    if (weakest) delete state.players[weakest.id];
    const player = addPlayer(state, user.id, user.username, Date.now());
    const time = now();
    await this.env.DB.batch([
      this.env.DB.prepare("INSERT INTO user_room_visits(user_id,room_seed,visited_at) VALUES(?,?,?) ON CONFLICT(user_id,room_seed) DO NOTHING").bind(user.id, seed, time),
      this.env.DB.prepare("UPDATE users SET last_room_seed=?,last_seen=? WHERE id=?").bind(seed, time, user.id),
      this.env.DB.prepare("INSERT INTO room_assignments(user_id,room_seed,spawn_index,assigned_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET room_seed=excluded.room_seed,spawn_index=excluded.spawn_index,assigned_at=excluded.assigned_at").bind(user.id, seed, 0, time),
      this.env.DB.prepare("INSERT INTO room_players(room_seed,user_id,spawn_index,joined_at) VALUES(?,?,?,?) ON CONFLICT(room_seed,user_id) DO UPDATE SET spawn_index=excluded.spawn_index,joined_at=excluded.joined_at").bind(seed, user.id, 0, time),
      this.env.DB.prepare("INSERT INTO live_room_assignments(room_seed,user_id,spawn_json,assigned_at) VALUES(?,?,?,?) ON CONFLICT(room_seed,user_id) DO UPDATE SET spawn_json=excluded.spawn_json,assigned_at=excluded.assigned_at").bind(seed, user.id, JSON.stringify({ position: player.segments[0], direction: player.direction }), time)
    ]);
    await this.ctx.storage.put("simulation", state);
    this.broadcast({ v: 2, type: "player.joined", payload: { user: { id: user.id, username: user.username }, timestamp: Date.now(), action: { type: "spawn", position: player.segments[0], direction: player.direction } } });
    return json({ seed, phantoms: [], playerSpawnIndex: 0, playerSpawn: { position: player.segments[0], direction: player.direction } });
  }
  async spectate({ user, seed }) {
    return json(await this.roomData(seed, user));
  }
  async submit({ seed, submissionId, user }) {
    const old = await this.env.DB.prepare("SELECT result_json FROM game_submissions WHERE id=? AND user_id=?").bind(submissionId, user.id).first();
    if (old) return json(JSON.parse(old.result_json));
    const terminal = await this.ctx.storage.get(`terminal:${user.id}`), state = await this.liveState(seed);
    if (!terminal) return json({ error: { code: "NO_AUTHORITATIVE_TERMINAL_RECORD" } }, 409);
    const current = state.players[user.id];
    if (current?.alive || current?.instanceId !== terminal.player.instanceId) return json({ error: { code: "TERMINAL_RECORD_SUPERSEDED" } }, 409);
    const id = crypto.randomUUID(), time = now(), score = terminal.player.score, stored = { id, playerId: user.id, playerName: user.username, finalScore: score, deathPosition: terminal.deathPosition, trajectoryLog: terminal.trajectory.map((position) => ({ position, direction: terminal.player.direction })), timestamp: Date.now(), elo: user.elo, terminalReason: terminal.reason };
    const worst = await this.env.DB.prepare("SELECT id,score FROM replays WHERE room_seed=? ORDER BY score ASC,created_at ASC LIMIT 1").bind(seed).first();
    const count = await this.env.DB.prepare("SELECT COUNT(*) AS count FROM replays WHERE room_seed=?").bind(seed).first();
    const replaySaved = Number(count?.count ?? 0) < 3 || score > Number(worst?.score ?? Number.MAX_SAFE_INTEGER);
    const result = { saved: true, replaySaved, replayId: replaySaved ? id : void 0, message: replaySaved ? "Game and replay saved" : "Game saved; replay did not beat the room minimum" };
    const statements = [this.env.DB.prepare("UPDATE rooms SET total_games_played=total_games_played+1,updated_at=? WHERE seed=?").bind(time, seed), this.env.DB.prepare("UPDATE users SET games_played=games_played+1,total_score=total_score+?,high_score=CASE WHEN ?>high_score THEN ? ELSE high_score END,high_score_seed=CASE WHEN ?>high_score THEN ? ELSE high_score_seed END,high_score_replay_id=CASE WHEN ?>high_score THEN ? ELSE high_score_replay_id END,high_score_date=CASE WHEN ?>high_score THEN ? ELSE high_score_date END,elo=CASE WHEN ?>high_score THEN ? ELSE elo END,last_seen=? WHERE id=?").bind(score, score, score, score, seed, score, id, score, time, score, score, time, user.id), this.env.DB.prepare("INSERT INTO game_submissions(id,user_id,room_seed,replay_id,result_json,created_at) VALUES(?,?,?,?,?,?)").bind(submissionId, user.id, seed, replaySaved ? id : null, JSON.stringify(result), time)];
    if (replaySaved) {
      for (const operation of replayReplacementOrder(true, Boolean(worst && Number(count?.count) >= 3))) statements.unshift(operation === "deleteRoomMinimum" ? this.env.DB.prepare("DELETE FROM replays WHERE id=?").bind(worst.id) : this.env.DB.prepare("INSERT INTO replays(id,room_seed,user_id,score,created_at,payload_json) VALUES(?,?,?,?,?,?)").bind(id, seed, user.id, score, time, JSON.stringify(stored)));
    }
    await this.env.DB.batch(statements);
    return json(result);
  }
  async saveTerminal(seed, terminal) {
    if (terminal.player.phantom) return null;
    const userRow = await this.env.DB.prepare("SELECT * FROM users WHERE id=?").bind(terminal.player.id).first();
    if (!userRow) return null;
    const user = toUser(userRow), submissionId = `terminal:${seed}:${user.id}:${terminal.player.instanceId ?? "none"}`, old = await this.env.DB.prepare("SELECT result_json FROM game_submissions WHERE id=? AND user_id=?").bind(submissionId, user.id).first();
    if (old) return JSON.parse(old.result_json);
    const id = crypto.randomUUID(), time = now(), score = terminal.player.score, stored = { id, playerId: user.id, playerName: user.username, finalScore: score, deathPosition: terminal.deathPosition, trajectoryLog: terminal.trajectory.map((position) => ({ position, direction: terminal.player.direction })), timestamp: Date.now(), elo: user.elo, terminalReason: terminal.reason };
    const worst = await this.env.DB.prepare("SELECT id,score FROM replays WHERE room_seed=? ORDER BY score ASC,created_at ASC LIMIT 1").bind(seed).first();
    const count = await this.env.DB.prepare("SELECT COUNT(*) AS count FROM replays WHERE room_seed=?").bind(seed).first();
    const replaySaved = Number(count?.count ?? 0) < 3 || score > Number(worst?.score ?? Number.MAX_SAFE_INTEGER);
    const result = { saved: true, replaySaved, replayId: replaySaved ? id : void 0, message: replaySaved ? "Game and replay saved" : "Game saved; replay did not beat the room minimum" };
    const statements = [this.env.DB.prepare("UPDATE rooms SET total_games_played=total_games_played+1,updated_at=? WHERE seed=?").bind(time, seed), this.env.DB.prepare("UPDATE users SET games_played=games_played+1,total_score=total_score+?,high_score=CASE WHEN ?>high_score THEN ? ELSE high_score END,high_score_seed=CASE WHEN ?>high_score THEN ? ELSE high_score_seed END,high_score_replay_id=CASE WHEN ?>high_score THEN ? ELSE high_score_replay_id END,high_score_date=CASE WHEN ?>high_score THEN ? ELSE high_score_date END,elo=CASE WHEN ?>high_score THEN ? ELSE elo END,last_seen=? WHERE id=?").bind(score, score, score, score, seed, score, id, score, time, score, score, time, user.id), this.env.DB.prepare("INSERT INTO game_submissions(id,user_id,room_seed,replay_id,result_json,created_at) VALUES(?,?,?,?,?,?)").bind(submissionId, user.id, seed, replaySaved ? id : null, JSON.stringify(result), time)];
    if (replaySaved) {
      for (const operation of replayReplacementOrder(true, Boolean(worst && Number(count?.count) >= 3))) statements.unshift(operation === "deleteRoomMinimum" ? this.env.DB.prepare("DELETE FROM replays WHERE id=?").bind(worst.id) : this.env.DB.prepare("INSERT INTO replays(id,room_seed,user_id,score,created_at,payload_json) VALUES(?,?,?,?,?,?)").bind(id, seed, user.id, score, time, JSON.stringify(stored)));
    }
    await this.env.DB.batch(statements);
    return result;
  }
  async socket(request) {
    if (request.headers.get("upgrade") !== "websocket") return new Response("Upgrade required", { status: 426 });
    const pair = new WebSocketPair(), [client, server] = Object.values(pair), user = JSON.parse(request.headers.get("x-user") || "{}"), seed = Number(request.headers.get("x-seed")), spectator = request.headers.get("x-spectator") === "1", state = await this.liveState(seed);
    await this.advance(state);
    let player = state.players[user.id];
    if (!spectator && (!player || !player.alive)) {
      if (player) delete state.players[user.id];
      player = addPlayer(state, user.id, user.username, Date.now(), { instanceId: crypto.randomUUID() });
      await this.persist(state);
      this.broadcast({ v: 2, type: "player.changed", payload: { player, tick: state.tick } });
    }
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId: user.id, seed, user, spectator, instanceId: player?.instanceId });
    server.send(JSON.stringify({ v: 2, type: "room.state", payload: this.snapshot(state) }));
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
      await this.advance(state);
      if (event.type === "room.resync") {
        ws.send(JSON.stringify({ v: 2, type: "room.state", payload: this.snapshot(state) }));
        return;
      }
      if (attachment.spectator) throw new Error();
      const player = state.players[attachment.userId], candidate = event?.payload?.action?.type === "direction" ? event.payload.action.direction : void 0;
      if (!player || !player.alive) {
        ws.send(JSON.stringify({ v: 2, type: "error", payload: { code: "PLAYER_NOT_ALIVE" } }));
        return;
      }
      if (event.type !== "player.input" || !validInput(player.direction, candidate)) {
        ws.send(JSON.stringify({ v: 2, type: "error", payload: { code: "INVALID_DIRECTION" } }));
        return;
      }
      if (player.direction.x !== candidate.x || player.direction.y !== candidate.y || player.direction.z !== candidate.z) {
        player.direction = candidate;
        await this.persist(state);
        this.broadcast({ v: 2, type: "player.changed", payload: { player, tick: state.tick } });
      }
    } catch {
      ws.send(JSON.stringify({ v: 2, type: "error", payload: { code: "INVALID_MESSAGE" } }));
    }
  }
  async webSocketClose(ws) {
    const attachment = ws.deserializeAttachment(), player = attachment && this.simulation?.players[attachment.userId];
    if (attachment && !attachment.spectator && player && player.instanceId === attachment.instanceId) {
      delete this.simulation.players[attachment.userId];
      await this.persist(this.simulation);
      this.broadcast({ v: 2, type: "room.left", payload: { userId: attachment.userId } });
    }
    ws.close();
    this.presence();
  }
  presence() {
    this.broadcast({ v: 1, type: "presence.updated", payload: { count: this.ctx.getWebSockets().length } });
  }
  sendToUser(userId, message) {
    const text = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) try {
      if (socket.deserializeAttachment()?.userId === userId) socket.send(text);
    } catch {
      socket.close();
    }
  }
  broadcast(message) {
    const text = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) try {
      socket.send(text);
    } catch {
      socket.close();
    }
  }
};
export {
  ROOM_REPLAYS_QUERY,
  RoomDurableObject,
  chooseSpawn,
  index_default as default,
  parseRoomSeed,
  rankNextRooms,
  replayReplacementOrder
};
//# sourceMappingURL=index.js.map
