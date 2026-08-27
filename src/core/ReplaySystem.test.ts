import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ReplayPlayer } from './ReplaySystem';
import { Phantom } from '../entities/Phantom';
import type { ReplayData } from '../types/replay';

describe('ReplayPlayer', () => {
  it('uses safe defaults for legacy replays without start parameters', () => {
    const legacyReplay = {
      id: 'legacy-replay',
      playerId: 'player-1',
      playerName: 'Player',
      timestamp: 0,
      finalScore: 10,
      deathPosition: { x: 1, y: 1, z: 1 },
      trajectoryLog: [],
    } as unknown as ReplayData;

    const player = new ReplayPlayer(legacyReplay);

    expect(player.getInitialSpeed()).toBe(300);
    expect(player.startParams.spawnIndex).toBe(0);
  });

  it('starts at the recorded position and follows each recorded turn', () => {
    const replay: ReplayData = {
      id: 'recorded-replay',
      playerId: 'player-1',
      playerName: 'Player',
      timestamp: 0,
      finalScore: 10,
      startParams: {
        seed: 1,
        spawnIndex: 2,
        initialSpeed: 300,
        startPosition: { x: 10, y: 5, z: 10 },
        startDirection: { x: 1, y: 0, z: 0 },
      },
      deathPosition: { x: 11, y: 5, z: 11 },
      trajectoryLog: [{ position: { x: 11, y: 5, z: 10 }, direction: { x: 0, y: 0, z: 1 } }],
    };
    const phantom = new Phantom(replay);

    expect(phantom.getHead()).toEqual(new THREE.Vector3(10, 5, 10));
    expect(phantom.getMoveDirection()).toEqual(new THREE.Vector3(1, 0, 0));
    phantom.update(0.2);
    phantom.update(0.2);
    expect(phantom.getHead()).toEqual(new THREE.Vector3(11, 5, 11));
    expect(phantom.getMoveDirection()).toEqual(new THREE.Vector3(0, 0, 1));
  });
});
