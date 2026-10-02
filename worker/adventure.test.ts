import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { RoomDurableObject } from './index';
import { addPlayer, createSimulation } from '../shared/simulation';
import { applyInteractions, copy, enterAdventure, newAdventure, type AdventureSnake } from '../shared/adventure';
import { simulateClientMove } from '../shared/adventureValidation';
import { roomSeed } from '../shared/roomCoordinates';

function fixture() {
  const from = roomSeed({ x: 0, y: 0, z: 0 }), to = roomSeed({ x: 0, y: 1, z: 0 });
  const user = { id: 'test-user', username: 'PLAYER', elo: 1000, settings: {} };
  const receipts = new Map<string, any>();
  let assigned = from, failCommit = false;
  const env: any = { ADVENTURE_ENABLED: 'true' };
  env.DB = {
    prepare: (sql: string) => {
      const statement: any = { sql, args: [], bind(...args: unknown[]) { this.args = args; return this; }, async run() { return {}; }, async first() {
        if (sql.includes('FROM sessions')) return { id: user.id, username: user.username, settings_json: '{}', elo: 1000 };
        if (sql.includes('FROM adventure_transfers')) return receipts.get(this.args[0]) ?? null;
        if (sql.includes('SELECT room_seed')) return { room_seed: assigned };
        return null;
      } };
      return statement;
    },
    batch: vi.fn(async (statements: any[]) => {
      if (failCommit) throw new Error('D1 FAILED');
      for (const statement of statements) {
        if (statement.sql.includes('INSERT INTO adventure_transfers')) { const [id, user_id, from_seed, to_seed, status, result_json] = statement.args; receipts.set(id, { user_id, from_seed, to_seed, status, result_json }); }
        if (statement.sql.includes('UPDATE room_assignments')) assigned = statement.args[0];
      }
      return [];
    }),
  };
  const makeActor = (seed: number) => {
    const stored = new Map<string, any>();
    const storage = {
      get: vi.fn(async (key: string) => copy(stored.get(key) ?? null)),
      put: vi.fn(async (key: string | Record<string, unknown>, value?: unknown) => {
        if (typeof key === 'string') stored.set(key, copy(value)); else for (const [k, v] of Object.entries(key)) stored.set(k, copy(v));
      }),
      delete: vi.fn(async (key: string) => stored.delete(key)),
      list: vi.fn(async ({ prefix }: { prefix: string }) => new Map([...stored].filter(([k]) => k.startsWith(prefix)))),
      setAlarm: vi.fn(), deleteAlarm: vi.fn(),
    };
    const actor = new RoomDurableObject({ storage, getWebSockets: () => [] } as any, env);
    const state = createSimulation(seed); state.food = [];
    (actor as any).simulation = state;
    (actor as any).liveState = vi.fn(async () => state);
    return { actor, state, stored, storage };
  };
  const source = makeActor(from), target = makeActor(to);
  env.ROOMS = { idFromName: (name: string) => name, get: (name: string) => ({ fetch: (url: string, init: RequestInit) => (name === String(from) ? source.actor : target.actor).fetch(new Request(url, init)) }) };
  const player = addPlayer(source.state, user.id, user.username, 0, { segments: Array.from({ length: 6 }, (_, i) => ({ x: 25, y: 50 - i, z: 25 })), direction: { x: 0, y: 1, z: 0 }, up: { x: 0, y: 0, z: 1 } });
  player.adventure = newAdventure(3, 300); player.adventure.charge = 3;
  player.instanceId = 'connection';
  const input = { fromSeed: from, direction: 'yp', transferId: '11111111-1111-4111-8111-111111111111', state: { segments: [{ x: 25, y: 51, z: 25 }, ...player.segments.slice(0, -1)], direction: player.direction, up: player.up, score: 999, speed: 9999 } };
  const request = () => new Request('https://snake.example/api/v1/rooms/portal', { method: 'POST', headers: { cookie: 'snake3d_session=test', 'content-type': 'application/json' }, body: JSON.stringify(input) });
  return { env, user, source, target, player, input, request, from, to, fail: () => { failCommit = true; } };
}

