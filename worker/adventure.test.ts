import { describe, expect, it, vi } from 'vitest';
import worker, { RoomDurableObject } from './index';
import { addPlayer, createSimulation } from '../shared/simulation';
import { copy, enterAdventure, newAdventure, type AdventureSnake } from '../shared/adventure';
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
    return { actor, state, stored };
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

describe('adventure step authority', () => {
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
