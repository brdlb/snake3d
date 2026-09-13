import { describe, expect, it } from 'vitest';
import type { SimPlayer } from '../../shared/simulation';
import { findLocalPlayer, isLiveOpponent } from './livePlayers';

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
