/**
 * Safety / interference checks (pure, auto-registered): doorway obstruction, garage-door
 * interference, electrical-panel access, hot-appliance / finishing / spark conflicts and overhead
 * interference (ceiling, beams, obstructions, attic ladder, lights). Walkway narrowing is the
 * `walkway` analyzer of the walkability feature; tool working clearance is the core `clearance`
 * analyzer; vehicle checks live in the vehicles feature.
 *
 * Every message names the things involved and quantifies the problem; thresholds are practical
 * planning guidelines, never code-compliance claims.
 */
import { registerAnalyzer } from '@/analysis/registry';
import type { AnalysisContext } from '@/analysis/context';
import type { WarningInput } from '@/analysis/types';
import type { EntityRef } from '@/domain/schema';
import { areaOfMulti, bbox, bboxIntersects, dot, intersect, localPolygonToWorld, localRect, polygonDistance, sub, type MultiPolygon, type Point, type Polygon } from '@/geometry';
import { DOOR_LANDING_DEPTH, doorLanding, doorLeaves, garageDoorZones, leafMaxAngle, leafSector, OPEN_DOOR_BAND, panelClearance, PANEL_CLEAR_HEIGHT, atticLadderLanding } from './zones';
import { safetyPrefs } from './prefs';
import { capitalize, overlapsBand, solids, the, type Solid } from './solids';

const MIN_AREA = 50; // mm²; ignore touching / float noise

function overlapRegion(a: Polygon, b: Polygon): MultiPolygon | null {
  if (!bboxIntersects(bbox(a), bbox(b))) return null;
  const r = intersect(a, b);
  return areaOfMulti(r) >= MIN_AREA ? r : null;
}

/** Smallest distance (mm) from a line (through `origin`, normal `n`) to any vertex of a region. */
function minDepth(region: MultiPolygon, origin: Point, n: Point): number {
  let d = Infinity;
  for (const piece of region) for (const p of piece.outer) d = Math.min(d, dot(sub(p, origin), n));
  return Math.max(0, d);
}

const DOOR_NAMES: Record<string, string> = { door: 'door', 'double-door': 'double door' };

// ───────────────────────────── doorways ─────────────────────────────

registerAnalyzer({
  id: 'doorway',
  label: 'Doorway obstruction',
  description: 'Door swings that hit something and doorways without a clear landing inside.',
  category: 'doorway',
  order: 40,
  run(ctx) {
    if (!ctx.hasRoom) return [];
    const out: WarningInput[] = [];
    const room = ctx.project.room;
    for (const f of ctx.features) {
      const k = f.feature.kind;
      if (k !== 'door' && k !== 'double-door') continue;
      const doorRef: EntityRef = { kind: 'feature', id: f.id };
      const blockers = solids(ctx).filter((s) => overlapsBand(s, 0, f.feature.height));
      const swingBlocked = new Set<string>();
      doorLeaves(room, f.feature).forEach((leaf, li) => {
        const full = Math.abs(leaf.sweep);
        const sector = leafSector(leaf);
        const near = blockers.filter((s) => bboxIntersects(bbox(sector), s.box));
        const { angle, blockedBy } = leafMaxAngle(
          leaf,
          near.map((s) => s.polygon),
        );
        if (blockedBy < 0 || angle >= full) return;
        const s = near[blockedBy]!;
        swingBlocked.add(s.ref.id);
        const region = intersect(sector, s.polygon);
        out.push({
          id: `doorway:${f.id}:swing:${li}:${s.ref.id}`,
          category: 'doorway',
          severity: 'warning',
          title: `${capitalize(the(s))} blocks the ${f.name} swing`,
          message: `${f.name} opens only ${angle}° before hitting ${the(s)} (it needs ${Math.round(full)}°).`,
          involved: [doorRef, s.ref],
          highlight: { polygons: [sector], regions: region },
          quantities: [
            { name: 'angle', value: angle, kind: 'angle' },
            { name: 'required', value: full, kind: 'angle' },
          ],
          data: { door: f.id, obstacle: s.ref, angle },
        });
      });
      // Clear landing inside the doorway.
      const landing = doorLanding(room, f.feature);
      if (landing.length < 3) continue;
      const wall = f.feature.placement.type === 'wall' ? ctx.room.walls[ctx.room.wallIndex.get(f.feature.placement.wallId) ?? -1] : undefined;
      if (!wall) continue;
      for (const s of blockers) {
        if (swingBlocked.has(s.ref.id)) continue;
        const region = overlapRegion(landing, s.polygon);
        if (!region) continue;
        const clear = minDepth(region, wall.a, wall.inward);
        out.push({
          id: `doorway:${f.id}:landing:${s.ref.id}`,
          category: 'doorway',
          severity: 'warning',
          title: `${capitalize(the(s))} crowds the ${f.name}`,
          message: `${capitalize(the(s))} is ${ctx.fmtLength(clear)} inside the ${f.name}; keep about ${ctx.fmtLength(DOOR_LANDING_DEPTH)} clear to walk through the ${DOOR_NAMES[k]}.`,
          involved: [doorRef, s.ref],
          highlight: { polygons: [landing], regions: region },
          quantities: [{ name: 'clear', value: clear, kind: 'length' }],
          data: { door: f.id, obstacle: s.ref, clear },
        });
      }
    }
    return out;
  },
});

