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

  it('opens the central 3x3 cells of each face at 100 segments', () => {
    expect(PORTAL_APERTURE).toBe(3);
    expect(crossedPortal({ x: 51, y: 25, z: 25 }, 99)).toBeNull();
    for (const a of [24, 25, 26]) for (const b of [24, 25, 26]) {
      expect(crossedPortal({ x: 51, y: a, z: b }, 100)).toBe('xp');
      expect(crossedPortal({ x: -1, y: a, z: b }, 100)).toBe('xn');
      expect(crossedPortal({ x: a, y: 51, z: b }, 100)).toBe('yp');
      expect(crossedPortal({ x: a, y: -1, z: b }, 100)).toBe('yn');
      expect(crossedPortal({ x: a, y: b, z: 51 }, 100)).toBe('zp');
      expect(crossedPortal({ x: a, y: b, z: -1 }, 100)).toBe('zn');
    }
    for (const outside of [23, 27]) {
      expect(crossedPortal({ x: 51, y: outside, z: 25 }, 100)).toBeNull();
      expect(crossedPortal({ x: 51, y: 25, z: outside }, 100)).toBeNull();
    }
    expect(crossedPortal({ x: 52, y: 25, z: 25 }, 100)).toBeNull();
    const offset = portalOffset('xp');
    expect({ x: 51 - offset.x, y: 25 - offset.y, z: 25 - offset.z }).toEqual({ x: 0, y: 25, z: 25 });
  });
});
