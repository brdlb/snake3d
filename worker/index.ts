import { addPlayer, advanceSimulation, chooseLowestPhantom, createSimulation, validInput, validOrientation, type SimPlayer, type SimulationDelta, type SimulationState } from '../shared/simulation';
export interface Env { DB: D1Database; ROOMS: DurableObjectNamespace; ASSETS: Fetcher }
type User = { id: string; username: string; createdAt: string; lastSeen: string; highScore: number; highScoreSeed?: number; highScoreReplayId?: string; highScoreDate?: string; gamesPlayed: number; totalScore: number; elo: number; settings: { musicVolume: number; sfxVolume: number } };
type RoomAction = 'initial' | 'resume' | 'restart' | 'next' | 'join' | 'spectate';
type RoomData = { seed: number; phantoms: unknown[]; playerSpawnIndex: number; playerSpawn?: { position: {x:number;y:number;z:number}; direction: {x:number;y:number;z:number}; up: {x:number;y:number;z:number} } };
const COOKIE = 'snake3d_session', YEAR = 31_536_000;
const now = () => new Date().toISOString();
const json = (value: unknown, status = 200, requestId?: string) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...(requestId ? { 'x-request-id': requestId } : {}) } });
const fail = (code: string, status: number, requestId: string) => json({ error: { code, requestId } }, status, requestId);
const cookie = (r: Request, n: string) => r.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(`${n}=`))?.slice(n.length + 1);
const hash = async (v: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))].map(x => x.toString(16).padStart(2, '0')).join('');
const username = () => `${['Swift', 'Stellar', 'Neon', 'Cosmic'][Math.floor(Math.random() * 4)]}${['Snake', 'Viper', 'Cobra', 'Runner'][Math.floor(Math.random() * 4)]}${Math.floor(Math.random() * 1000)}`;
function toUser(row: Record<string, unknown>): User { return { id: String(row.id), username: String(row.username), createdAt: String(row.created_at), lastSeen: String(row.last_seen), highScore: Number(row.high_score), highScoreSeed: row.high_score_seed == null ? undefined : Number(row.high_score_seed), highScoreReplayId: row.high_score_replay_id as string | undefined, highScoreDate: row.high_score_date as string | undefined, gamesPlayed: Number(row.games_played), totalScore: Number(row.total_score), elo: Number(row.elo), settings: JSON.parse(String(row.settings_json)) }; }
async function userFor(r: Request, e: Env) { const token = cookie(r, COOKIE); if (!token) return null; const row = await e.DB.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(await hash(token), now()).first<Record<string, unknown>>(); return row ? toUser(row) : null; }
const mutationAllowed = (r: Request) => { const o = r.headers.get('origin'); return !o || o === new URL(r.url).origin || o.startsWith('http://localhost:') || o.startsWith('http://127.0.0.1:'); };
async function body(r: Request, requestId: string): Promise<unknown | Response> { if (Number(r.headers.get('content-length') || 0) > 524288) return fail('PAYLOAD_TOO_LARGE',413,requestId); try { return await r.json(); } catch { return fail('INVALID_JSON',400,requestId); } }
function position(v: unknown) { if (!v || typeof v !== 'object') return false; const p=v as Record<string,unknown>; return [p.x,p.y,p.z].every(x=>typeof x==='number'&&Number.isFinite(x)); }
function direction(v: unknown) { if (!position(v)) return false; const p=v as Record<string,number>, lengthSquared=p.x ** 2 + p.y ** 2 + p.z ** 2; return Math.abs(lengthSquared - 1) < 1e-9; }
const roomActions = new Set<RoomAction>(['initial','resume','restart','next','join','spectate']);
const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
export function parseRoomSeed(value: string | null) { if (value === null || !/^\d+$/.test(value)) return null; const seed=Number(value); return Number.isSafeInteger(seed) ? seed : null; }
export function chooseSpawn(phantoms: Array<{ elo?: number; startParams?: { spawnIndex?: number } }>, previousSpawnIndex?: number) {
  const used = new Set(phantoms.map(p => p.startParams?.spawnIndex).filter((v): v is number => Number.isInteger(v) && v >= 0 && v < 4));
  const free = [0, 1, 2, 3].filter(index => !used.has(index));
  const alternatives = free.filter(index => index !== previousSpawnIndex);
  if (alternatives.length) return alternatives[Math.floor(Math.random() * alternatives.length)];
  if (free.length) return free[Math.floor(Math.random() * free.length)];
  const replacementCandidates = phantoms.filter(phantom => {
    const index = phantom.startParams?.spawnIndex;
    return Number.isInteger(index) && index !== previousSpawnIndex;
  });
  if (replacementCandidates.length) {
    return replacementCandidates.reduce((best, phantom) => (Number(phantom.elo ?? 1000) < Number(best.elo ?? 1000) ? phantom : best)).startParams!.spawnIndex!;
  }
  return previousSpawnIndex === undefined ? 0 : (previousSpawnIndex + 1) % 4;
}
export function rankNextRooms<T extends { averageElo: number; phantomCount: number }>(rooms: T[], playerElo: number, random = Math.random) {
  return [...rooms].sort((a,b) => Math.abs(a.averageElo-playerElo)-Math.abs(b.averageElo-playerElo) || b.phantomCount-a.phantomCount || random()-.5);
}

