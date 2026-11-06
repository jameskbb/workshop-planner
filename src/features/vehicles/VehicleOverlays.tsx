/**
 * Vehicle overlays on the plan:
 *  - "Vehicle clearance": door swings (reachable part vs blocked part), trunk/hatch/tailgate and
 *    hood access zones, and the per-side walking-clearance bands: green when the desired clearance
 *    is there, red with a label ("Driver side 4″ of 30″") when it is not. Open doors are drawn open
 *    in the doors-open state. Follows live drags of the vehicle.
 *  - "Vehicle entry path": the simulated maneuver from the driveway: swept area, path, start
 *    position and every contact.
 */
import { memo, useMemo } from 'react';
import { Circle, Group, Line, Text } from 'react-konva';
import { buildAnalysisContext } from '@/analysis';
import { getScenario } from '@/domain/resolve';
import type { Vehicle } from '@/domain/schema';
import { add, centroid, doorLeafPolygon, localToWorld, scale as vscale, vehicleParts, type Polygon } from '@/geometry';
import { useFormatters } from '@/hooks/useFormatters';
import { useProjectStore } from '@/stores/projectStore';
import { usePreview, withPreview } from '@/stores/editorStore';
import { useUiStore } from '@/stores/uiStore';
import { canvasColors } from '@/styles/tokens';
import { useLayerVisible, useScale, useViewRotation } from '@/features/plan/hooks';
import { layoutLabels, textWidth, type LabelCandidate } from '@/features/plan/labelLayout';
import { ENTRY_MARGIN, entryFor, sweptRegion } from './entry';
import { SIDE_LABEL, vehicleReport } from './report';

const OK = '#3f9d6a';
const BAD = canvasColors.danger;
const flat = (pts: Polygon) => pts.flatMap((p) => [p.x, p.y]);

function Label({ at, text, color, scale, viewRot, bold, dy = 0 }: { at: { x: number; y: number }; text: string; color: string; scale: number; viewRot: number; bold?: boolean; dy?: number }) {
  const font = 10 / scale;
  // `dy` is the screen-space nudge the collision solver picked (offsetY is in the text's own,
  // view-aligned frame, so subtracting it moves the label down the screen).
  return (
    <Text
      x={at.x}
      y={at.y}
      rotation={-viewRot}
      text={text}
      fontSize={font}
      fontStyle={bold ? '600' : 'normal'}
      width={240 / scale}
      offsetX={120 / scale}
      offsetY={font / 2 - dy / scale}
      align="center"
      fill={color}
      listening={false}
    />
  );
}

/**
 * Stack this vehicle's clearance labels so they never print on top of each other: each label may
 * slide up or down a line or two from its anchor.
 */
function useVehicleLabelOffsets(entries: ReadonlyArray<{ id: string; at: { x: number; y: number }; text: string }>, scale: number, viewRot: number): Map<string, number> {
  return useMemo(() => {
    const rot = (viewRot * Math.PI) / 180;
    const font = 10;
    const h = font + 2;
    const steps = [0, -h - 1, h + 1, -2 * (h + 1), 2 * (h + 1)];
    const candidates: LabelCandidate[] = entries.map((e) => ({
      id: e.id,
      x: (e.at.x * Math.cos(rot) - e.at.y * Math.sin(rot)) * scale,
      y: (e.at.x * Math.sin(rot) + e.at.y * Math.cos(rot)) * scale,
      w: Math.min(textWidth(e.text, font), 240),
      h,
      offsets: steps.map((dy) => ({ dx: 0, dy })),
      priority: e.text.length,
    }));
    const out = new Map<string, number>();
    // Nothing is dropped here: the last resort is the anchor itself (the text is the warning).
    for (const [id, p] of layoutLabels(candidates)) out.set(id, p.dy);
    return out;
  }, [entries, scale, viewRot]);
}

