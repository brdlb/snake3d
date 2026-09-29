import { describe, expect, it, vi } from 'vitest';
import { chooseSpawn, parseRoomSeed, rankNextRooms, replayReplacementOrder, ROOM_LIST_QUERY, ROOM_REPLAYS_QUERY, RoomDurableObject } from './index';
import { addPlayer, createSimulation } from '../shared/simulation';
import { roomSeed } from '../shared/roomCoordinates';

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
  it('prefers ELO distance, then occupied phantom count', () => {
    const rooms = rankNextRooms([
      { id: 'far', averageElo: 1200, phantomCount: 3 },
      { id: 'less-full', averageElo: 1000, phantomCount: 1 },
      { id: 'full', averageElo: 1000, phantomCount: 3 },
    ], 1000, () => 0.5);
    expect(rooms.map(room => room.id)).toEqual(['full', 'less-full', 'far']);
  });

  it('breaks equal candidates randomly', () => {
    const random = vi.fn().mockReturnValueOnce(0.9).mockReturnValueOnce(0.1);
    const rooms = rankNextRooms([
      { id: 'a', averageElo: 1000, phantomCount: 2 },
      { id: 'b', averageElo: 1000, phantomCount: 2 },
    ], 1000, random);
    expect(random).toHaveBeenCalled();
    expect(new Set(rooms.map(room => room.id))).toEqual(new Set(['a', 'b']));
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

  it('returns the best saved replay for each spawn in a room', () => {
    expect(ROOM_REPLAYS_QUERY).toContain('WHERE room_seed=?');
    expect(ROOM_REPLAYS_QUERY).toContain('PARTITION BY json_extract(payload_json');
    expect(ROOM_REPLAYS_QUERY).toContain('ROW_NUMBER()');
    expect(ROOM_REPLAYS_QUERY).not.toContain('LIMIT 3');
  });

  it('keeps the replay query scoped to a room for authoritative terminal records', () => {
    expect(ROOM_REPLAYS_QUERY).toContain('room_seed=?');
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

  it('prepares phantoms once and reuses them for subsequent realtime messages', async () => {
    const { object, prepare } = room();

    await (object as any).liveState(123);
    expect(prepare).toHaveBeenCalledTimes(2);

    prepare.mockClear();
    await (object as any).liveState(123);

    expect(prepare).not.toHaveBeenCalled();
  });

  it('includes a player replay when restart assigned that player another spawn', async () => {
    const replay = { playerId: 'player-1', startParams: { spawnIndex: 0 } };
    const prepare = vi.fn((query: string) => ({
      bind: () =>
        query === ROOM_REPLAYS_QUERY
          ? { all: vi.fn().mockResolvedValue({ results: [{ payload_json: JSON.stringify(replay) }] }) }
          : { first: vi.fn().mockResolvedValue({ spawn_index: 1 }) },
    }));
    const object = new RoomDurableObject(
      { storage: { get: vi.fn() }, getWebSockets: () => [] } as any,
      { DB: { prepare } } as any,
    );

    const room = await (object as any).roomData(123, { id: 'player-1' }, true);

    expect(room.phantoms).toEqual([replay]);
  });

  it('excludes a replay whose recorded start overlaps the actual player body', async () => {
    const replay = {
      id: 'bad-replay',
      startParams: { spawnIndex: 3, startPosition: { x: 5, y: 5, z: 5 } },
    };
    const prepare = vi.fn((query: string) => ({
      bind: () =>
        query === ROOM_REPLAYS_QUERY
          ? { all: vi.fn().mockResolvedValue({ results: [{ payload_json: JSON.stringify(replay) }] }) }
          : { first: vi.fn().mockResolvedValue({ spawn_index: 0 }) },
    }));
    const object = new RoomDurableObject(
      { storage: { get: vi.fn() }, getWebSockets: () => [] } as any,
      { DB: { prepare } } as any,
    );

    const room = await (object as any).roomData(
      123,
      { id: 'player-1' },
      true,
      undefined,
      [
        { x: 5, y: 5, z: 5 },
        { x: 5, y: 5, z: 4 },
        { x: 5, y: 5, z: 3 },
      ],
    );

    expect(room.phantoms).toEqual([]);
  });

  it('counts the restarting player replay when assigning a free spawn', async () => {
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
    const replays = [0, 1, 2].map((spawnIndex, index) => ({
      playerId: index === 1 ? 'player-1' : `player-${index + 2}`,
      startParams: { spawnIndex },
    }));
    const activeReplays = vi
      .spyOn(object as any, 'activeReplays')
      .mockResolvedValue({ results: replays.map((replay) => ({ payload_json: JSON.stringify(replay) })) });
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

    expect(activeReplays).toHaveBeenCalledWith(123);
    expect(
      statements.find((statement) => statement.query.startsWith('INSERT INTO room_assignments'))
        ?.args[2],
    ).toBe(3);
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
      { storage: { put: vi.fn() }, getWebSockets: () => [] } as any,
      { DB: { prepare, batch: vi.fn(async (batch) => statements.push(...batch)) } } as any,
    );
    vi.spyOn(object as any, 'prepareState').mockResolvedValue(state);
    vi.spyOn(object as any, 'activeReplays').mockResolvedValue({ results: [] });
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
  it('accepts a fresh state sequence after reconnecting a living player', async () => {
    const state = createSimulation(123);
    const player = addPlayer(state, 'player-1', 'Player', 0, {
      entityId: 'entity-1', instanceId: 'old-connection',
    });
    player.lastStateSeq = 12;
    player.lastInputSeq = 8;
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