export function replayReplacementOrder(replaySaved: boolean, evictRoomReplay: boolean) {
  if (!replaySaved) return [];
  return [...(evictRoomReplay ? ['deleteRoomMinimum'] : []), 'insertReplay'] as const;
}

export const ROOM_REPLAYS_QUERY = `SELECT payload_json FROM (
  SELECT payload_json, ROW_NUMBER() OVER (
    PARTITION BY json_extract(payload_json, '$.startParams.spawnIndex')
    ORDER BY score DESC, created_at ASC
  ) AS spawn_rank
  FROM replays
  WHERE room_seed=?
) WHERE spawn_rank=1`;

export default { async fetch(request, env): Promise<Response> { const requestId=crypto.randomUUID(), url=new URL(request.url), path=url.pathname;
  if (!path.startsWith('/api/')) { const response=await env.ASSETS.fetch(request), headers=new Headers(response.headers); headers.set('x-content-type-options','nosniff'); headers.set('referrer-policy','same-origin'); headers.set('permissions-policy','camera=(), microphone=(), geolocation=()'); return new Response(response.body,{status:response.status,headers}); }
  if (request.method !== 'GET' && !mutationAllowed(request)) return fail('INVALID_ORIGIN',403,requestId);
  if (path==='/api/v1/session'&&request.method==='POST') { const token=[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join(''), id=crypto.randomUUID(), time=now(), secure=url.protocol==='https:'?' Secure;':''; const user:User={id,username:username(),createdAt:time,lastSeen:time,highScore:0,gamesPlayed:0,totalScore:0,elo:1000,settings:{musicVolume:.5,sfxVolume:.7}}; await env.DB.batch([env.DB.prepare('INSERT INTO users (id,username,created_at,last_seen,settings_json) VALUES (?,?,?,?,?)').bind(id,user.username,time,time,JSON.stringify(user.settings)),env.DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').bind(await hash(token),id,new Date(Date.now()+YEAR*1000).toISOString(),time)]); return new Response(JSON.stringify({user,isNew:true}),{headers:{'content-type':'application/json','set-cookie':`${COOKIE}=${token}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${YEAR}`,'x-request-id':requestId}}); }
  const user=await userFor(request,env); if (!user) return fail('UNAUTHENTICATED',401,requestId);
  if(path==='/api/v1/me'&&request.method==='GET') return json({user},200,requestId);
  if(path==='/api/v1/me/settings'&&request.method==='PATCH') { const data=await body(request,requestId); if(data instanceof Response)return data; const settings=(data as {settings?:unknown}).settings; if(!settings||typeof settings!=='object')return fail('INVALID_SETTINGS',400,requestId); const next={...user.settings,...(settings as object)}; if(![next.musicVolume,next.sfxVolume].every(v=>typeof v==='number'&&v>=0&&v<=1))return fail('INVALID_SETTINGS',400,requestId); await env.DB.prepare('UPDATE users SET settings_json=?,last_seen=? WHERE id=?').bind(JSON.stringify(next),now(),user.id).run(); return json({user:{...user,settings:next}},200,requestId); }
  if(path==='/api/v1/matches'&&request.method==='POST') { const data=await body(request,requestId); if(data instanceof Response)return data; const p=data as {action?:unknown;contextSeed?:unknown;seed?:unknown}; if(typeof p.action!=='string'||!roomActions.has(p.action as RoomAction)||p.contextSeed!==undefined&&(!Number.isSafeInteger(p.contextSeed))||p.seed!==undefined&&(!Number.isSafeInteger(p.seed)))return fail('INVALID_ROOM_ACTION',400,requestId); if(p.action==='join'||p.action==='spectate'&&Number.isSafeInteger(p.seed)){if(!Number.isSafeInteger(p.seed))return fail('INVALID_ROOM_LINK',400,requestId);const exists=await env.DB.prepare('SELECT 1 FROM rooms WHERE seed=?').bind(p.seed).first();if(!exists)return fail('ROOM_NOT_FOUND',404,requestId);return env.ROOMS.get(env.ROOMS.idFromName(String(p.seed))).fetch(`https://room/${p.action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({user,seed:p.seed})});} if(p.action==='join')return fail('INVALID_ROOM_LINK',400,requestId); return env.ROOMS.get(env.ROOMS.idFromName(`user:${user.id}`)).fetch('https://room/assign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:p.action,contextSeed:p.contextSeed,user})}); }
  const socket=path.match(/^\/api\/v1\/rooms\/(-?\d+)\/socket$/); if(socket&&request.headers.get('upgrade')==='websocket') { const spectator=url.searchParams.get('spectator')==='1', restarting=url.searchParams.get('restart')==='1'; if(spectator){const exists=await env.DB.prepare('SELECT 1 FROM rooms WHERE seed=?').bind(Number(socket[1])).first();if(!exists)return fail('ROOM_NOT_FOUND',404,requestId);}else{const assigned=await env.DB.prepare('SELECT 1 FROM room_assignments WHERE user_id=? AND room_seed=?').bind(user.id,Number(socket[1])).first(); if(!assigned)return fail('ROOM_CONTEXT_MISMATCH',409,requestId);} return env.ROOMS.get(env.ROOMS.idFromName(socket[1])).fetch('https://room/socket',{headers:{upgrade:'websocket','x-user':JSON.stringify(user),'x-seed':socket[1],'x-spectator':spectator?'1':'0','x-restart':restarting?'1':'0'}}); }
  if(path==='/api/v1/leaderboard'&&request.method==='GET'){const limit=Math.min(Math.max(Number(url.searchParams.get('limit')||50),1),50), rows=await env.DB.prepare('SELECT username AS playerName,high_score AS score,high_score_seed AS seed,high_score_date AS date,high_score_replay_id AS replayId FROM users WHERE high_score>0 ORDER BY high_score DESC LIMIT ?').bind(limit).all();return json(rows.results,200,requestId);}
  return fail('NOT_FOUND',404,requestId);
} } satisfies ExportedHandler<Env>;

export class RoomDurableObject {
  constructor(private readonly ctx: DurableObjectState, private readonly env: Env) {}
  private simulation: SimulationState | null = null;
  private restartUserId: string | null = null;
  private snapshot(state: SimulationState) { return { seed: state.seed, tick: state.tick, serverTime: Date.now(), food: state.food, players: Object.values(state.players) }; }
  private async persist(state: SimulationState) { await this.ctx.storage.put('simulation',state); const deadlines=[...Object.values(state.players).filter(p=>p.alive).map(p=>p.nextStepAt),...Object.values(state.players).map(p=>p.disconnectedAt).filter((value): value is number => Number.isFinite(value))]; const next=Math.min(...deadlines); if(Number.isFinite(next))await this.ctx.storage.setAlarm(next); else await this.ctx.storage.deleteAlarm(); }
  private cleanupDisconnected(state: SimulationState, now: number) { for (const [id, player] of Object.entries(state.players)) if (player.disconnectedAt !== undefined && player.disconnectedAt <= now) delete state.players[id]; }
  private async applyDeltas(state: SimulationState, deltas: SimulationDelta[]) {
    if(!deltas.length)return;
    state.trajectories ??= {};
    for(const delta of deltas) for(const player of delta.changed) { const path=state.trajectories[player.id]??=[]; path.push(player.segments[0]); if(path.length>10000)path.splice(0,path.length-10000); }
    for(const delta of deltas) for(const death of delta.deaths) await this.ctx.storage.put(`terminal:${death.player.id}`,{player:death.player,deathPosition:death.position,reason:death.reason,trajectory:state.trajectories[death.player.id]??[],tick:delta.tick,createdAt:Date.now()});
    await this.persist(state);
       for(const delta of deltas) { for(const food of delta.food)this.broadcast({v:2,type:'food.changed',payload:{...food,tick:delta.tick,serverTime:Date.now()}}); for(const death of delta.deaths){const terminal={player:death.player,deathPosition:death.position,reason:death.reason,trajectory:state.trajectories[death.player.id]??[]}; const result=await this.saveTerminal(state.seed,terminal); this.broadcast({v:2,type:'player.died',payload:{player:death.player,position:death.position,reason:death.reason,tick:delta.tick,serverTime:Date.now()}}); if(result)this.sendToUser(death.player.id,{v:2,type:'game.saved',payload:result});} }
  }
  private async advance(state: SimulationState, serverNow=Date.now()) { await this.applyDeltas(state,advanceSimulation(state,serverNow)); }
  async alarm() { const state=this.simulation??await this.ctx.storage.get<SimulationState>('simulation'); if(!state)return; this.simulation=state; this.cleanupDisconnected(state,Date.now()); await this.advance(state); await this.persist(state); }
  async fetch(request: Request): Promise<Response> { const path=new URL(request.url).pathname; if(path==='/socket') { if(request.headers.get('x-restart')==='1') this.restartUserId=(JSON.parse(request.headers.get('x-user')||'{}') as User).id; return this.socket(request); } const data=await request.json<any>(); return path==='/assign' ? this.assign(data) : path==='/join' ? this.join(data) : path==='/spectate' ? this.spectate(data) : new Response('Not found',{status:404}); }
  private async restorePhantoms(state: SimulationState) {
    const restartingUserId = this.restartUserId;
    if (restartingUserId) {
      const anotherOnlinePlayer = this.ctx.getWebSockets().some(socket => {
        const attachment = socket.deserializeAttachment() as { userId?: string; spectator?: boolean } | null;
        return attachment?.userId !== restartingUserId && !attachment?.spectator;
      });
      this.restartUserId = null;
      if (anotherOnlinePlayer) return;
    } else {
      if (Object.values(state.players).some(player => player.alive && !player.phantom)) return;
      if (Object.values(state.players).some(player => player.phantom)) return;
    }
    const reserved = new Set<number>();
    for (const player of Object.values(state.players).filter(player => !player.phantom)) {
      const assignment = await this.env.DB.prepare('SELECT spawn_index FROM room_assignments WHERE room_seed=? AND user_id=?').bind(state.seed, player.id).first<{ spawn_index: number }>();
      if (assignment && Number.isInteger(assignment.spawn_index)) reserved.add(assignment.spawn_index);
    }
     if (restartingUserId) for (const [entityId, player] of Object.entries(state.players)) if (player.id === restartingUserId && !player.phantom) delete state.players[entityId];
    for (const id of Object.keys(state.players)) if (state.players[id].phantom) delete state.players[id];
    const replays = await this.activeReplays(state.seed);
    for (const row of replays.results) try {
      const replay = JSON.parse(row.payload_json);
      const spawnIndex = replay.startParams?.spawnIndex;
      if (reserved.has(spawnIndex)) continue;
      addPlayer(state, `phantom:${replay.id}`, replay.playerName ?? 'Phantom', Date.now(), { spawnIndex,
        entityId: `phantom:${replay.id}:${crypto.randomUUID()}`,
        phantom: true,
        score: Number(replay.finalScore ?? 0),
        color: '#7dd3fc',
        startPosition: replay.startParams?.startPosition,
        direction: replay.startParams?.startDirection
      });
    } catch { /* Ignore malformed historical replays. */ }
  }
  private async liveState(seed: number) { this.simulation ??= await this.ctx.storage.get<SimulationState>('simulation') ?? createSimulation(seed); await this.restorePhantoms(this.simulation); return this.simulation; }
  private async createRoom(user: User) {
    for(let attempt=0;attempt<8;attempt++) { const seed=randomSeed(), result=await this.env.DB.prepare('INSERT OR IGNORE INTO rooms(seed,elo_bucket,updated_at) VALUES(?,?,?)').bind(seed,Math.floor(user.elo/100),now()).run(); if(result.meta.changes===1)return seed; }
    throw new Error('ROOM_SEED_COLLISION');
  }
  private async activeReplays(seed:number) { return this.env.DB.prepare(ROOM_REPLAYS_QUERY).bind(seed).all<{payload_json:string}>(); }
  private async roomData(seed:number,user:User):Promise<RoomData> { const replays=await this.activeReplays(seed); const assignment=await this.env.DB.prepare('SELECT spawn_index FROM room_assignments WHERE user_id=? AND room_seed=?').bind(user.id,seed).first<{spawn_index:number}>(); return {seed,phantoms:replays.results.map(r=>JSON.parse(r.payload_json)),playerSpawnIndex:assignment?.spawn_index??0}; }
  private async selectRoom(user:User) {
    const candidates=await this.env.DB.prepare(`SELECT r.seed AS seed, COALESCE(AVG(CAST(json_extract(p.payload_json,'$.elo') AS REAL)),1000) AS average_elo, COUNT(p.id) AS phantom_count FROM rooms r LEFT JOIN replays p ON p.room_seed=r.seed WHERE NOT EXISTS (SELECT 1 FROM user_room_visits v WHERE v.user_id=? AND v.room_seed=r.seed) GROUP BY r.seed`).bind(user.id).all<{seed:number;average_elo:number;phantom_count:number}>();
    return rankNextRooms(candidates.results.map(row=>({seed:Number(row.seed),averageElo:Number(row.average_elo),phantomCount:Number(row.phantom_count)})),user.elo)[0]?.seed??await this.createRoom(user);
  }
  private async assign({action,contextSeed,user}:{action:RoomAction;contextSeed?:number;user:User}) {
    if(action==='spectate') return json(await this.roomData(contextSeed ?? await this.selectRoom(user),user));
    const current=await this.env.DB.prepare('SELECT room_seed,spawn_index FROM room_assignments WHERE user_id=?').bind(user.id).first<{room_seed:number;spawn_index:number}>();
    if((action==='restart'||action==='next')&&(!current||contextSeed!==current.room_seed))return json({error:{code:'ROOM_CONTEXT_MISMATCH'}},409);
    let seed:number;
    if(action==='restart') seed=current!.room_seed;
    else if(action==='resume'||action==='initial') { const last=await this.env.DB.prepare('SELECT last_room_seed FROM users WHERE id=?').bind(user.id).first<{last_room_seed:number|null}>(); seed=last?.last_room_seed??await this.createRoom(user); }
    else {
      seed=await this.selectRoom(user);
    }
    const existing=await this.activeReplays(seed);
    const spawn=chooseSpawn(existing.results.map(row=>JSON.parse(row.payload_json)),action==='restart' ? current!.spawn_index : undefined);
    const time=now();
    await this.env.DB.batch([
      this.env.DB.prepare('INSERT INTO user_room_visits(user_id,room_seed,visited_at) VALUES(?,?,?) ON CONFLICT(user_id,room_seed) DO NOTHING').bind(user.id,seed,time),
      this.env.DB.prepare('UPDATE users SET last_room_seed=?,last_seen=? WHERE id=?').bind(seed,time,user.id),
      this.env.DB.prepare('INSERT INTO room_assignments(user_id,room_seed,spawn_index,assigned_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET room_seed=excluded.room_seed,spawn_index=excluded.spawn_index,assigned_at=excluded.assigned_at').bind(user.id,seed,spawn,time),
      this.env.DB.prepare('INSERT INTO room_players(room_seed,user_id,spawn_index,joined_at) VALUES(?,?,?,?) ON CONFLICT(room_seed,user_id) DO UPDATE SET spawn_index=excluded.spawn_index,joined_at=excluded.joined_at').bind(seed,user.id,spawn,time),
      this.env.DB.prepare('UPDATE rooms SET updated_at=? WHERE seed=?').bind(time,seed)
    ]);
    return json(await this.roomData(seed,user));
  }
  private async join({user,seed}:{user:User;seed:number}) {
    const exists=await this.env.DB.prepare('SELECT 1 FROM rooms WHERE seed=?').bind(seed).first();
    if(!exists)return json({error:{code:'ROOM_NOT_FOUND'}},404);
    const state=await this.liveState(seed);
    const existing=await this.activeReplays(seed);
    const spawn=chooseSpawn(existing.results.map(row=>JSON.parse(row.payload_json)));
    const weakest=chooseLowestPhantom(Object.values(state.players));
     if(weakest)delete state.players[weakest.entityId];
     const player=addPlayer(state,user.id,user.username,Date.now(),{spawnIndex:spawn,entityId:crypto.randomUUID()});
    const time=now();
    await this.env.DB.batch([
      this.env.DB.prepare('INSERT INTO user_room_visits(user_id,room_seed,visited_at) VALUES(?,?,?) ON CONFLICT(user_id,room_seed) DO NOTHING').bind(user.id,seed,time),
      this.env.DB.prepare('UPDATE users SET last_room_seed=?,last_seen=? WHERE id=?').bind(seed,time,user.id),
       this.env.DB.prepare('INSERT INTO room_assignments(user_id,room_seed,spawn_index,assigned_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET room_seed=excluded.room_seed,spawn_index=excluded.spawn_index,assigned_at=excluded.assigned_at').bind(user.id,seed,spawn,time),
       this.env.DB.prepare('INSERT INTO room_players(room_seed,user_id,spawn_index,joined_at) VALUES(?,?,?,?) ON CONFLICT(room_seed,user_id) DO UPDATE SET spawn_index=excluded.spawn_index,joined_at=excluded.joined_at').bind(seed,user.id,spawn,time),
       this.env.DB.prepare('INSERT INTO live_room_assignments(room_seed,user_id,spawn_json,assigned_at) VALUES(?,?,?,?) ON CONFLICT(room_seed,user_id) DO UPDATE SET spawn_json=excluded.spawn_json,assigned_at=excluded.assigned_at').bind(seed,user.id,JSON.stringify({position:player.segments[0],direction:player.direction,up:player.up}),time)
    ]);
    await this.ctx.storage.put('simulation',state);
     this.broadcast({v:2,type:'player.joined',payload:{user:{id:user.id,username:user.username},timestamp:Date.now(),action:{type:'spawn',position:player.segments[0],direction:player.direction,up:player.up}}});
     return json({seed,phantoms:[],playerSpawnIndex:spawn,playerSpawn:{position:player.segments[0],direction:player.direction,up:player.up}});
  }
  private async spectate({user,seed}:{user:User;seed:number}) { return json(await this.roomData(seed,user)); }
  private async submit({seed,submissionId,user}:{seed:number;submissionId:string;user:User}) { const old=await this.env.DB.prepare('SELECT result_json FROM game_submissions WHERE id=? AND user_id=?').bind(submissionId,user.id).first<{result_json:string}>(); if(old)return json(JSON.parse(old.result_json)); const terminal=await this.ctx.storage.get<{player:SimPlayer;deathPosition:unknown;reason:string;trajectory:unknown[]}> (`terminal:${user.id}`),state=await this.liveState(seed); if(!terminal)return json({error:{code:'NO_AUTHORITATIVE_TERMINAL_RECORD'}},409); const current=state.players[user.id]; if(current?.alive||current?.instanceId!==terminal.player.instanceId)return json({error:{code:'TERMINAL_RECORD_SUPERSEDED'}},409); const id=crypto.randomUUID(),time=now(),score=terminal.player.score,stored={id,playerId:user.id,playerName:user.username,finalScore:score,deathPosition:terminal.deathPosition,trajectoryLog:terminal.trajectory.map(position=>({position,direction:terminal.player.direction})),timestamp:Date.now(),elo:user.elo,terminalReason:terminal.reason}; const worst=await this.env.DB.prepare('SELECT id,score FROM replays WHERE room_seed=? ORDER BY score ASC,created_at ASC LIMIT 1').bind(seed).first<{id:string;score:number}>(); const count=await this.env.DB.prepare('SELECT COUNT(*) AS count FROM replays WHERE room_seed=?').bind(seed).first<{count:number}>(); const replaySaved=Number(count?.count??0)<3||score>Number(worst?.score??Number.MAX_SAFE_INTEGER); const result={saved:true,replaySaved,replayId:replaySaved?id:undefined,message:replaySaved?'Game and replay saved':'Game saved; replay did not beat the room minimum'}; const statements=[this.env.DB.prepare('UPDATE rooms SET total_games_played=total_games_played+1,updated_at=? WHERE seed=?').bind(time,seed),this.env.DB.prepare('UPDATE users SET games_played=games_played+1,total_score=total_score+?,high_score=CASE WHEN ?>high_score THEN ? ELSE high_score END,high_score_seed=CASE WHEN ?>high_score THEN ? ELSE high_score_seed END,high_score_replay_id=CASE WHEN ?>high_score THEN ? ELSE high_score_replay_id END,high_score_date=CASE WHEN ?>high_score THEN ? ELSE high_score_date END,elo=CASE WHEN ?>high_score THEN ? ELSE elo END,last_seen=? WHERE id=?').bind(score,score,score,score,seed,score,id,score,time,score,score,time,user.id),this.env.DB.prepare('INSERT INTO game_submissions(id,user_id,room_seed,replay_id,result_json,created_at) VALUES(?,?,?,?,?,?)').bind(submissionId,user.id,seed,replaySaved?id:null,JSON.stringify(result),time)]; if(replaySaved){for(const operation of replayReplacementOrder(true,Boolean(worst&&Number(count?.count)>=3)))statements.unshift(operation==='deleteRoomMinimum'?this.env.DB.prepare('DELETE FROM replays WHERE id=?').bind(worst!.id):this.env.DB.prepare('INSERT INTO replays(id,room_seed,user_id,score,created_at,payload_json) VALUES(?,?,?,?,?,?)').bind(id,seed,user.id,score,time,JSON.stringify(stored)));} await this.env.DB.batch(statements); return json(result); }
  private async saveTerminal(seed:number, terminal:{player:SimPlayer;deathPosition:unknown;reason:string;trajectory:unknown[]}) { if(terminal.player.phantom)return null; const userRow=await this.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(terminal.player.id).first<Record<string,unknown>>(); if(!userRow)return null; const user=toUser(userRow),submissionId=`terminal:${seed}:${user.id}:${terminal.player.instanceId??'none'}`,old=await this.env.DB.prepare('SELECT result_json FROM game_submissions WHERE id=? AND user_id=?').bind(submissionId,user.id).first<{result_json:string}>(); if(old)return JSON.parse(old.result_json); const id=crypto.randomUUID(),time=now(),score=terminal.player.score,stored={id,playerId:user.id,playerName:user.username,finalScore:score,deathPosition:terminal.deathPosition,trajectoryLog:terminal.trajectory.map(position=>({position,direction:terminal.player.direction})),timestamp:Date.now(),elo:user.elo,terminalReason:terminal.reason}; const worst=await this.env.DB.prepare('SELECT id,score FROM replays WHERE room_seed=? ORDER BY score ASC,created_at ASC LIMIT 1').bind(seed).first<{id:string;score:number}>(); const count=await this.env.DB.prepare('SELECT COUNT(*) AS count FROM replays WHERE room_seed=?').bind(seed).first<{count:number}>(); const replaySaved=Number(count?.count??0)<3||score>Number(worst?.score??Number.MAX_SAFE_INTEGER); const result={saved:true,replaySaved,replayId:replaySaved?id:undefined,message:replaySaved?'Game and replay saved':'Game saved; replay did not beat the room minimum'}; const statements=[this.env.DB.prepare('UPDATE rooms SET total_games_played=total_games_played+1,updated_at=? WHERE seed=?').bind(time,seed),this.env.DB.prepare('UPDATE users SET games_played=games_played+1,total_score=total_score+?,high_score=CASE WHEN ?>high_score THEN ? ELSE high_score END,high_score_seed=CASE WHEN ?>high_score THEN ? ELSE high_score_seed END,high_score_replay_id=CASE WHEN ?>high_score THEN ? ELSE high_score_replay_id END,high_score_date=CASE WHEN ?>high_score THEN ? ELSE high_score_date END,elo=CASE WHEN ?>high_score THEN ? ELSE elo END,last_seen=? WHERE id=?').bind(score,score,score,score,seed,score,id,score,time,score,score,time,user.id),this.env.DB.prepare('INSERT INTO game_submissions(id,user_id,room_seed,replay_id,result_json,created_at) VALUES(?,?,?,?,?,?)').bind(submissionId,user.id,seed,replaySaved?id:null,JSON.stringify(result),time)]; if(replaySaved){for(const operation of replayReplacementOrder(true,Boolean(worst&&Number(count?.count)>=3)))statements.unshift(operation==='deleteRoomMinimum'?this.env.DB.prepare('DELETE FROM replays WHERE id=?').bind(worst!.id):this.env.DB.prepare('INSERT INTO replays(id,room_seed,user_id,score,created_at,payload_json) VALUES(?,?,?,?,?,?)').bind(id,seed,user.id,score,time,JSON.stringify(stored)));} await this.env.DB.batch(statements); return result; }
   private async socket(request:Request) { if(request.headers.get('upgrade')!=='websocket')return new Response('Upgrade required',{status:426}); const pair=new WebSocketPair(),[client,server]=Object.values(pair),user=JSON.parse(request.headers.get('x-user')||'{}') as User,seed=Number(request.headers.get('x-seed')),spectator=request.headers.get('x-spectator')==='1',state=await this.liveState(seed); await this.advance(state); let player=Object.values(state.players).find(candidate=>candidate.id===user.id&&!candidate.phantom); let playerJoined=false; const connectionId=crypto.randomUUID(); if(!spectator){ const assigned=await this.env.DB.prepare('SELECT spawn_index FROM room_assignments WHERE room_seed=? AND user_id=?').bind(seed,user.id).first<{spawn_index:number}>(); const spawnIndex=assigned?.spawn_index??0; if(!player||!player.alive){if(player)delete state.players[player.entityId];player=addPlayer(state,user.id,user.username,Date.now(),{spawnIndex,instanceId:connectionId});playerJoined=true;} else { player.instanceId=connectionId; player.disconnectedAt=undefined; for(const socket of this.ctx.getWebSockets())try{const attachment=socket.deserializeAttachment() as {userId?:string}|null;if(attachment?.userId===user.id)socket.close(4001,'Replaced by a newer connection');}catch{} } await this.persist(state);} this.ctx.acceptWebSocket(server); server.serializeAttachment({userId:user.id,entityId:player?.entityId,seed,user,spectator,instanceId:player?.instanceId}); server.send(JSON.stringify({v:2,type:'room.state',payload:this.snapshot(state)})); if(playerJoined)this.broadcast({v:2,type:'player.joined',payload:{user:{id:user.id,username:user.username},timestamp:Date.now(),action:{type:'spawn',entityId:player!.entityId,position:player!.segments[0],direction:player!.direction,up:player!.up}}}); this.presence(); return new Response(null,{status:101,webSocket:client}); }
      async webSocketMessage(ws:WebSocket,message:string|ArrayBuffer) { try { const event=JSON.parse(String(message)),attachment=ws.deserializeAttachment() as {userId:string;entityId?:string;seed:number;user:User;spectator?:boolean;instanceId?:string}; if(event?.v!==2)throw new Error(); if(event.type==='ping'){ws.send(JSON.stringify({v:2,type:'pong'}));return;} const state=await this.liveState(attachment.seed); if(event.type==='room.resync'){await this.advance(state);ws.send(JSON.stringify({v:2,type:'room.state',payload:this.snapshot(state)}));return;} if(attachment.spectator)throw new Error(); const player=attachment.entityId?state.players[attachment.entityId]:undefined,candidate=event?.payload?.action?.type==='direction'?event.payload.action.direction:undefined,up=event?.payload?.action?.type==='direction'?event.payload.action.up:undefined; if(!player||player.instanceId!==attachment.instanceId){ws.send(JSON.stringify({v:2,type:'error',payload:{code:'STALE_CONNECTION'}}));return;} if(!player.alive){ws.send(JSON.stringify({v:2,type:'error',payload:{code:'PLAYER_NOT_ALIVE'}}));return;} if(event.type!=='player.directionChanged'||!validInput(player.direction,candidate,player.up,up??player.up)||!validOrientation(candidate,up??player.up)){ws.send(JSON.stringify({v:2,type:'error',payload:{code:'INVALID_DIRECTION'}}));return;} const directionChanged=player.direction.x!==candidate.x||player.direction.y!==candidate.y||player.direction.z!==candidate.z,upChanged=player.up.x!==(up??player.up).x||player.up.y!==(up??player.up).y||player.up.z!==(up??player.up).z; if(directionChanged||upChanged){player.direction=candidate;player.up=up??player.up;await this.persist(state);this.broadcast({v:2,type:'player.directionChanged',payload:{entityId:player.entityId,direction:player.direction,up:player.up,speed:player.speed,tick:state.tick,serverTime:Date.now()}});} await this.advance(state); } catch { ws.send(JSON.stringify({v:2,type:'error',payload:{code:'INVALID_MESSAGE'}})); } }
   async webSocketClose(ws:WebSocket) { const attachment=ws.deserializeAttachment() as {userId:string;entityId?:string;spectator?:boolean;instanceId?:string}|null,player=attachment?.entityId&&this.simulation?.players[attachment.entityId]; if(attachment&&!attachment.spectator&&player&&player.instanceId===attachment.instanceId){player.disconnectedAt=Date.now()+15000;await this.persist(this.simulation!);this.broadcast({v:2,type:'room.left',payload:{entityId:player.entityId,userId:attachment.userId}});} ws.close(); this.presence(); }
  private presence() { this.broadcast({v:1,type:'presence.updated',payload:{count:this.ctx.getWebSockets().length}}); }
  private sendToUser(userId:string,message:unknown) { const text=JSON.stringify(message); for(const socket of this.ctx.getWebSockets())try{if((socket.deserializeAttachment() as {userId?:string}|null)?.userId===userId)socket.send(text);}catch{socket.close();} }
  private broadcast(message:unknown) { const text=JSON.stringify(message); for(const socket of this.ctx.getWebSockets())try{socket.send(text);}catch{socket.close();} }
}
