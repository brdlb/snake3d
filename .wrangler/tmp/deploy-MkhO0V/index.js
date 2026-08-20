var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

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
function position(v) {
  if (!v || typeof v !== "object") return false;
  const p = v;
  return [p.x, p.y, p.z].every((x) => typeof x === "number" && Number.isFinite(x));
}
__name(position, "position");
function direction(v) {
  if (!position(v)) return false;
  const p = v, lengthSquared = p.x ** 2 + p.y ** 2 + p.z ** 2;
  return Math.abs(lengthSquared - 1) < 1e-9;
}
__name(direction, "direction");
var roomActions = /* @__PURE__ */ new Set(["initial", "resume", "restart", "next"]);
var randomSeed = /* @__PURE__ */ __name(() => crypto.getRandomValues(new Uint32Array(1))[0] & 2147483647, "randomSeed");
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
  return [...evictRoomReplay ? ["deleteRoomMinimum"] : [], "deletePlayerReplay", "insertReplay"];
}
__name(replayReplacementOrder, "replayReplacementOrder");
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
    if (typeof p.action !== "string" || !roomActions.has(p.action) || p.contextSeed !== void 0 && !Number.isSafeInteger(p.contextSeed)) return fail("INVALID_ROOM_ACTION", 400, requestId);
    return env.ROOMS.get(env.ROOMS.idFromName(`user:${user.id}`)).fetch("https://room/assign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: p.action, contextSeed: p.contextSeed, user }) });
  }
  const game = path.match(/^\/api\/v1\/rooms\/(-?\d+)\/games$/);
  if (game && request.method === "POST") {
    const data = await body(request, requestId);
    if (data instanceof Response) return data;
    const p = data;
    if (typeof p.submissionId !== "string" || p.submissionId.length < 8 || p.submissionId.length > 128 || !p.replay || JSON.stringify(p).length > 524288 || !Number.isFinite(p.replay.finalScore) || p.replay.finalScore < 0 || !position(p.replay.deathPosition) || !Array.isArray(p.replay.trajectoryLog) || p.replay.trajectoryLog.length > 1e4 || !p.replay.trajectoryLog.every((v) => position(v.position) && direction(v.direction))) return fail("INVALID_SUBMISSION", 400, requestId);
    return env.ROOMS.get(env.ROOMS.idFromName(game[1])).fetch("https://room/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seed: Number(game[1]), submissionId: p.submissionId, replay: p.replay, user }) });
  }
  const socket = path.match(/^\/api\/v1\/rooms\/(-?\d+)\/socket$/);
  if (socket && request.headers.get("upgrade") === "websocket") {
    const assigned = await env.DB.prepare("SELECT 1 FROM room_assignments WHERE user_id=? AND room_seed=?").bind(user.id, Number(socket[1])).first();
    if (!assigned) return fail("ROOM_CONTEXT_MISMATCH", 409, requestId);
    return env.ROOMS.get(env.ROOMS.idFromName(socket[1])).fetch("https://room/socket", { headers: { upgrade: "websocket", "x-user": JSON.stringify(user), "x-seed": socket[1] } });
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
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/socket") return this.socket(request);
    const data = await request.json();
    return path === "/assign" ? this.assign(data) : path === "/submit" ? this.submit(data) : new Response("Not found", { status: 404 });
  }
  async createRoom(user) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const seed = randomSeed(), result = await this.env.DB.prepare("INSERT OR IGNORE INTO rooms(seed,elo_bucket,updated_at) VALUES(?,?,?)").bind(seed, Math.floor(user.elo / 100), now()).run();
      if (result.meta.changes === 1) return seed;
    }
    throw new Error("ROOM_SEED_COLLISION");
  }
  async activeReplays(seed, userId) {
    return this.env.DB.prepare("SELECT payload_json FROM replays WHERE room_seed=? AND user_id<>? ORDER BY score DESC, created_at ASC LIMIT 3").bind(seed, userId).all();
  }
  async roomData(seed, user) {
    const replays = await this.activeReplays(seed, user.id);
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
    const existing = await this.activeReplays(seed, user.id);
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
  async submit({ seed, submissionId, replay, user }) {
    const old = await this.env.DB.prepare("SELECT result_json FROM game_submissions WHERE id=? AND user_id=?").bind(submissionId, user.id).first();
    if (old) return json(JSON.parse(old.result_json));
    const assignment = await this.env.DB.prepare("SELECT 1 FROM room_assignments WHERE user_id=? AND room_seed=?").bind(user.id, seed).first();
    if (!assignment) return json({ error: { code: "ROOM_CONTEXT_MISMATCH" } }, 409);
    const id = crypto.randomUUID(), time = now(), score = Math.floor(replay.finalScore), stored = { ...replay, id, playerId: user.id, playerName: user.username, timestamp: Date.now(), elo: user.elo };
    const worst = await this.env.DB.prepare("SELECT id,score FROM replays WHERE room_seed=? ORDER BY score ASC,created_at ASC LIMIT 1").bind(seed).first();
    const count = await this.env.DB.prepare("SELECT COUNT(*) AS count FROM replays WHERE room_seed=?").bind(seed).first();
    const replaySaved = Number(count?.count ?? 0) < 3 || score > Number(worst?.score ?? Number.MAX_SAFE_INTEGER);
    const result = { saved: true, replaySaved, replayId: replaySaved ? id : void 0, message: replaySaved ? "Game and replay saved" : "Game saved; replay did not beat the room minimum" };
    const statements = [this.env.DB.prepare("UPDATE rooms SET total_games_played=total_games_played+1,updated_at=? WHERE seed=?").bind(time, seed), this.env.DB.prepare("UPDATE users SET games_played=games_played+1,total_score=total_score+?,high_score=CASE WHEN ?>high_score THEN ? ELSE high_score END,high_score_seed=CASE WHEN ?>high_score THEN ? ELSE high_score_seed END,high_score_replay_id=CASE WHEN ?>high_score THEN ? ELSE high_score_replay_id END,high_score_date=CASE WHEN ?>high_score THEN ? ELSE high_score_date END,elo=CASE WHEN ?>high_score THEN ? ELSE elo END,last_seen=? WHERE id=?").bind(score, score, score, score, seed, score, id, score, time, score, score, time, user.id), this.env.DB.prepare("INSERT INTO game_submissions(id,user_id,room_seed,replay_id,result_json,created_at) VALUES(?,?,?,?,?,?)").bind(submissionId, user.id, seed, replaySaved ? id : null, JSON.stringify(result), time)];
    if (replaySaved) {
      const replacement = [];
      for (const operation of replayReplacementOrder(Boolean(replaySaved), Boolean(worst && Number(count?.count) >= 3))) {
        if (operation === "deleteRoomMinimum") replacement.push(this.env.DB.prepare("DELETE FROM replays WHERE id=?").bind(worst.id));
        else if (operation === "deletePlayerReplay") replacement.push(this.env.DB.prepare("DELETE FROM replays WHERE room_seed=? AND user_id=?").bind(seed, user.id));
        else replacement.push(this.env.DB.prepare("INSERT INTO replays(id,room_seed,user_id,score,created_at,payload_json) VALUES(?,?,?,?,?,?)").bind(id, seed, user.id, score, time, JSON.stringify(stored)));
      }
      statements.unshift(...replacement);
    }
    await this.env.DB.batch(statements);
    this.broadcast({ v: 1, type: "room.updated", payload: { seed } });
    return json(result);
  }
  socket(request) {
    if (request.headers.get("upgrade") !== "websocket") return new Response("Upgrade required", { status: 426 });
    const pair = new WebSocketPair(), [client, server] = Object.values(pair), user = JSON.parse(request.headers.get("x-user") || "{}"), seed = Number(request.headers.get("x-seed"));
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId: user.id, seed });
    server.send(JSON.stringify({ v: 1, type: "room.snapshot", payload: { seed } }));
    this.presence();
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(ws, message) {
    try {
      const event = JSON.parse(String(message));
      if (event?.v !== 1) throw new Error();
      ws.send(JSON.stringify({ v: 1, type: event.type === "ping" ? "pong" : "ack", id: event.id }));
    } catch {
      ws.send(JSON.stringify({ v: 1, type: "error", payload: { code: "INVALID_MESSAGE" } }));
    }
  }
  webSocketClose(ws) {
    ws.close();
    this.presence();
  }
  presence() {
    this.broadcast({ v: 1, type: "presence.updated", payload: { count: this.ctx.getWebSockets().length } });
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
  RoomDurableObject,
  chooseSpawn,
  index_default as default,
  rankNextRooms,
  replayReplacementOrder
};
//# sourceMappingURL=index.js.map
