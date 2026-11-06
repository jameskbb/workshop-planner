/**
 * Vehicle inspector sections: state (parked / doors open) and mirrors, dimensions and doors, desired
 * clearances with live status per side, and the garage-entry simulation.
 */
import { Car, DoorOpen, Play, Route } from 'lucide-react';
import { useMemo } from 'react';
import { buildAnalysisContext } from '@/analysis';
import { inspectorSections, type SelectionContext } from '@/app/registry';
import { AngleInput, LengthInput } from '@/components/LengthInput';
import { PropRow } from '@/components/shell';
import { Button, Select } from '@/components/ui';
import type { Vehicle, VehicleDoor } from '@/domain/schema';
import { useFormatters } from '@/hooks/useFormatters';
import { dispatch } from '@/stores/projectStore';
import { isOverlayOn, uiActions, useUiStore } from '@/stores/uiStore';
import { cn } from '@/utils/cn';
import { SwitchRow } from '@/features/editor/inspectorParts';
import { entryFor, garageOpenings } from './entry';
import { DOOR_LABEL, SIDE_LABEL, vehicleReport } from './report';

export const OVERLAY_VEHICLE = 'vehicle-clearance';
export const OVERLAY_ENTRY = 'vehicle-entry';

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'] as const;

/**
 * Compass word for where a vehicle's nose points. Vehicles model their front as local +y, which is
 * plan south, so heading 0° = nose south; rotation is clockwise on screen (north up).
 */
export function noseCompass(rotationDeg: number): (typeof COMPASS)[number] {
  // 0° → south (index 4), increasing clockwise: south → southwest → west …
  const i = Math.round((((rotationDeg % 360) + 360) % 360) / 45);
  return COMPASS[(4 + i) % 8]!;
}

const single = (c: SelectionContext): Vehicle | undefined => (c.single?.kind === 'vehicle' ? c.scenario.vehicles.find((v) => v.id === c.single!.id) : undefined);
export function updateVehicle(id: string, patch: Partial<Vehicle>, label?: string) {
  const r = dispatch({ type: 'vehicle.update', payload: { id, patch } });
  if (!r.ok) uiActions.flash(r.error, 'error');
  else if (label) uiActions.flash(label);
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange(v: T): void; label: string }) {
  return (
    <div className="flex gap-1" role="group" aria-label={label}>
      {options.map((o) => (
        <Button key={o.value} size="sm" variant={value === o.value ? 'primary' : 'outline'} className="flex-1" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </Button>
      ))}
    </div>
  );
}

function StateSection({ ctx }: { ctx: SelectionContext }) {
  const v = single(ctx)!;
  return (
    <div className="space-y-1.5">
      <Segmented
        label="Vehicle state"
        value={v.state}
        options={[
          { value: 'parked', label: 'Parked' },
          { value: 'doors-open', label: 'Doors open' },
        ]}
        onChange={(state) => updateVehicle(v.id, { state })}
      />
      <SwitchRow label="Mirrors folded" checked={v.mirrorsFolded} onChange={(mirrorsFolded) => updateVehicle(v.id, { mirrorsFolded })} testId="vehicle-mirrors-folded" />
      <p className="text-2xs text-ink-faint">With doors open, the open doors are checked against other items' working clearances.</p>
    </div>
  );
}

