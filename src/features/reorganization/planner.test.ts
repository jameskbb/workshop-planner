import { describe, expect, it } from 'vitest';
import { createDemoProject } from '@/features/projects/demo';
import { localRect, localPolygonToWorld, polygonContainsPolygon, roomWalls, type Pose } from '@/geometry';
import { atSpot, blocks, describeSpot, findStagingSpot, planMoves, regionName, rotationDelta, stronglyConnected, type ItemPlacement, type MoveItem, type PlannerInput } from './planner';
import { buildPlannerInput, diffLayouts, estimateWeightKg } from './input';
import { resolveObject } from '@/domain/resolve';

// A 6 m × 5 m room, NW interior corner at the origin (+x east, +y south).
const ROOM = [
  { x: 0, y: 0 },
  { x: 6000, y: 0 },
  { x: 6000, y: 5000 },
  { x: 0, y: 5000 },
];
const room: PlannerInput['room'] = { polygon: ROOM, walls: roomWalls(ROOM) };

function at(x: number, y: number, w = 600, d = 600, rotation = 0, z: [number, number] = [0, 900]): ItemPlacement {
  const pose: Pose = { x, y, rotation };
  return { pose, polygon: localPolygonToWorld(pose, localRect(w, d)), z };
}

function item(id: string, name: string, from: ItemPlacement | null, to: ItemPlacement | null, weightKg = 30, mobile = false): MoveItem {
  return { id, kind: 'object', name, category: 'storage', weightKg, mobile, from, to };
}

const plan = (items: MoveItem[], extra: Partial<PlannerInput> = {}) => planMoves({ room, items, fixed: [], ...extra });

describe('location phrases', () => {
  it('names regions and wall spots', () => {
    const box = { minX: 0, minY: 0, maxX: 6000, maxY: 5000 };
    expect(regionName({ x: 300, y: 4700 }, box)).toBe('southwest corner');
    expect(regionName({ x: 3000, y: 2500 }, box)).toBe('middle of the room');
    expect(regionName({ x: 3000, y: 300 }, box)).toBe('north side');
    expect(describeSpot(at(3000, 350).polygon, room)).toBe('the North wall');
    expect(describeSpot(at(350, 4650).polygon, room)).toBe('the southwest corner');
    expect(describeSpot(at(3000, 2500).polygon, room)).toBe('the middle of the room');
  });

  it('says "against" for walls (including named wall segments) and "in" for regions and corners', () => {
    expect(atSpot('the North wall')).toBe('against the North wall');
    expect(atSpot('the East wall (south)')).toBe('against the East wall (south)');
    expect(atSpot('the northeast corner')).toBe('in the northeast corner');
    expect(atSpot('the middle of the room')).toBe('in the middle of the room');
    expect(atSpot('the corner of the North wall and the East wall')).toBe('in the corner of the North wall and the East wall');
  });

  it('rotationDelta picks the short way', () => {
    expect(rotationDelta(0, 90)).toBe(90);
    expect(rotationDelta(0, 270)).toBe(-90);
    expect(rotationDelta(350, 10)).toBe(20);
  });
});

describe('blocks()', () => {
  it('needs plan overlap and vertical overlap; touching is fine', () => {
    expect(blocks(at(1000, 1000), at(1300, 1000))).toBe(true);
    expect(blocks(at(1000, 1000), at(1600, 1000))).toBe(false); // edges touch
    // A wall cabinet hung above a bench does not block it.
    expect(blocks(at(1000, 1000, 600, 600, 0, [1400, 2100]), at(1000, 1000, 600, 600, 0, [0, 900]))).toBe(false);
  });
});

describe('stronglyConnected', () => {
  it('finds cycles', () => {
    const edges = new Map([
      ['a', new Set(['b'])],
      ['b', new Set(['a'])],
      ['c', new Set(['a'])],
    ]);
    const comps = stronglyConnected(['a', 'b', 'c'], edges).map((c) => c.sort().join());
    expect(comps).toContain('a,b');
    expect(comps).toContain('c');
  });
});

