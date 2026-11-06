/**
 * Click-to-place tool for fixed features, electrical points, lights, vehicles and library objects.
 * `startPlacing(request)` switches to it; a ghost follows the cursor (wall-hosted items slide along
 * the nearest wall), a click places the item and returns to Select (Shift-click keeps placing).
 */
import { Stamp } from 'lucide-react';
import { Circle, Group, Line, Rect } from 'react-konva';
import { create } from 'zustand';
import type { CanvasTool } from '@/app/registry';
import type { AppCommand } from '@/domain/commands';
import { placeObject } from '@/domain/factories';
import { electricalPosition, featureFootprint, findDefinition, objectFootprint, resolveObject, roomGeometry, vehicleGeomSpec, vehiclePose } from '@/domain/resolve';
import { ElectricalPointSchema, type ArchitecturalFeature, type ElectricalPoint, type LightingFixture, type ObjectDefinition, type Placement, type Project, type Vehicle } from '@/domain/schema';
import { quantize } from '@/domain/units';
import { clamp, distance, projectOntoWall, snapPoint, vehicleBody, type Point } from '@/geometry';
import { canvasColors } from '@/styles/tokens';
import { dispatch, useProjectStore } from '@/stores/projectStore';
import { editorActions, useEditorStore, type PlacementRequest } from '@/stores/editorStore';
import { uiActions, useUiStore } from '@/stores/uiStore';
import { newId } from '@/utils/id';
import { ARCHITECTURE_TEMPLATES, BUILTIN_OBJECTS_BY_ID, ELECTRICAL_TEMPLATES, LIGHT_TEMPLATES, createVehicle, vehicleTemplate } from '@/features/objects/library';
import { snapConfig, snapThreshold } from '@/features/editor/selection';
import { useCustomLibrary } from '@/app/services';

type Ghost =
  | { kind: 'feature'; item: ArchitecturalFeature }
  | { kind: 'electrical'; item: ElectricalPoint }
  | { kind: 'light'; item: LightingFixture }
  | { kind: 'vehicle'; item: Vehicle }
  | { kind: 'object'; item: ReturnType<typeof placeObject>; definition: ObjectDefinition };

const useGhost = create<{ ghost: Ghost | null; warning: string | null }>()(() => ({ ghost: null, warning: null }));

export function startPlacing(req: PlacementRequest): void {
  editorActions.setPlacing(req);
  uiActions.setTool('place');
  uiActions.flash(`Click on the plan to place the ${req.label.toLowerCase()}. Esc cancels; Shift-click places several.`);
}

/** Nearest wall placement for a point (center offset clamped so the item stays on the wall). */
export function nearestWallPlacement(project: Project, p: Point, width: number): { placement: Placement; distance: number } | null {
  const g = roomGeometry(project.room);
  let best: { placement: Placement; distance: number } | null = null;
  g.walls.forEach((w, i) => {
    const pr = projectOntoWall(p, w);
    const off = clamp(pr.offset, Math.min(width / 2, w.length / 2), Math.max(w.length - width / 2, w.length / 2));
    const foot = { x: w.a.x + w.dir.x * off, y: w.a.y + w.dir.y * off };
    const d = distance(p, foot);
    if (!best || d < best.distance) best = { placement: { type: 'wall', wallId: project.room.walls[i]!.id, offset: quantize(off) }, distance: d };
  });
  return best;
}

function definitionFor(id: string): ObjectDefinition | undefined {
  return BUILTIN_OBJECTS_BY_ID.get(id) ?? useCustomLibrary.getState().definitions.find((d) => d.id === id) ?? (useProjectStore.getState().project ? findDefinition(useProjectStore.getState().project!, id) : undefined);
}