function DoorRow({ v, d, i }: { v: Vehicle; d: VehicleDoor; i: number }) {
  const set = (patch: Partial<VehicleDoor>) => updateVehicle(v.id, { doors: v.doors.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-1 text-2xs">
      <span className="truncate text-ink-muted">{DOOR_LABEL[d.id]}</span>
      <LengthInput className="w-16" aria-label={`${DOOR_LABEL[d.id]} hinge from front`} value={d.hingeFromFront} allowZero={false} onCommit={(hingeFromFront) => set({ hingeFromFront })} />
      <LengthInput className="w-16" aria-label={`${DOOR_LABEL[d.id]} length`} value={d.length} allowZero={false} onCommit={(length) => set({ length })} />
      <AngleInput className="w-14" aria-label={`${DOOR_LABEL[d.id]} open angle`} value={d.openAngle} onCommit={(a) => a >= 10 && a <= 90 && set({ openAngle: a })} />
    </div>
  );
}

function DimensionsSection({ ctx }: { ctx: SelectionContext }) {
  const v = single(ctx)!;
  const u = (patch: Partial<Vehicle>) => updateVehicle(v.id, patch);
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-x-2">
        <PropRow label="Wheelbase">
          <LengthInput aria-label="Wheelbase" value={v.wheelbase} allowZero={false} onCommit={(wheelbase) => u({ wheelbase: Math.min(wheelbase, v.length - v.frontOverhang - 100) })} data-testid="vehicle-wheelbase" />
        </PropRow>
        <PropRow label="Front overhang">
          <LengthInput aria-label="Front overhang" value={v.frontOverhang} allowZero={false} onCommit={(frontOverhang) => u({ frontOverhang })} />
        </PropRow>
        <PropRow label="Folded mirrors">
          <LengthInput aria-label="Width with mirrors folded" value={v.foldedMirrorWidth ?? v.width + 80} allowZero={false} onCommit={(foldedMirrorWidth) => u({ foldedMirrorWidth: Math.max(foldedMirrorWidth, v.width) })} />
        </PropRow>
        <PropRow label="Turning radius">
          <LengthInput aria-label="Curb-to-curb turning radius" value={v.turningRadius} allowZero={false} onCommit={(turningRadius) => u({ turningRadius })} />
        </PropRow>
      </div>
      <PropRow label="Driver side">
        <Select className="h-7" ariaLabel="Driver side" value={v.driverSide} onValueChange={(d) => u({ driverSide: d as Vehicle['driverSide'] })} options={[{ value: 'left', label: 'Left (US)' }, { value: 'right', label: 'Right (UK, JP…)' }]} />
      </PropRow>
      <div className="grid grid-cols-2 gap-x-2">
        <PropRow label="Rear access">
          <Select className="h-7" ariaLabel="Rear access type" value={v.rearAccess.kind} onValueChange={(kind) => u({ rearAccess: { ...v.rearAccess, kind: kind as Vehicle['rearAccess']['kind'] } })} options={[{ value: 'trunk', label: 'Trunk' }, { value: 'hatch', label: 'Hatch' }, { value: 'tailgate', label: 'Tailgate' }]} />
        </PropRow>
        <PropRow label="Rear depth">
          <LengthInput aria-label="Room needed behind to open the trunk" value={v.rearAccess.depth} allowZero={false} onCommit={(depth) => u({ rearAccess: { ...v.rearAccess, depth } })} />
        </PropRow>
      </div>
      <PropRow label="Hood access">
        <LengthInput aria-label="Room needed in front to open the hood" value={v.hoodAccessDepth} allowZero={false} onCommit={(hoodAccessDepth) => u({ hoodAccessDepth })} />
      </PropRow>
      <div className="pt-1">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-1 pb-0.5 text-2xs text-ink-faint">
          <span>Door</span>
          <span className="w-16">Hinge</span>
          <span className="w-16">Length</span>
          <span className="w-14">Opens</span>
        </div>
        {v.doors.map((d, i) => (
          <DoorRow key={d.id} v={v} d={d} i={i} />
        ))}
      </div>
    </div>
  );
}

function ClearanceSection({ ctx }: { ctx: SelectionContext }) {
  const v = single(ctx)!;
  const fmt = useFormatters();
  const overlay = useUiStore((s) => isOverlayOn(s, OVERLAY_VEHICLE, true));
  const rep = useMemo(() => vehicleReport(buildAnalysisContext(ctx.project), v), [ctx.project, v]);
  const sides = ['driver', 'passenger', 'front', 'rear'] as const;
  return (
    <div className="space-y-1">
      {sides.map((side) => {
        const s = rep.sides.find((x) => x.side === side)!;
        return (
          <PropRow key={side} label={SIDE_LABEL[side][0]!.toUpperCase() + SIDE_LABEL[side].slice(1)}>
            <div className="flex items-center gap-1.5">
              <LengthInput
                aria-label={`Desired ${SIDE_LABEL[side]} clearance`}
                value={v.desiredClearance[side]}
                onCommit={(mm) => updateVehicle(v.id, { desiredClearance: { ...v.desiredClearance, [side]: mm } })}
                data-testid={`vehicle-clearance-${side}`}
              />
              <span className={cn('num w-20 shrink-0 text-right text-2xs', s.ok ? 'text-ok' : 'text-danger')}>{s.desired <= 0 ? 'n/a' : s.ok ? '✓ clear' : `✕ ${fmt.length(s.clear)}`}</span>
            </div>
          </PropRow>
        );
      })}
      <ul className="space-y-0.5 pt-1 text-2xs text-ink-muted">
        {rep.doors.map((d) => (
          <li key={d.door.id} className={d.fullyOpens ? '' : 'text-danger'}>
            <DoorOpen className="mr-1 inline size-3" />
            {DOOR_LABEL[d.door.id]}: {d.fullyOpens ? `opens fully (${d.door.openAngle}°)` : `${d.maxAngle}° of ${d.door.openAngle}°, ${fmt.length(d.egressGap)} to get out${d.blocker ? `, stopped by ${d.blocker.name}` : ''}`}
          </li>
        ))}
        {rep.access.map((a) => (
          <li key={a.which} className={a.ok ? '' : 'text-danger'}>
            {a.label[0]!.toUpperCase() + a.label.slice(1)} access: {a.ok ? 'clear' : `${fmt.length(a.clear)} of ${fmt.length(a.depth)}${a.blocker ? ` (${a.blocker.name})` : ''}`}
          </li>
        ))}
      </ul>
      <Button size="sm" variant="ghost" onClick={() => uiActions.setOverlay(OVERLAY_VEHICLE, !overlay)} aria-pressed={overlay}>
        <Car /> {overlay ? 'Hide' : 'Show'} door swings & clearances on plan
      </Button>
    </div>
  );
}