describe('planMoves', () => {
  it('moves an item whose target is free in one step, described by the wall', () => {
    const p = plan([item('cab', 'Rolling cabinet', at(3000, 2500), at(3000, 350))]);
    expect(p.steps).toHaveLength(1);
    expect(p.steps[0]!.title).toBe('Move the rolling cabinet to the North wall');
    expect(p.steps[0]!.key).toBe('move:cab');
    expect(p.totalMoves).toBe(1);
    expect(p.stagedIds).toEqual([]);
  });

  it('clears a target spot first and phrases "into X\'s previous position"', () => {
    // The planer goes where the cabinet is now; the cabinet goes to the north wall.
    const p = plan([item('planer', 'Planer', at(5000, 2500), at(3000, 2500)), item('cab', 'Rolling cabinet', at(3000, 2500), at(3000, 350))]);
    expect(p.steps.map((s) => s.key)).toEqual(['move:cab', 'move:planer']);
    expect(p.steps[1]!.title).toBe("Move the planer into the rolling cabinet's previous position");
  });

  it('resolves a swap by staging the lighter item; the heavy one moves once', () => {
    const p = plan([item('heavy', 'Tool chest', at(1000, 2500), at(4000, 2500), 160), item('light', 'Shop vac', at(4000, 2500), at(1000, 2500), 12)]);
    expect(p.stagedIds).toEqual(['light']);
    expect(p.repeatedHeavyIds).toEqual([]);
    expect(p.steps.map((s) => s.kind)).toEqual(['stage', 'move', 'move']);
    expect(p.steps[0]!.title).toMatch(/^Clear the /);
    expect(p.steps[0]!.detail).toMatch(/temporarily/);
    expect(p.steps[1]!.itemIds).toEqual(['heavy']);
    expect(p.steps[1]!.heavy).toBe(true);
    expect(p.steps[2]!.key).toBe('final:light');
    expect(p.steps[2]!.detail).toMatch(/temporary spot/);
    expect(p.totalMoves).toBe(3);
  });

  it('counts casters: a heavy cabinet on casters is staged before a lighter static tool', () => {
    const p = plan([item('rolling', 'Rolling cabinet', at(1000, 2500), at(4000, 2500), 100, true), item('saw', 'Table saw', at(4000, 2500), at(1000, 2500), 60, false)]);
    // effort: rolling 35 kg vs saw 60 kg
    expect(p.stagedIds).toEqual(['rolling']);
  });

  it('staging spots are inside the room and block no current or target position', () => {
    const a = item('a', 'A', at(1000, 2500, 800, 800), at(4000, 2500, 800, 800), 100);
    const b = item('b', 'B', at(4000, 2500, 800, 800), at(1000, 2500, 800, 800), 20);
    const p = plan([a, b]);
    const stage = p.steps.find((s) => s.kind === 'stage')!;
    expect(stage.toPolygon).toBeDefined();
    const spot = { polygon: stage.toPolygon!, z: [0, 900] as [number, number] };
    expect(polygonContainsPolygon(ROOM, spot.polygon)).toBe(true);
    for (const pl of [a.from!, a.to!, b.to!]) expect(blocks(spot, pl)).toBe(false);
  });

  it('falls back to "outside the garage" when there is no open floor', () => {
    const tiny = [
      { x: 0, y: 0 },
      { x: 1200, y: 0 },
      { x: 1200, y: 600 },
      { x: 0, y: 600 },
    ];
    const p = planMoves({
      room: { polygon: tiny, walls: roomWalls(tiny) },
      items: [item('a', 'Cabinet A', at(300, 300), at(900, 300), 80), item('b', 'Cabinet B', at(900, 300), at(300, 300), 50)],
      fixed: [],
    });
    const stage = p.steps.find((s) => s.kind === 'stage')!;
    expect(stage.itemIds).toEqual(['b']);
    expect(stage.detail).toMatch(/outside the garage/);
  });

  it('handles a three-way cycle with one staging move', () => {
    const p = plan([
      item('a', 'A', at(1000, 1000), at(3000, 1000), 90),
      item('b', 'B', at(3000, 1000), at(5000, 1000), 70),
      item('c', 'C', at(5000, 1000), at(1000, 1000), 10),
    ]);
    expect(p.stagedIds).toEqual(['c']);
    expect(p.totalMoves).toBe(4);
    expect(p.repeatedHeavyIds).toEqual([]);
  });

  it('groups removals by area and does them first; vehicles leave first and park last', () => {
    const car: MoveItem = { id: 'car', kind: 'vehicle', name: 'Sedan', category: 'vehicle', weightKg: 0, mobile: true, from: at(1500, 2500, 1800, 4700), to: null };
    const p = plan([
      item('vac', 'Shop vac', at(300, 4700, 400, 400), null, 10),
      item('box', 'Lumber cart', at(700, 4700, 400, 400), null, 20),
      item('saw', 'Table saw', at(5000, 1000), at(1500, 2500), 100),
      car,
      { id: 'car2', kind: 'vehicle', name: 'Truck', category: 'vehicle', weightKg: 0, mobile: true, from: null, to: at(4500, 3500, 1800, 2000) },
    ]);
    expect(p.steps[0]!.kind).toBe('vehicle-out');
    expect(p.steps[0]!.title).toBe('Drive the sedan out of the garage');
    expect(p.steps[1]!.kind).toBe('clear');
    expect(p.steps[1]!.title).toBe('Clear the southwest corner');
    expect(p.steps[1]!.itemIds.sort()).toEqual(['box', 'vac']);
    // The saw can go where the car was, since the car left first.
    expect(p.steps[2]!.title).toBe("Move the table saw into the sedan's previous position");
    expect(p.steps.at(-1)!.kind).toBe('vehicle-in');
  });

  it('brings new items in after the moves', () => {
    const p = plan([item('new', 'Drill press', null, at(3000, 350)), item('m', 'Cart', at(1000, 1000), at(2000, 1000))]);
    expect(p.steps.map((s) => s.kind)).toEqual(['move', 'bring-in']);
    expect(p.steps[1]!.title).toBe('Bring in the drill press and place it against the North wall');
  });

  it('respects statuses: moved = done, skipped = stays, blocked = deferred and blocks dependants', () => {
    const items = [
      item('a', 'Cabinet', at(3000, 2500), at(3000, 350)),
      item('b', 'Planer', at(5000, 2500), at(3000, 2500)),
      item('c', 'Bench', at(1000, 4000, 1200, 600), at(1000, 1000, 1200, 600)),
    ];
    // Cabinet cannot move yet → planer (which needs the cabinet's spot) waits.
    const blocked = plan(items, { status: { 'move:a': 'blocked' } });
    expect(blocked.steps.find((s) => s.itemIds[0] === 'b')!.kind).toBe('waiting');
    expect(blocked.steps.find((s) => s.itemIds[0] === 'b')!.waitingOn).toEqual(['Cabinet']);
    expect(blocked.steps.at(-1)!.kind).toBe('deferred');
    expect(blocked.steps.find((s) => s.itemIds[0] === 'c')!.kind).toBe('move');

    const moved = plan(items, { status: { 'move:a': 'moved' } });
    expect(moved.steps[0]!.detail).toBe('Already moved.');
    expect(moved.steps.find((s) => s.itemIds[0] === 'b')!.kind).toBe('move');

    const skipped = plan(items, { status: { 'move:c': 'skipped' } });
    expect(skipped.steps.some((s) => s.itemIds.includes('c'))).toBe(false);
    expect(skipped.notes.join()).toMatch(/bench stays where it is/);
  });

  it('a staged step marked moved no longer blocks: regeneration finishes without re-staging', () => {
    const items = [item('heavy', 'Tool chest', at(1000, 2500), at(4000, 2500), 160), item('light', 'Shop vac', at(4000, 2500), at(1000, 2500), 12)];
    const p = plan(items, { status: { 'stage:light': 'moved' } });
    expect(p.stagedIds).toEqual([]);
    expect(p.steps.map((s) => s.kind)).toEqual(['stage', 'move', 'move']);
    expect(p.steps[0]!.detail).toBe('Already moved.');
  });

  it('notes target-layout conflicts with things that do not move', () => {
    const p = plan([item('a', 'Cart', at(1000, 1000), at(3000, 2500))], { fixed: [{ name: 'Support pole', polygon: at(3000, 2500, 100, 100).polygon, z: [0, 2700] }] });
    expect(p.notes[0]).toMatch(/overlaps the support pole/);
  });

  it('findStagingSpot prefers open floor near the item', () => {
    const it = item('x', 'X', at(1000, 1000), at(5000, 4000));
    const spot = findStagingSpot(it, room, [{ name: 'o', polygon: at(1000, 1000, 700, 700).polygon, z: [0, 900] }], { x: 1000, y: 1000 })!;
    expect(spot).not.toBeNull();
    expect(Math.hypot(spot.pose.x - 1000, spot.pose.y - 1000)).toBeLessThan(1200);
  });
});

