import { beforeEach, describe, expect, it } from 'vitest';
import { dispatch, loadProject, undo, useProjectStore } from '@/stores/projectStore';
import { createProject, createRoom, rectangleRoomPoints } from './factories';
import { feetInches } from './units';
import { bearingOfDirection, directionOfBearing, moveVerticesEdit, roomProblem, setWallLengthEdit, wallLetter } from './roomEdit';
import { outlineFromWalls, ROOM_TEMPLATES, roomTemplate, templateDefaults } from './roomTemplates';
import { area, distance, interiorAngles } from '@/geometry';
import type { Room } from './schema';

const W = 6000;
const D = 5000;
const room = () => useProjectStore.getState().project!.room;
const len = (r: Room, i: number) => distance(r.vertices[i]!, r.vertices[(i + 1) % r.vertices.length]!);
const fmt = (mm: number) => `${mm}mm`;

beforeEach(() => {
  loadProject(createProject({ name: 'Edit test', roomPoints: rectangleRoomPoints(W, D) }));
});

describe('exact wall length / angle', () => {
  it('lengthening a wall carries the next wall along, keeping the room rectangular', () => {
    const north = room().walls[0]!;
    expect(dispatch({ type: 'room.setWallLength', payload: { wallId: north.id, length: 7000 } }).ok).toBe(true);
    const r = room();
    expect(len(r, 0)).toBeCloseTo(7000, 2);
    expect(len(r, 1)).toBeCloseTo(D, 2); // east wall unchanged
    expect(len(r, 2)).toBeCloseTo(7000, 2); // south wall absorbs
    expect(interiorAngles(r.vertices).every((a) => Math.abs(a - 90) < 1e-6)).toBe(true);
    undo();
    expect(len(room(), 0)).toBeCloseTo(W, 2);
  });

  it('refuses to change a locked length with a clear explanation', () => {
    const north = room().walls[0]!;
    dispatch({ type: 'room.setWallConstraints', payload: { wallId: north.id, constraints: { lockLength: true } } });
    const r = dispatch({ type: 'room.setWallLength', payload: { wallId: north.id, length: 7000 } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/North wall's length is locked/);
    expect(len(room(), 0)).toBeCloseTo(W, 2);
  });

  it('sets a wall direction by compass bearing and a corner angle', () => {
    const east = room().walls[1]!;
    // East wall runs south (bearing 180). Tilt it to bearing 170 (slightly west of south? no: 170 = toward SSE).
    expect(dispatch({ type: 'room.setWallDirection', payload: { wallId: east.id, direction: directionOfBearing(170) } }).ok).toBe(true);
    const r = room();
    const dir = Math.atan2(r.vertices[2]!.y - r.vertices[1]!.y, r.vertices[2]!.x - r.vertices[1]!.x) * (180 / Math.PI);
    expect(bearingOfDirection(dir)).toBeCloseTo(170, 4);
    // Put the NE corner back to 90°.
    expect(dispatch({ type: 'room.setCornerAngle', payload: { vertexId: r.vertices[1]!.id, angle: 90 } }).ok).toBe(true);
    expect(interiorAngles(room().vertices)[1]).toBeCloseTo(90, 4);
  });
});

describe('constraints on corner drags', () => {
  it('keeps horizontal/vertical walls square when a corner is dragged', () => {
    for (const [i, c] of [
      [0, { horizontal: true }],
      [1, { vertical: true }],
      [2, { horizontal: true }],
      [3, { vertical: true }],
    ] as const) {
      expect(dispatch({ type: 'room.setWallConstraints', payload: { wallId: room().walls[i]!.id, constraints: c } }).ok).toBe(true);
    }
    const ne = room().vertices[1]!;
    expect(dispatch({ type: 'room.moveVertex', payload: { vertexId: ne.id, x: 6500, y: -500 } }).ok).toBe(true);
    const v = room().vertices;
    expect(v[0]).toMatchObject({ x: 0, y: -500 });
    expect(v[1]).toMatchObject({ x: 6500, y: -500 });
    expect(v[2]).toMatchObject({ x: 6500, y: D });
    expect(v[3]).toMatchObject({ x: 0, y: D });
  });

  it('turning a constraint on reshapes the room to satisfy it', () => {
    const v = room().vertices;
    dispatch({ type: 'room.moveVertex', payload: { vertexId: v[1]!.id, x: W, y: 300 } }); // tilt the north wall
    expect(room().vertices[1]!.y).toBe(300);
    expect(dispatch({ type: 'room.setWallConstraints', payload: { wallId: room().walls[0]!.id, constraints: { horizontal: true } } }).ok).toBe(true);
    const after = room().vertices;
    expect(after[0]!.y).toBeCloseTo(after[1]!.y, 2);
  });

  it('rejects contradictory constraints', () => {
    const w = room().walls[0]!;
    const r = dispatch({ type: 'room.setWallConstraints', payload: { wallId: w.id, constraints: { horizontal: true, vertical: true } } });
    expect(r.ok).toBe(false);
    const self = dispatch({ type: 'room.setWallConstraints', payload: { wallId: w.id, constraints: { parallelTo: w.id } } });
    expect(!self.ok && self.error).toMatch(/parallel to itself/);
  });

  it('refuses a drag that would break a locked length and names the wall', () => {
    const walls = room().walls;
    dispatch({ type: 'room.setWallConstraints', payload: { wallId: walls[0]!.id, constraints: { lockLength: true } } });
    dispatch({ type: 'room.setWallConstraints', payload: { wallId: walls[3]!.id, constraints: { lockLength: true } } });
    dispatch({ type: 'room.setWallConstraints', payload: { wallId: walls[1]!.id, constraints: { lockLength: true } } });
    dispatch({ type: 'room.setWallConstraints', payload: { wallId: walls[2]!.id, constraints: { lockLength: true } } });
    // With all four lengths locked the rectangle can only shear; pulling a corner far away is impossible.
    const before = JSON.parse(JSON.stringify(room()));
    const r = dispatch({ type: 'room.moveVertex', payload: { vertexId: room().vertices[1]!.id, x: 20000, y: 0 } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/length is locked/);
    expect(room()).toEqual(before);
  });

  it('parallel constraint follows the reference wall', () => {
    const walls = room().walls;
    // South wall parallel to north wall; then tilt the north wall by moving the NE corner.
    dispatch({ type: 'room.setWallConstraints', payload: { wallId: walls[2]!.id, constraints: { parallelTo: walls[0]!.id } } });
    expect(dispatch({ type: 'room.moveVertex', payload: { vertexId: room().vertices[1]!.id, x: W, y: -400 } }).ok).toBe(true);
    const v = room().vertices;
    const northDir = Math.atan2(v[1]!.y - v[0]!.y, v[1]!.x - v[0]!.x);
    const southDir = Math.atan2(v[3]!.y - v[2]!.y, v[3]!.x - v[2]!.x);
    expect(Math.abs(Math.sin(northDir - southDir))).toBeLessThan(1e-4);
  });

  it('splitting a wall drops its length lock and keeps direction locks on both halves', () => {
    const north = room().walls[0]!;
    dispatch({ type: 'room.setWallConstraints', payload: { wallId: north.id, constraints: { horizontal: true, lockLength: true } } });
    expect(dispatch({ type: 'room.insertVertex', payload: { wallId: north.id, offset: 2000, vertexId: 'mid', newWallId: 'north-b' } }).ok).toBe(true);
    const walls = room().walls;
    expect(walls[0]!.constraints).toEqual({ horizontal: true });
    expect(walls[1]!.constraints).toEqual({ horizontal: true });
    // Removing the corner again is fine (the merged wall is still horizontal).
    expect(dispatch({ type: 'room.deleteVertex', payload: { vertexId: 'mid' } }).ok).toBe(true);
  });

  it('refuses to remove a corner when the merged wall has a locked length', () => {
    const r0 = room();
    dispatch({ type: 'room.insertVertex', payload: { wallId: r0.walls[0]!.id, offset: 2000, vertexId: 'mid', newWallId: 'north-b' } });
    dispatch({ type: 'room.setWallConstraints', payload: { wallId: room().walls[0]!.id, constraints: { lockLength: true } } });
    const r = dispatch({ type: 'room.deleteVertex', payload: { vertexId: 'mid' } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/break a wall constraint/);
  });
});

describe('pure edit helpers', () => {
  it('reports self-intersection with the brief wording', () => {
    const bow = [
      { x: 0, y: 0 },
      { x: 1000, y: 1000 },
      { x: 1000, y: 0 },
      { x: 0, y: 1000 },
    ];
    expect(roomProblem(bow)).toBe('This would cause the room boundary to intersect itself.');
    const r = moveVerticesEdit(createRoom(rectangleRoomPoints(W, D)), [{ vertexId: 'nope', x: 0, y: 0 }], fmt);
    expect(r.ok).toBe(false);
  });

  it('refuses a length change that would make the outline cross itself', () => {
    const r = createRoom(rectangleRoomPoints(W, D));
    // Shrinking the north wall to almost nothing and beyond is refused before it self-intersects.
    expect(setWallLengthEdit(r, r.walls[0]!.id, 0.5, fmt).ok).toBe(false);
  });

  it('letters and bearings', () => {
    expect([0, 1, 25, 26, 27].map(wallLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB']);
    expect(bearingOfDirection(0)).toBe(90); // east
    expect(bearingOfDirection(-90)).toBe(0); // north
    expect(bearingOfDirection(90)).toBe(180); // south
    expect(bearingOfDirection(180)).toBe(270); // west
  });
});

describe('room templates', () => {
  it('every template builds a valid outline with openings on real walls', () => {
    for (const t of ROOM_TEMPLATES) {
      const p = templateDefaults(t, 'imperial');
      expect(t.validate?.(p) ?? null).toBeNull();
      const { points, openings } = t.build(p);
      expect(roomProblem(points)).toBeNull();
      for (const o of openings) {
        const a = points[o.wallIndex]!;
        const b = points[(o.wallIndex + 1) % points.length]!;
        const L = distance(a, b);
        expect(o.offset - o.width / 2).toBeGreaterThanOrEqual(0);
        expect(o.offset + o.width / 2).toBeLessThanOrEqual(L + 1e-6);
      }
      expect(roomProblem(t.build(templateDefaults(t, 'metric')).points)).toBeNull();
    }
  });

  it('L-shape has the notch area removed', () => {
    const t = roomTemplate('l-shape');
    const p = { width: feetInches(22, 0), depth: feetInches(24, 0), notchWidth: feetInches(8, 0), notchDepth: feetInches(6, 0) };
    expect(area(t.build(p).points)).toBeCloseTo(p.width * p.depth - p.notchWidth * p.notchDepth, 0);
    expect(t.validate!({ ...p, notchWidth: p.width })).toMatch(/smaller/);
  });

  it('builds an outline from typed wall lengths and turns (and closes it)', () => {
    const inch = 25.4;
    const walls = [
      { length: 258 * inch, turn: 0 }, // Wall A: 21' 6"
      { length: 288 * inch, turn: 90 }, // Wall B: 24'
      { length: 258 * inch, turn: 90 }, // Wall C
    ];
    const open = outlineFromWalls(walls, { close: true });
    expect(open.points).toHaveLength(4);
    expect(open.closingLength).toBeCloseTo(288 * inch, 6);
    const closed = outlineFromWalls([...walls, { length: 288 * inch, turn: 90 }]);
    expect(closed.points).toHaveLength(4);
    expect(closed.closingGap).toBeLessThan(0.5);
    expect(area(closed.points)).toBeCloseTo(258 * 288 * inch * inch, 0);
  });
});