/** Build the entity for a placement request at a world point. */
export function buildPlacement(project: Project, req: PlacementRequest, at: Point): { ghost: Ghost | null; warning: string | null } {
  const hasRoom = project.room.vertices.length >= 3;
  if (req.kind === 'feature') {
    const t = ARCHITECTURE_TEMPLATES.find((x) => `${x.kind}:${x.name}` === req.templateId);
    if (!t) return { ghost: null, warning: null };
    let placement: Placement = { type: 'free', x: quantize(at.x), y: quantize(at.y), rotation: 0 };
    let depth = t.depth;
    if (t.hosting === 'wall') {
      if (!hasRoom) return { ghost: null, warning: 'Draw the room first: this goes on a wall.' };
      const w = nearestWallPlacement(project, at, t.width)!;
      placement = w.placement;
      const opening = t.kind === 'door' || t.kind === 'double-door' || t.kind === 'garage-door' || t.kind === 'window';
      if (opening) depth = project.room.walls.find((x) => x.id === (w.placement as { wallId: string }).wallId)?.thickness ?? t.depth;
    }
    const item: ArchitecturalFeature = {
      id: newId(),
      kind: t.kind,
      name: t.name,
      placement,
      width: t.width,
      depth,
      height: t.height,
      elevation: t.elevation ?? 0,
      shape: t.shape ?? 'rect',
      ...(t.door ? { door: { swing: t.door.swing ?? 'in', hinge: t.door.hinge ?? 'left', openAngle: t.door.openAngle ?? 90 } } : {}),
      ...(t.garageDoor ? { garageDoor: { ...t.garageDoor, kind: t.garageDoor.kind ?? 'sectional', state: t.garageDoor.state ?? 'closed' } } : {}),
      locked: false,
      hidden: false,
      notes: '',
    };
    return { ghost: { kind: 'feature', item }, warning: null };
  }
  if (req.kind === 'electrical') {
    const t = ELECTRICAL_TEMPLATES.find((x) => x.kind === req.templateId);
    if (!t) return { ghost: null, warning: null };
    const onWall = t.kind !== 'ceiling-outlet' && t.kind !== 'extension-point';
    let placement: Placement = { type: 'free', x: quantize(at.x), y: quantize(at.y), rotation: 0 };
    if (onWall) {
      if (!hasRoom) return { ghost: null, warning: 'Draw the room first: this goes on a wall.' };
      placement = nearestWallPlacement(project, at, (t.defaults.width as number | undefined) ?? 70)!.placement;
    }
    const item = ElectricalPointSchema.parse({ id: newId(), kind: t.kind, label: t.kind === 'panel' ? 'Electrical panel' : '', placement, ...t.defaults });
    return { ghost: { kind: 'electrical', item }, warning: null };
  }
  if (req.kind === 'light') {
    const t = LIGHT_TEMPLATES.find((x) => x.name === req.templateId);
    if (!t) return { ghost: null, warning: null };
    const item: LightingFixture = {
      id: newId(),
      kind: t.kind,
      name: t.name,
      x: quantize(at.x),
      y: quantize(at.y),
      rotation: 0,
      length: t.length,
      width: t.width,
      elevation: t.kind === 'task-light' ? 1500 : Math.max(0, project.room.ceilingHeight - 50),
      lumens: t.lumens,
      beamAngle: t.beamAngle,
      locked: false,
      hidden: false,
      notes: '',
    };
    return { ghost: { kind: 'light', item }, warning: null };
  }
  if (req.kind === 'vehicle') {
    vehicleTemplate(req.templateId);
    // Nose toward the room's first wall (north) by default: rotation 180 = nose north.
    const item = createVehicle(req.templateId, { x: quantize(at.x), y: quantize(at.y), rotation: 180 });
    return { ghost: { kind: 'vehicle', item }, warning: null };
  }
  const def = definitionFor(req.templateId);
  if (!def) return { ghost: null, warning: 'That object is no longer in the library.' };
  return { ghost: { kind: 'object', item: placeObject(def, { x: quantize(at.x), y: quantize(at.y), rotation: 0 }), definition: def }, warning: null };
}

function commandFor(g: Ghost): AppCommand {
  switch (g.kind) {
    case 'feature':
      return { type: 'feature.add', payload: { items: [g.item] } };
    case 'electrical':
      return { type: 'electrical.add', payload: { items: [g.item] } };
    case 'light':
      return { type: 'light.add', payload: { items: [g.item] } };
    case 'vehicle':
      return { type: 'vehicle.add', payload: { items: [g.item] } };
    case 'object':
      return { type: 'object.add', payload: { objects: [g.item], definitions: [g.definition] } };
  }
}

function snapAt(world: Point, alt: boolean): Point {
  const sc = snapConfig();
  if (!sc.on || alt) return world;
  const project = useProjectStore.getState().project;
  const corners = project?.room.vertices ?? [];
  return snapPoint(world, { gridSize: sc.toggles.grid ? sc.grid : undefined, corners }, snapThreshold(), { ...sc.toggles, walls: false, wallCenters: false, objectEdges: false, objectCenters: false }).point;
}

