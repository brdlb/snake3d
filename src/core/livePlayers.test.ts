import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { SimPlayer } from '../../shared/simulation';
import {
  advanceLiveOpponent,
  advanceLiveOpponents,
  applyLiveDirectionState,
  findLocalPlayer,
  isLiveOpponent,
} from './livePlayers';

const player = (id: string, entityId: string): SimPlayer => ({
  id,
  entityId,
  name: id,
  segments: [{ x: 5, y: 5, z: 5 }],
  direction: { x: 0, y: 0, z: 1 },
  up: { x: 0, y: 1, z: 0 },
  score: 0,
  speed: 300,
  growth: 0,
  alive: true,
  paused: false,
  color: '#ffffff',
  nextStepAt: 0,
});

describe('live player identity', () => {
  it('recovers the local player by user id after changing rooms', () => {
    const local = player('me', 'new-room-entity');
    const remote = player('other', 'remote-entity');

    expect(findLocalPlayer([local, remote], 'old-room-entity', 'me')).toBe(local);
    expect(isLiveOpponent(local, 'old-room-entity', 'me')).toBe(false);
    expect(isLiveOpponent(remote, 'old-room-entity', 'me')).toBe(true);
  });
});

describe('live opponent movement', () => {
  const opponent = (alive = true) => ({
    alive,
    paused: false,
    speed: 300,
    segments: [
      new THREE.Vector3(5, 5, 5),
      new THREE.Vector3(5, 5, 4),
      new THREE.Vector3(5, 5, 3),
    ],
    direction: new THREE.Quaternion(),
    directionVector: new THREE.Vector3(0, 0, 1),
    up: new THREE.Vector3(0, 1, 0),
    elapsed: 0,
    serverTick: 0,
    replayIndex: 0,
  });
  const orientation = () => new THREE.Quaternion();

  it('advances at the player speed without changing body length', () => {
    const remote = opponent();

    advanceLiveOpponent(remote, 0.2, orientation);

    expect(remote.segments.map(({ x, y, z }) => ({ x, y, z }))).toEqual([
      { x: 5, y: 5, z: 6 },
      { x: 5, y: 5, z: 5 },
      { x: 5, y: 5, z: 4 },
    ]);
    expect(remote.segments).toHaveLength(3);
    expect(remote.serverTick).toBe(1);
  });

  it('does not advance a dead player', () => {
    const remote = opponent(false);

    advanceLiveOpponent(remote, 1, orientation);

    expect(remote.segments[0]).toEqual(new THREE.Vector3(5, 5, 5));
    expect(remote.serverTick).toBe(0);
  });

  it('does not extrapolate a paused player, then resumes normally', () => {
    const remote = opponent();
    remote.paused = true;

    advanceLiveOpponent(remote, 1, orientation);
    expect(remote.segments[0]).toEqual(new THREE.Vector3(5, 5, 5));

    remote.paused = false;
    advanceLiveOpponent(remote, 0.2, orientation);
    expect(remote.segments[0]).toEqual(new THREE.Vector3(5, 5, 6));
  });

  it('advances only unpaused remote opponents in a shared frame', () => {
    const paused = opponent();
    const moving = opponent();
    paused.paused = true;

    advanceLiveOpponents([paused, moving], 0.2, orientation);

    expect(paused.segments[0]).toEqual(new THREE.Vector3(5, 5, 5));
    expect(moving.segments[0]).toEqual(new THREE.Vector3(5, 5, 6));
  });

  it('replaces the complete body on a direction checkpoint before extrapolating', () => {
    const remote = { ...opponent(), serverTime: 0 };

    applyLiveDirectionState(
      remote,
      {
        entityId: 'remote-entity',
        seq: 1,
        step: 7,
        head: { x: 20, y: 5, z: 5 },
        segments: [
          { x: 20, y: 5, z: 5 },
          { x: 19, y: 5, z: 5 },
          { x: 18, y: 5, z: 5 },
        ],
        direction: { x: 1, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
        speed: 300,
        serverTime: 1000,
      },
      orientation,
    );
    advanceLiveOpponent(remote, 0.2, orientation);

    expect(remote.segments.map(({ x, y, z }) => ({ x, y, z }))).toEqual([
      { x: 21, y: 5, z: 5 },
      { x: 20, y: 5, z: 5 },
      { x: 19, y: 5, z: 5 },
    ]);
    expect(remote.serverTick).toBe(8);
  });
});
