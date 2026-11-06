/**
 * Vehicles: the Vehicles sidebar (generic templates, click to place; a custom-size vehicle and
 * the vehicles in this layout), the vehicle inspector (see ./inspector for state, clearances, doors
 * and entry simulation), the door-swing / clearance overlay and the entry-path overlay.
 */
import { Car, DoorOpen, Lock, Plus, Route } from 'lucide-react';
import { useState } from 'react';
import { canvasLayers, contextMenuActions, inspectorSections, paletteCommands, shellExtras, sidebarSections, type SelectionContext } from '@/app/registry';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Select } from '@/components/ui';
import { centroid } from '@/geometry';
import { editorActions, useEditorStore } from '@/stores/editorStore';
import { noseCompass, OVERLAY_ENTRY, OVERLAY_VEHICLE, updateVehicle } from './inspector';
import { VehicleClearanceLayer, VehicleEntryLayer } from './VehicleOverlays';
import { PropRow, Section } from '@/components/shell';
import { AngleInput, LengthInput } from '@/components/LengthInput';
import { getScenario, roomGeometry } from '@/domain/resolve';
import type { Vehicle } from '@/domain/schema';
import { useFormatters } from '@/hooks/useFormatters';
import { dispatch, useProjectStore } from '@/stores/projectStore';
import { uiActions, useUiStore } from '@/stores/uiStore';
import { cn } from '@/utils/cn';
import { createVehicle, VEHICLE_TEMPLATES, vehicleTemplate } from '@/features/objects/library';
import { NameField, NotesField, SwitchRow } from '@/features/editor/inspectorParts';
import { startPlacing } from '@/features/architecture/place';

const NO_VEHICLES: Vehicle[] = [];

