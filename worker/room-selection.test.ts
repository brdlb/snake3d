import { describe, expect, it, vi } from 'vitest';
import worker, { chooseSpawn, parseRoomSeed, replayReplacementOrder, ROOM_LIST_QUERY, RoomDurableObject } from './index';
import { addPlayer, createSimulation, safeSpawn } from '../shared/simulation';
import { FIRST_ROOM_SEED, roomSeed } from '../shared/roomCoordinates';

describe('portal room transfer', () => {
  const user = {
    id: 'player-1', username: 'PLAYER', settings: { musicVolume: 0.5, sfxVolume: 0.7 },
  };
  const segments = Array.from({ length: 100 }, (_, index) => ({ x: 51 - index, y: 25, z: 25 }));
  const stateInput = {
    segments, direction: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, score: 200, speed: 450,
  };

  it('accepts a level-one opening only for a living assigned snake with 100 segments', async () => {
    const state = createSimulation(roomSeed({ x: 0, y: 0, z: 0 }));
    addPlayer(state, user.id, user.username, Date.now());
    const object = new RoomDurableObject({ storage: {}, getWebSockets: () => [] } as any, {} as any);
    (object as any).simulation = state;
    (object as any).persist = vi.fn();
    const request = (length: number) => new Request('https://room/portal-check', {
      method: 'POST', body: JSON.stringify({ userId: user.id, state: { ...stateInput, segments: segments.slice(0, length) } }),
    });
    expect((await object.fetch(request(99))).status).toBe(409);
    const response = await object.fetch(request(100));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ length: 100 });
  });

  it('creates the destination player with the whole translated body, score and speed', async () => {
    const target = roomSeed({ x: 1, y: 0, z: 0 });
    const state = createSimulation(target);
    const object = new RoomDurableObject({ storage: {}, getWebSockets: () => [] } as any, {} as any);
    (object as any).liveState = vi.fn().mockResolvedValue(state);
    (object as any).persist = vi.fn();
    (object as any).roomData = vi.fn().mockResolvedValue({ seed: target, phantoms: [], playerSpawnIndex: 0 });
    const translated = segments.map((segment) => ({ ...segment, x: segment.x - 51 }));
    const response = await object.fetch(new Request('https://room/portal-enter', {
      method: 'POST', body: JSON.stringify({ user, seed: target, state: { ...stateInput, segments: translated } }),
    }));
    const player = Object.values(state.players).find((item) => item.id === user.id);
    expect(response.status).toBe(200);
    expect(player?.segments).toEqual(translated);
    expect(player?.score).toBe(200);
    expect(player?.speed).toBe(450);
    expect(state.trajectories?.[user.id].startSegments).toEqual(translated);
  });
});

