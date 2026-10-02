import { copy, moveAdventure, type AdventureSnake } from './adventure';
import type { Axis } from './simulation';

// Collision disagreement is not evidence of cheating. Keep movement deterministic
// but let the client's later checkpoint resolve a missed turn or occupied cell.
export function simulateClientMove(snake: AdventureSnake, direction: Axis): AdventureSnake | null {
  if (Math.abs(direction.x) + Math.abs(direction.y) + Math.abs(direction.z) !== 1) return null;
  const legal = moveAdventure(snake, direction);
  if (legal) return legal;
  // Keep the last safe server position; a nearby client checkpoint wins.
  // Never force an out-of-bounds or self-overlapping server prediction onto players.
  const next = copy(snake);
  next.direction = copy(direction);
  return next;
}

export function excessiveAdventureDelta(expected: AdventureSnake, client: AdventureSnake, terminal = false): boolean {
  const a = client.adventure;
  if (!a || !Array.isArray(a.completed) || !Array.isArray(a.path) || !Array.isArray(a.coatings) ||
      !a.sequence || typeof a.sequence !== 'object' || !a.temporary || typeof a.temporary !== 'object' ||
      !Array.isArray(a.occupied) || !Number.isFinite(a.activeMs) || a.version !== expected.adventure.version ||
      a.entryLength !== expected.adventure.entryLength || a.entrySpeed !== expected.adventure.entrySpeed) return true;
  const distance = (a: Axis, b: Axis) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
  return client.segments.some(p => Object.values(p).some(v => v < (terminal ? -1 : 0) || v > (terminal ? 51 : 50))) ||
    Math.abs(expected.segments.length - client.segments.length) > 2 ||
    client.segments.some((p, i) => distance(p, expected.segments[Math.min(i, expected.segments.length - 1)]) > 2) ||
    Math.abs(expected.score - client.score) > 15 || Math.abs(expected.speed - client.speed) > 50 ||
    Math.abs(expected.growth - client.growth) > 2 ||
    expected.adventure.charge !== client.adventure.charge ||
    expected.adventure.polarity !== client.adventure.polarity ||
    JSON.stringify([...expected.adventure.completed].sort()) !== JSON.stringify([...client.adventure.completed].sort()) ||
    JSON.stringify(expected.adventure.occupied) !== JSON.stringify(client.adventure.occupied) ||
    JSON.stringify(expected.adventure.path) !== JSON.stringify(client.adventure.path) ||
    JSON.stringify(expected.adventure.sequence) !== JSON.stringify(client.adventure.sequence) ||
    JSON.stringify(expected.adventure.coatings) !== JSON.stringify(client.adventure.coatings) ||
    JSON.stringify(expected.adventure.temporary) !== JSON.stringify(client.adventure.temporary) ||
    Math.abs(expected.adventure.activeMs - client.adventure.activeMs) > 1000;
}
