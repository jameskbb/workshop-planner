/**
 * Inventory: an automatic list of everything in a layout, grouped by category with counts and
 * sizes ("2 × Wall cabinet: 36″ × 12″"). Pure; used by the Inventory panel, its printout and the
 * CSV export.
 */
import { getScenario, resolveObject, type ResolvedObject } from '@/domain/resolve';
import type { Project } from '@/domain/schema';

export type InventoryGroupId = 'storage' | 'stationary-tool' | 'work-surface' | 'dust-collection' | 'misc' | 'vehicle' | 'unknown';

export const INVENTORY_GROUPS: Array<{ id: InventoryGroupId; title: string }> = [
  { id: 'storage', title: 'Storage' },
  { id: 'stationary-tool', title: 'Tools' },
  { id: 'work-surface', title: 'Work surfaces' },
  { id: 'dust-collection', title: 'Dust collection' },
  { id: 'misc', title: 'Miscellaneous' },
  { id: 'vehicle', title: 'Vehicles' },
  { id: 'unknown', title: 'Other' },
];

export interface InventoryLine {
  /** Stable key for inventory notes: definition + rounded size. */
  key: string;
  group: InventoryGroupId;
  name: string;
  count: number;
  width: number;
  depth: number;
  height: number;
  /** Instance ids in this line. */
  ids: string[];
  mobile: boolean;
  wallMounted: boolean;
  /** Distinct instance names when they differ from `name` (e.g. "Wall cabinet (north)"). */
  instanceNames: string[];
}

export interface InventoryGroup {
  id: InventoryGroupId;
  title: string;
  lines: InventoryLine[];
  /** Total item count in the group. */
  count: number;
}

export interface Inventory {
  groups: InventoryGroup[];
  total: number;
}

const round = (mm: number) => Math.round(mm);

/** Strip a trailing qualifier: "Wall cabinet (north)" → "Wall cabinet". */
function baseName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim() || name;
}

export function inventoryKey(r: Pick<ResolvedObject, 'object'>): string {
  const o = r.object;
  return `${o.definitionId}:${round(o.width)}x${round(o.depth)}x${round(o.height)}`;
}

/** Build the inventory for a layout (defaults to the active one). Hidden items are included; they are still in the garage. */
export function buildInventory(project: Project, scenarioId?: string): Inventory {
  const s = getScenario(project, scenarioId);
  const lines = new Map<string, InventoryLine>();
  for (const o of s.objects) {
    const r = resolveObject(project, o);
    const key = inventoryKey(r);
    const group = (r.category === 'unknown' ? 'unknown' : r.category) as InventoryGroupId;
    const line = lines.get(key);
    if (line) {
      line.count++;
      line.ids.push(o.id);
      line.instanceNames.push(r.label);
    } else {
      lines.set(key, {
        key,
        group,
        name: r.definition?.name ?? baseName(o.name),
        count: 1,
        width: o.width,
        depth: o.depth,
        height: o.height,
        ids: [o.id],
        mobile: r.mobile,
        wallMounted: r.wallMounted,
        instanceNames: [r.label],
      });
    }
  }
  for (const v of s.vehicles) {
    const key = `vehicle:${v.templateId ?? v.name}:${round(v.length)}x${round(v.width)}`;
    const line = lines.get(key);
    if (line) {
      line.count++;
      line.ids.push(v.id);
      line.instanceNames.push(v.name);
    } else {
      lines.set(key, { key, group: 'vehicle', name: v.name, count: 1, width: v.width, depth: v.length, height: v.height, ids: [v.id], mobile: true, wallMounted: false, instanceNames: [v.name] });
    }
  }
  for (const l of lines.values()) {
    // Keep instance names only when they add information.
    const distinct = [...new Set(l.instanceNames)];
    l.instanceNames = distinct.length === 1 && distinct[0] === l.name ? [] : distinct;
    if (l.count === 1 && l.instanceNames.length === 1) {
      l.name = l.instanceNames[0]!;
      l.instanceNames = [];
    }
  }
  const groups: InventoryGroup[] = INVENTORY_GROUPS.map((g) => {
    const gl = [...lines.values()].filter((l) => l.group === g.id).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return { id: g.id, title: g.title, lines: gl, count: gl.reduce((n, l) => n + l.count, 0) };
  }).filter((g) => g.lines.length > 0);
  return { groups, total: groups.reduce((n, g) => n + g.count, 0) };
}

/** "2 × 48″ wall cabinets" style summary text for a line. */
export function lineSummary(line: InventoryLine, fmtLength: (mm: number) => string): string {
  return `${line.count} × ${line.name} (${fmtLength(line.width)} × ${fmtLength(line.depth)})`;
}

/** Plain-text inventory (clipboard / tests). */
export function inventoryText(project: Project, inv: Inventory, fmtLength: (mm: number) => string, notes: Record<string, string> = project.inventoryNotes): string {
  const out = [`${project.name}: Inventory`, ''];
  for (const g of inv.groups) {
    out.push(g.title.toUpperCase());
    for (const l of g.lines) {
      out.push(`  ${lineSummary(l, fmtLength)}${notes[l.key] ? `: ${notes[l.key]}` : ''}`);
    }
    out.push('');
  }
  return out.join('\n').trimEnd();
}