describe('room selection rules', () => {
  it('accepts only a safe integer invitation seed', () => {
    expect(parseRoomSeed('123')).toBe(123);
    expect(parseRoomSeed('-1')).toBeNull();
    expect(parseRoomSeed('12.2')).toBeNull();
    expect(parseRoomSeed('9007199254740992')).toBeNull();
  });
  it('sends every default entrant to the first cube without checking room occupancy', async () => {
    const player = {
      id: 'player-1', username: 'PLAYER', created_at: '', last_seen: '', high_score: 0,
      games_played: 0, total_score: 0, elo: 1000, settings_json: '{}',
    };
    const insert = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
    const prepare = vi.fn(() => ({
      bind: vi.fn(() => ({ first: vi.fn().mockResolvedValue(player), run: insert })),
    }));
    const env = { DB: { prepare }, ROOMS: { get: vi.fn() } } as any;
    for (const token of ['first', 'second']) {
      const response = await worker.fetch(new Request('https://snake.example/api/v1/rooms/enter', {
        headers: { cookie: `snake3d_session=${token}` },
      }), env);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ seed: FIRST_ROOM_SEED });
    }
    expect(insert).toHaveBeenCalledTimes(2);
    expect(env.ROOMS.get).not.toHaveBeenCalled();
  });

  it('uses a free spawn and otherwise evicts the lowest-score phantom spawn', () => {
    expect(chooseSpawn([{ elo: 1000, startParams: { spawnIndex: 0 } }])).toBeGreaterThanOrEqual(1);
    expect(chooseSpawn([
      { elo: 1200, score: 120, startParams: { spawnIndex: 0 } },
      { elo: 700, score: 700, startParams: { spawnIndex: 1 } },
      { elo: 1100, score: 110, startParams: { spawnIndex: 2 } },
      { elo: 900, score: 900, startParams: { spawnIndex: 3 } },
    ])).toBe(2);
  });

  it('moves restart to another free spawn when one exists', () => {
    expect(chooseSpawn([
      { elo: 1000, startParams: { spawnIndex: 2 } },
      { elo: 1000, startParams: { spawnIndex: 3 } },
    ], 0)).toBe(1);
  });

  it('replaces the lowest-score spawn when every spawn is occupied', () => {
    expect(chooseSpawn([
      { elo: 700, score: 700, startParams: { spawnIndex: 0 } },
      { elo: 1200, score: 1200, startParams: { spawnIndex: 1 } },
      { elo: 1100, score: 1100, startParams: { spawnIndex: 2 } },
      { elo: 1000, score: 1000, startParams: { spawnIndex: 3 } },
    ], 0)).toBe(0);
  });

  it('keeps earlier player replays and replaces only the room minimum at capacity', () => {
    expect(replayReplacementOrder(true, false)).toEqual(['insertReplay']);
    expect(replayReplacementOrder(true, true)).toEqual(['deleteRoomMinimum', 'insertReplay']);
  });

  it('lists room play counts and the best score for every spawn', () => {
    expect(ROOM_LIST_QUERY).toContain('r.total_games_played AS gamesPlayed');
    expect(ROOM_LIST_QUERY).toContain('room_spawn_records');
    expect(ROOM_LIST_QUERY.match(/MAX\(CASE/g)).toHaveLength(4);
    expect(ROOM_LIST_QUERY).toContain('GROUP BY r.seed');
  });
});

