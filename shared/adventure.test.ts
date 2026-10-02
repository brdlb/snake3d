import { describe, expect, it } from 'vitest';
import { applyInteractions, advanceCoatings, checkPortal, checkpointBlocked, copy, createRoomDefinition, enterAdventure, moveAdventure, newAdventure, personalPortals, themeDepths, transitionAdventure, validAdventureRoom, type AdventureSnake, type InteractionDefinition } from './adventure';
import { validatePortalRoute } from './adventureGeneration';
import { roomSeed } from './roomCoordinates';

export function entry(length = 3, speed = 300): AdventureSnake {
  return { segments: Array.from({ length }, (_, i) => ({ x: 5, y: 5, z: 5 - i })), direction: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 }, score: 20, speed, growth: 0, adventure: newAdventure(length, speed) };
}
const seed = roomSeed({ x: 0, y: 0, z: 0 });
const room = createRoomDefinition(seed);
function at(kind: InteractionDefinition['kind'], snake: AdventureSnake, extra: Partial<InteractionDefinition> = {}) {
  return { ...room, interactions: [{ id: 'object', kind, theme: 'ENERGY' as const, position: copy(snake.segments[0]), ...extra }] };
}

describe('coordinate adventure rules', () => {
  it('maps signed coordinates into independent depths and stable theme priority', () => {
    expect(themeDepths({ x: -3, y: 4, z: 2 })).toEqual({ MASS: 0, TEMPO: 3, ENERGY: 4, TUNING: 0, CIRCUIT: 2 });
    expect(createRoomDefinition(roomSeed({ x: 2, y: 2, z: 2 })).themes).toEqual(['MASS', 'ENERGY']);
    expect(createRoomDefinition(roomSeed({ x: 99, y: 0, z: 0 })).portals.find(p => p.direction === 'xp')?.tier).toBe(3);
    expect(createRoomDefinition(roomSeed({ x: -1, y: 0, z: 0 })).portals.find(p => p.direction === 'xp')).toMatchObject({ theme: 'TEMPO', tier: 1 });
    expect(createRoomDefinition(roomSeed({ x: 0, y: -1, z: 0 })).portals.find(p => p.direction === 'yp')).toMatchObject({ theme: 'TUNING', tier: 1 });
  });
  it('has five exits at the floor, six above it, and rejects negative z', () => {
    expect(room.portals.filter(p => p.enabled)).toHaveLength(5);
    expect(createRoomDefinition(roomSeed({ x: 0, y: 0, z: 1 })).portals.filter(p => p.enabled)).toHaveLength(6);
    expect(validAdventureRoom(roomSeed({ x: 0, y: 0, z: -1 }))).toBe(false);
    expect(() => createRoomDefinition(roomSeed({ x: 0, y: 0, z: -1 }))).toThrow();
  });
  it('is deterministic and leaves central entrance approaches empty', () => {
    expect(createRoomDefinition(seed)).toEqual(room);
    for (const o of room.interactions) expect([o.position.x, o.position.y, o.position.z].filter(v => v === 25).length).toBeLessThan(2);
  });
  it('locks length and speed targets to entry state, not current state', () => {
    const s = entry();
    expect(personalPortals(room, s.adventure).find(p => p.direction === 'xp')?.requirements[0]).toMatchObject({ min: 6 });
    s.segments.push({ x: 5, y: 5, z: 2 }); s.speed = 900;
    expect(personalPortals(room, s.adventure).find(p => p.direction === 'xn')?.requirements[0]).toMatchObject({ min: 350 });
    expect(checkPortal(room, 'xp', s).open).toBe(false);
  });
  it('consumes charge on advancement and only pops an actual reverse route', () => {
    const s = entry(); s.adventure.charge = 3;
    const forward = transitionAdventure(room, 'yp', s)!;
    expect(forward.snake.adventure.charge).toBe(2);
    expect(forward.path).toEqual([seed]);
    const nextSeed = roomSeed({ x: 0, y: 1, z: 0 });
    const checkpoint = enterAdventure(forward.snake, nextSeed, forward.path);
    checkpoint.snake.adventure.charge = 0;
    const back = transitionAdventure(createRoomDefinition(nextSeed), 'yn', checkpoint.snake)!;
    expect(back.path).toEqual([]);
    expect(back.snake.adventure.charge).toBe(0);
    const returned = enterAdventure(back.snake, seed, back.path);
    expect(checkPortal(room, 'yp', returned.snake).open).toBe(false);
  });
  it('captures complete post-payment checkpoint without sharing mutable state', () => {
    const s = entry(6); s.growth = 2; s.adventure.charge = 2; s.adventure.coatings[1] = 'INSULATED';
    const cp = enterAdventure(s, seed, [seed + 1]);
    s.segments[0].x++; s.growth = 0; s.adventure.coatings[1] = 'NORMAL';
    expect(cp.snake.growth).toBe(2); expect(cp.snake.score).toBe(20);
    expect(cp.snake.segments[0].x).toBe(5); expect(cp.snake.adventure.coatings[1]).toBe('INSULATED');
    expect(checkpointBlocked(cp, [{ alive: true, segments: [cp.snake.segments[5]] }])).toBe(true);
    expect(checkpointBlocked(cp, [{ alive: false, segments: [cp.snake.segments[0]] }])).toBe(false);
  });
});

