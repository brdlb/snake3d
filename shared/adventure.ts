import { adjacentRoom, generationSeed, roomCoordinates, roomSeed, type GridPosition, type PortalDirection, type RoomCoordinates } from './roomCoordinates';

export const ADVENTURE_VERSION = 1;
export const THEMES = ['MASS', 'TEMPO', 'ENERGY', 'TUNING', 'CIRCUIT'] as const;
export const PORTAL_DIRECTIONS: PortalDirection[] = ['xp', 'xn', 'yp', 'yn', 'zp', 'zn'];
export type Theme = typeof THEMES[number];
export type Polarity = 'NEUTRAL' | 'POSITIVE' | 'NEGATIVE';
export type Coating = 'NORMAL' | 'CONDUCTIVE' | 'INSULATED';
export type Requirement =
  | { kind: 'length' | 'speed' | 'charge'; min: number; max?: number }
  | { kind: 'polarity'; value: Polarity }
  | { kind: 'task'; id: string }
  | { kind: 'temporary'; id: string };
export type InteractionKind = 'MASS_CONVERTER' | 'DYNAMO' | 'BRAKE' | 'POLARIZER' | 'CLEANER' | 'CONTACT' | 'BEACON' | 'TEMPORARY' | 'COATER' | 'GROWER' | 'ACCELERATOR';
export type InteractionDefinition = {
  id: string; kind: InteractionKind; position: GridPosition; theme: Theme;
  task?: string; order?: number; polarity?: Polarity; coating?: Coating;
  minSpeed?: number; durationMs?: number;
};
export type PortalDefinition = {
  direction: PortalDirection; theme: Theme; tier: number; enabled: boolean;
  requirements: Requirement[]; chargeCost: number; template: string;
};
export type RoomDefinition = {
  version: number; seed: number; coordinates: RoomCoordinates;
  themes: Theme[]; depths: Record<Theme, number>;
  interactions: InteractionDefinition[]; portals: PortalDefinition[];
};
export type AdventureState = {
  version: number; charge: number; polarity: Polarity; coatings: Coating[];
  completed: string[]; sequence: Record<string, number>; temporary: Record<string, number>;
  occupied: string[]; activeMs: number; path: number[]; entryLength: number; entrySpeed: number;
};
export type AdventureSnake = {
  segments: GridPosition[]; direction: GridPosition; up: GridPosition;
  score: number; speed: number; growth: number; adventure: AdventureState;
};
export type EntryCheckpoint = { version: number; seed: number; snake: AdventureSnake };
export type AdventureRecord = { version: number; checkpoint: EntryCheckpoint; path: number[] };
export type AdventureReplayEvent = { step: number; snake: AdventureSnake };
export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const samePosition = (a: GridPosition, b: GridPosition) => a.x === b.x && a.y === b.y && a.z === b.z;
export const positionKey = (p: GridPosition) => `${p.x},${p.y},${p.z}`;

export function themeDepths(p: RoomCoordinates): Record<Theme, number> {
  return { MASS: Math.max(p.x, 0), TEMPO: Math.max(-p.x, 0), ENERGY: Math.max(p.y, 0), TUNING: Math.max(-p.y, 0), CIRCUIT: Math.max(p.z, 0) };
}
export function validAdventureRoom(seed: number): boolean {
  const p = roomCoordinates(seed);
  return !!p && p.z >= 0;
}
export function newAdventure(length: number, speed: number, path: number[] = []): AdventureState {
  return { version: ADVENTURE_VERSION, charge: 0, polarity: 'NEUTRAL', coatings: Array<Coating>(length).fill('NORMAL'), completed: [], sequence: {}, temporary: {}, occupied: [], activeMs: 0, path: [...path], entryLength: length, entrySpeed: speed };
}
export function enterAdventure(snake: AdventureSnake, seed: number, path: number[]): EntryCheckpoint {
  const next = copy(snake);
  next.adventure = { ...next.adventure, completed: [], sequence: {}, temporary: {}, occupied: [], activeMs: 0, path: [...path], entryLength: next.segments.length, entrySpeed: next.speed };
  return { version: ADVENTURE_VERSION, seed, snake: next };
}
export function checkpointBlocked(checkpoint: EntryCheckpoint, others: Array<{ segments: GridPosition[]; alive: boolean }>): boolean {
  const blocked = new Set(others.filter(p => p.alive).flatMap(p => p.segments.map(positionKey)));
  return checkpoint.snake.segments.some(p => blocked.has(positionKey(p)));
}
export function advanceCoatings(coatings: Coating[], length: number): Coating[] {
  return coatings.slice(0, length).concat(Array<Coating>(Math.max(0, length - coatings.length)).fill('NORMAL'));
}

