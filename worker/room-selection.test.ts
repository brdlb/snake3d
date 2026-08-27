import { describe, expect, it, vi } from 'vitest';
import { chooseSpawn, parseRoomSeed, rankNextRooms, replayReplacementOrder, ROOM_REPLAYS_QUERY, RoomDurableObject } from './index';

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
});
