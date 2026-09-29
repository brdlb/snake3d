/** A room contains integer positions 0..50 on each axis. */
export const ROOM_SIZE = 50;
export const ROOM_STRIDE = ROOM_SIZE + 1;
export const PORTAL_MIN_LENGTH = 100;
export const PORTAL_CENTER = ROOM_SIZE / 2;
export const PORTAL_RADIUS = 2;

export type RoomCoordinates = { x: number; y: number; z: number };
export type PortalDirection = 'xp' | 'xn' | 'yp' | 'yn' | 'zp' | 'zn';

const COORD_LIMIT = 65535;
const COORD_BASE = 131071;
const COORD_OFFSET = 2 ** 31;

export function roomSeed({ x, y, z }: RoomCoordinates): number {
  if (![x, y, z].every((value) => Number.isInteger(value) && Math.abs(value) <= COORD_LIMIT))
    throw new RangeError('Room coordinates are outside the supported world');
  return COORD_OFFSET + ((x + COORD_LIMIT) * COORD_BASE + y + COORD_LIMIT) * COORD_BASE + z + COORD_LIMIT;
}

export function roomCoordinates(seed: number): RoomCoordinates | null {
  if (!Number.isSafeInteger(seed) || seed < COORD_OFFSET || seed >= COORD_OFFSET + COORD_BASE ** 3)
    return null;
  let index = seed - COORD_OFFSET;
  const z = index % COORD_BASE - COORD_LIMIT;
  index = Math.floor(index / COORD_BASE);
  const y = index % COORD_BASE - COORD_LIMIT;
  const x = Math.floor(index / COORD_BASE) - COORD_LIMIT;
  return { x, y, z };
}

export function adjacentRoom(position: RoomCoordinates, direction: PortalDirection): RoomCoordinates {
  const offset = {
    xp: { x: 1, y: 0, z: 0 }, xn: { x: -1, y: 0, z: 0 },
    yp: { x: 0, y: 1, z: 0 }, yn: { x: 0, y: -1, z: 0 },
    zp: { x: 0, y: 0, z: 1 }, zn: { x: 0, y: 0, z: -1 },
  }[direction];
  return { x: position.x + offset.x, y: position.y + offset.y, z: position.z + offset.z };
}

export function generationSeed(seed: number): number {
  const coordinates = roomCoordinates(seed);
  if (!coordinates) return seed;
  let hash = 2166136261;
  for (const value of [coordinates.x, coordinates.y, coordinates.z]) {
    hash = Math.imul(hash ^ value, 16777619);
  }
  return hash >>> 0;
}

export type GridPosition = { x: number; y: number; z: number };

/** The head must step through the central 5 by 5 opening of a face. */
export function crossedPortal(head: GridPosition, length: number): PortalDirection | null {
  if (length < PORTAL_MIN_LENGTH) return null;
  const middle = (a: number, b: number) =>
    Math.abs(a - PORTAL_CENTER) <= PORTAL_RADIUS && Math.abs(b - PORTAL_CENTER) <= PORTAL_RADIUS;
  if (head.x === ROOM_SIZE + 1 && middle(head.y, head.z)) return 'xp';
  if (head.x === -1 && middle(head.y, head.z)) return 'xn';
  if (head.y === ROOM_SIZE + 1 && middle(head.x, head.z)) return 'yp';
  if (head.y === -1 && middle(head.x, head.z)) return 'yn';
  if (head.z === ROOM_SIZE + 1 && middle(head.x, head.y)) return 'zp';
  if (head.z === -1 && middle(head.x, head.y)) return 'zn';
  return null;
}

export function portalOffset(direction: PortalDirection): GridPosition {
  return {
    xp: { x: ROOM_STRIDE, y: 0, z: 0 }, xn: { x: -ROOM_STRIDE, y: 0, z: 0 },
    yp: { x: 0, y: ROOM_STRIDE, z: 0 }, yn: { x: 0, y: -ROOM_STRIDE, z: 0 },
    zp: { x: 0, y: 0, z: ROOM_STRIDE }, zn: { x: 0, y: 0, z: -ROOM_STRIDE },
  }[direction];
}
