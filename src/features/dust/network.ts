/**
 * Dust-collection network (pure): duct and hose runs become a graph (ends within a snap distance
 * join; an end landing on another run's segment makes a wye). Tools with a dust port and collectors
 * attach to the nearest run end within reach. For each tool: path length to the collector split
 * into rigid duct and flexible hose, bends, blast gates passed, and an "equivalent length" rule of
 * thumb (flex ≈ 2.5× duct, each 90° of bend ≈ 6 ft of duct). A planning estimate, not an
 * engineering calculation.
 */
import { z } from 'zod';
import type { AnalysisContext } from '@/analysis/context';
import { defineExtension } from '@/domain/extensions';
import type { DuctRun, DustFitting } from '@/domain/schema';
import { feet, inches } from '@/domain/units';
import { closestPointOnSegment, distance, localToWorld, type Point } from '@/geometry';

export const dustPrefs = defineExtension(
  'dust.prefs',
  z.object({
    /** Longest practical equivalent run for the collector (mm). */
    maxEquivalent: z.number().positive(),
    /** Longest practical flexible hose on one run (mm). */
    maxFlex: z.number().positive(),
  }),
  { maxEquivalent: feet(35), maxFlex: feet(10) },
);

/** Run ends closer than this join (mm). */
export const JOIN_DISTANCE = inches(4);
/** A port / collector inlet connects to a run end within this distance (mm). */
export const PORT_REACH = inches(24);
export const FLEX_FACTOR = 2.5;
export const BEND_EQUIVALENT_PER_90 = feet(6);
export const PLANNING_NOTE = 'Planning estimate only, not an engineering airflow calculation.';

export interface DustEndpoint {
  objectId: string;
  name: string;
  port: Point;
  diameter: number;
  collector: boolean;
}

export interface ToolRoute {
  tool: DustEndpoint;
  connected: boolean;
  collector?: DustEndpoint;
  /** Polyline from the tool port to the collector inlet (when connected). */
  path: Point[];
  rigid: number;
  flex: number;
  /** Sum of turning angles along the path (degrees). */
  bendDegrees: number;
  bends: number;
  gates: number;
  equivalent: number;
  /** Straight-line distance to the nearest collector (for unconnected tools). */
  direct?: number;
  narrowest?: number;
  problems: string[];
}

/** World dust-port positions of tools and collectors (collectors = category 'dust-collection'). */
export function dustEndpoints(ctx: AnalysisContext): DustEndpoint[] {
  const out: DustEndpoint[] = [];
  for (const o of ctx.objects) {
    const port = o.resolved.definition?.dustPort;
    const collector = o.resolved.category === 'dust-collection';
    if (!port && !collector) continue;
    const pose = o.zonesAtWorkingPosition ? o.zonePose : o.pose;
    const p = port ? localToWorld(pose, { x: port.x + (o.resolved.footprint.offsetX ?? 0), y: port.y + (o.resolved.footprint.offsetY ?? 0) }) : { x: pose.x, y: pose.y };
    out.push({ objectId: o.id, name: o.name, port: p, diameter: port?.diameter ?? inches(4), collector });
  }
  return out;
}

interface Edge {
  to: number;
  length: number;
  flex: boolean;
  run: string;
  diameter: number;
}

interface Graph {
  nodes: Point[];
  adj: Edge[][];
}

function buildGraph(runs: readonly DuctRun[]): Graph {
  const nodes: Point[] = [];
  const adj: Edge[][] = [];
  const nodeAt = (p: Point): number => {
    for (let i = 0; i < nodes.length; i++) if (distance(nodes[i]!, p) <= JOIN_DISTANCE) return i;
    nodes.push(p);
    adj.push([]);
    return nodes.length - 1;
  };
  // Split points: run ends that land on another run's segment (wye / tee).
  const splits = new Map<string, Array<{ seg: number; t: number; p: Point }>>();
  for (const r of runs) {
    for (const end of [r.points[0]!, r.points[r.points.length - 1]!]) {
      for (const other of runs) {
        if (other.id === r.id) continue;
        for (let k = 0; k + 1 < other.points.length; k++) {
          const a = other.points[k]!;
          const b = other.points[k + 1]!;
          const c = closestPointOnSegment(end, a, b);
          if (c.distance <= JOIN_DISTANCE && c.t > 0.001 && c.t < 0.999) {
            const list = splits.get(other.id) ?? [];
            list.push({ seg: k, t: c.t, p: c.point });
            splits.set(other.id, list);
          }
        }
      }
    }
  }
  for (const r of runs) {
    const pts: Point[] = [];
    for (let k = 0; k < r.points.length; k++) {
      pts.push(r.points[k]!);
      if (k + 1 < r.points.length) {
        const extra = (splits.get(r.id) ?? []).filter((s) => s.seg === k).sort((a, b) => a.t - b.t);
        for (const s of extra) pts.push(s.p);
      }
    }
    let prev = nodeAt(pts[0]!);
    for (let k = 1; k < pts.length; k++) {
      const cur = nodeAt(pts[k]!);
      if (cur === prev) continue;
      const len = distance(nodes[prev]!, nodes[cur]!);
      adj[prev]!.push({ to: cur, length: len, flex: r.kind === 'flex', run: r.id, diameter: r.diameter });
      adj[cur]!.push({ to: prev, length: len, flex: r.kind === 'flex', run: r.id, diameter: r.diameter });
      prev = cur;
    }
  }
  return { nodes, adj };
}

