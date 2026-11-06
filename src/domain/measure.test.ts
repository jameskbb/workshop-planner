import { describe, expect, it } from 'vitest';
import { createProject, placeObject, rectangleRoomPoints } from './factories';
import { ObjectDefinitionSchema, type Measurement, type Project } from './schema';
import { getScenario } from './resolve';
import { angleAt, entityName, objectFaceClearance, resolveMeasurement } from './measure';

const def = ObjectDefinitionSchema.parse({ id: 'box', name: 'Cabinet', category: 'storage', width: 1000, depth: 500, height: 900, source: 'builtin' });

function fixture(): Project {
  const p = createProject({ name: 'M', roomPoints: rectangleRoomPoints(6000, 5000) });
  p.definitions.push(def);
  const s = getScenario(p);
  s.objects.push(placeObject(def, { x: 1000, y: 1000, rotation: 0 }, { id: 'a' }));
  s.objects.push(placeObject(def, { x: 3500, y: 1000, rotation: 0 }, { id: 'b', name: 'Bench' }));
  return p;
}

const base: Omit<Measurement, 'kind'> = { id: 'm', a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, offset: 0, hidden: false };

describe('measurement resolution', () => {
  it('object ↔ object follows the objects and names them', () => {
    const p = fixture();
    const s = getScenario(p);
    const m: Measurement = { ...base, kind: 'object-object', anchorA: { kind: 'object', id: 'a' }, anchorB: { kind: 'object', id: 'b' } };
    const r = resolveMeasurement(p, s, m);
    expect(r.value).toBeCloseTo(1500, 6); // 3500−500 − (1000+500)
    expect(r.title).toBe('Cabinet → Bench');
    // State is immutable in the app (lookups are memoized by identity): replace, don't mutate.
    const moved = { ...s, objects: s.objects.map((o) => (o.id === 'b' ? { ...o, x: 4000 } : o)) };
    expect(resolveMeasurement(p, moved, m).value).toBeCloseTo(2000, 6);
  });

  it('wall ↔ object uses the interior wall face', () => {
    const p = fixture();
    const s = getScenario(p);
    const north = p.room.walls[0]!;
    const r = resolveMeasurement(p, s, { ...base, kind: 'wall-object', anchorA: { kind: 'wall', id: north.id }, anchorB: { kind: 'object', id: 'a' } });
    expect(r.value).toBeCloseTo(750, 6);
    expect(entityName(p, s, { kind: 'wall', id: north.id })).toBe('North wall');
  });

  it('clearance in front of an object (front = +y at rotation 0) stops at the south wall', () => {
    const p = fixture();
    const s = getScenario(p);
    const c = objectFaceClearance(p, s, 'a', 'front');
    expect(c!.distance).toBeCloseTo(5000 - 1250, 6);
    // To the east of the cabinet the bench is the obstacle.
    expect(objectFaceClearance(p, s, 'a', 'right')!.distance).toBeCloseTo(1500, 6);
    const r = resolveMeasurement(p, s, { ...base, kind: 'clearance', anchorA: { kind: 'object', id: 'a' }, side: 'right' });
    expect(r.value).toBeCloseTo(1500, 6);
  });

  it('falls back to stored points when an anchor is deleted', () => {
    const p = fixture();
    const s = getScenario(p);
    const m: Measurement = { ...base, kind: 'object-object', a: { x: 0, y: 0 }, b: { x: 300, y: 400 }, anchorA: { kind: 'object', id: 'gone' }, anchorB: { kind: 'object', id: 'b' } };
    const r = resolveMeasurement(p, s, m);
    expect(r.live).toBe(false);
    expect(r.value).toBeCloseTo(500, 6);
  });

  it('angular measurements', () => {
    expect(angleAt({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90, 9);
    expect(angleAt({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0.0001 })).toBeCloseTo(180, 1);
    const p = fixture();
    const r = resolveMeasurement(p, getScenario(p), { ...base, kind: 'angular', a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, c: { x: 10, y: 10 } });
    expect(r.value).toBeCloseTo(45, 9);
  });
});