function random(seed: number) {
  return () => { seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b); seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b); return ((seed ^= seed >>> 16) >>> 0) / 4294967296; };
}
export function createRoomDefinition(seed: number): RoomDefinition {
  const coordinates = roomCoordinates(seed);
  if (!coordinates || coordinates.z < 0) throw new RangeError('WORLD EDGE');
  const depths = themeDepths(coordinates);
  const themes = THEMES.filter(t => depths[t] > 0).sort((a, b) => depths[b] - depths[a] || THEMES.indexOf(a) - THEMES.indexOf(b)).slice(0, 2);
  if (!themes.length) themes.push('MASS');
  const layout = random(generationSeed(seed) ^ (ADVENTURE_VERSION * 0x9e3779b9));
  const interactions: InteractionDefinition[] = [];
  const portals = PORTAL_DIRECTIONS.map((direction, index): PortalDefinition => {
    const target = adjacentRoom(coordinates, direction);
    const theme: Theme = direction[0] === 'x' ? (target.x < 0 || (target.x === 0 && coordinates.x < 0) ? 'TEMPO' : 'MASS') : direction[0] === 'y' ? (target.y < 0 || (target.y === 0 && coordinates.y < 0) ? 'TUNING' : 'ENERGY') : 'CIRCUIT';
    const tier = Math.min(3, Math.max(1, themeDepths(target)[theme]));
    const task = `${direction}-task`;
    // Disjoint lanes, outside the central approach corridors. Both endpoints
    // of a contact motif share a straight, two-cell body bridge.
    const base = { x: 8 + index * 6, y: 8 + Math.floor(layout() * 4), z: 12 + Math.floor(layout() * 4) };
    const add = (kind: InteractionKind, n: number, extra: Partial<InteractionDefinition> = {}) => interactions.push({ id: `${direction}-${n}`, kind, position: { ...base, z: base.z + n * 2 }, theme, ...extra });
    const requirements: Requirement[] = [];
    let chargeCost = 0;
    if (theme === 'MASS') {
      requirements.push({ kind: 'length', min: 6, ...(tier > 1 ? { max: 12 } : {}) });
      add('GROWER', 0); add('MASS_CONVERTER', 1);
      if (tier === 3) { add('CONTACT', 2, { task }); add('CONTACT', 3, { task }); requirements.push({ kind: 'task', id: task }); }
    } else if (theme === 'TEMPO') {
      requirements.push({ kind: 'speed', min: 350, ...(tier > 1 ? { max: 450 } : {}) });
      add('ACCELERATOR', 0); add('DYNAMO', 1, { minSpeed: 300 }); add('BRAKE', 2);
      if (tier === 3) { add('TEMPORARY', 3, { task, durationMs: 30000 }); requirements.push({ kind: 'temporary', id: task }); }
    } else if (theme === 'ENERGY') {
      requirements.push({ kind: 'charge', min: tier }); chargeCost = tier;
      const conversion = `${direction}-convert`;
      add('GROWER', 0); add('MASS_CONVERTER', 1, { task: conversion });
      add('DYNAMO', 2, { minSpeed: 60 }); add('DYNAMO', 3, { minSpeed: 60 }); add('DYNAMO', 4, { minSpeed: 60 });
      if (tier > 1) requirements.push({ kind: 'task', id: conversion });
      if (tier === 3) { add('BEACON', 5, { task, order: 0 }); add('BEACON', 6, { task, order: 1 }); requirements.push({ kind: 'task', id: task }); }
    } else if (theme === 'TUNING') {
      requirements.push({ kind: 'polarity', value: 'NEGATIVE' });
      add('POLARIZER', 0, { polarity: 'POSITIVE', ...(tier > 1 ? { task, order: 0 } : {}) });
      add('POLARIZER', 1, { polarity: 'NEGATIVE', ...(tier > 1 ? { task, order: 1 } : {}) });
      add('CLEANER', 2);
      if (tier > 1) requirements.push({ kind: 'task', id: task });
      if (tier === 3) { add('DYNAMO', 3, { minSpeed: 60 }); requirements.push({ kind: 'charge', min: 1 }); chargeCost = 1; }
    } else {
      add('COATER', 0, { coating: tier === 1 ? 'NORMAL' : 'CONDUCTIVE' });
      add('CONTACT', 1, { task, coating: tier === 1 ? 'NORMAL' : 'CONDUCTIVE' });
      add('CONTACT', 2, { task, coating: tier === 1 ? 'NORMAL' : 'CONDUCTIVE' });
      if (tier === 3) { add('CONTACT', 3, { task, coating: 'CONDUCTIVE' }); add('GROWER', 4); add('COATER', 5, { coating: 'INSULATED' }); }
      requirements.push({ kind: 'task', id: task });
    }
    if (themes.length === 2 && theme === themes[0] && requirements.length < 3) {
      const secondary = themes[1];
      const extra: Requirement = secondary === 'MASS' ? { kind: 'length', min: 6 } : secondary === 'TEMPO' ? { kind: 'speed', min: 350 } : secondary === 'ENERGY' ? { kind: 'charge', min: 1 } : secondary === 'TUNING' ? { kind: 'polarity', value: 'NEGATIVE' } : { kind: 'task', id: 'zp-task' };
      if (!requirements.some(r => r.kind === extra.kind && (r.kind !== 'task' || extra.kind !== 'task' || r.id === extra.id))) requirements.push(extra);
      if (secondary === 'ENERGY') chargeCost = Math.max(1, chargeCost);
    }
    return { direction, theme, tier, enabled: target.z >= 0, requirements, chargeCost, template: `${theme}-${tier}` };
  });
  return { version: ADVENTURE_VERSION, seed, coordinates, depths, themes, interactions: interactions.filter(o => portals.find(p => o.id.startsWith(p.direction))?.enabled), portals };
}
export function personalPortals(room: RoomDefinition, state: AdventureState): PortalDefinition[] {
  return room.portals.map(portal => ({ ...portal, requirements: portal.requirements.map(req => {
    if (req.kind === 'length') { const min = Math.max(3, state.entryLength + 3); return { ...req, min, ...(req.max === undefined ? {} : { max: min + 6 }) }; }
    if (req.kind === 'speed') { const min = Math.max(60, state.entrySpeed + 50); return { ...req, min, ...(req.max === undefined ? {} : { max: min + 100 }) }; }
    return req;
  }) }));
}
export function requirementLabel(req: Requirement): string {
  if (req.kind === 'polarity') return `POLARITY ${req.value}`;
  if (req.kind === 'task') {
    if (req.id.endsWith('-convert')) return 'CONVERT MASS';
    if (req.id.startsWith('yp-')) return 'BEACON SEQUENCE';
    if (req.id.startsWith('yn-')) return 'POLARITY SEQUENCE';
    return 'BRIDGE CONTACTS';
  }
  if (req.kind === 'temporary') return 'DELIVER LIVE CHARGE';
  return `${req.kind.toUpperCase()} ${req.min}${req.max === undefined ? '+' : `–${req.max}`}`;
}
export function checkPortal(room: RoomDefinition, direction: PortalDirection, snake: AdventureSnake) {
  const portal = personalPortals(room, snake.adventure).find(p => p.direction === direction)!;
  if (!portal.enabled) return { open: false, reason: 'WORLD EDGE', cost: 0, returning: false };
  const target = roomSeed(adjacentRoom(room.coordinates, direction));
  const returning = snake.adventure.path[snake.adventure.path.length - 1] === target;
  if (returning) return { open: true, reason: 'FREE RETURN', cost: 0, returning };
  for (const req of portal.requirements) {
    const value = req.kind === 'length' ? snake.segments.length : req.kind === 'speed' ? snake.speed : snake.adventure.charge;
    const ok = req.kind === 'polarity' ? snake.adventure.polarity === req.value : req.kind === 'task' ? snake.adventure.completed.includes(req.id) : req.kind === 'temporary' ? (snake.adventure.temporary[req.id] ?? 0) > snake.adventure.activeMs : value >= req.min && (req.max === undefined || value <= req.max);
    if (!ok) return { open: false, reason: requirementLabel(req), cost: portal.chargeCost, returning };
  }
  return { open: snake.adventure.charge >= portal.chargeCost, reason: snake.adventure.charge >= portal.chargeCost ? 'OPEN' : `COST ${portal.chargeCost} CHARGE`, cost: portal.chargeCost, returning };
}
export function transitionAdventure(room: RoomDefinition, direction: PortalDirection, snake: AdventureSnake) {
  const result = checkPortal(room, direction, snake);
  if (!result.open) return null;
  const next = copy(snake);
  next.adventure.charge -= result.cost;
  const path = result.returning ? next.adventure.path.slice(0, -1) : [...next.adventure.path, room.seed];
  return { snake: next, path };
}

