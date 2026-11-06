/**
 * CSV object inventory: one row per item in a layout.
 * Columns (brief): Object, Category, Width, Depth, Height, X, Y, Rotation, Mobile, Notes.
 * RFC 4180 quoting, CRLF line ends, UTF-8 BOM (so spreadsheet apps read the file as UTF-8), and
 * a leading apostrophe on text cells that would otherwise be evaluated as formulas.
 */
import { getScenario, resolveObject } from '@/domain/resolve';
import type { Project } from '@/domain/schema';
import { INVENTORY_GROUPS, inventoryKey } from '@/features/inventory/inventory';

export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  let s = value;
  // Formula injection guard (=, +, -, @, tab, CR at the start of a text cell).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(cells: Array<string | number | boolean | null | undefined>): string {
  return cells.map(csvCell).join(',');
}

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

export function inventoryCsv(project: Project, scenarioId?: string): string {
  const s = getScenario(project, scenarioId);
  const imperial = project.settings.unitSystem === 'imperial';
  const unit = imperial ? 'in' : project.settings.metricUnit;
  const conv = (mm: number) => (imperial ? round(mm / 25.4, 2) : unit === 'cm' ? round(mm / 10, 1) : unit === 'm' ? round(mm / 1000, 3) : round(mm, 0));
  const groupTitle = (id: string) => INVENTORY_GROUPS.find((g) => g.id === id)?.title ?? id;
  const header = ['Object', 'Category', `Width (${unit})`, `Depth (${unit})`, `Height (${unit})`, `X (${unit})`, `Y (${unit})`, 'Rotation (deg)', 'Mobile', 'Notes'];
  const rows: string[] = [csvRow(header)];
  for (const o of s.objects) {
    const r = resolveObject(project, o);
    const invNote = project.inventoryNotes[inventoryKey(r)];
    const notes = [o.notes, invNote].filter((x) => x && x.trim()).join(' | ');
    rows.push(csvRow([r.label, groupTitle(r.category), conv(o.width), conv(o.depth), conv(o.height), conv(r.pose.x), conv(r.pose.y), round(r.pose.rotation, 1), r.mobile, notes]));
  }
  for (const v of s.vehicles) {
    rows.push(csvRow([v.name, 'Vehicles', conv(v.width), conv(v.length), conv(v.height), conv(v.x), conv(v.y), round(v.rotation, 1), true, v.notes]));
  }
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}