describe('personal interactions', () => {
  it('converts three tail segments once on entry without dropping below three', () => {
    const s = entry(6); const r = at('MASS_CONVERTER', s);
    applyInteractions(r, s, 200); applyInteractions(r, s, 200);
    expect(s.segments).toHaveLength(3); expect(s.adventure.charge).toBe(1);
    s.adventure.occupied = []; applyInteractions(r, s, 200);
    expect(s.segments).toHaveLength(3); expect(s.adventure.charge).toBe(1);
  });
  it('caps charge, checks speed and gives resources independently', () => {
    const s = entry(), other = entry(); s.adventure.charge = 12;
    const r = at('DYNAMO', s, { minSpeed: 300 });
    applyInteractions(r, s, 200); applyInteractions(r, other, 200);
    expect(s.adventure.charge).toBe(12); expect(other.adventure.charge).toBe(1);
    const slow = entry(3, 60); applyInteractions(r, slow, 200); expect(slow.adventure.charge).toBe(0);
  });
  it('brakes only for an available charge and never below 60 SPM', () => {
    const s = entry(3, 80), r = at('BRAKE', s);
    applyInteractions(r, s, 200); expect(s.speed).toBe(80);
    s.adventure.charge = 1; s.adventure.occupied = [];
    applyInteractions(r, s, 200); expect(s.speed).toBe(60); expect(s.adventure.charge).toBe(0);
  });
  it('sets and clears polarity', () => {
    const s = entry(); applyInteractions(at('POLARIZER', s, { polarity: 'NEGATIVE' }), s, 200);
    expect(s.adventure.polarity).toBe('NEGATIVE'); s.adventure.occupied = [];
    applyInteractions(at('CLEANER', s), s, 200); expect(s.adventure.polarity).toBe('NEUTRAL');
  });
  it('resets only the wrong sequence and completes ordered stages', () => {
    const s = entry(); s.adventure.sequence.other = 2;
    applyInteractions(at('BEACON', s, { task: 'test', order: 1 }), s, 200);
    expect(s.adventure.sequence.test).toBe(0); expect(s.adventure.sequence.other).toBe(2);
    const first = { id: 'a', kind: 'BEACON' as const, theme: 'TUNING' as const, position: { x: 5, y: 5, z: 5 }, task: 'test', order: 0 };
    const second = { ...first, id: 'b', position: { x: 5, y: 5, z: 6 }, order: 1 };
    const r = { ...room, interactions: [first, second] };
    s.adventure.occupied = []; applyInteractions(r, s, 200);
    s.segments[0].z = 6; applyInteractions(r, s, 200);
    expect(s.adventure.completed).toContain('test');
  });
  it('expires temporary charge in simulation time and pauses without a step', () => {
    const s = entry(); const r = at('TEMPORARY', s, { task: 'timer', durationMs: 1000 });
    applyInteractions(r, s, 200); expect(s.adventure.temporary.timer).toBe(1200);
    const saved = copy(s); expect(saved.adventure.activeMs).toBe(200);
    applyInteractions({ ...room, interactions: [] }, s, 1000);
    expect(s.adventure.temporary.timer <= s.adventure.activeMs).toBe(true);
  });
  it('keeps segment coatings on movement, appends ordinary growth and trims removed tails', () => {
    expect(advanceCoatings(['CONDUCTIVE', 'INSULATED', 'NORMAL'], 4)).toEqual(['CONDUCTIVE', 'INSULATED', 'NORMAL', 'NORMAL']);
    const s = entry(); s.adventure.coatings[0] = 'CONDUCTIVE'; s.growth = 1;
    const next = moveAdventure(s, { x: 1, y: 0, z: 0 })!;
    expect(next.adventure.coatings[0]).toBe('CONDUCTIVE'); expect(next.segments).toHaveLength(4);
    expect(moveAdventure(s, { x: 0, y: 0, z: -1 })).toBeNull();
  });
  it('requires simultaneous contact with the right coatings', () => {
    const s = entry(); const r = { ...room, interactions: s.segments.filter((_, i) => i !== 1).map((position, i): InteractionDefinition => ({ id: String(i), position, kind: 'CONTACT', task: 'bridge', theme: 'CIRCUIT', coating: 'CONDUCTIVE' })) };
    applyInteractions(r, s, 200); expect(s.adventure.completed).toEqual([]);
    s.adventure.coatings = ['CONDUCTIVE', 'NORMAL', 'CONDUCTIVE'];
    applyInteractions(r, s, 200); expect(s.adventure.completed).toContain('bridge');
  });
});