// ───────────── ghost rendering ─────────────

function GhostOverlay() {
  const ghost = useGhost((s) => s.ghost);
  if (!ghost) return null;
  return (
    <Group opacity={0.55} listening={false}>
      <GhostShape ghost={ghost} />
    </Group>
  );
}

function GhostShape({ ghost }: { ghost: Ghost }) {
  const project = useProjectStore((s) => s.project);
  const scale = useUiStore((s) => s.viewport.scale);
  if (!project) return null;
  const flat = (pts: Point[]) => pts.flatMap((p) => [p.x, p.y]);
  const stroke = canvasColors.select;
  switch (ghost.kind) {
    case 'feature': {
      const fp = featureFootprint(project.room, ghost.item);
      return <Line points={flat(fp)} closed fill="rgba(47,125,246,0.25)" stroke={stroke} strokeWidth={2} strokeScaleEnabled={false} />;
    }
    case 'electrical': {
      const p = electricalPosition(project.room, ghost.item);
      return <Circle x={p.x} y={p.y} radius={8 / scale} fill="rgba(47,125,246,0.35)" stroke={stroke} strokeWidth={2} strokeScaleEnabled={false} />;
    }
    case 'light': {
      const l = ghost.item;
      return <Rect x={l.x - l.length / 2} y={l.y - l.width / 2 - 20} width={l.length} height={l.width + 40} fill="rgba(245,200,66,0.4)" stroke={stroke} strokeWidth={2} strokeScaleEnabled={false} />;
    }
    case 'vehicle':
      return <Line points={flat(vehicleBody(vehicleGeomSpec(ghost.item), vehiclePose(ghost.item)))} closed fill="rgba(47,125,246,0.2)" stroke={stroke} strokeWidth={2} strokeScaleEnabled={false} />;
    case 'object': {
      const r = resolveObject({ ...project, definitions: [...project.definitions, ghost.definition] }, ghost.item);
      return <Line points={flat(objectFootprint(r))} closed fill="rgba(47,125,246,0.2)" stroke={stroke} strokeWidth={2} strokeScaleEnabled={false} />;
    }
  }
}

function PlaceHint() {
  const placing = useEditorStore((s) => s.placing);
  const warning = useGhost((s) => s.warning);
  if (!placing) return null;
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-md border border-line-strong bg-panel/95 px-3 py-1.5 text-2xs text-ink-muted shadow-lg" role="status">
      Placing <b className="text-ink">{placing.label}</b>: click to place · Shift-click to place several · Esc to cancel
      {warning && <span className="ml-2 text-warn">{warning}</span>}
    </div>
  );
}

export const placeTool: CanvasTool = {
  id: 'place',
  label: 'Place item',
  icon: Stamp,
  cursor: 'copy',
  order: 90,
  hidden: true,
  overlay: GhostOverlay,
  htmlOverlay: PlaceHint,
  onPointerMove(e) {
    const project = useProjectStore.getState().project;
    const req = useEditorStore.getState().placing;
    if (!project || !req) return;
    useGhost.setState(buildPlacement(project, req, snapAt(e.world, e.altKey)));
  },
  onPointerDown(e, api) {
    if (e.button !== 0) return;
    const project = useProjectStore.getState().project;
    const req = useEditorStore.getState().placing;
    if (!project || !req) return;
    const { ghost, warning } = buildPlacement(project, req, snapAt(e.world, e.altKey));
    if (!ghost) {
      if (warning) uiActions.flash(warning, 'warning');
      return;
    }
    const r = dispatch(commandFor(ghost));
    if (!r.ok) return uiActions.flash(r.error, 'error');
    uiActions.select([{ kind: ghost.kind, id: ghost.item.id }]);
    if (!e.shiftKey) {
      editorActions.setPlacing(null);
      api.resetTool();
    }
  },
  onKeyDown(e, api) {
    if (e.key === 'Escape') {
      editorActions.setPlacing(null);
      api.resetTool();
      return true;
    }
    return false;
  },
  onDeactivate() {
    useGhost.setState({ ghost: null, warning: null });
    editorActions.setPlacing(null);
  },
};