// ───────────────────────────── garage doors ─────────────────────────────

registerAnalyzer({
  id: 'garage-door',
  label: 'Garage-door interference',
  description: 'Things in the door opening, under the tracks or in the way of the open door.',
  category: 'garage-door',
  order: 45,
  run(ctx) {
    if (!ctx.hasRoom) return [];
    const out: WarningInput[] = [];
    for (const f of ctx.features) {
      const z = garageDoorZones(ctx.project.room, f.feature);
      if (!z) continue;
      const doorRef: EntityRef = { kind: 'feature', id: f.id };
      const openingHeight = f.feature.garageDoor?.openingHeight ?? f.feature.height;
      for (const s of solids(ctx)) {
        // 1. Floor strip just inside the opening: the door closes onto it.
        if (overlapsBand(s, 0, openingHeight)) {
          const region = overlapRegion(z.strip, s.polygon);
          if (region) {
            const inside = minDepth(region, z.a, z.wall.inward);
            out.push({
              id: `garage-door:${f.id}:strip:${s.ref.id}`,
              category: 'garage-door',
              severity: 'warning',
              title: `${capitalize(the(s))} is in the ${f.name} opening`,
              message: `${capitalize(the(s))} sits ${inside < 1 ? 'in the door line' : `${ctx.fmtLength(inside)} inside the ${f.name}`}; the door would come down on it.`,
              involved: [doorRef, s.ref],
              highlight: { polygons: [z.strip], regions: region },
              quantities: [{ name: 'inside', value: inside, kind: 'length' }],
              data: { door: f.id, obstacle: s.ref, zone: 'opening' },
            });
          }
        }
        // 2. Under the tracks: the open panel rests at track height.
        const lo = z.trackHeight - OPEN_DOOR_BAND;
        const hi = z.trackHeight + OPEN_DOOR_BAND;
        if (!overlapsBand(s, lo, hi)) continue;
        const region = overlapRegion(z.band, s.polygon);
        if (!region) continue;
        const hangsDown = s.mount === 'ceiling' || s.bottom > z.trackHeight - OPEN_DOOR_BAND;
        const excess = hangsDown ? hi - s.bottom : s.top - lo;
        const message = hangsDown
          ? `${capitalize(the(s))} hangs down to ${ctx.fmtLength(s.bottom)} inside the ${f.name}'s travel (the open door rests at ${ctx.fmtLength(z.trackHeight)}).`
          : z.open
            ? `The open ${f.name} hits ${the(s)}: the door rests at ${ctx.fmtLength(z.trackHeight)} and ${the(s)} is ${ctx.fmtLength(s.top)} tall here.`
            : `${capitalize(the(s))} (${ctx.fmtLength(s.top)} tall) stands under the ${f.name} tracks (${ctx.fmtLength(z.trackHeight)}); the door would hit it when opened.`;
        out.push({
          id: `garage-door:${f.id}:band:${s.ref.id}`,
          category: 'garage-door',
          severity: 'warning',
          title: `${capitalize(the(s))} is in the way of the open ${f.name}`,
          message,
          involved: [doorRef, s.ref],
          highlight: { polygons: [z.band], regions: region },
          quantities: [
            { name: 'excess', value: Math.max(0, excess), kind: 'length' },
            { name: 'trackHeight', value: z.trackHeight, kind: 'length' },
          ],
          data: { door: f.id, obstacle: s.ref, zone: 'tracks', open: z.open },
        });
      }
    }
    return out;
  },
});

// ───────────────────────────── electrical panel access ─────────────────────────────