describe('adventure transfer transaction', () => {
  it('uses server resources and makes repeated requests idempotent', async () => {
    const f = fixture();
    const response = await worker.fetch(f.request(), f.env);
    expect(response.status).toBe(200);
    const result = await response.json<any>();
    expect(result.initialState.adventure.charge).toBe(2);
    expect(result.initialState.speed).toBe(300);
    expect(result.initialState.score).toBe(0);
    expect(result.initialState.adventure.path).toEqual([f.from]);
    const target = Object.values(f.target.state.players)[0];
    target.score = 25;
    const repeated = await worker.fetch(f.request(), f.env);
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual(result);
    expect(target.score).toBe(25);
    expect(f.env.DB.batch).toHaveBeenCalledTimes(1);
    expect(Object.values(f.source.state.players)).toHaveLength(0);
  });
  it('leaves the source unchanged and releases reservations after a failed D1 transaction', async () => {
    const f = fixture(); f.fail(); const before = copy(f.player);
    await expect(worker.fetch(f.request(), f.env)).rejects.toThrow('D1 FAILED');
    expect(f.player).toEqual(before);
    expect(f.source.stored.has(`departure:${f.user.id}`)).toBe(false);
    expect(f.target.stored.has(`arrival:${f.input.transferId}`)).toBe(false);
    expect(Object.values(f.target.state.players)).toHaveLength(0);
  });
  it('blocks a transfer when any destination body segment is occupied', async () => {
    const f = fixture();
    addPlayer(f.target.state, 'other', 'OTHER', 0, { segments: [{ x: 25, y: -2, z: 25 }], direction: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } });
    const before = copy(f.player);
    const response = await worker.fetch(f.request(), f.env);
    expect(response.status).toBe(409);
    expect(f.player).toEqual(before);
    expect(f.env.DB.batch).not.toHaveBeenCalled();
  });
  it('refuses a forged head jump and never changes the checkpoint', async () => {
    const f = fixture(); f.input.state.segments[0].x = 24;
    expect((await worker.fetch(f.request(), f.env)).status).toBe(409);
    expect(f.env.DB.batch).not.toHaveBeenCalled();
  });
});

afterEach(() => vi.useRealTimers());

