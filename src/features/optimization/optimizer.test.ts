import { describe, expect, it } from 'vitest';
import '@/domain/commands';
import { analyzeLayout } from '@/analysis';
import { createProject, placeObject, rectangleRoomPoints } from '@/domain/factories';
import { getScenario, objectFootprint, resolveObject, roomGeometry } from '@/domain/resolve';
import { inches } from '@/domain/units';
import type { Project } from '@/domain/schema';
import { polygonContainsPolygon, satConvex } from '@/geometry';
import { builtinObject } from '@/features/objects/library';
import { createDemoProject } from '@/features/projects/demo';
import { loadProject, transact, useProjectStore } from '@/stores/projectStore';
import { buildModel, candidateCommands, convexClipArea, DEFAULT_PRIORITIES, optimizeLayout, presetPriorities, projectWithCandidate, prng } from './optimizer';
import { runAssistant } from './evaluate';

function shop(): Project {
  const p = createProject({ name: 'T', roomPoints: rectangleRoomPoints(inches(240), inches(200)) });
  const defs = ['table-saw', 'workbench', 'base-cabinet', 'shelving', 'planer', 'mobile-tool-cart'].map(builtinObject);
  p.definitions = defs;
  const [saw, bench, cab, shelf, planer, cart] = defs;
  p.scenarios[0]!.objects = [
    placeObject(saw!, { x: inches(120), y: inches(100), rotation: 0 }, { id: 'saw' }),
    placeObject(bench!, { x: inches(60), y: inches(60), rotation: 45 }, { id: 'bench', locked: true }),
    placeObject(cab!, { x: inches(180), y: inches(60), rotation: 0 }, { id: 'cab' }),
    placeObject(shelf!, { x: inches(190), y: inches(150), rotation: 0 }, { id: 'shelf' }),
    placeObject(planer!, { x: inches(60), y: inches(150), rotation: 0 }, { id: 'planer' }),
    placeObject(cart!, { x: inches(120), y: inches(170), rotation: 0 }, { id: 'cart' }),
  ];
  return p;
}

/** Every floor footprint inside the room and no two overlapping (3D-aware like the analyzer). */
function assertValid(p: Project, sid: string) {
  const s = getScenario(p, sid);
  const room = roomGeometry(p.room).polygon;
  const r = s.objects.map((o) => resolveObject(p, o));
  for (const a of r) if (a.object.mount === 'floor') expect(polygonContainsPolygon(room, objectFootprint(a), 1), a.name).toBe(true);
  for (let i = 0; i < r.length; i++)
    for (let j = i + 1; j < r.length; j++) {
      const a = r[i]!;
      const b = r[j]!;
      const vert = a.elevation < b.elevation + b.height - 1 && b.elevation < a.elevation + a.height - 1;
      if (!vert) continue;
      const c = satConvex(objectFootprint(a), objectFootprint(b), 1);
      expect(c.colliding && c.depth > 1, `${a.name} × ${b.name}`).toBe(false);
    }
  expect(analyzeLayout(p, sid).filter((w) => w.analyzerId === 'overlap' || w.analyzerId === 'bounds')).toEqual([]);
}