describe('procedural route witnesses', () => {
  it('turns safely before returning rather than reversing into the incoming tail', () => {
    const s = entry(); s.segments = [{x:0,y:25,z:25},{x:-1,y:25,z:25},{x:-2,y:25,z:25}]; s.direction = {x:1,y:0,z:0}; s.adventure.path = [seed];
    const result = validatePortalRoute(createRoomDefinition(roomSeed({x:1,y:0,z:0})), s, 'xn');
    expect(result.valid, result.reason).toBe(true); expect(result.route.length).toBeGreaterThan(2);
  });
  for (const [direction, coordinates] of [
    ['xp', { x: 0, y: 0, z: 0 }], ['xn', { x: 0, y: 0, z: 0 }], ['yp', { x: 0, y: 0, z: 0 }], ['yn', { x: 0, y: 0, z: 0 }], ['zp', { x: 0, y: 0, z: 0 }],
    ['xp', { x: 2, y: 0, z: 0 }], ['xn', { x: -2, y: 0, z: 0 }], ['yp', { x: 0, y: 2, z: 0 }], ['yn', { x: 0, y: -2, z: 0 }], ['zp', { x: 0, y: 0, z: 2 }],
    ['xp', { x: 1, y: 0, z: 0 }], ['xn', { x: -1, y: 0, z: 0 }], ['yp', { x: 0, y: 1, z: 0 }], ['yn', { x: 0, y: -1, z: 0 }], ['zp', { x: 0, y: 0, z: 1 }],
    ['xp', { x: 4, y: 2, z: 0 }], ['xp', { x: 4, y: -2, z: 0 }], ['zp', { x: -2, y: 0, z: 4 }], ['zp', { x: 2, y: 0, z: 4 }],
    ['xp', { x: 4, y: 0, z: 2 }],
  ] as const) it(`finds a full-body route for ${direction} at ${JSON.stringify(coordinates)}`, () => {
    const result = validatePortalRoute(createRoomDefinition(roomSeed(coordinates)), entry(), direction);
    expect(result.valid, result.reason).toBe(true);
    expect(result.route.length).toBeGreaterThan(0);
  });
  for (const length of [3, 9, 24]) it(`validates a long-body energy recipe at length ${length}`, () => {
    const result = validatePortalRoute(createRoomDefinition(roomSeed({ x: 0, y: 2, z: 0 })), entry(length), 'yp');
    expect(result.valid, result.reason).toBe(true);
  });
});