registerAnalyzer({
  id: 'panel-access',
  label: 'Electrical panel access',
  description: 'The clear working space in front of the electrical panel.',
  category: 'panel-access',
  order: 60,
  run(ctx) {
    if (!ctx.hasRoom) return [];
    const out: WarningInput[] = [];
    for (const e of ctx.project.electrical) {
      if (e.hidden && !ctx.options.includeHidden) continue;
      const pc = panelClearance(ctx.project.room, e);
      if (!pc) continue;
      const name = e.label || 'Electrical panel';
      for (const s of solids(ctx)) {
        if (!overlapsBand(s, 0, PANEL_CLEAR_HEIGHT)) continue;
        const region = overlapRegion(pc.zone, s.polygon);
        if (!region) continue;
        const clear = minDepth(region, pc.center, pc.inward);
        out.push({
          id: `panel-access:${e.id}:${s.ref.id}`,
          category: 'panel-access',
          severity: 'warning',
          title: `${capitalize(the(s))} blocks access to the ${name}`,
          message: `${capitalize(the(s))} ${clear < 12.7 ? 'sits directly' : `is ${ctx.fmtLength(clear)}`} in front of the ${name}; keep a ${ctx.fmtLength(pc.width)} × ${ctx.fmtLength(pc.depth)} space clear so the panel can be reached and opened.`,
          involved: [{ kind: 'electrical', id: e.id }, s.ref],
          highlight: { polygons: [pc.zone], regions: region },
          quantities: [
            { name: 'clear', value: clear, kind: 'length' },
            { name: 'required', value: pc.depth, kind: 'length' },
          ],
          data: { panel: e.id, obstacle: s.ref, clear },
        });
      }
    }
    return out;
  },
});

// ───────────────────────────── hot / finishing / sparks ─────────────────────────────

interface HazardThing {
  ref: EntityRef;
  name: string;
  polygon: Polygon;
}

function hazardSets(ctx: AnalysisContext) {
  const hot: HazardThing[] = [];
  const sparks: HazardThing[] = [];
  const flammable: HazardThing[] = [];
  const finishing: HazardThing[] = [];
  for (const o of ctx.objects) {
    const h = o.resolved.definition?.hazards;
    if (!h) continue;
    const t = { ref: { kind: 'object', id: o.id } as EntityRef, name: o.name, polygon: o.footprint };
    if (h.hot) hot.push(t);
    if (h.sparks) sparks.push(t);
    if (h.flammable) flammable.push(t);
    if (h.finishing) finishing.push(t);
  }
  for (const f of ctx.features) {
    if (f.feature.kind === 'water-heater' || f.feature.kind === 'hvac') hot.push({ ref: { kind: 'feature', id: f.id }, name: `the ${f.name}`, polygon: f.footprint });
  }
  for (const z of ctx.scenario.zones) {
    if (z.kind !== 'finishing' || (z.hidden && !ctx.options.includeHidden)) continue;
    finishing.push({ ref: { kind: 'zone', id: z.id }, name: `the ${z.name} zone`, polygon: z.points });
  }
  return { hot, sparks, flammable, finishing };
}

registerAnalyzer({
  id: 'hazard',
  label: 'Hot appliance & finishing conflicts',
  description: 'Flammables or finishing too close to hot appliances or spark-producing tools (tagged items only).',
  category: 'hazard',
  order: 70,
  run(ctx) {
    const prefs = safetyPrefs.read(ctx.project);
    const { hot, sparks, flammable, finishing } = hazardSets(ctx);
    const out: WarningInput[] = [];
    const seen = new Set<string>();
    const check = (a: HazardThing, b: HazardThing, limit: number, kind: 'hot' | 'sparks', what: string) => {
      if (a.ref.id === b.ref.id) return;
      const key = [a.ref.id, b.ref.id].sort().join('+') + kind;
      if (seen.has(key)) return;
      const d = polygonDistance(a.polygon, b.polygon);
      if (d >= limit) return;
      seen.add(key);
      const verb = kind === 'hot' ? `Keep ${what} at least ${ctx.fmtLength(limit)} from hot appliances.` : `Keep ${what} at least ${ctx.fmtLength(limit)} from tools that throw sparks.`;
      out.push({
        id: `hazard:${kind}:${key}`,
        category: 'hazard',
        severity: 'warning',
        title: `${capitalize(a.name)} is close to ${b.name}`,
        message: `${capitalize(a.name)} is ${d < 1 ? 'touching' : `${ctx.fmtLength(d)} from`} ${b.name}. ${verb}`,
        involved: [a.ref, b.ref],
        highlight: { polygons: [a.polygon, b.polygon] },
        quantities: [
          { name: 'distance', value: d, kind: 'length' },
          { name: 'required', value: limit, kind: 'length' },
        ],
        data: { kind, a: a.ref, b: b.ref, distance: d },
      });
    };
    for (const h of hot) {
      for (const f of flammable) check(f, h, prefs.hotDistance, 'hot', 'flammables');
      for (const f of finishing) check(f, h, prefs.hotDistance, 'hot', 'finishing work and supplies');
    }
    for (const s of sparks) {
      for (const f of flammable) check(s, f, prefs.sparksDistance, 'sparks', 'flammables');
      for (const f of finishing) check(s, f, prefs.sparksDistance, 'sparks', 'finishing work');
    }
    return out;
  },
});

