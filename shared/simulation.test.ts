import { describe, expect, it } from 'vitest';
import { addPlayer, chooseLowestPhantom, createSimulation, safeSpawn, stepSimulation, validInput } from './simulation';

describe('live room simulation', () => {
  it('chooses an unoccupied dynamic spawn', () => {
    const state = createSimulation(42);
    addPlayer(state, 'a', 'A', 0);
    const spawn = safeSpawn(state, () => .5);
    expect(state.players.a.segments.some(p => p.x === spawn.position.x && p.y === spawn.position.y && p.z === spawn.position.z)).toBe(false);
  });

  it('rejects diagonal and immediate reverse input', () => {
    expect(validInput({ x: 0, y: 0, z: -1 }, { x: 1, y: 0, z: 0 })).toBe(true);
    expect(validInput({ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 })).toBe(false);
    expect(validInput({ x: 0, y: 0, z: -1 }, { x: 1, y: 1, z: 0 })).toBe(false);
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
});