const VehicleClearance = memo(function VehicleClearance({ vehicle, selected }: { vehicle: Vehicle; selected: boolean }) {
  const v = withPreview(vehicle, usePreview<Vehicle>('vehicle', vehicle.id));
  const project = useProjectStore((s) => s.project);
  const scale = useScale();
  const viewRot = useViewRotation();
  const fmt = useFormatters();
  const rep = useMemo(() => (project ? vehicleReport(buildAnalysisContext(project), v) : null), [project, v]);
  const entries = useMemo(() => {
    if (!rep) return [];
    const list: Array<{ id: string; at: { x: number; y: number }; text: string }> = [];
    for (const s of rep.sides) {
      if (s.desired <= 0 || !(!s.ok || selected)) continue;
      list.push({ id: `side:${s.side}`, at: centroid(s.band), text: s.ok ? `${SIDE_LABEL[s.side]} ${fmt.length(s.desired)} ✓` : `${SIDE_LABEL[s.side]}: ${fmt.length(s.clear)} of ${fmt.length(s.desired)}` });
    }
    for (const a of rep.access) {
      if (a.ok && !selected) continue;
      list.push({ id: `access:${a.which}`, at: centroid(a.zone), text: a.ok ? `${a.label} access ✓` : `${a.label}: ${fmt.length(a.clear)} of ${fmt.length(a.depth)}` });
    }
    for (const d of rep.doors) {
      if (d.fullyOpens && !selected) continue;
      list.push({ id: `door:${d.door.id}`, at: centroid(d.sector), text: d.fullyOpens ? `${d.door.openAngle}°` : `${d.label} ${d.maxAngle}°/${d.door.openAngle}°` });
    }
    return list;
  }, [rep, selected, fmt]);
  const dys = useVehicleLabelOffsets(entries, scale, viewRot);
  if (!rep) return null;
  return (
    <Group listening={false}>
      {rep.sides.map((s) => {
        if (s.desired <= 0) return null;
        const color = s.ok ? OK : BAD;
        return (
          <Group key={s.side}>
            <Line points={flat(s.band)} closed fill={color} opacity={s.ok ? 0.08 : 0.16} stroke={color} strokeWidth={s.ok ? 0.75 : 1.5} dash={[5, 4]} strokeScaleEnabled={false} />
            {(!s.ok || selected) && (
              <Label at={centroid(s.band)} dy={dys.get(`side:${s.side}`) ?? 0} text={s.ok ? `${SIDE_LABEL[s.side]} ${fmt.length(s.desired)} ✓` : `${SIDE_LABEL[s.side]}: ${fmt.length(s.clear)} of ${fmt.length(s.desired)}`} color={color} scale={scale} viewRot={viewRot} bold={!s.ok} />
            )}
          </Group>
        );
      })}
      {rep.access.map((a) => {
        const color = a.ok ? OK : BAD;
        return (
          <Group key={a.which}>
            <Line points={flat(a.zone)} closed fill={color} opacity={a.ok ? 0.05 : 0.14} stroke={color} strokeWidth={1} dash={[2, 3]} strokeScaleEnabled={false} />
            {(!a.ok || selected) && <Label at={centroid(a.zone)} dy={dys.get(`access:${a.which}`) ?? 0} text={a.ok ? `${a.label} access ✓` : `${a.label}: ${fmt.length(a.clear)} of ${fmt.length(a.depth)}`} color={color} scale={scale} viewRot={viewRot} bold={!a.ok} />}
          </Group>
        );
      })}
      {rep.doors.map((d) => {
        const color = d.fullyOpens ? OK : BAD;
        const open = v.state === 'doors-open';
        const leaf = doorLeafPolygon(rep.spec, rep.pose, d.door, d.maxAngle, 50);
        const tip = centroid(d.sector);
        return (
          <Group key={d.door.id}>
            {!d.fullyOpens && <Line points={flat(d.sector)} closed fill={BAD} opacity={0.08} stroke={BAD} strokeWidth={1} dash={[3, 3]} strokeScaleEnabled={false} />}
            <Line points={flat(d.reachable)} closed fill={color} opacity={0.12} stroke={color} strokeWidth={1} strokeScaleEnabled={false} />
            {open && <Line points={flat(leaf)} closed fill={canvasColors.vehicleStroke} stroke={canvasColors.vehicleStroke} strokeWidth={1} strokeScaleEnabled={false} />}
            {(!d.fullyOpens || selected) && <Label at={tip} dy={dys.get(`door:${d.door.id}`) ?? 0} text={d.fullyOpens ? `${d.door.openAngle}°` : `${d.label} ${d.maxAngle}°/${d.door.openAngle}°`} color={color} scale={scale} viewRot={viewRot} bold={!d.fullyOpens} />}
          </Group>
        );
      })}
    </Group>
  );
});

