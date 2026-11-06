/**
 * Workflow relationships (pure): ordered chains of stations ("Lumber rack → Miter saw → Table saw →
 * Assembly table") built from scenario relationships, with approximate walking distance per step
 * (route on the walkability grid, straight line when no route exists).
 */
import type { AnalysisContext } from '@/analysis';
import type { Relationship } from '@/domain/schema';
import { distance, localToWorld, walkingDistance, type Point } from '@/geometry';
import { aisleWidthOf, walkability } from '@/features/walkability/model';

export interface Station {
  id: string;
  kind: 'object' | 'vehicle';
  name: string;
  /** Where a person stands to use it. */
  point: Point;
  /** Center (for drawing lines). */
  center: Point;
}

/** Stations referenced by relationships (objects at their working pose, vehicles at the driver door). */
export function stationOf(ctx: AnalysisContext, id: string): Station | null {
  const o = ctx.objectById.get(id);
  if (o) {
    const fp = o.resolved.footprint;
    const pose = o.zonePose;
    return {
      id,
      kind: 'object',
      name: o.name,
      point: localToWorld(pose, { x: fp.offsetX ?? 0, y: (fp.offsetY ?? 0) + fp.depth / 2 + 300 }),
      center: localToWorld(pose, { x: fp.offsetX ?? 0, y: fp.offsetY ?? 0 }),
    };
  }
  const v = ctx.vehicles.find((x) => x.id === id);
  if (v) {
    const s = v.vehicle.driverSide === 'right' ? -1 : 1;
    return { id, kind: 'vehicle', name: v.name, point: localToWorld(v.pose, { x: s * (v.spec.width / 2 + 400), y: v.spec.length * 0.15 }), center: { x: v.pose.x, y: v.pose.y } };
  }
  return null;
}

export interface WorkflowStep {
  relationship: Relationship;
  from: Station;
  to: Station;
  /** mm (walking when possible). */
  distance: number;
  straight: number;
  walked: boolean;
  /** No walkable route (distance is the straight-line lower bound). */
  blocked: boolean;
}

export interface WorkflowChain {
  /** Chain name ("" for loose pairs). */
  name: string;
  steps: WorkflowStep[];
  /** Station names in order (A → B → C). */
  path: string[];
  total: number;
  /** Frequency-weighted total (Σ distance × frequency / 3). */
  weighted: number;
  /** Steps that reference an item missing from this layout. */
  missing: number;
}

export const UNNAMED_CHAIN = '';

/** Walking distance between two stations on the walkability grid. */
function stepDistance(ctx: AnalysisContext, a: Point, b: Point): { distance: number; walked: boolean; blocked: boolean } {
  const straight = distance(a, b);
  const walk = walkability(ctx, aisleWidthOf(ctx));
  if (!walk) return { distance: straight, walked: false, blocked: false };
  const d = walkingDistance(walk, a, b, 450);
  if (d === null) return { distance: straight, walked: false, blocked: true };
  return { distance: Math.max(d, straight), walked: true, blocked: false };
}

/** Every workflow chain in the scenario, steps ordered by `order`. */
export function workflowChains(ctx: AnalysisContext): WorkflowChain[] {
  return ctx.memo('workflow:chains', () => {
    const rels = ctx.scenario.relationships.filter((r) => r.kind === 'workflow');
    const groups = new Map<string, Relationship[]>();
    for (const r of rels) {
      const key = r.chain?.trim() || UNNAMED_CHAIN;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const chains: WorkflowChain[] = [];
    for (const [name, list] of groups) {
      const sorted = [...list].sort((a, b) => a.order - b.order);
      const steps: WorkflowStep[] = [];
      let missing = 0;
      for (const r of sorted) {
        const from = stationOf(ctx, r.fromId);
        const to = stationOf(ctx, r.toId);
        if (!from || !to) {
          missing++;
          continue;
        }
        const d = stepDistance(ctx, from.point, to.point);
        steps.push({ relationship: r, from, to, distance: d.distance, straight: distance(from.point, to.point), walked: d.walked, blocked: d.blocked });
      }
      const path: string[] = [];
      for (const s of steps) {
        if (path[path.length - 1] !== s.from.name) path.push(s.from.name);
        path.push(s.to.name);
      }
      chains.push({
        name,
        steps,
        path,
        total: steps.reduce((t, s) => t + s.distance, 0),
        weighted: steps.reduce((t, s) => t + (s.distance * s.relationship.frequency) / 3, 0),
        missing,
      });
    }
    return chains.sort((a, b) => (a.name === UNNAMED_CHAIN ? 1 : 0) - (b.name === UNNAMED_CHAIN ? 1 : 0) || a.name.localeCompare(b.name));
  });
}

/** Total workflow walking distance for the scenario (frequency-weighted), mm. */
export function workflowTotal(ctx: AnalysisContext): { total: number; weighted: number; steps: number; blocked: number } {
  const chains = workflowChains(ctx);
  const steps = chains.flatMap((c) => c.steps);
  return {
    total: steps.reduce((t, s) => t + s.distance, 0),
    weighted: chains.reduce((t, c) => t + c.weighted, 0),
    steps: steps.length,
    blocked: steps.filter((s) => s.blocked).length,
  };
}