describe('optimizer', () => {
  it('prng is deterministic', () => {
    const a = prng(42);
    const b = prng(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });

  it('convex clip area', () => {
    const sq = (x: number, y: number, s: number) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
    expect(convexClipArea(sq(0, 0, 10), sq(5, 5, 10))).toBeCloseTo(25, 9);
    expect(convexClipArea(sq(0, 0, 10), sq(20, 20, 10))).toBe(0);
  });

  it('presets raise their focus priorities', () => {
    const p = presetPriorities('parking', DEFAULT_PRIORITIES);
    expect(p.parking).toBe(10);
    expect(p.storage).toBe(2.5);
    expect(presetPriorities('balanced', DEFAULT_PRIORITIES)).toEqual(DEFAULT_PRIORITIES);
  });

  it('produces four valid, labeled candidates; locked objects never move; deterministic', () => {
    const p = shop();
    const sid = p.scenarios[0]!.id;
    const opts = { priorities: DEFAULT_PRIORITIES, iterations: 500, seed: 7 };
    const cands = optimizeLayout(p, sid, opts);
    expect(cands.map((c) => c.label)).toEqual(['Parking Priority', 'Workshop Priority', 'Balanced', 'Maximum Open Space']);
    for (const c of cands) {
      expect(c.valid, c.label).toBe(true);
      expect(c.objects.some((o) => o.id === 'bench'), c.label).toBe(false);
      const q = projectWithCandidate(p, sid, c);
      assertValid(q, sid);
      expect(getScenario(q, sid).objects.find((o) => o.id === 'bench')).toEqual(getScenario(p, sid).objects.find((o) => o.id === 'bench'));
      for (const t of c.terms) expect(Number.isFinite(t.after)).toBe(true);
    }
    // Candidates are distinct arrangements.
    const sig = cands.map((c) => JSON.stringify(c.objects.map((o) => [o.id, Math.round(o.x), Math.round(o.y), o.rotation])));
    expect(new Set(sig).size).toBeGreaterThan(1);
    // Same seed ⇒ same result.
    expect(optimizeLayout(p, sid, { ...opts, candidates: ['balanced'] })[0]!.objects).toEqual(cands[2]!.objects);
  }, 30_000);

  it('improves the weighted objective on the demo and keeps it valid', () => {
    const p = createDemoProject();
    const sid = p.scenarios[0]!.id;
    const [c] = optimizeLayout(p, sid, { priorities: DEFAULT_PRIORITIES, iterations: 400, seed: 3, candidates: ['balanced'] });
    expect(c!.valid).toBe(true);
    const locked = getScenario(p, sid).objects.filter((o) => o.locked).map((o) => o.id);
    for (const id of locked) expect(c!.objects.some((o) => o.id === id)).toBe(false);
    const w = (k: 'before' | 'after') => c!.terms.reduce((s, t) => s + t.weight * t[k], 0);
    expect(w('after')).toBeLessThan(w('before'));
    expect(analyzeLayout(projectWithCandidate(p, sid, c!), sid).filter((x) => x.severity === 'critical')).toEqual([]);
  }, 30_000);

  // R-010: the optimizer's collision model must agree with the analyzers, so a returned candidate is
  // never flagged "invalid" by the final check (a vehicle's mirrors are part of the car).
  it('counts vehicle mirrors as part of the car and only returns candidates the analyzers accept', () => {
    const p = createDemoProject();
    const sid = p.scenarios[0]!.id;
    const r = runAssistant(p, sid, { priorities: DEFAULT_PRIORITIES, iterations: 800, seed: 5 });
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) {
      expect(c.valid, c.label).toBe(true);
      expect(c.critical, c.label).toEqual([]);
      const q = projectWithCandidate(p, sid, c);
      // Nothing (object OR vehicle, mirrors included) overlaps in the returned layout.
      const newCritical = analyzeLayout(q, sid).filter((w) => w.severity === 'critical');
      expect(newCritical.map((w) => w.message), c.label).toEqual([]);
    }
  }, 30_000);

  it('the model keeps a vehicle apart by its mirror width, not its body width', () => {
    const p = createDemoProject();
    const sid = p.scenarios[0]!.id;
    const v = getScenario(p, sid).vehicles[0]!;
    expect(v.mirrorWidth).toBeGreaterThan(v.width);
    const model = buildModel(p, sid, inches(30));
    const unit = model.units.find((u) => u.key === `vehicle:${v.id}`)!;
    expect(unit.members[0]!.fp.width).toBeCloseTo(v.mirrorWidth, 6);
  });

  it('accepting a candidate creates a new layout and never touches the active one', () => {
    const p = shop();
    const sid = p.scenarios[0]!.id;
    loadProject(p);
    const before = JSON.stringify(getScenario(p, sid));
    const [c] = optimizeLayout(p, sid, { priorities: DEFAULT_PRIORITIES, iterations: 300, seed: 1, candidates: ['open-space'] });
    const r = transact('Create layout', candidateCommands(sid, c!, 'new-layout', 'Suggested: open space'));
    expect(r.ok).toBe(true);
    const now = useProjectStore.getState().project!;
    expect(now.scenarios).toHaveLength(2);
    expect(JSON.stringify(getScenario(now, sid))).toBe(before);
    expect(now.activeScenarioId).toBe('new-layout');
    assertValid(now, 'new-layout');
  }, 30_000);
});