function EntrySection({ ctx }: { ctx: SelectionContext }) {
  const v = single(ctx)!;
  const fmt = useFormatters();
  const openings = useMemo(() => garageOpenings(buildAnalysisContext(ctx.project)), [ctx.project]);
  const showing = useUiStore((s) => isOverlayOn(s, OVERLAY_ENTRY));
  const entry = v.entry;
  const result = useMemo(() => (entry?.openingFeatureId ? entryFor(buildAnalysisContext(ctx.project), v) : null), [ctx.project, v, entry?.openingFeatureId]);
  if (openings.length === 0) return <p className="text-2xs text-ink-faint">Add a garage door (Fixed features panel) to simulate driving in from the driveway.</p>;
  const cur = entry ?? { openingFeatureId: undefined, approachAngle: 0, approachDistance: 6000, direction: 'forward' as const };
  const set = (patch: Partial<NonNullable<Vehicle['entry']>>) => updateVehicle(v.id, { entry: { ...cur, openingFeatureId: cur.openingFeatureId ?? openings[0]!.feature.id, ...patch } });
  const run = () => {
    set({});
    uiActions.setOverlay(OVERLAY_ENTRY, true);
  };
  return (
    <div className="space-y-1">
      <PropRow label="Garage door">
        <Select className="h-7" ariaLabel="Garage opening to enter through" value={cur.openingFeatureId ?? openings[0]!.feature.id} onValueChange={(openingFeatureId) => set({ openingFeatureId })} options={openings.map((o) => ({ value: o.feature.id, label: `${o.feature.name} (${fmt.length(o.width)})` }))} />
      </PropRow>
      <PropRow label="Direction">
        <Segmented label="Drive in direction" value={cur.direction} options={[{ value: 'forward', label: 'Nose in' }, { value: 'reverse', label: 'Back in' }]} onChange={(direction) => set({ direction })} />
      </PropRow>
      <div className="grid grid-cols-2 gap-x-2">
        <PropRow label="Approach">
          <AngleInput aria-label="Driveway approach angle (0° = straight in)" value={cur.approachAngle} onCommit={(a) => set({ approachAngle: Math.max(-75, Math.min(75, a)) })} data-testid="entry-angle" />
        </PropRow>
        <PropRow label="Start">
          <LengthInput aria-label="Start distance outside the door" value={cur.approachDistance} allowZero={false} onCommit={(approachDistance) => set({ approachDistance })} />
        </PropRow>
      </div>
      <div className="flex gap-1">
        <Button size="sm" variant="primary" onClick={run} data-testid="entry-run">
          <Play /> Simulate entry
        </Button>
        {entry?.openingFeatureId && (
          <Button size="sm" variant="ghost" onClick={() => uiActions.setOverlay(OVERLAY_ENTRY, !showing)} aria-pressed={showing}>
            <Route /> {showing ? 'Hide' : 'Show'} path
          </Button>
        )}
      </div>
      {result && ('error' in result ? (
        <p className="text-2xs text-ink-muted">{result.error}</p>
      ) : (
        <p className={cn('rounded-md border px-2 py-1.5 text-xs leading-snug', result.feasible ? 'border-ok/40 text-ink' : 'border-danger/50 text-ink')} data-testid="entry-result">
          <span className={result.feasible ? 'font-semibold text-ok' : 'font-semibold text-danger'}>{result.feasible ? '✓ Can drive in. ' : '✕ Blocked. '}</span>
          {result.summary}
        </p>
      ))}
      <p className="text-2xs text-ink-faint">Simple bicycle-model turning with this vehicle's turning radius: an approximation, not automotive engineering. Adjust the approach angle to match your driveway.</p>
    </div>
  );
}

const is = (c: SelectionContext) => !!single(c);
inspectorSections.register({ id: 'vehicle.state', title: 'State & mirrors', order: 41, appliesTo: is, component: StateSection });
inspectorSections.register({ id: 'vehicle.clearance', title: 'Desired clearance', order: 42, appliesTo: is, component: ClearanceSection });
inspectorSections.register({ id: 'vehicle.entry', title: 'Entry simulation', order: 44, appliesTo: is, component: EntrySection });
inspectorSections.register({ id: 'vehicle.dimensions', title: 'Dimensions & doors', order: 46, appliesTo: is, component: DimensionsSection, collapsed: true });