/** Nearest graph node that is a run END (degree 1), or any node, within reach of a point. */
function attach(g: Graph, p: Point, reach: number): number {
  let best = -1;
  let bd = Infinity;
  g.nodes.forEach((n, i) => {
    const d = distance(n, p);
    if (d <= reach && d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

function turn(a: Point, b: Point, c: Point): number {
  const a1 = Math.atan2(b.y - a.y, b.x - a.x);
  const a2 = Math.atan2(c.y - b.y, c.x - b.x);
  let d = ((a2 - a1) * 180) / Math.PI;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return Math.abs(d);
}

export function dustRoutes(ctx: AnalysisContext, runs: readonly DuctRun[] = ctx.scenario.dust.runs, fittings: readonly DustFitting[] = ctx.scenario.dust.fittings): ToolRoute[] {
  const prefs = dustPrefs.read(ctx.project);
  const ends = dustEndpoints(ctx);
  const collectors = ends.filter((e) => e.collector);
  const tools = ends.filter((e) => !e.collector);
  const g = buildGraph(runs);
  // Multi-source Dijkstra from every collector inlet.
  const dist = new Float64Array(g.nodes.length).fill(Infinity);
  const prev = new Int32Array(g.nodes.length).fill(-1);
  const prevEdge: Array<Edge | null> = new Array(g.nodes.length).fill(null);
  const owner = new Int32Array(g.nodes.length).fill(-1);
  const queue: number[] = [];
  collectors.forEach((c, ci) => {
    const n = attach(g, c.port, PORT_REACH);
    if (n < 0) return;
    const d0 = distance(c.port, g.nodes[n]!);
    if (d0 < dist[n]!) {
      dist[n] = d0;
      owner[n] = ci;
      queue.push(n);
    }
  });
  const done = new Uint8Array(g.nodes.length);
  while (queue.length) {
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (dist[queue[i]!]! < dist[queue[bi]!]!) bi = i;
    const u = queue.splice(bi, 1)[0]!;
    if (done[u]) continue;
    done[u] = 1;
    for (const e of g.adj[u]!) {
      const w = e.flex ? e.length * FLEX_FACTOR : e.length;
      if (dist[u]! + w < dist[e.to]!) {
        dist[e.to] = dist[u]! + w;
        prev[e.to] = u;
        prevEdge[e.to] = e;
        owner[e.to] = owner[u]!;
        queue.push(e.to);
      }
    }
  }
  return tools.map((tool) => {
    const n = attach(g, tool.port, PORT_REACH);
    const nearestCollector = collectors.reduce<{ c?: DustEndpoint; d: number }>((acc, c) => {
      const d = distance(c.port, tool.port);
      return d < acc.d ? { c, d } : acc;
    }, { d: Infinity });
    if (n < 0 || !Number.isFinite(dist[n]!)) {
      return { tool, connected: false, path: [], rigid: 0, flex: 0, bendDegrees: 0, bends: 0, gates: 0, equivalent: 0, direct: nearestCollector.c ? nearestCollector.d : undefined, collector: nearestCollector.c, problems: [] };
    }
    const nodePath: number[] = [];
    const edges: Edge[] = [];
    for (let u = n; u >= 0; u = prev[u]!) {
      nodePath.push(u);
      if (prevEdge[u]) edges.push(prevEdge[u]!);
    }
    const collector = collectors[owner[n]!];
    const path = [tool.port, ...nodePath.map((i) => g.nodes[i]!), ...(collector ? [collector.port] : [])];
    let rigid = 0;
    let flex = 0;
    for (const e of edges) {
      if (e.flex) flex += e.length;
      else rigid += e.length;
    }
    // Short connectors from port / to inlet count as flexible hose.
    flex += distance(tool.port, g.nodes[n]!) + (collector ? distance(collector.port, g.nodes[nodePath[nodePath.length - 1]!]!) : 0);
    let bendDegrees = 0;
    let bends = 0;
    for (let k = 1; k + 1 < path.length; k++) {
      if (distance(path[k - 1]!, path[k]!) < 1 || distance(path[k]!, path[k + 1]!) < 1) continue;
      const t = turn(path[k - 1]!, path[k]!, path[k + 1]!);
      if (t > 10) {
        bendDegrees += t;
        bends++;
      }
    }
    const runIds = new Set(edges.map((e) => e.run));
    const gates = fittings.filter((f) => f.kind === 'blast-gate' && f.runId && runIds.has(f.runId)).length;
    const equivalent = rigid + flex * FLEX_FACTOR + (bendDegrees / 90) * BEND_EQUIVALENT_PER_90;
    const narrowest = edges.length ? Math.min(...edges.map((e) => e.diameter)) : undefined;
    const problems: string[] = [];
    if (equivalent > prefs.maxEquivalent) problems.push('long');
    if (flex > prefs.maxFlex) problems.push('flex');
    if (narrowest !== undefined && narrowest < tool.diameter - 1) problems.push('narrow');
    return { tool, connected: true, collector, path, rigid, flex, bendDegrees, bends, gates, equivalent, narrowest, problems };
  });
}

export function dustRoutesFor(ctx: AnalysisContext): ToolRoute[] {
  return ctx.memo('dust:routes', () => dustRoutes(ctx));
}
