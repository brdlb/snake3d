/** Local-only end-to-end smoke. Start Wrangler on 8787 and a headless Chrome
 * with --remote-debugging-port=9223. This creates isolated local test users. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { checkPortal, copy, moveAdventure, type AdventureSnake, type RoomDefinition } from '../shared/adventure';
import { validatePortalRoute } from '../shared/adventureGeneration';

const origin = 'http://127.0.0.1:8787';
// Confirm that the local Worker serves the module referenced by its HTML.
for (let attempt = 0; attempt < 50; attempt++) {
  const html = await (await fetch(`${origin}/?smoke=${Date.now()}`)).text();
  const module = html.match(/src="([^"\s]+\.js)"/);
  if (module) {
    const response = await fetch(new URL(module[1], origin));
    if (response.ok && response.headers.get('content-type')?.includes('javascript')) break;
  }
  if (attempt === 49) throw new Error('BUILT ASSET MANIFEST NOT READY: RESTART LOCAL WRANGLER AFTER BUILD');
  await new Promise(resolve => setTimeout(resolve, 200));
}
const browser = await (await fetch('http://127.0.0.1:9223/json/version')).json() as { webSocketDebuggerUrl: string };
const cdp = new WebSocket(browser.webSocketDebuggerUrl);
await new Promise<void>(resolve => cdp.addEventListener('open', () => resolve(), { once: true }));
let id = 0;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
const runtimeErrors: string[] = [];
cdp.addEventListener('message', e => {
  const message = JSON.parse(String(e.data));
  if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') runtimeErrors.push(message.params.entry.text);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result);
});
function call(method: string, params: object = {}, sessionId?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const next = ++id;
    pending.set(next, { resolve, reject });
    cdp.send(JSON.stringify({ id: next, method, params, sessionId }));
  });
}
async function page() {
  const { browserContextId } = await call('Target.createBrowserContext');
  const { targetId } = await call('Target.createTarget', { url: `${origin}/api/v1/version`, browserContextId });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  await call('Runtime.enable', {}, sessionId);
  await call('Page.enable', {}, sessionId);
  await call('Log.enable', {}, sessionId);
  await call('Network.enable', {}, sessionId);
  await call('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
  for (let tries = 0; tries < 20; tries++) {
    const ready = await evaluate(sessionId, 'location.origin');
    if (ready === origin) return { sessionId, browserContextId };
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('LOCAL PAGE DID NOT LOAD');
}
async function evaluate(session: string, expression: string): Promise<any> {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, replMode: true, userGesture: true }, session);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
const clients = await Promise.all([page(), page()]);
try {
  for (const client of clients) {
    await evaluate(client.sessionId, `window.api = async (path, body) => {
      const r = await fetch(path, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(body) });
      const value = await r.json(); if (!r.ok) throw new Error(r.status + ':' + JSON.stringify(value)); return value;
    }; window.auth = await api('/api/v1/session', {});`);
  }
  const first = clients[0].sessionId;
  const second = clients[1].sessionId;
  const assignment = await evaluate(first, `window.room = await api('/api/v1/matches', {action:'initial'}); room`);
  assert.equal(assignment.definition.portals.filter((p: any) => p.enabled).length, 5);
  const firstUser = await evaluate(first, 'auth.user.id');
  const connect = async (session: string, seed: number): Promise<AdventureSnake> => {
    return evaluate(session, `window.ws?.close(); window.ws = new WebSocket('ws://127.0.0.1:8787/api/v1/rooms/${seed}/socket');
      window.messages = []; window.ws.onmessage = e => messages.push(JSON.parse(e.data));
      await new Promise((resolve,reject) => { ws.onerror = () => reject(new Error('SOCKET FAILED')); const poll=setInterval(()=>{ const m=messages.find(m=>m.type==='room.state'); if(m){clearInterval(poll);resolve();} },10);setTimeout(()=>{clearInterval(poll);reject(new Error('SOCKET TIMEOUT'));},10000); });
      window.serverPlayer = messages.find(m=>m.type==='room.state').payload.players.find(p=>p.id===auth.user.id);
      window.serverStep = serverPlayer.adventureStep ?? 0; serverPlayer;`);
  };
  let state = await connect(first, assignment.seed);
  const checkpoint = copy(assignment.initialState);
  const step = async (session: string, snake: AdventureSnake, direction: { x: number; y: number; z: number }): Promise<AdventureSnake> => {
    const predicted = moveAdventure(snake, direction);
    assert.ok(predicted, 'LEGAL MOVEMENT');
    // The orientation is independent of the direction only when the up axis
    // remains perpendicular. Pick a legal orientation for vertical turns.
    predicted.up = direction.y ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
    return evaluate(session, `window.expectedStep = ++serverStep; const action=${JSON.stringify(predicted)};
      ws.send(JSON.stringify({v:3,type:'adventure.step',payload:{action:{...action,step:expectedStep}}}));
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{clearInterval(poll);reject(new Error('STEP TIMEOUT '+expectedStep));},5000);const poll=setInterval(()=>{const m=messages.find(m=>m.type==='adventure.state'&&m.payload.entityId===serverPlayer.entityId&&m.payload.step===expectedStep);if(m){clearInterval(poll);clearTimeout(timer);serverPlayer={...serverPlayer,...m.payload.state};resolve();}},5);}); serverPlayer;`);
  };
  const definition: RoomDefinition = assignment.definition;
  const witness = validatePortalRoute(definition, state, 'yp');
  assert.equal(witness.valid, true, witness.reason);
  for (const d of witness.route) state = await step(first, state, d);
  assert.ok(checkPortal(definition, 'yp', state).open);
  const crossing = copy(state);
  crossing.segments.unshift({ ...crossing.segments[0], y: 51 });
  if (crossing.growth > 0) crossing.growth--; else crossing.segments.pop();
  crossing.direction = { x: 0, y: 1, z: 0 }; crossing.up = { x: 0, y: 0, z: 1 };
  const transferId = crypto.randomUUID();
  const payload = { fromSeed: assignment.seed, direction: 'yp', state: crossing, transferId };
  const destination = await evaluate(first, `await api('/api/v1/rooms/portal',${JSON.stringify(payload)})`);
  assert.equal(destination.initialState.adventure.charge, state.adventure.charge - 1);
  assert.deepEqual(destination.initialState.adventure.path, [assignment.seed]);
  const repeated = await evaluate(first, `await api('/api/v1/rooms/portal',${JSON.stringify(payload)})`);
  assert.deepEqual(repeated.initialState, destination.initialState);
  state = await connect(first, destination.seed);
  const entryCheckpoint = copy(destination.initialState);
  state = await step(first, state, { x: 0, y: 1, z: 0 });
  state = await step(first, state, { x: 1, y: 0, z: 0 });
  await evaluate(first, `const submissionId=crypto.randomUUID();ws.send(JSON.stringify({v:2,type:'player.died',payload:{action:{...serverPlayer,type:'death',step:serverStep+1,seq:1,submissionId,reason:'bounds'}}}));
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{clearInterval(poll);reject(new Error('DEATH SAVE TIMEOUT'));},5000);const poll=setInterval(()=>{const m=messages.find(m=>m.type==='game.saved'&&m.payload.submissionId===submissionId);if(m){clearTimeout(timer);clearInterval(poll);resolve();}},10);});`);
  await evaluate(first, `ws.close();`);
  const restored = await evaluate(first, `await api('/api/v1/matches', {action:'restart',contextSeed:${destination.seed}})`);
  assert.deepEqual(restored.initialState, entryCheckpoint);
  state = await connect(first, destination.seed);
  const connected = await evaluate(first, `await api('/api/v1/matches', {action:'resume'})`);
  for (const key of ['segments', 'direction', 'up', 'score', 'speed', 'growth', 'adventure'] as const) assert.deepEqual(connected.initialState[key], state[key]);
  const returnWitness = validatePortalRoute(destination.definition, state, 'yn');
  assert.ok(returnWitness.valid, returnWitness.reason);
  for (const d of returnWitness.route) state = await step(first, state, d);
  const backCross = copy(state); backCross.segments.unshift({ ...state.segments[0], y: -1 });
  if (backCross.growth > 0) backCross.growth--; else backCross.segments.pop();
  backCross.direction = { x: 0, y: -1, z: 0 }; backCross.up = { x: 0, y: 0, z: 1 };
  const returned = await evaluate(first, `await api('/api/v1/rooms/portal', ${JSON.stringify({ fromSeed: destination.seed, direction: 'yn', state: backCross, transferId: crypto.randomUUID() })})`);
  assert.deepEqual(returned.initialState.adventure.path, []);
  assert.equal(returned.initialState.adventure.charge, state.adventure.charge);
  const otherAssignment = await evaluate(second, `await api('/api/v1/matches', {action:'initial'})`);
  const otherState = await connect(second, otherAssignment.seed);
  assert.equal(otherState.adventure.charge, 0);
  assert.notEqual(await evaluate(second, 'auth.user.id'), firstUser);
  assert.deepEqual(checkpoint.adventure.charge, 0);
  const below = await evaluate(second, `const response=await fetch('/api/v1/rooms', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({x:0,y:0,z:-1})}); ({status:response.status,body:await response.json()})`);
  assert.equal(below.status, 400);
  // Reserve the first player's checkpoint with a second player by walking
  // normally through the shared room; only the first player's reset blocks.
  const firstCheckpoint = returned.initialState as AdventureSnake;
  let blocker = otherState;
  const targetCell = firstCheckpoint.segments[0];
  const findPath = (s: AdventureSnake): Array<{ x:number;y:number;z:number }> => {
    const q = [{ snake: s, path: [] as Array<{x:number;y:number;z:number}> }], seen = new Set<string>();
    const dirs = [{x:1,y:0,z:0},{x:-1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:-1,z:0},{x:0,y:0,z:1},{x:0,y:0,z:-1}];
    for (let i=0;i<10000&&q.length;i++) { const n=q.shift()!; if(JSON.stringify(n.snake.segments[0])===JSON.stringify(targetCell)) return n.path; for(const d of dirs){const next=moveAdventure(n.snake,d);if(!next)continue;const k=JSON.stringify(next.segments);if(seen.has(k))continue;seen.add(k);q.push({snake:next,path:[...n.path,d]});} q.sort((a,b)=>{const h=(v:AdventureSnake)=>Math.abs(v.segments[0].x-targetCell.x)+Math.abs(v.segments[0].y-targetCell.y)+Math.abs(v.segments[0].z-targetCell.z);return h(a.snake)-h(b.snake);}); }
    throw new Error('BLOCKER ROUTE UNAVAILABLE');
  };
  // The first player is disconnected and absent from the destination DO;
  // its persisted checkpoint still reserves no space until a restart.
  for (const d of findPath(blocker)) blocker = await step(second, blocker, d);
  const blocked = await evaluate(first, `const r=await fetch('/api/v1/matches',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'restart',contextSeed:${returned.seed}})});({status:r.status,body:await r.json()})`);
  assert.equal(blocked.status, 409); assert.equal(blocked.body.error.code, 'RESPAWN BLOCKED');
  // Render the actual application with an isolated profile.
  const visual = await page(); clients.push(visual);
  await call('Page.bringToFront', {}, visual.sessionId);
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, visual.sessionId);
  await evaluate(visual.sessionId, `localStorage.setItem('snake3d_onboarding_completed','1');`);
  const navigation = await call('Page.navigate', { url: `${origin}/?adventureDebug=1&smoke=${Date.now()}` }, visual.sessionId);
  assert.equal(navigation.errorText, undefined);
  for (let i = 0; i < 300; i++) {
    if (await evaluate(visual.sessionId, '!!window.snakeAdventureGame?.welcomeScreen')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(await evaluate(visual.sessionId, `!!document.querySelector('.welcome-actions button')`), `WELCOME BUTTON READY: ${JSON.stringify({ errors: runtimeErrors, page: await evaluate(visual.sessionId, '({text:document.body.innerText,game:!!window.snakeAdventureGame,initialized:window.snakeAdventureGame?.playfieldInitialized})') })}`);
  await evaluate(visual.sessionId, `document.querySelector('.welcome-actions button').click();`);
  for (let i = 0; i < 150; i++) {
    if (await evaluate(visual.sessionId, '!!snakeAdventureGame.adventure && !snakeAdventureGame.isWaitingForStart && !snakeAdventureGame.isSpectating')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await evaluate(visual.sessionId, `snakeAdventureGame.isPaused=true;`);
  const visualDefinition = await evaluate(visual.sessionId, 'snakeAdventureGame.roomDefinition');
  const visualState = await evaluate(visual.sessionId, 'snakeAdventureGame.livePlayerState()') as AdventureSnake;
  const visualRoute = validatePortalRoute(visualDefinition, visualState, 'xp');
  assert.ok(visualRoute.valid, visualRoute.reason);
  for (const d of visualRoute.route) {
    await evaluate(visual.sessionId, `const g=snakeAdventureGame,d=${JSON.stringify(d)};
      const vector=g.snake.getHead().clone().set(d.x,d.y,d.z),up=g.snake.getHead().clone().set(0,d.y?0:1,d.y?1:0);
      g.snake.direction.copy(g.orientationQuaternion(vector,up));g.snake.update(60/g.currentSPM+0.000001);g.playerTick++;g.checkCollisions(null);
      if(g.isGameOver)throw new Error('VISUAL PLAYER COLLISION');
      g.adventurePending=true;g.adventurePendingSince=Date.now();g.networkManager.sendAdventureStep({...g.livePlayerState(),step:g.playerTick});
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{clearInterval(poll);reject(new Error('VISUAL STEP TIMEOUT'));},5000);const poll=setInterval(()=>{if(!g.adventurePending){clearInterval(poll);clearTimeout(timer);resolve();}},5);});`);
  }
  await evaluate(visual.sessionId, `const g=snakeAdventureGame;const before=g.snake.segments.map(p=>p.clone());g.snake.direction.copy(g.orientationQuaternion(g.snake.getHead().clone().set(1,0,0),g.snake.getHead().clone().set(0,1,0)));g.snake.update(60/g.currentSPM+0.000001);g.playerTick++;g.checkCollisions(before);
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{clearInterval(poll);reject(new Error('VISUAL PORTAL TIMEOUT'));},10000);const poll=setInterval(()=>{if(!g.isRoomTransitionPending){clearInterval(poll);clearTimeout(timer);resolve();}},10);});`);
  assert.notEqual(await evaluate(visual.sessionId, 'snakeAdventureGame.currentSeed'), visualDefinition.seed);
  assert.equal(await evaluate(visual.sessionId, 'snakeAdventureGame.previousRooms.length'), 1);
  await new Promise(resolve => setTimeout(resolve, 300));
  const hud = await evaluate(visual.sessionId, `document.querySelector('.hud-adventure')?.innerText`);
  assert.ok(hud?.includes('CHARGE 0/12'), hud);
  assert.ok(await evaluate(visual.sessionId, `!document.querySelector('.welcome-screen')?.classList.contains('active')`));
  if (process.env.ADVENTURE_SCREENSHOT) {
    const shot = await call('Page.captureScreenshot', { format: 'png' }, visual.sessionId);
    await writeFile(process.env.ADVENTURE_SCREENSHOT, Buffer.from(shot.data, 'base64'));
  }
  console.log(JSON.stringify({ status: 'PASS', checks: ['TWO ISOLATED BROWSER SESSIONS', 'SERVER STEP INTERACTIONS', 'CHARGE PAYMENT', 'IDEMPOTENT TRANSFER', 'DEATH SAVE', 'FULL CHECKPOINT RESTORE', 'RESUME', 'FREE RETURN', 'BLOCKED RESPAWN', 'NEGATIVE Z REJECTION', 'GAME HUD RENDER', 'GAME PORTAL TRANSFER WITH PREVIOUS ROOM RENDER'] }));
} finally {
  for (const client of clients) await call('Target.disposeBrowserContext', { browserContextId: client.browserContextId });
  cdp.close();
}
