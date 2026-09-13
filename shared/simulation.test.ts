import { describe, expect, it } from 'vitest';
import { addPlayer, advanceSimulation, chooseLowestPhantom, createSimulation, safeSpawn, stepSimulation, validInput, validOrientation } from './simulation';

describe('live room simulation', () => {
  it('chooses an unoccupied dynamic spawn', () => {
    const state = createSimulation(42);
    addPlayer(state, 'a', 'A', 0, { spawnIndex: 0 });
    const spawn = safeSpawn(state, () => .5, 0);
    expect(Object.values(state.players).find(player => player.id === 'a')?.segments.some(p => p.x === spawn.position.x && p.y === spawn.position.y && p.z === spawn.position.z)).toBe(false);
    expect(spawn).toMatchObject({ spawnIndex: 1, safe: true });
  });

  it('reports when every room spawn is occupied instead of silently overlapping it', () => {
    const state = createSimulation(43);
    for (let spawnIndex = 0; spawnIndex < 4; spawnIndex++)
      addPlayer(state, `player-${spawnIndex}`, `Player ${spawnIndex}`, 0, { spawnIndex });

    expect(safeSpawn(state, undefined, 2)).toMatchObject({ spawnIndex: 2, safe: false });
  });

  it('rejects diagonal and immediate reverse input', () => {
    expect(validInput({ x: 0, y: 0, z: -1 }, { x: 1, y: 0, z: 0 })).toBe(true);
    expect(validInput({ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 })).toBe(false);
    expect(validInput({ x: 0, y: 0, z: -1 }, { x: 1, y: 1, z: 0 })).toBe(false);
  });

  it('accepts only orthogonal unit direction and up vectors', () => {
    expect(validOrientation({ x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 })).toBe(true);
    expect(validOrientation({ x: 0, y: 0, z: -1 }, { x: 1, y: 1, z: 0 })).toBe(false);
    expect(validOrientation({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBe(false);
  });

  it('simulates food and collision only on the server state', () => {
    const state = createSimulation(1);
    const p = addPlayer(state, 'a', 'A', 0, { segments: [{ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 2 }, { x: 1, y: 1, z: 3 }], direction: { x: 1, y: 0, z: 0 } });
    state.food = [{ x: 2, y: 1, z: 1, kind: 'green' }];
    expect(stepSimulation(state, 250)).toBe(true);
    expect(p.score).toBe(5);
    p.direction = { x: -1, y: 0, z: 0 };
    p.nextStepAt = 0;
    stepSimulation(state, 500);
    expect(p.alive).toBe(false);
  });

  it('evicts the lowest scoring phantom only', () => {
    const state = createSimulation(2);
    const live = addPlayer(state, 'live', 'Live', 0, { score: 0 });
    const weak = addPlayer(state, 'weak', 'Weak', 0, { phantom: true, score: 2 });
    addPlayer(state, 'strong', 'Strong', 0, { phantom: true, score: 9 });
    expect(chooseLowestPhantom(Object.values(state.players))).toBe(weak);
    expect(chooseLowestPhantom([live])).toBeUndefined();
  });

  it('assigns a distinct entity id to every spawned entity', () => {
    const state = createSimulation(8);
    const player = addPlayer(state, 'same-user', 'Player', 0);
    const phantom = addPlayer(state, 'phantom:replay', 'Phantom', 0, { phantom: true });
    expect(player.entityId).not.toBe(phantom.entityId);
  });

  it('keeps multiple room entities with the same user id', () => {
    const state = createSimulation(81);
    const first = addPlayer(state, 'same-user', 'Player', 0);
    const second = addPlayer(state, 'same-user', 'Player', 0, { phantom: true });
    expect(first.entityId).not.toBe(second.entityId);
    expect(Object.values(state.players)).toHaveLength(2);
  });

  it('restores a phantom at its recorded start position', () => {
    const state = createSimulation(9);
    const phantom = addPlayer(state, 'phantom:replay', 'Phantom', 0, {
      phantom: true,
      spawnIndex: 3,
      startPosition: { x: 17, y: 18, z: 19 },
      direction: { x: 0, y: 0, z: -1 },
    });
    expect(phantom.segments[0]).toEqual({ x: 17, y: 18, z: 19 });
  });

  it('kills a snake at a wall and records the authoritative reason', () => {
    const state = createSimulation(3);
    const player = addPlayer(state, 'a', 'A', 0, { segments: [{ x: 50, y: 1, z: 1 }, { x: 49, y: 1, z: 1 }], direction: { x: 1, y: 0, z: 0 } });
    player.nextStepAt = 1;
    const [delta] = advanceSimulation(state, 1);
    expect(delta.deaths).toMatchObject([{ player: { id: 'a' }, reason: 'bounds', position: { x: 51, y: 1, z: 1 } }]);
  });

  it('keeps advancing an out-of-bounds snake when death is client-confirmed', () => {
    const state = createSimulation(3);
    const player = addPlayer(state, 'a', 'A', 0, { segments: [{ x: 50, y: 1, z: 1 }, { x: 49, y: 1, z: 1 }], direction: { x: 1, y: 0, z: 0 } });
    player.nextStepAt = 1;
    const [delta] = advanceSimulation(state, 1, false);
    expect(delta.deaths).toHaveLength(0);
    expect(player.alive).toBe(true);
    expect(player.segments[0]).toEqual({ x: 51, y: 1, z: 1 });
  });

  it('handles self and opponent body collisions, but permits a vacating tail', () => {
    const state = createSimulation(4);
    const self = addPlayer(state, 'self', 'Self', 0, { segments: [{x:2,y:2,z:2},{x:2,y:2,z:3},{x:1,y:2,z:3},{x:1,y:2,z:2}], direction: {x:0,y:0,z:1} });
    const other = addPlayer(state, 'other', 'Other', 0, { segments: [{x:10,y:10,z:10},{x:9,y:10,z:10}], direction: {x:-1,y:0,z:0} });
    self.nextStepAt = other.nextStepAt = 1;
    const [first] = advanceSimulation(state, 1);
    expect(first.deaths.map(death => death.player.id)).toContain('self');
    expect(other.alive).toBe(true);
    const tailState = createSimulation(5);
    const mover = addPlayer(tailState, 'm', 'M', 0, { segments: [{x:1,y:1,z:1},{x:1,y:1,z:2}], direction: {x:1,y:0,z:0} });
    const tailOwner = addPlayer(tailState, 't', 'T', 0, { segments: [{x:3,y:1,z:1},{x:2,y:1,z:1}], direction: {x:1,y:0,z:0} });
    mover.nextStepAt = tailOwner.nextStepAt = 1;
    advanceSimulation(tailState, 1);
    expect(mover.alive).toBe(true);
    expect(mover.segments[0]).toEqual({x:2,y:1,z:1});
  });

  it('kills both snakes that reach the same cell in one atomic tick', () => {
    const state = createSimulation(6);
    const a = addPlayer(state, 'a', 'A', 0, { segments: [{x:1,y:1,z:1},{x:0,y:1,z:1}], direction: {x:1,y:0,z:0} });
    const b = addPlayer(state, 'b', 'B', 0, { segments: [{x:3,y:1,z:1},{x:4,y:1,z:1}], direction: {x:-1,y:0,z:0} });
    a.nextStepAt = b.nextStepAt = 1;
    const [delta] = advanceSimulation(state, 1);
    expect(delta.deaths).toHaveLength(2);
    expect(delta.deaths.every(death => death.reason === 'head-to-head')).toBe(true);
  });

  it('returns food replacement and changed player state from the same tick', () => {
    const state = createSimulation(7);
    const p = addPlayer(state, 'a', 'A', 0, { segments: [{x:1,y:1,z:1},{x:0,y:1,z:1}], direction: {x:1,y:0,z:0} });
    state.food = [{x:2,y:1,z:1,kind:'blue'}]; p.nextStepAt = 1;
    const [delta] = advanceSimulation(state, 1);
    expect(delta.food).toHaveLength(1);
    expect(delta.changed[0]).toMatchObject({ id: 'a', score: 15, speed: 310, alive: true });
    expect(delta.food[0]).toMatchObject({ entityId: p.entityId, score: 15, speed: 310, length: 3 });
  });
});
