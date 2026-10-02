import { describe, expect, it } from 'vitest';
import { adjacentRoom, crossedPortal, generationSeed, portalOffset, PORTAL_APERTURE, roomCoordinates, roomSeed } from './roomCoordinates';

describe('coordinate room addresses', () => {
  it('round trips signed coordinates without aliasing adjacent rooms', () => {
    for (const position of [{ x: 0, y: 0, z: 0 }, { x: -1, y: 2, z: -3 }, { x: 65535, y: -65535, z: 0 }])
      expect(roomCoordinates(roomSeed(position))).toEqual(position);
    expect(roomSeed(adjacentRoom({ x: 0, y: 0, z: 0 }, 'xp'))).not.toBe(roomSeed({ x: 0, y: 0, z: 0 }));
  });

  it('uses all three axes for procedural generation', () => {
    const origin = roomSeed({ x: 0, y: 0, z: 0 });
    for (const direction of ['xp', 'yp', 'zp'] as const)
      expect(generationSeed(roomSeed(adjacentRoom({ x: 0, y: 0, z: 0 }, direction)))).not.toBe(generationSeed(origin));
    expect(generationSeed(123)).toBe(123);
  });

  it('detects portal geometry independently of snake length', () => {
    expect(PORTAL_APERTURE).toBe(1);
    expect(crossedPortal({ x: 51, y: 25, z: 25 }, 3)).toBe('xp');
    expect(crossedPortal({ x: 51, y: 25, z: 25 }, 100)).toBe('xp');
    expect(crossedPortal({ x: 51, y: 24, z: 25 }, 100)).toBeNull();
    expect(crossedPortal({ x: 51, y: 26, z: 25 }, 100)).toBeNull();
    expect(crossedPortal({ x: 51, y: 25, z: 24 }, 100)).toBeNull();
    expect(crossedPortal({ x: 51, y: 25, z: 26 }, 100)).toBeNull();
    expect(crossedPortal({ x: -1, y: 25, z: 25 }, 100)).toBe('xn');
    expect(crossedPortal({ x: 25, y: 51, z: 25 }, 100)).toBe('yp');
    expect(crossedPortal({ x: 25, y: -1, z: 25 }, 100)).toBe('yn');
    expect(crossedPortal({ x: 25, y: 25, z: 51 }, 100)).toBe('zp');
    expect(crossedPortal({ x: 25, y: 25, z: -1 }, 100)).toBe('zn');
    expect(crossedPortal({ x: 52, y: 25, z: 25 }, 100)).toBeNull();
    const offset = portalOffset('xp');
    expect({ x: 51 - offset.x, y: 25 - offset.y, z: 25 - offset.z }).toEqual({ x: 0, y: 25, z: 25 });
  });
});
