import { describe, expect, it } from 'vitest';
import { adjacentRoom, crossedPortal, generationSeed, portalOffset, roomCoordinates, roomSeed } from './roomCoordinates';

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

  it('opens only central faces at 100 segments and places the head at the opposite edge', () => {
    expect(crossedPortal({ x: 51, y: 25, z: 25 }, 99)).toBeNull();
    expect(crossedPortal({ x: 51, y: 25, z: 25 }, 100)).toBe('xp');
    expect(crossedPortal({ x: 51, y: 28, z: 25 }, 100)).toBeNull();
    expect(crossedPortal({ x: -1, y: 25, z: 25 }, 100)).toBe('xn');
    expect(crossedPortal({ x: 25, y: 25, z: 51 }, 100)).toBe('zp');
    const offset = portalOffset('xp');
    expect({ x: 51 - offset.x, y: 25 - offset.y, z: 25 - offset.z }).toEqual({ x: 0, y: 25, z: 25 });
  });
});