export function VehicleClearanceLayer() {
  const visible = useLayerVisible('vehicle');
  const vehicles = useProjectStore((s) => (s.project ? getScenario(s.project).vehicles : undefined));
  const selection = useUiStore((s) => s.selection);
  if (!visible || !vehicles) return null;
  return (
    <Group listening={false}>
      {vehicles
        .filter((v) => !v.hidden)
        .map((v) => (
          <VehicleClearance key={v.id} vehicle={v} selected={selection.some((r) => r.kind === 'vehicle' && r.id === v.id)} />
        ))}
    </Group>
  );
}

// ───────────── entry path ─────────────

const EntryPath = memo(function EntryPath({ vehicle }: { vehicle: Vehicle }) {
  const project = useProjectStore((s) => s.project);
  const scale = useScale();
  const viewRot = useViewRotation();
  const fmt = useFormatters();
  const r = useMemo(() => (project ? entryFor(buildAnalysisContext(project), vehicle) : null), [project, vehicle]);
  const swept = useMemo(() => (r && !('error' in r) ? sweptRegion(r.spec, r.plan) : []), [r]);
  if (!r || 'error' in r) return null;
  const color = r.feasible ? '#2f7df6' : BAD;
  const path = r.plan.poses.map((p) => localToWorld(p, { x: 0, y: 0 }));
  const startBody = vehicleParts(r.spec, r.start)[0]!;
  const heading = add(r.start, vscale({ x: Math.cos(((r.start.rotation + 90) * Math.PI) / 180), y: Math.sin(((r.start.rotation + 90) * Math.PI) / 180) }, r.spec.length / 2));
  return (
    <Group listening={false}>
      {swept.map((piece, i) => (
        <Line key={i} points={flat(piece.outer)} closed fill={color} opacity={0.12} stroke={color} strokeWidth={1} strokeScaleEnabled={false} />
      ))}
      <Line points={flat(path)} stroke={color} strokeWidth={2} dash={[10, 6]} strokeScaleEnabled={false} />
      <Line points={flat(startBody)} closed stroke={color} strokeWidth={1.5} dash={[6, 4]} strokeScaleEnabled={false} />
      <Circle x={heading.x} y={heading.y} radius={5 / scale} fill={color} />
      <Label at={r.start} text={`Start (${r.direction === 'reverse' ? 'backing in' : 'forward'})`} color={color} scale={scale} viewRot={viewRot} bold />
      {r.collisions.map((c, i) => {
        const body = vehicleParts(r.spec, c.pose)[0]!;
        const col = c.envelopeOnly ? canvasColors.warn : BAD;
        return (
          <Group key={i}>
            <Line points={flat(body)} closed stroke={col} strokeWidth={1.5} strokeScaleEnabled={false} />
            <Label at={c.pose} text={c.envelopeOnly ? `within ${fmt.length(ENTRY_MARGIN)} of ${c.name}` : `hits ${c.name} (${fmt.length(c.depth)})`} color={col} scale={scale} viewRot={viewRot} bold />
          </Group>
        );
      })}
    </Group>
  );
});

export function VehicleEntryLayer() {
  const vehicles = useProjectStore((s) => (s.project ? getScenario(s.project).vehicles : undefined));
  if (!vehicles) return null;
  return (
    <Group listening={false}>
      {vehicles
        .filter((v) => !v.hidden && v.entry?.openingFeatureId)
        .map((v) => (
          <EntryPath key={v.id} vehicle={v} />
        ))}
    </Group>
  );
}
