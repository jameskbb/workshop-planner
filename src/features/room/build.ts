/**
 * Creating / replacing the room outline from points (draw tool, templates, typed wall lengths).
 * Replacing an existing outline asks for confirmation first (it is undoable either way).
 */
import { fitRoomToView } from '@/app/canvas/PlanCanvas';
import type { AppCommand } from '@/domain/commands';
import { createRoom } from '@/domain/factories';
import { roomProblem } from '@/domain/roomEdit';
import type { TemplateOpening } from '@/domain/roomTemplates';
import type { ArchitecturalFeature, Project, Room } from '@/domain/schema';
import { quantize } from '@/domain/units';
import type { Point } from '@/geometry';
import { transact, useProjectStore } from '@/stores/projectStore';
import { editorActions } from '@/stores/editorStore';
import { uiActions } from '@/stores/uiStore';
import { newId } from '@/utils/id';
import { ARCHITECTURE_TEMPLATES } from '@/features/objects/library';

/** Remove consecutive duplicate points (e.g. from a double-click). */
export function cleanOutline(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 1) out.push({ x: quantize(p.x), y: quantize(p.y) });
  }
  while (out.length > 1 && Math.hypot(out[0]!.x - out[out.length - 1]!.x, out[0]!.y - out[out.length - 1]!.y) < 1) out.pop();
  return out;
}

export function roomFromPoints(points: readonly Point[], project: Project): Room {
  const room = createRoom(points, { ceilingHeight: project.room.ceilingHeight, wallThickness: project.settings.defaultWallThickness });
  return room;
}

/** Garage-door / door features for template openings on the given room. */
export function openingFeatures(room: Room, openings: readonly TemplateOpening[]): ArchitecturalFeature[] {
  const gd = ARCHITECTURE_TEMPLATES.find((t) => t.kind === 'garage-door')!;
  const door = ARCHITECTURE_TEMPLATES.find((t) => t.kind === 'door')!;
  return openings.map((o, i) => {
    const t = o.kind === 'garage-door' ? gd : door;
    const wall = room.walls[o.wallIndex]!;
    const widthFt = Math.round(o.width / 304.8);
    return {
      id: newId(),
      kind: t.kind,
      name: o.kind === 'garage-door' ? (openings.length > 1 ? `Garage door ${i + 1} (${widthFt} ft)` : `Garage door (${widthFt} ft)`) : 'Entry door',
      placement: { type: 'wall', wallId: wall.id, offset: quantize(o.offset) },
      width: quantize(o.width),
      depth: wall.thickness,
      height: t.height,
      elevation: 0,
      shape: 'rect',
      ...(t.door ? { door: { swing: t.door.swing ?? 'in', hinge: t.door.hinge ?? 'left', openAngle: t.door.openAngle ?? 90 } } : {}),
      ...(t.garageDoor ? { garageDoor: { ...t.garageDoor, kind: t.garageDoor.kind ?? 'sectional', state: t.garageDoor.state ?? 'closed' } } : {}),
      locked: false,
      hidden: false,
      notes: '',
    } as ArchitecturalFeature;
  });
}

/**
 * Set the room outline (and optional openings). Returns false with an explanation when the outline
 * is invalid. Asks before replacing an existing outline.
 */
export function applyOutline(points: readonly Point[], opts: { label: string; openings?: readonly TemplateOpening[]; confirmReplace?: boolean; onDone?: () => void }): boolean {
  const project = useProjectStore.getState().project;
  if (!project) return false;
  const pts = cleanOutline(points);
  const problem = roomProblem(pts);
  if (problem) {
    uiActions.flash(problem, 'error');
    return false;
  }
  const doIt = () => {
    const room = roomFromPoints(pts, project);
    const cmds: AppCommand[] = [{ type: 'room.set', payload: { room, label: opts.label } }];
    const feats = openingFeatures(room, opts.openings ?? []);
    if (feats.length) cmds.push({ type: 'feature.add', payload: { items: feats } });
    const r = transact(opts.label, cmds);
    if (!r.ok) return uiActions.flash(r.error, 'error');
    uiActions.clearSelection();
    uiActions.setTool('select');
    setTimeout(fitRoomToView, 0);
    opts.onDone?.();
    uiActions.flash(`Room outline set: ${pts.length} walls. Drag corners, double-click a wall to add a corner, or type exact lengths in the Room panel.`);
  };
  if (project.room.vertices.length >= 3 && opts.confirmReplace !== false) {
    editorActions.openDialog('confirm', {
      title: 'Replace the room outline?',
      description: 'The current walls are replaced. Doors, windows and outlets on walls move to the nearest new wall; everything else stays where it is. You can undo this.',
      confirmLabel: 'Replace outline',
      destructive: false,
      onConfirm: doIt,
    });
    return true;
  }
  doIt();
  return true;
}
