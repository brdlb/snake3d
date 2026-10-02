import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ReplayPlayer } from './ReplaySystem';
import { Phantom } from '../entities/Phantom';
import type { ReplayData } from '../types/replay';
import { newAdventure, type AdventureSnake } from '../../shared/adventure';

describe('ReplayPlayer', () => {
  it('replays authoritative transformations, growth, resources and segment coatings', () => {
    const initial: AdventureSnake = { segments: [{x:5,y:5,z:5},{x:4,y:5,z:5},{x:3,y:5,z:5}], direction: {x:1,y:0,z:0}, up: {x:0,y:1,z:0}, score: 10, speed: 300, growth: 2, adventure: newAdventure(3,300) };
    const next: AdventureSnake = { ...initial, segments: [{x:6,y:5,z:5},{x:5,y:5,z:5},{x:4,y:5,z:5},{x:3,y:5,z:5}], score: 20, speed: 450, growth: 1, adventure: { ...initial.adventure, charge: 2, coatings: ['CONDUCTIVE','NORMAL','INSULATED','NORMAL'] } };
    const phantom = new Phantom({ id:'adventure-replay',playerId:'player',playerName:'PLAYER',timestamp:0,finalScore:20,deathPosition:{x:40,y:5,z:5},trajectoryLog:[],startParams:{seed:1,spawnIndex:0,initialSpeed:300,startPosition:initial.segments[0],startDirection:initial.direction,startSegments:initial.segments,initialGrowth:2,initialScore:10,initialAdventure:initial.adventure,adventureVersion:1},adventureEvents:[{step:1,snake:next}] });
    expect(phantom.update(0.2)).toBe(true);
    expect(phantom.segments).toHaveLength(4);
    expect(phantom.getSPM()).toBe(450);
    expect(phantom.adventure?.charge).toBe(2);
    expect(phantom.adventure?.coatings).toEqual(next.adventure.coatings);
  });
  it('restores the full body of a replay that began after portal travel', () => {
    const segments = Array.from({ length: 100 }, (_, index) => ({ x: index === 0 ? 0 : -index, y: 25, z: 25 }));
    const replay: ReplayData = {
      id: 'portal-replay', playerId: 'player-1', playerName: 'PLAYER', timestamp: 0,
      finalScore: 200, deathPosition: { x: 1, y: 25, z: 25 }, trajectoryLog: [],
      startParams: { seed: 1, spawnIndex: 0, initialSpeed: 450,
        startPosition: segments[0], startDirection: { x: 1, y: 0, z: 0 }, startSegments: segments },
    };
    const phantom = new Phantom(replay);
    expect(phantom.segments).toHaveLength(100);
    expect(phantom.segments[99]).toEqual(new THREE.Vector3(-99, 25, 25));
  });

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