/** Only invoked for a completed movement step. Re-entering, not dwelling,
 * triggers providers. Player timers advance by movement time, never wall time. */
export function applyInteractions(room: RoomDefinition, snake: AdventureSnake, elapsedMs: number): string[] {
  const a = snake.adventure;
  a.activeMs += Math.max(0, elapsedMs);
  const touched = room.interactions.filter(o => samePosition(o.position, snake.segments[0]));
  const triggered: string[] = [];
  for (const o of touched) {
    if (a.occupied.includes(o.id)) continue;
    triggered.push(o.id);
    if (o.kind === 'MASS_CONVERTER' && snake.segments.length >= 6 && a.charge < 12) {
      snake.segments.splice(-3); a.coatings.splice(snake.segments.length); a.charge++;
      if (o.task && !a.completed.includes(o.task)) a.completed.push(o.task);
    }
    if (o.kind === 'GROWER') snake.growth += 3;
    if (o.kind === 'ACCELERATOR') snake.speed += 50;
    if (o.kind === 'DYNAMO' && snake.speed >= (o.minSpeed ?? 60)) a.charge = Math.min(12, a.charge + 1);
    if (o.kind === 'BRAKE' && a.charge > 0 && snake.speed > 60) { a.charge--; snake.speed = Math.max(60, snake.speed - 50); }
    if (o.kind === 'POLARIZER') a.polarity = o.polarity ?? 'NEUTRAL';
    if (o.kind === 'CLEANER') a.polarity = 'NEUTRAL';
    if (o.kind === 'TEMPORARY' && o.task) a.temporary[o.task] = a.activeMs + (o.durationMs ?? 30000) * (a.entrySpeed < 150 ? 4 : 1);
    if (o.task && o.order !== undefined) {
      const expected = a.sequence[o.task] ?? 0;
      a.sequence[o.task] = o.order === expected ? expected + 1 : o.order === 0 ? 1 : 0;
      const count = room.interactions.filter(x => x.task === o.task && x.order !== undefined).length;
      a.completed = a.completed.filter(id => id !== o.task);
      if (a.sequence[o.task] === count) a.completed.push(o.task);
    }
  }
  for (const o of room.interactions.filter(o => o.kind === 'COATER')) snake.segments.forEach((p, i) => { if (samePosition(p, o.position)) a.coatings[i] = o.coating ?? 'CONDUCTIVE'; });
  const contactTasks = [...new Set(room.interactions.filter(o => o.kind === 'CONTACT').map(o => o.task!))];
  for (const task of contactTasks) {
    const contacts = room.interactions.filter(o => o.kind === 'CONTACT' && o.task === task);
    const connected = contacts.every(o => snake.segments.some((p, i) => samePosition(p, o.position) && (!o.coating || o.coating === 'NORMAL' || a.coatings[i] === o.coating)));
    if (connected && !a.completed.includes(task)) a.completed.push(task);
  }
  a.occupied = touched.map(o => o.id);
  return triggered;
}

/** Single-cell simulation shared by the validator and server. */
export function moveAdventure(snake: AdventureSnake, direction: GridPosition): AdventureSnake | null {
  if (Math.abs(direction.x) + Math.abs(direction.y) + Math.abs(direction.z) !== 1) return null;
  if (direction.x * snake.direction.x + direction.y * snake.direction.y + direction.z * snake.direction.z === -1) return null;
  const next = copy(snake), head = next.segments[0];
  const p = { x: head.x + direction.x, y: head.y + direction.y, z: head.z + direction.z };
  if ([p.x, p.y, p.z].some(v => v < 0 || v > 50)) return null;
  const body = next.growth > 0 ? next.segments : next.segments.slice(0, -1);
  if (body.some(segment => samePosition(segment, p))) return null;
  next.segments.unshift(p);
  if (next.growth > 0) next.growth--; else next.segments.pop();
  next.adventure.coatings = advanceCoatings(next.adventure.coatings, next.segments.length);
  next.direction = { ...direction };
  return next;
}