describe('adventure step authority', () => {
  function movingFixture() {
    vi.useFakeTimers();
    const f = fixture();
    f.player.segments = [{ x: 5, y: 5, z: 5 }, { x: 5, y: 5, z: 4 }, { x: 5, y: 5, z: 3 }];
    f.player.direction = { x: 0, y: 0, z: 1 }; f.player.up = { x: 0, y: 1, z: 0 };
    f.player.adventure = newAdventure(3, 300);
    (f.source.actor as any).startTrajectory(f.source.state, f.player, 0);
    (f.source.actor as any).definition = () => ({ interactions: [] });
    const ws: any = { deserializeAttachment: () => ({ userId: f.user.id, entityId: f.player.entityId, instanceId: 'connection', seed: f.from, user: f.user }), send: vi.fn() };
    const send = (action: any) => f.source.actor.webSocketMessage(ws, JSON.stringify({ v: 3, type: 'adventure.step', payload: { action } }));
    const batch = (count: number) => {
      let next = (f.source.actor as any).adventureSnake(f.player);
      const moves = [];
      for (let i = 0; i < count; i++) {
        const speed = next.speed;
        next = simulateClientMove(next, next.direction)!;
        applyInteractions({ interactions: [] } as any, next, 60000 / speed);
        moves.push({ direction: next.direction, up: next.up });
      }
      return { ...next, step: (f.player.adventureStep ?? 0) + count, epoch: f.player.adventureEpoch ?? 0, moves };
    };
    return { ...f, ws, send, batch };
  }
  it('simulates a batch in memory and writes one recovery checkpoint after five seconds', async () => {
    const f = movingFixture();
    await f.send(f.batch(3));
    expect(f.player.segments[0].z).toBe(8);
    expect(f.source.storage.get).not.toHaveBeenCalled();
    expect(f.source.storage.put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.source.storage.put).toHaveBeenCalledTimes(1);
    expect(f.source.stored.get('simulation').players[f.player.entityId].adventureStep).toBe(3);
  });
  it('accepts a small client delta but forces a large jump and rejects the previous epoch', async () => {
    const f = movingFixture();
    const small = f.batch(1); small.segments.forEach((p: any) => p.x++);
    await f.send(small);
    expect(f.player.segments[0].x).toBe(6);
    expect(f.player.adventureEpoch).toBeUndefined();
    const forged = f.batch(1); forged.segments[0].x += 10;
    await f.send(forged);
    expect(f.player.segments[0].x).toBe(6);
    expect(f.player.adventureEpoch).toBe(1);
    expect(JSON.parse(f.ws.send.mock.calls.at(-1)[0]).payload.correction).toBe(true);
    const before = copy(f.player);
    await f.send({ ...f.batch(1), epoch: 0 });
    expect(f.player).toEqual(before);
  });
  it('accepts the client checkpoint when server movement reports a body collision', async () => {
    const f = movingFixture();
    f.player.segments = [{ x: 5, y: 5, z: 5 }, { x: 5, y: 5, z: 6 }, { x: 5, y: 5, z: 7 }];
    const action = f.batch(1);
    action.segments = [{ x: 6, y: 5, z: 5 }, { x: 5, y: 5, z: 5 }, { x: 5, y: 5, z: 6 }];
    action.direction = { x: 1, y: 0, z: 0 };
    await f.send(action);
    expect(f.player.segments).toEqual(action.segments);
    expect(f.player.alive).toBe(true);
    expect(f.player.adventureEpoch).toBeUndefined();
  });
  it('does not allow a client checkpoint to overwrite player identity or life state', async () => {
    const f = movingFixture();
    await f.send({ ...f.batch(1), id: 'forged', entityId: 'forged', alive: false });
    expect(f.player.id).toBe(f.user.id);
    expect(f.player.alive).toBe(true);
  });
  it('corrects malformed adventure state and excessive movement rate', async () => {
    const f = movingFixture();
    await f.send({ ...f.batch(1), adventure: {} });
    expect(f.player.adventureEpoch).toBe(1);
    await f.send(f.batch(12));
    expect(f.player.adventureEpoch).toBe(2);
    expect(f.player.adventureStep).toBe(1);
  });
  it('ignores forged charge and speed, advances one legal cell, and ignores duplicate steps', async () => {
    const f = fixture();
    f.player.segments = [{ x: 5, y: 5, z: 5 }, { x: 5, y: 5, z: 4 }, { x: 5, y: 5, z: 3 }];
    f.player.direction = { x: 0, y: 0, z: 1 }; f.player.up = { x: 0, y: 1, z: 0 };
    (f.source.actor as any).startTrajectory(f.source.state, f.player, 0);
    const action = { ...copy(f.player), step: 1, segments: [{ x: 6, y: 5, z: 5 }, ...f.player.segments.slice(0, -1)], direction: { x: 1, y: 0, z: 0 }, speed: 9999, adventure: { ...f.player.adventure!, charge: 12 } };
    const ws: any = { deserializeAttachment: () => ({ userId: f.user.id, entityId: f.player.entityId, instanceId: 'connection', seed: f.from, user: f.user }), send: vi.fn() };
    await f.source.actor.webSocketMessage(ws, JSON.stringify({ v: 3, type: 'adventure.step', payload: { action } }));
    expect(f.player.speed).toBe(300); expect(f.player.adventure!.charge).toBe(3);
    expect(f.player.segments[0]).toEqual({ x: 6, y: 5, z: 5 });
    const before = copy(f.player);
    await f.source.actor.webSocketMessage(ws, JSON.stringify({ v: 3, type: 'adventure.step', payload: { action } }));
    expect(f.player).toEqual(before);
    expect(ws.send).toHaveBeenCalled();
  });
  it('restores a complete entry checkpoint when installing a new incarnation', () => {
    const f = fixture();
    const snake: AdventureSnake = { segments: f.player.segments, direction: f.player.direction, up: f.player.up, score: 12, speed: 450, growth: 2, adventure: f.player.adventure! };
    snake.adventure.coatings = Array(6).fill('CONDUCTIVE');
    const checkpoint = enterAdventure(snake, f.from, [f.to]);
    const restored = (f.source.actor as any).installAdventure(f.source.state, f.user, checkpoint);
    expect(restored.growth).toBe(2); expect(restored.speed).toBe(450); expect(restored.score).toBe(12);
    expect(restored.adventure.coatings).toEqual(snake.adventure.coatings);
    expect(restored.adventure.path).toEqual([f.to]);
    expect(restored.entityId).not.toBe(f.player.entityId);
  });
});
