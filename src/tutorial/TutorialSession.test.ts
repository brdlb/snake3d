import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TutorialSession } from './TutorialSession';

describe('TutorialSession', () => {
  it('builds positions from direction and up', () => {
    const session = new TutorialSession(
      new THREE.Vector3(10, 10, 10),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      () => 0,
    );
    const collectibles = session.getLayout().collectibles;
    const [first, second] = collectibles;
    const last = collectibles[4];
    expect(first.position).toEqual(new THREE.Vector3(16, 10, 10));
    expect(second.position).toEqual(new THREE.Vector3(19, 10, 8));
    expect(last.position.y).toBe(13);
    expect(session.getLayout().requiredTurn).toBe('left');
  });

  it('advances only through the required phases', () => {
    const session = new TutorialSession(new THREE.Vector3(), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), () => 0.9);
    expect(session.collect('growth')).toBe('turn_gate');
    expect(session.collect('growth')).toBe('acceleration_intro');
    expect(session.confirm()).toBe('acceleration_intro');
    expect(session.collect('acceleration')).toBe('slowdown_intro');
    expect(session.confirm()).toBe('slowdown_intro');
    expect(session.collect('slowdown')).toBe('roll_gate');
    expect(session.acceptRoll()).toBe('expanding_world');
    expect(session.completeExpansion()).toBe('standard_game');
  });
});