function VehiclesPanel() {
  const fmt = useFormatters();
  const vehicles = useProjectStore((s) => (s.project ? getScenario(s.project).vehicles : NO_VEHICLES));
  const selection = useUiStore((s) => s.selection);
  return (
    <div>
      <Section title="In this layout">
        {vehicles.length === 0 ? (
          <p className="text-2xs text-ink-faint">No vehicle yet. Add one below to check parking, door swings and walking room around it.</p>
        ) : (
          <ul className="space-y-0.5">
            {vehicles.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  className={cn('flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-panel-2', selection.some((r) => r.id === v.id) ? 'bg-select/15 text-ink' : 'text-ink-muted')}
                  onClick={() => uiActions.select([{ kind: 'vehicle', id: v.id }])}
                >
                  <Car className="size-3" />
                  <span className="flex-1 truncate">{v.name}</span>
                  <span className="num text-2xs">{fmt.length(v.length)}</span>
                  {v.locked && <Lock className="size-3" aria-label="Locked" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Add a vehicle">
        <ul>
          {VEHICLE_TEMPLATES.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink hover:bg-panel-2"
                onClick={() => startPlacing({ kind: 'vehicle', templateId: t.id, label: t.name })}
                data-testid={`place-vehicle-${t.id}`}
              >
                <span className="truncate">{t.name}</span>
                <span className="num shrink-0 text-2xs text-ink-faint">
                  {fmt.length(t.length)} × {fmt.length(t.width)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <Button size="sm" variant="outline" className="mt-1 w-full justify-start" onClick={() => editorActions.openDialog('custom-vehicle')} data-testid="custom-vehicle">
          <Plus /> Custom vehicle (your exact sizes)…
        </Button>
        <p className="mt-1 text-2xs text-ink-faint">Class-average sizes. Enter your own vehicle's length, width and mirror width in the inspector.</p>
      </Section>
    </div>
  );
}
sidebarSections.register({ id: 'vehicles', title: 'Vehicles', icon: Car, order: 60, component: VehiclesPanel });

const single = (c: SelectionContext): Vehicle | undefined => (c.single?.kind === 'vehicle' ? c.scenario.vehicles.find((v) => v.id === c.single!.id) : undefined);
function update(id: string, patch: Partial<Vehicle>) {
  const r = dispatch({ type: 'vehicle.update', payload: { id, patch } });
  if (!r.ok) uiActions.flash(r.error, 'error');
}

function VehicleMain({ ctx }: { ctx: SelectionContext }) {
  const v = single(ctx)!;
  const move = (patch: Partial<Vehicle>) => (v.locked ? uiActions.flash(`"${v.name}" is locked. Unlock it to move it.`, 'warning') : update(v.id, patch));
  return (
    <div className="space-y-1">
      <NameField value={v.name} onCommit={(name) => name && update(v.id, { name })} testId="vehicle-name" />
      <div className="grid grid-cols-2 gap-x-2">
        <PropRow label="X">
          <LengthInput aria-label="X position" value={v.x} allowNegative onCommit={(x) => move({ x })} />
        </PropRow>
        <PropRow label="Y">
          <LengthInput aria-label="Y position" value={v.y} allowNegative onCommit={(y) => move({ y })} />
        </PropRow>
      </div>
      <PropRow label="Heading">
        <AngleInput aria-label={`Heading in degrees, clockwise (nose points ${noseCompass(v.rotation)})`} value={v.rotation} onCommit={(rotation) => move({ rotation })} />
      </PropRow>
      <p className="pl-1 text-2xs text-ink-faint" data-testid="vehicle-heading-hint">
        Nose points {noseCompass(v.rotation)}
      </p>
      <div className="grid grid-cols-2 gap-x-2">
        <PropRow label="Length">
          <LengthInput aria-label="Length" value={v.length} allowZero={false} onCommit={(length) => update(v.id, { length })} />
        </PropRow>
        <PropRow label="Width">
          <LengthInput aria-label="Body width" value={v.width} allowZero={false} onCommit={(width) => update(v.id, { width, mirrorWidth: Math.max(v.mirrorWidth, width) })} />
        </PropRow>
        <PropRow label="Mirrors">
          <LengthInput aria-label="Width with mirrors" value={v.mirrorWidth} allowZero={false} onCommit={(mirrorWidth) => update(v.id, { mirrorWidth: Math.max(mirrorWidth, v.width) })} />
        </PropRow>
        <PropRow label="Height">
          <LengthInput aria-label="Height" value={v.height} allowZero={false} onCommit={(height) => update(v.id, { height })} />
        </PropRow>
      </div>
      <SwitchRow label="Locked" checked={v.locked} onChange={(locked) => update(v.id, { locked })} />
      <SwitchRow label="Hidden" checked={v.hidden} onChange={(hidden) => update(v.id, { hidden })} />
      <NotesField value={v.notes} onCommit={(notes) => update(v.id, { notes })} />
    </div>
  );
}
inspectorSections.register({ id: 'vehicle.main', title: 'Vehicle', order: 10, appliesTo: (c) => !!single(c), component: VehicleMain });

for (const t of VEHICLE_TEMPLATES) {
  paletteCommands.register({
    id: `vehicles.add.${t.id}`,
    title: `Add vehicle: ${t.name}`,
    section: 'Vehicles',
    icon: Car,
    keywords: ['car', 'truck', 'suv'],
    order: 60,
    when: (c) => !!c.project,
    run: () => startPlacing({ kind: 'vehicle', templateId: t.id, label: t.name }),
  });
}

// ───────────── overlays ─────────────

canvasLayers.register({ id: 'vehicle-clearance', slot: 'overlay', order: 30, component: VehicleClearanceLayer, overlay: { key: OVERLAY_VEHICLE, label: 'Vehicle door swings & clearance', defaultOn: true, group: 'Vehicles' } });
canvasLayers.register({ id: 'vehicle-entry', slot: 'overlay', order: 31, component: VehicleEntryLayer, overlay: { key: OVERLAY_ENTRY, label: 'Vehicle entry path', defaultOn: false, group: 'Vehicles' } });

// ───────────── custom vehicle dialog ─────────────

const FIELDS = [
  ['length', 'Length'],
  ['width', 'Body width'],
  ['mirrorWidth', 'Width with mirrors'],
  ['height', 'Height'],
  ['wheelbase', 'Wheelbase'],
] as const;

function CustomVehicleDialog() {
  const fmt = useFormatters();
  const [base, setBase] = useState('sedan');
  const tpl = vehicleTemplate(base);
  const [name, setName] = useState('My car');
  const [vals, setVals] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const text = (k: (typeof FIELDS)[number][0]) => vals[k] ?? fmt.length(tpl[k]);
  const submit = () => {
    const project = useProjectStore.getState().project;
    if (!project) return;
    const dims: Record<string, number> = {};
    for (const [k, label] of FIELDS) {
      const r = fmt.parse(text(k), { allowZero: false });
      if (!r.ok) return setError(`${label}: ${r.error}`);
      dims[k] = r.mm;
    }
    if (dims.wheelbase! >= dims.length!) return setError('The wheelbase must be shorter than the overall length.');
    if (dims.mirrorWidth! < dims.width!) return setError('The width with mirrors cannot be less than the body width.');
    const g = roomGeometry(project.room);
    const at = g.polygon.length >= 3 ? centroid(g.polygon) : { x: 0, y: 0 };
    const k = dims.length! / tpl.length;
    const v = createVehicle(base, { x: Math.round(at.x), y: Math.round(at.y), rotation: 180 }, {
      name: name.trim() || 'My car',
      templateId: undefined,
      length: dims.length!,
      width: dims.width!,
      height: dims.height!,
      mirrorWidth: dims.mirrorWidth!,
      foldedMirrorWidth: Math.max(dims.width!, dims.width! + (tpl.foldedMirrorWidth - tpl.width)),
      wheelbase: dims.wheelbase!,
      frontOverhang: Math.min(tpl.frontOverhang * k, (dims.length! - dims.wheelbase!) * 0.6),
    });
    v.doors = v.doors.map((d) => ({ ...d, hingeFromFront: d.hingeFromFront * k, length: d.length * k }));
    const r = dispatch({ type: 'vehicle.add', payload: { items: [v] } });
    if (!r.ok) return setError(r.error);
    editorActions.closeDialog();
    uiActions.select([{ kind: 'vehicle', id: v.id }]);
    uiActions.flash(`Added ${v.name}. Drag it to its parking spot; set desired clearances in the inspector.`);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && editorActions.closeDialog()}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Custom vehicle</DialogTitle>
            <DialogDescription>Enter or confirm your vehicle's measurements (e.g. from the owner's manual). Door and access zones start from the closest body style.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 py-2">
            <div className="col-span-2">
              <Label htmlFor="cv-name">Name</Label>
              <Input id="cv-name" className="mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2024 Subaru WRX" data-testid="cv-name" />
            </div>
            <div className="col-span-2">
              <Label>Body style</Label>
              <Select className="mt-1" ariaLabel="Body style" value={base} onValueChange={(v) => (setBase(v), setVals({}))} options={VEHICLE_TEMPLATES.map((t) => ({ value: t.id, label: t.name }))} />
            </div>
            {FIELDS.map(([k, label]) => (
              <div key={k}>
                <Label htmlFor={`cv-${k}`}>{label}</Label>
                <Input id={`cv-${k}`} className="num mt-1" value={text(k)} onChange={(e) => setVals((s) => ({ ...s, [k]: e.target.value }))} data-testid={`cv-${k}`} />
              </div>
            ))}
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => editorActions.closeDialog()}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" data-testid="cv-create">
              Add vehicle
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CustomVehicleHost() {
  const open = useEditorStore((s) => s.dialog?.id === 'custom-vehicle');
  return open ? <CustomVehicleDialog /> : null;
}
shellExtras.register({ id: 'vehicles.dialogs', order: 40, component: CustomVehicleHost });

paletteCommands.register({ id: 'vehicles.custom', title: 'Add custom vehicle…', section: 'Vehicles', icon: Car, keywords: ['car', 'dimensions', 'wheelbase'], when: (c) => !!c.project, run: () => editorActions.openDialog('custom-vehicle') });
paletteCommands.register({ id: 'vehicles.toggle-clearance', title: 'Toggle: Show vehicle clearance', section: 'View', icon: Car, keywords: ['door swing', 'vehicle'], when: (c) => !!c.project, run: () => uiActions.toggleOverlay(OVERLAY_VEHICLE, true) });
paletteCommands.register({ id: 'vehicles.toggle-entry', title: 'Toggle: Show vehicle entry path', section: 'View', icon: Route, keywords: ['driveway', 'simulation', 'swept path'], when: (c) => !!c.project, run: () => uiActions.toggleOverlay(OVERLAY_ENTRY) });

// ───────────── context menu: doors / mirrors ─────────────

const oneVehicle = (c: SelectionContext) => (c.single?.kind === 'vehicle' ? c.scenario.vehicles.find((v) => v.id === c.single!.id) : undefined);
contextMenuActions.register({
  id: 'vehicle.doors',
  group: 'state',
  order: 10,
  icon: DoorOpen,
  label: (c) => (oneVehicle(c)?.state === 'doors-open' ? 'Close doors' : 'Open doors'),
  appliesTo: (c) => !!oneVehicle(c),
  run: (c) => {
    const v = oneVehicle(c)!;
    updateVehicle(v.id, { state: v.state === 'doors-open' ? 'parked' : 'doors-open' });
  },
});
contextMenuActions.register({
  id: 'vehicle.mirrors',
  group: 'state',
  order: 11,
  label: (c) => (oneVehicle(c)?.mirrorsFolded ? 'Unfold mirrors' : 'Fold mirrors'),
  appliesTo: (c) => !!oneVehicle(c),
  run: (c) => {
    const v = oneVehicle(c)!;
    updateVehicle(v.id, { mirrorsFolded: !v.mirrorsFolded });
  },
});
contextMenuActions.register({
  id: 'vehicle.entry',
  group: 'state',
  order: 12,
  icon: Route,
  label: 'Simulate driving in',
  appliesTo: (c) => !!oneVehicle(c) && c.project.architecture.some((f) => f.kind === 'garage-door'),
  run: (c) => {
    const v = oneVehicle(c)!;
    if (!v.entry?.openingFeatureId) {
      const gd = c.project.architecture.find((f) => f.kind === 'garage-door')!;
      updateVehicle(v.id, { entry: { openingFeatureId: gd.id, approachAngle: 0, approachDistance: 6000, direction: 'forward', ...(v.entry ?? {}) } });
    }
    uiActions.setOverlay(OVERLAY_ENTRY, true);
  },
});