describe('room state preparation', () => {
  function room() {
    const storage = { get: vi.fn().mockResolvedValue(null) };
    const all = vi.fn().mockResolvedValue({ results: [] });
    const prepare = vi.fn().mockReturnValue({ bind: () => ({ all }) });
    const object = new RoomDurableObject({ storage, getWebSockets: () => [] } as any, { DB: { prepare } } as any);
    return { object, prepare, storage };
  }

  it('loads a realtime state from Durable Object storage without D1', async () => {
    const { object, prepare, storage } = room();

    await (object as any).loadState(123);

    expect(storage.get).toHaveBeenCalledWith('simulation');
    expect(prepare).not.toHaveBeenCalled();
  });

  it('removes replay phantoms from a saved room while keeping live players', async () => {
    const state = createSimulation(123);
    addPlayer(state, 'player-1', 'PLAYER', Date.now());
    addPlayer(state, 'phantom:old-replay', 'PHANTOM', 0, { phantom: true });
    const storage = { get: vi.fn().mockResolvedValue(state) };
    const prepare = vi.fn();
    const object = new RoomDurableObject(
      { storage, getWebSockets: () => [] } as any,
      { DB: { prepare } } as any,
    );

    const loaded = await (object as any).liveState(123);

    expect(Object.values(loaded.players).map((player: any) => player.id)).toEqual(['player-1']);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('keeps realtime state free of replay reads', async () => {
    const { object, prepare } = room();

    await (object as any).liveState(123);
    await (object as any).liveState(123);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('returns no replay phantoms in room data', async () => {
    const { object, prepare } = room();
    prepare.mockReturnValue({ bind: () => ({ first: vi.fn().mockResolvedValue({ spawn_index: 0 }) }) });
    const data = await (object as any).roomData(123, { id: 'player-1' });
    expect(data.phantoms).toEqual([]);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('assigns restart without loading saved replays', async () => {
    const statements: Array<{ query: string; args: unknown[] }> = [];
    const prepare = vi.fn((query: string) => ({
      bind: (...args: unknown[]) =>
        query === 'SELECT room_seed,spawn_index FROM room_assignments WHERE user_id=?'
          ? { first: vi.fn().mockResolvedValue({ room_seed: 123, spawn_index: 1 }) }
          : { query, args },
    }));
    const object = new RoomDurableObject(
      { storage: { get: vi.fn() }, getWebSockets: () => [] } as any,
      { DB: { prepare, batch: vi.fn(async (batch) => statements.push(...batch)) } } as any,
    );
    vi.spyOn(object as any, 'roomData').mockResolvedValue({
      seed: 123,
      phantoms: [],
      playerSpawnIndex: 3,
    });

    await (object as any).assign({
      action: 'restart',
      contextSeed: 123,
      user: { id: 'player-1', username: 'Player', elo: 1000 },
    });

    expect(prepare).not.toHaveBeenCalledWith(expect.stringContaining('FROM replays'));
    expect(
      statements.find((statement) => statement.query.startsWith('INSERT INTO room_assignments'))
        ?.args[2],
    ).not.toBe(1);
  });

  it('persists the actual safe spawn selected around a live player', async () => {
    const state = createSimulation(123);
    addPlayer(state, 'online-player', 'Online', 0, { spawnIndex: 0 });
    const statements: Array<{ query: string; args: unknown[] }> = [];
    const prepare = vi.fn((query: string) => ({
      bind: (...args: unknown[]) =>
        query === 'SELECT 1 FROM rooms WHERE seed=?'
          ? { first: vi.fn().mockResolvedValue({ 1: 1 }) }
          : { query, args },
    }));
    const object = new RoomDurableObject(
      { storage: { put: vi.fn(), setAlarm: vi.fn() }, getWebSockets: () => [] } as any,
      { DB: { prepare, batch: vi.fn(async (batch) => statements.push(...batch)) } } as any,
    );
    vi.spyOn(object as any, 'prepareState').mockResolvedValue(state);
    vi.spyOn(object as any, 'roomData').mockImplementation(async () => {
      const player = Object.values(state.players).find((candidate) => candidate.id === 'joining-player');
      return { seed: 123, phantoms: [], playerSpawnIndex: player?.spawnIndex };
    });
    vi.spyOn(Math, 'random').mockReturnValueOnce(0);

    const response = await (object as any).join({
      seed: 123,
      user: { id: 'joining-player', username: 'Joining', elo: 1000 },
    });

    expect(await response.json()).toMatchObject({ playerSpawnIndex: 1 });
    expect(
      statements.find((statement) => statement.query.startsWith('INSERT INTO room_assignments'))
        ?.args[2],
    ).toBe(1);
  });

  it('requests one state sync from players when spectators arrive together', () => {
    const playerSend = vi.fn();
    const spectatorSend = vi.fn();
    const playerSocket = {
      deserializeAttachment: () => ({ spectator: false }),
      send: playerSend,
      close: vi.fn(),
    };
    const spectatorSocket = {
      deserializeAttachment: () => ({ spectator: true }),
      send: spectatorSend,
      close: vi.fn(),
    };
    const object = new RoomDurableObject(
      { getWebSockets: () => [playerSocket, spectatorSocket] } as any,
      {} as any,
    );
    vi.spyOn(Date, 'now').mockReturnValue(1000);

    (object as any).requestSpectatorSync();
    (object as any).requestSpectatorSync();

    expect(playerSend).toHaveBeenCalledTimes(1);
    expect(JSON.parse(playerSend.mock.calls[0][0])).toMatchObject({
      v: 2,
      type: 'room.syncRequested',
      payload: { requestId: expect.any(String) },
    });
    expect(spectatorSend).not.toHaveBeenCalled();
  });

  it('persists and broadcasts a spectator sync state', async () => {
    const state = createSimulation(123);
    const player = addPlayer(state, 'player-1', 'Player', 0, {
      entityId: 'entity-1',
      instanceId: 'connection-1',
    });
    const sender = {
      deserializeAttachment: () => ({
        userId: 'player-1',
        entityId: 'entity-1',
        seed: 123,
        instanceId: 'connection-1',
      }),
      send: vi.fn(),
      close: vi.fn(),
    };
    const spectator = {
      deserializeAttachment: () => ({ spectator: true }),
      send: vi.fn(),
      close: vi.fn(),
    };
    const storage = { put: vi.fn(), deleteAlarm: vi.fn() };
    const object = new RoomDurableObject(
      { storage, getWebSockets: () => [sender, spectator] } as any,
      {} as any,
    );
    (object as any).simulation = state;
    const segments = [
      { x: 10, y: 10, z: 10 },
      { x: 10, y: 10, z: 9 },
      { x: 10, y: 10, z: 8 },
    ];

    await object.webSocketMessage(
      sender as any,
      JSON.stringify({
        v: 2,
        type: 'player.state',
        payload: {
          action: {
            type: 'state',
            seq: 1,
            step: 5,
            reason: 'spectator-sync',
            segments,
            direction: { x: 0, y: 0, z: 1 },
            up: { x: 0, y: 1, z: 0 },
            score: 0,
            speed: 300,
          },
        },
      }),
    );

    expect(player.segments).toEqual(segments);
    expect(storage.put).toHaveBeenCalledWith('simulation', state);
    expect(JSON.parse(spectator.send.mock.calls[0][0])).toMatchObject({
      type: 'player.state',
      payload: { entityId: 'entity-1', segments, reason: 'spectator-sync' },
    });
  });

  it('persists and broadcasts a pause checkpoint without changing replay trajectory', async () => {
    const state = createSimulation(123);
    const player = addPlayer(state, 'player-1', 'Player', 0, {
      entityId: 'entity-1',
      instanceId: 'connection-1',
    });
    state.trajectories = {
      'player-1': {
        startPosition: { ...player.segments[0] },
        startDirection: { ...player.direction },
        spawnIndex: 0,
        initialSpeed: player.speed,
        changes: [],
      },
    };
    const sender = {
      deserializeAttachment: () => ({
        userId: 'player-1', entityId: 'entity-1', seed: 123, instanceId: 'connection-1',
      }),
      send: vi.fn(), close: vi.fn(),
    };
    const peer = { deserializeAttachment: () => ({}), send: vi.fn(), close: vi.fn() };
    const storage = { put: vi.fn(), deleteAlarm: vi.fn() };
    const object = new RoomDurableObject({ storage, getWebSockets: () => [sender, peer] } as any, {} as any);
    (object as any).simulation = state;

    const pause = (seq: number, paused: unknown) => JSON.stringify({
      v: 2,
      type: 'player.pauseChanged',
      payload: { action: {
        type: 'pause', seq, step: 5, paused,
        segments: player.segments, direction: player.direction, up: player.up,
        score: player.score, speed: player.speed,
      } },
    });
    await object.webSocketMessage(sender as any, pause(1, true));
    await object.webSocketMessage(sender as any, pause(1, false));
    await object.webSocketMessage(sender as any, pause(2, 'invalid'));

    expect(player.paused).toBe(true);
    expect(state.trajectories['player-1'].changes).toEqual([]);
    expect(storage.put).toHaveBeenCalledWith('simulation', state);
    expect(JSON.parse(peer.send.mock.calls[0][0])).toMatchObject({
      type: 'player.pauseChanged', payload: { entityId: 'entity-1', paused: true, seq: 1 },
    });
    expect(JSON.parse(sender.send.mock.calls[0][0])).toMatchObject({
      type: 'error', payload: { code: 'INVALID_MESSAGE' },
    });
    expect((object as any).snapshot(state).players[0].paused).toBe(true);
  });

  it('rejects invalid direction segments and ignores an old sequence', async () => {
    const state = createSimulation(123);
    const player = addPlayer(state, 'player-1', 'Player', 0, {
      entityId: 'entity-1',
      instanceId: 'connection-1',
    });
    player.lastInputSeq = 2;
    const sender = {
      deserializeAttachment: () => ({
        userId: 'player-1',
        entityId: 'entity-1',
        seed: 123,
        instanceId: 'connection-1',
      }),
      send: vi.fn(),
      close: vi.fn(),
    };
    const storage = { put: vi.fn(), deleteAlarm: vi.fn() };
    const object = new RoomDurableObject(
      { storage, getWebSockets: () => [sender] } as any,
      {} as any,
    );
    (object as any).simulation = state;
    const message = (seq: number, segments: unknown) =>
      JSON.stringify({
        v: 2,
        type: 'player.directionChanged',
        payload: {
          action: {
            type: 'direction',
            seq,
            step: 5,
            head: { x: 5, y: 5, z: 5 },
            segments,
            direction: { x: 1, y: 0, z: 0 },
            up: { x: 0, y: 1, z: 0 },
          },
        },
      });

    await object.webSocketMessage(sender as any, message(3, []));
    await object.webSocketMessage(sender as any, message(2, player.segments));

    expect(JSON.parse(sender.send.mock.calls[0][0])).toMatchObject({
      type: 'error',
      payload: { code: 'INVALID_MESSAGE' },
    });
    expect(player.lastInputSeq).toBe(2);
    expect(storage.put).not.toHaveBeenCalled();
  });
});

describe('live player encounters', () => {
  it('records one meeting per connected pair and ignores spectators and phantoms', async () => {
    const state = createSimulation(123);
    addPlayer(state, 'peer', 'Peer', 0, { entityId: 'peer-entity' });
    const records = new Map<string, unknown>();
    const storage = {
      get: vi.fn(async (key: string) => records.get(key)),
      put: vi.fn(async (key: string, value: unknown) => { records.set(key, value); }),
    };
    const run = vi.fn(async () => ({}));
    const prepare = vi.fn(() => ({ bind: () => ({ run }) }));
    const sockets = [
      { deserializeAttachment: () => ({ userId: 'peer', spectator: false }) },
      { deserializeAttachment: () => ({ userId: 'watcher', spectator: true }) },
    ];
    const object = new RoomDurableObject(
      { storage, getWebSockets: () => sockets } as any,
      { DB: { prepare } } as any,
    );
    await (object as any).recordLiveEncounters(123, 'visitor', state);
    await (object as any).recordLiveEncounters(123, 'visitor', state);
    expect(run).toHaveBeenCalledTimes(1);
    expect(records.has('encounter:peer:visitor')).toBe(true);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO live_player_encounters'));
  });
});

describe('terminal save diagnostics', () => {
  it('frees all spawns occupied by legacy HTTP joins without socket metadata', async () => {
    const state = createSimulation(123);
    for (let spawnIndex = 0; spawnIndex < 4; spawnIndex++)
      addPlayer(state, `legacy-${spawnIndex}`, 'LEGACY', Date.now() - 60000, { spawnIndex });
    const object = new RoomDurableObject({
      storage: { get: vi.fn().mockResolvedValue(state) }, getWebSockets: () => [],
    } as any, {} as any);
    const loaded = await (object as any).loadState(123);
    expect(Object.keys(loaded.players)).toHaveLength(0);
    expect(safeSpawn(loaded, undefined, 0).safe).toBe(true);
    addPlayer(loaded, 'fresh', 'FRESH', Date.now());
    expect(Object.keys((await (object as any).loadState(123)).players)).toHaveLength(1);
  });

  it('removes orphaned persisted sockets but preserves connected players and pending joins', async () => {
    const state = createSimulation(123);
    addPlayer(state, 'orphan', 'ORPHAN', 0, { instanceId: 'lost' });
    addPlayer(state, 'online', 'ONLINE', 0, { instanceId: 'active' });
    addPlayer(state, 'pending', 'PENDING', 0).disconnectedAt = Date.now() + 15000;
    addPlayer(state, 'expired', 'EXPIRED', 0).disconnectedAt = Date.now() - 1;
    const object = new RoomDurableObject({
      storage: { get: vi.fn().mockResolvedValue(state) },
      getWebSockets: () => [{ deserializeAttachment: () => ({ instanceId: 'active' }) }],
    } as any, {} as any);
    const loaded = await (object as any).loadState(123);
    expect(Object.values(loaded.players).map((player: any) => player.id).sort()).toEqual(['online', 'pending']);
  });

  it('rejects a socket spawn when all spawn paths are occupied', async () => {
    const state = createSimulation(123);
    for (let spawnIndex = 0; spawnIndex < 4; spawnIndex++)
      addPlayer(state, `peer-${spawnIndex}`, 'PEER', Date.now(), { spawnIndex });
    vi.stubGlobal('WebSocketPair', class { 0 = {}; 1 = {}; });
    try {
      const object = new RoomDurableObject({ getWebSockets: () => [] } as any, {
        DB: { prepare: () => ({ bind: () => ({ first: async () => ({ spawn_index: 0 }) }) }) },
      } as any);
      (object as any).simulation = state;
      const response = await (object as any).socket(new Request('https://room/socket', {
        headers: { upgrade: 'websocket', 'x-user': JSON.stringify({ id: 'visitor', username: 'VISITOR' }), 'x-seed': '123' },
      }));
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: { code: 'ROOM_FULL' } });
      expect(Object.values(state.players)).toHaveLength(4);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('accepts a fresh state sequence after reconnecting a living player', async () => {
    const state = createSimulation(123);
    const player = addPlayer(state, 'player-1', 'Player', 0, {
      entityId: 'entity-1', instanceId: 'old-connection',
    });
    player.lastStateSeq = 12;
    player.lastInputSeq = 8;
    player.disconnectedAt = Date.now() + 15000;
    const server = {
      serializeAttachment: vi.fn(), send: vi.fn(),
    };
    vi.stubGlobal('WebSocketPair', class {
      0 = {};
      1 = server;
    });
    const NativeResponse = Response;
    vi.stubGlobal('Response', class {
      constructor(_body: unknown, public init: ResponseInit) {}
    });
    try {
      const storage = { put: vi.fn(), deleteAlarm: vi.fn() };
      const object = new RoomDurableObject({
        storage, acceptWebSocket: vi.fn(), getWebSockets: () => [],
      } as any, { DB: { prepare: () => ({ bind: () => ({ first: async () => ({ spawn_index: 0 }) }) }) } } as any);
      (object as any).simulation = state;
      await (object as any).socket(new Request('https://room/socket', {
        headers: { upgrade: 'websocket', 'x-user': JSON.stringify({ id: 'player-1', username: 'Player' }), 'x-seed': '123' },
      }));
      expect(player.lastStateSeq).toBeUndefined();
      expect(player.lastInputSeq).toBeUndefined();
      expect(player.instanceId).not.toBe('old-connection');
      expect(storage.put).toHaveBeenCalledWith('simulation', state);
    } finally {
      vi.stubGlobal('Response', NativeResponse);
      vi.unstubAllGlobals();
    }
  });

  function setup() {
    const state = createSimulation(123);
    const player = addPlayer(state, 'player-1', 'Player', 0, {
      entityId: 'entity-1', instanceId: 'connection-1',
    });
    state.trajectories = { 'player-1': {
      startPosition: player.segments[0], startDirection: player.direction,
      spawnIndex: 0, initialSpeed: player.speed, changes: [],
    } };
    const records = new Map<string, any>();
    const storage = {
      get: vi.fn(async (key: string) => records.get(key)),
      put: vi.fn(async (key: string, value: any) => { records.set(key, value); }),
      deleteAlarm: vi.fn(),
    };
    const sender = {
      deserializeAttachment: () => ({ userId: 'player-1', entityId: 'entity-1', seed: 123, instanceId: 'connection-1' }),
      send: vi.fn(), close: vi.fn(),
    };
    const object = new RoomDurableObject({ storage, getWebSockets: () => [sender] } as any, {} as any);
    (object as any).simulation = state;
    const submit = (seq: number) => object.webSocketMessage(sender as any, JSON.stringify({
      v: 2, type: 'player.died', payload: { action: {
        type: 'death', submissionId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', seq, step: 3, reason: 'bounds',
        segments: player.segments, direction: player.direction, up: player.up,
        score: 45, speed: player.speed,
      } },
    }));
    return { state, player, sender, object, records, submit };
  }

  it('returns an explicit failure for a stale death sequence', async () => {
    const { player, sender, submit } = setup();
    player.lastStateSeq = 5;
    await submit(5);
    expect(JSON.parse(sender.send.mock.lastCall![0])).toMatchObject({
      type: 'game.saveFailed', payload: { code: 'STALE_DEATH_SEQUENCE', retryable: false },
    });
  });

  it('identifies a death sent through a spectator socket', async () => {
    const { sender, submit } = setup();
    sender.deserializeAttachment = () => ({
      userId: 'player-1', entityId: 'entity-1', seed: 123, instanceId: 'connection-1', spectator: true,
    });
    await submit(1);
    expect(JSON.parse(sender.send.mock.lastCall![0])).toMatchObject({
      type: 'game.saveFailed', payload: { code: 'SPECTATOR_CANNOT_SAVE', retryable: false },
    });
  });

  it('records a terminal and allows an idempotent retry after a save failure', async () => {
    const { player, sender, object, records, submit } = setup();
    const save = vi.fn().mockRejectedValueOnce(new Error('D1 unavailable'))
      .mockResolvedValue({ saved: true, message: 'Game and replay saved' });
    (object as any).saveTerminal = save;
    await submit(1);
    expect(player.alive).toBe(false);
    expect(records.get('save-trace:player-1')).toMatchObject({ stage: 'failed', code: 'SAVE_FAILED' });
    expect(JSON.parse(sender.send.mock.lastCall![0])).toMatchObject({
      type: 'game.saveFailed', payload: { retryable: true },
    });
    await submit(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0][1]).toBe(save.mock.calls[1][1]);
    expect(records.get('save-trace:player-1')).toMatchObject({ stage: 'saved' });
    expect(JSON.parse(sender.send.mock.lastCall![0])).toMatchObject({
      type: 'game.saved', payload: { saved: true, submissionId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' },
    });
  });

  it('reports roster, terminal, and latest save stage without exposing the trajectory', async () => {
    const { object, records, player } = setup();
    records.set('terminal:player-1', { player, createdAt: 12345, trajectory: { changes: [{ secret: true }] } });
    records.set('save-trace:player-1', { stage: 'failed', code: 'SAVE_FAILED', submissionId: 'attempt-1' });
    const response = await object.fetch(new Request('https://room/diagnostics', {
      headers: { 'x-user-id': 'player-1', 'x-seed': '123' },
    }));
    const result = await response.json() as any;
    expect(result.players).toMatchObject([{ entityId: 'entity-1', alive: true, connected: true }]);
    expect(result.terminal).toMatchObject({ score: player.score, createdAt: 12345 });
    expect(result.save).toMatchObject({ stage: 'failed', code: 'SAVE_FAILED' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});
