import { applyInteractions, checkPortal, copy, createRoomDefinition, moveAdventure, personalPortals, positionKey, samePosition, type AdventureSnake, type RoomDefinition } from './adventure';
import { type GridPosition, type PortalDirection } from './roomCoordinates';

const directions: GridPosition[] = [{ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }];
const distance = (a: GridPosition, b: GridPosition) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
export type RouteWitness = { direction: PortalDirection; route: GridPosition[]; valid: boolean; reason?: string };
export type GenerationReport = { attempts: number; fallback: boolean; witnesses: RouteWitness[]; rejected: string[] };

/** Bounded A* carries the actual body and pending growth. It is a witness
 * finder, not a claim that every possible input body can solve the room. */
function navigate(room: RoomDefinition, initial: AdventureSnake, target: GridPosition, budget = 2500, outgoing?: GridPosition): { snake: AdventureSnake; route: GridPosition[] } | null {
  type Node = { snake: AdventureSnake; route: GridPosition[]; cost: number };
  const queue: Node[] = [{ snake: copy(initial), route: [], cost: distance(initial.segments[0], target) }];
  const seen = new Set<string>();
  for (let iteration = 0; iteration < budget && queue.length; iteration++) {
    queue.sort((a, b) => b.cost - a.cost);
    const node = queue.pop()!;
    if (samePosition(node.snake.segments[0], target)) {
      const exit = outgoing ? { x: target.x + outgoing.x, y: target.y + outgoing.y, z: target.z + outgoing.z } : null;
      const reverse = outgoing && outgoing.x * node.snake.direction.x + outgoing.y * node.snake.direction.y + outgoing.z * node.snake.direction.z === -1;
      const blocked = exit && (node.snake.growth > 0 ? node.snake.segments : node.snake.segments.slice(0, -1)).some(p => samePosition(p, exit));
      if (!reverse && !blocked) return node;
    }
    for (const d of directions) {
      const next = moveAdventure(node.snake, d);
      if (!next) continue;
      if (room.interactions.some(o => samePosition(o.position, next.segments[0]) && !samePosition(o.position, target))) continue;
      const key = `${next.segments.map(positionKey).join(';')}|${next.growth}`;
      if (seen.has(key)) continue;
      seen.add(key);
      applyInteractions(room, next, 60000 / node.snake.speed);
      const route = [...node.route, d];
      queue.push({ snake: next, route, cost: route.length + distance(next.segments[0], target) * 1.1 });
    }
  }
  return null;
}
export function validatePortalRoute(room: RoomDefinition, initial: AdventureSnake, direction: PortalDirection): RouteWitness {
  const portal = room.portals.find(p => p.direction === direction)!;
  if (!portal.enabled) return { direction, valid: true, route: [] };
  let snake = copy(initial);
  const route: GridPosition[] = [];
  const objects = room.interactions.filter(o => o.id.startsWith(direction));
  const visit = (target: GridPosition): boolean => {
    const result = navigate(room, snake, target);
    if (!result) return false;
    snake = result.snake; route.push(...result.route); return true;
  };
  const provider = (kind: string) => objects.find(o => o.kind === kind);
  const repeat = (kind: string, done: () => boolean): boolean => {
    const eligible = (o: RoomDefinition['interactions'][number]) => o.kind === kind && (o.kind !== 'DYNAMO' || (o.minSpeed ?? 60) <= snake.speed);
    let providers = objects.filter(eligible);
    if (!providers.length) providers = room.interactions.filter(eligible);
    if (!providers.length) return done();
    for (let i = 0; i < 24 && !done(); i++) {
      const object = providers[i % providers.length];
      if (samePosition(snake.segments[0], object.position)) {
        const away = directions.map(d => ({ x: object.position.x + d.x * 2, y: object.position.y + d.y * 2, z: object.position.z + d.z * 2 })).find(p => !snake.segments.some(s => samePosition(s, p)));
        if (!away || !visit(away)) return false;
      }
      if (!visit(object.position)) return false;
      // Realize pending growth before attempting another conversion.
      if (snake.growth > 0 && !visit({ ...object.position, y: object.position.y + 4 })) return false;
    }
    return done();
  };
  const fail = (reason: string): RouteWitness => ({ direction, valid: false, route, reason });
  const returning = checkPortal(room, direction, snake).returning;
  if (!returning) {
  const requirements = personalPortals(room, initial.adventure).find(p => p.direction === direction)!.requirements;
  const length = requirements.find(r => r.kind === 'length');
  if (length && length.kind === 'length' && !repeat('GROWER', () => snake.segments.length >= length.min)) return fail('LENGTH ROUTE');
  const speed = requirements.find(r => r.kind === 'speed');
  if (speed && speed.kind === 'speed' && !repeat('ACCELERATOR', () => snake.speed >= speed.min)) return fail('SPEED ROUTE');
  const polarity = requirements.find(r => r.kind === 'polarity');
  if (polarity?.kind === 'polarity') {
    const polarizer = room.interactions.find(o => o.kind === 'POLARIZER' && o.polarity === polarity.value);
    if (!polarizer || !visit(polarizer.position)) return fail('POLARITY ROUTE');
  }
  if (portal.theme === 'MASS' && !repeat('GROWER', () => snake.segments.length >= snake.adventure.entryLength + 3)) return fail('MASS ROUTE');
  if (portal.theme === 'TEMPO' && !repeat('ACCELERATOR', () => snake.speed >= snake.adventure.entrySpeed + 50)) return fail('TEMPO ROUTE');
  if (portal.theme === 'ENERGY' && portal.tier > 1) {
    if (!repeat('GROWER', () => snake.segments.length >= 6)) return fail('CONVERSION LENGTH');
    if (!visit(provider('MASS_CONVERTER')!.position)) return fail('CONVERSION ROUTE');
  }
  if (portal.chargeCost > 0 && !repeat('DYNAMO', () => snake.adventure.charge >= portal.chargeCost)) return fail('ENERGY ROUTE');
  if (portal.theme === 'CIRCUIT' && portal.tier === 3 && !repeat('GROWER', () => snake.segments.length >= 5)) return fail('CIRCUIT LENGTH');
  for (const o of objects.filter(o => ['POLARIZER', 'BEACON', 'COATER', 'CONTACT'].includes(o.kind) && o.coating !== 'INSULATED').sort((a, b) => a.position.z - b.position.z)) {
    if (!visit(o.position)) return fail('TASK ROUTE');
  }
  for (const req of requirements.filter(r => r.kind === 'task')) {
    if (req.kind !== 'task' || snake.adventure.completed.includes(req.id)) continue;
    const contacts = room.interactions.filter(o => o.task === req.id && o.kind === 'CONTACT');
    if (!contacts.length) return fail('TASK REQUIREMENT');
    const extent = Math.max(...contacts.map(o => o.position.z)) - Math.min(...contacts.map(o => o.position.z)) + 1;
    if (!repeat('GROWER', () => snake.segments.length >= extent)) return fail('BRIDGE LENGTH');
    const coating = room.interactions.find(o => o.id.startsWith(req.id.split('-')[0]) && o.kind === 'COATER' && o.coating !== 'INSULATED');
    if (coating && !visit(coating.position)) return fail('COATING ROUTE');
    for (const contact of contacts) if (!visit(contact.position)) return fail('BRIDGE ROUTE');
  }
  const temporary = provider('TEMPORARY');
  if (temporary && !visit(temporary.position)) return fail('TEMPORARY ROUTE');
  }
  const axis = direction[0] as 'x' | 'y' | 'z';
  const exit = { x: 25, y: 25, z: 25, [axis]: direction[1] === 'p' ? 50 : 0 };
  const outgoing = { x: 0, y: 0, z: 0, [axis]: direction[1] === 'p' ? 1 : -1 };
  const exitRoute = navigate(room, snake, exit, 2500, outgoing);
  if (!exitRoute) return fail('EXIT ROUTE');
  snake = exitRoute.snake; route.push(...exitRoute.route);
  const checked = checkPortal(room, direction, snake);
  if (!checked.open) return fail(checked.reason);
  return { direction, route, valid: true };
}
export function validateRoomDefinition(room: RoomDefinition, entry: AdventureSnake): GenerationReport {
  const witnesses = room.portals.map(p => validatePortalRoute(room, entry, p.direction));
  return { attempts: 1, fallback: false, witnesses, rejected: witnesses.filter(w => !w.valid).map(w => `${w.direction}: ${w.reason}`) };
}
export function generateValidatedRoom(seed: number, entry: AdventureSnake): { room: RoomDefinition; report: GenerationReport } {
  const rejected: string[] = [];
  for (let attempt = 0; attempt < 32; attempt++) {
    const room = createRoomDefinition(seed);
    if (attempt) room.interactions = room.interactions.map(o => ({ ...o, position: { ...o.position, y: o.position.y + attempt % 4, z: o.position.z + Math.floor(attempt / 4) % 4 } }));
    const report = validateRoomDefinition(room, entry);
    if (!report.rejected.length) return { room, report: { ...report, attempts: attempt + 1, rejected } };
    rejected.push(...report.rejected);
  }
  const room = createRoomDefinition(seed);
  // The fallback removes the compound layer but retains each branch's
  // resource/state mechanic. Validate it too; never silently assert solvability.
  room.portals = room.portals.map(p => ({ ...p, tier: 1, chargeCost: p.theme === 'ENERGY' ? 1 : 0, requirements: p.requirements.filter(r => r.kind !== 'temporary' && (r.kind !== 'task' || p.theme === 'CIRCUIT')).map(r => r.kind === 'charge' ? { ...r, min: 1 } : r.kind === 'length' || r.kind === 'speed' ? { kind: r.kind, min: r.min } : r), template: `${p.theme}-FALLBACK` }));
  room.interactions = room.interactions.filter(o => o.kind !== 'BEACON' && o.coating !== 'INSULATED' && !(o.kind === 'CONTACT' && o.id.endsWith('-3'))).map(o => o.theme === 'CIRCUIT' ? { ...o, coating: 'NORMAL' } : o.kind === 'POLARIZER' ? { ...o, task: undefined, order: undefined } : o);
  const report = validateRoomDefinition(room, entry);
  return { room, report: { ...report, attempts: 32, fallback: true, rejected: [...rejected, ...report.rejected] } };
}

const sharedRooms = new Map<number, { room: RoomDefinition; report: GenerationReport }>();
/** Geometry never depends on the first player to visit a room. Validate a
 * canonical entrance, then separately validate each player's entry profile. */
export function generateSharedRoom(seed: number): { room: RoomDefinition; report: GenerationReport } {
  let generated = sharedRooms.get(seed);
  if (!generated) {
    const adventure: AdventureSnake['adventure'] = { version: 1, charge: 0, polarity: 'NEUTRAL', coatings: ['NORMAL', 'NORMAL', 'NORMAL'], completed: [], sequence: {}, temporary: {}, occupied: [], activeMs: 0, path: [], entryLength: 3, entrySpeed: 300 };
    generated = generateValidatedRoom(seed, { segments: [{ x: 5, y: 5, z: 5 }, { x: 5, y: 5, z: 4 }, { x: 5, y: 5, z: 3 }], direction: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 }, score: 0, speed: 300, growth: 0, adventure });
    if (sharedRooms.size >= 128) sharedRooms.delete(sharedRooms.keys().next().value!);
    sharedRooms.set(seed, generated);
  }
  return copy(generated);
}