describe('project adapter', () => {
  it('diffs the demo layouts and plans a sensible reorganization', () => {
    const project = createDemoProject();
    const [car, shop] = project.scenarios;
    const diff = diffLayouts(project, car!, shop!);
    const byName = (re: RegExp) => diff.find((d) => re.test(d.name))!;
    expect(byName(/sedan/i).change).toBe('removed');
    expect(byName(/planer/i).change).toBe('moved');
    expect(byName(/shelving/i).change).toBe('moved');
    expect(byName(/miter/i).change).toBe('unchanged');
    expect(byName(/miter/i).reconfigured).toBe(true);
    expect(byName(/workbench/i).change).toBe('unchanged');

    const { input } = buildPlannerInput(project, car!.id, shop!.id);
    const p = planMoves(input);
    // The car leaves first; the shelving rolls into the empty bay afterwards.
    expect(p.steps[0]!.title).toBe('Drive the sedan out of the garage');
    const shelf = p.steps.findIndex((s) => /shelving/i.test(s.title));
    expect(shelf).toBeGreaterThan(0);
    expect(p.repeatedHeavyIds).toEqual([]);
  });

  it('reads weights from labels ("350 lb") or estimates from size', () => {
    const project = createDemoProject();
    const s = project.scenarios[0]!;
    const cab = s.objects.find((o) => /tool cabinet/i.test(o.label ?? ''))!;
    expect(estimateWeightKg(resolveObject(project, cab)).kg).toBeCloseTo(158.76, 1);
    const cart = s.objects.find((o) => /tool cart/i.test(o.name))!;
    const known = estimateWeightKg(resolveObject(project, cart));
    expect(known.estimated).toBe(false);
    // Without a library weight the estimate comes from size × category density.
    project.definitions = project.definitions.map((d) => ({ ...d, weightKg: undefined }));
    const w = estimateWeightKg(resolveObject(project, { ...cart }));
    expect(w.estimated).toBe(true);
    expect(w.kg).toBeGreaterThan(2);
  });
});