// ───────────────────────────── overhead ─────────────────────────────

registerAnalyzer({
  id: 'overhead',
  label: 'Overhead interference',
  description: 'Items taller than the ceiling, beams, ceiling obstructions or lights above them, and the attic-ladder landing.',
  category: 'overhead',
  order: 80,
  run(ctx) {
    if (!ctx.hasRoom) return [];
    const out: WarningInput[] = [];
    const ceiling = ctx.project.room.ceilingHeight;
    const all = solids(ctx);
    for (const s of all) {
      if (s.ref.kind !== 'object') continue;
      if (s.top > ceiling + 1) {
        out.push({
          id: `overhead:${s.ref.id}:ceiling`,
          category: 'overhead',
          severity: 'critical',
          title: `${s.name} is taller than the ceiling`,
          message: `${s.name} reaches ${ctx.fmtLength(s.top)} but the ceiling is ${ctx.fmtLength(ceiling)} (${ctx.fmtLength(s.top - ceiling)} too tall).`,
          involved: [s.ref],
          highlight: { polygons: [s.polygon] },
          quantities: [{ name: 'excess', value: s.top - ceiling, kind: 'length' }],
          data: { obstacle: { kind: 'ceiling' } },
        });
      }
    }
    // Beams, ceiling obstructions, attic-ladder hatches hang down to their elevation.
    for (const f of ctx.project.architecture) {
      if (f.hidden && !ctx.options.includeHidden) continue;
      if (f.kind !== 'ceiling-beam' && f.kind !== 'ceiling-obstruction' && f.kind !== 'attic-ladder') continue;
      const ref: EntityRef = { kind: 'feature', id: f.id };
      const fp = ctx.features.find((x) => x.id === f.id)?.footprint;
      if (fp && fp.length >= 3) {
        for (const s of all) {
          if (s.ref.kind === 'feature' || s.top <= f.elevation + 1) continue;
          const region = overlapRegion(fp, s.polygon);
          if (!region) continue;
          out.push({
            id: `overhead:${f.id}:${s.ref.id}`,
            category: 'overhead',
            severity: 'warning',
            title: `${capitalize(the(s))} runs into the ${f.name}`,
            message: `${capitalize(the(s))} (${ctx.fmtLength(s.top)} tall) runs into the ${f.name}, which hangs down to ${ctx.fmtLength(f.elevation)} (${ctx.fmtLength(s.top - f.elevation)} too tall).`,
            involved: [s.ref, ref],
            highlight: { polygons: [fp], regions: region },
            quantities: [{ name: 'excess', value: s.top - f.elevation, kind: 'length' }],
            data: { obstacle: ref },
          });
        }
      }
      if (f.kind === 'attic-ladder') {
        const landing = atticLadderLanding(ctx.project.room, f);
        for (const s of all) {
          if (s.ref.kind === 'feature' || s.mount !== 'floor') continue;
          const region = overlapRegion(landing, s.polygon);
          if (!region) continue;
          out.push({
            id: `overhead:${f.id}:landing:${s.ref.id}`,
            category: 'overhead',
            severity: 'warning',
            title: `${capitalize(the(s))} is where the ${f.name} lands`,
            message: `The ${f.name} unfolds onto ${the(s)}; keep its landing clear so the ladder can reach the floor.`,
            involved: [ref, s.ref],
            highlight: { polygons: [landing], regions: region },
            quantities: [{ name: 'area', value: areaOfMulti(region), kind: 'area' }],
            data: { obstacle: s.ref, zone: 'ladder-landing' },
          });
        }
      }
    }
    // Light fixtures.
    for (const l of ctx.scenario.lights) {
      if (l.hidden && !ctx.options.includeHidden) continue;
      const fp = localPolygonToWorld({ x: l.x, y: l.y, rotation: l.rotation }, localRect(l.length, Math.max(l.width, 60)));
      for (const s of all) {
        if (s.ref.kind === 'feature' || s.top <= l.elevation - 25) continue;
        const region = overlapRegion(fp, s.polygon);
        if (!region) continue;
        out.push({
          id: `overhead:light:${l.id}:${s.ref.id}`,
          category: 'overhead',
          severity: 'warning',
          title: `${capitalize(the(s))} would hit the ${l.name}`,
          message: `${capitalize(the(s))} (${ctx.fmtLength(s.top)} tall) would hit the ${l.name}, mounted at ${ctx.fmtLength(l.elevation)}.`,
          involved: [s.ref, { kind: 'light', id: l.id }],
          highlight: { polygons: [fp], regions: region },
          quantities: [{ name: 'excess', value: s.top - l.elevation, kind: 'length' }],
          data: { obstacle: { kind: 'light', id: l.id } },
        });
      }
    }
    return out;
  },
});

export type { Solid };
