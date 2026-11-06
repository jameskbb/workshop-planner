/**
 * Electrical points, light fixtures, workflow zones and persistent measurements.
 */
import { memo } from 'react';
import { Circle, Group, Line, Rect, Text } from 'react-konva';
import { entityAttrs, handleAttrs } from '@/app/canvas/PlanCanvas';
import { electricalPosition, getScenario, resolvePlacement } from '@/domain/resolve';
import { resolveMeasurement } from '@/domain/measure';
import type { ElectricalPoint, LightingFixture, Measurement, Room, WorkflowZone } from '@/domain/schema';
import { add, angleOf, area, centroid, normalize, perp, scale as vscale, sub, type Point } from '@/geometry';
import { useFormatters } from '@/hooks/useFormatters';
import { useProjectStore } from '@/stores/projectStore';
import { usePreview, withPreview } from '@/stores/editorStore';
import { useUiStore } from '@/stores/uiStore';
import { canvasColors, monochrome, zoneKindColors } from '@/styles/tokens';
import { useLayerVisible, useLiveRoom, useMonochrome, useScale, useViewRotation } from '../hooks';
import { uprightAngle } from './RoomLayer';
import { arcPoints } from './ArchitectureLayer';
import { LockGlyph } from './ObjectsLayer';

const flat = (pts: Point[]) => pts.flatMap((p) => [p.x, p.y]);
const MONO_FONT = 'JetBrains Mono Variable, monospace';

// ───────────── electrical ─────────────

const ElectricalNode = memo(function ElectricalNode({ point, room, selected, hovered }: { point: ElectricalPoint; room: Room; selected: boolean; hovered: boolean }) {
  const e = withPreview(point, usePreview<ElectricalPoint>('electrical', point.id));
  const scale = useScale();
  const viewRot = useViewRotation();
  const mono = useMonochrome();
  const color = mono ? monochrome.stroke : canvasColors.electrical;
  const stroke = selected ? canvasColors.select : hovered ? canvasColors.hover : color;
  const r = 7 / scale;
  const font = 9 / scale;
  if (e.kind === 'panel') {
    const { pose } = resolvePlacement(room, e.placement, e.width, 100);
    return (
      <Group {...entityAttrs('electrical', e.id)} x={pose.x} y={pose.y} rotation={pose.rotation}>
        <Rect x={-e.width / 2} y={-50} width={e.width} height={100} fill={mono ? '#fff' : '#f5e7c2'} stroke={stroke} strokeWidth={selected ? 2 : 1.25} strokeScaleEnabled={false} hitStrokeWidth={10} />
        <Line points={[-e.width / 2, -50, e.width / 2, 50]} stroke={stroke} strokeWidth={1} strokeScaleEnabled={false} />
        <Group rotation={-pose.rotation - viewRot}>
          <Text text={e.label || 'Panel'} fontSize={font} y={70} width={100 / scale} offsetX={50 / scale} align="center" fill={color} />
        </Group>
        {e.locked && (selected || hovered) && <LockGlyph x={0} y={-50 - font} scale={scale} />}
      </Group>
    );
  }
  const p = electricalPosition(room, e);
  const is240 = e.kind === 'outlet-240';
  const tags = [is240 ? '240V' : '', e.gfci ? 'GFCI' : '', e.dedicated ? 'DED' : ''].filter(Boolean).join(' ');
  return (
    <Group {...entityAttrs('electrical', e.id)} x={p.x} y={p.y}>
      <Circle radius={r} fill={mono ? '#fff' : '#fff8e6'} stroke={stroke} strokeWidth={selected ? 2 : 1.25} strokeScaleEnabled={false} hitStrokeWidth={8} />
      {e.kind === 'ceiling-outlet' ? (
        <Line points={[-r * 0.6, -r * 0.6, r * 0.6, r * 0.6, 0, 0, r * 0.6, -r * 0.6, -r * 0.6, r * 0.6]} stroke={stroke} strokeWidth={1} strokeScaleEnabled={false} />
      ) : e.kind === 'extension-point' ? (
        <Text text="E" rotation={-viewRot} fontSize={r * 1.2} width={r * 2} offsetX={r} offsetY={r * 0.6} align="center" fill={stroke} />
      ) : (
        <Group rotation={-viewRot}>
          <Line points={[-r * 0.35, -r * 0.45, -r * 0.35, r * 0.45]} stroke={stroke} strokeWidth={1.25} strokeScaleEnabled={false} />
          <Line points={[r * 0.35, -r * 0.45, r * 0.35, r * 0.45]} stroke={stroke} strokeWidth={1.25} strokeScaleEnabled={false} />
        </Group>
      )}
      {(tags || (selected && e.label)) && (
        <Group rotation={-viewRot}>
          <Text text={[tags, selected ? e.label : ''].filter(Boolean).join(' · ')} fontSize={font} x={r * 1.3} offsetY={font / 2} fill={color} fontStyle="600" listening={false} />
        </Group>
      )}
      {e.locked && (selected || hovered) && <LockGlyph x={0} y={-r - font} scale={scale} />}
    </Group>
  );
});

export function ElectricalLayer() {
  const visible = useLayerVisible('electrical');
  const room = useLiveRoom();
  const points = useProjectStore((s) => s.project?.electrical);
  const selection = useUiStore((s) => s.selection);
  const hovered = useUiStore((s) => (s.hovered?.kind === 'electrical' ? s.hovered.id : null));
  if (!visible || !room || !points || room.vertices.length < 3) return null;
  return (
    <Group>
      {points.map((e) => {
        const selected = selection.some((s) => s.kind === 'electrical' && s.id === e.id);
        return e.hidden && !selected ? null : <ElectricalNode key={e.id} point={e} room={room} selected={selected} hovered={hovered === e.id} />;
      })}
    </Group>
  );
}

// ───────────── lights ─────────────

const LightNode = memo(function LightNode({ light, selected, hovered }: { light: LightingFixture; selected: boolean; hovered: boolean }) {
  const l = withPreview(light, usePreview<LightingFixture>('light', light.id));
  const scale = useScale();
  const viewRot = useViewRotation();
  const mono = useMonochrome();
  const stroke = selected ? canvasColors.select : hovered ? canvasColors.hover : mono ? monochrome.stroke : canvasColors.light;
  const fill = mono ? '#fff' : '#fff6d1';
  return (
    <Group {...entityAttrs('light', l.id)} x={l.x} y={l.y} rotation={l.rotation}>
      {l.kind === 'shop-light' ? (
        <>
          <Rect x={-l.length / 2} y={-l.width / 2 - 20} width={l.length} height={l.width + 40} fill={fill} stroke={stroke} strokeWidth={selected ? 2 : 1.25} strokeScaleEnabled={false} hitStrokeWidth={8} />
          <Line points={[-l.length / 2, 0, l.length / 2, 0]} stroke={stroke} strokeWidth={1} strokeScaleEnabled={false} />
        </>
      ) : (
        <>
          <Circle radius={Math.max(l.length, l.width) / 2} fill={fill} stroke={stroke} strokeWidth={selected ? 2 : 1.25} strokeScaleEnabled={false} hitStrokeWidth={8} />
          <Line points={[-l.length / 2, -l.length / 2, l.length / 2, l.length / 2, 0, 0, l.length / 2, -l.length / 2, -l.length / 2, l.length / 2]} stroke={stroke} strokeWidth={1} strokeScaleEnabled={false} />
        </>
      )}
      {(selected || hovered) && (
        <Group rotation={-l.rotation - viewRot}>
          <Text text={l.name} fontSize={10 / scale} y={Math.max(l.width, l.length / 4) / 2 + 60} width={160 / scale} offsetX={80 / scale} align="center" fill={canvasColors.inkMuted} listening={false} />
        </Group>
      )}
      {l.locked && (selected || hovered) && <LockGlyph x={0} y={-l.width / 2 - 40} scale={scale} />}
    </Group>
  );
});

export function LightsLayer() {
  const visible = useLayerVisible('lighting');
  const lights = useProjectStore((s) => (s.project ? getScenario(s.project).lights : undefined));
  const selection = useUiStore((s) => s.selection);
  const hovered = useUiStore((s) => (s.hovered?.kind === 'light' ? s.hovered.id : null));
  if (!visible || !lights) return null;
  return (
    <Group>
      {lights.map((l) => {
        const selected = selection.some((s) => s.kind === 'light' && s.id === l.id);
        return l.hidden && !selected ? null : <LightNode key={l.id} light={l} selected={selected} hovered={hovered === l.id} />;
      })}
    </Group>
  );
}

// ───────────── zones ─────────────

const ZoneNode = memo(function ZoneNode({ zone, selected, hovered }: { zone: WorkflowZone; selected: boolean; hovered: boolean }) {
  const z = withPreview(zone, usePreview<WorkflowZone>('zone', zone.id));
  const scale = useScale();
  const viewRot = useViewRotation();
  const mono = useMonochrome();
  const fmt = useFormatters();
  const color = mono ? monochrome.muted : (z.color ?? zoneKindColors[z.kind] ?? '#bdbdbd');
  const c = centroid(z.points);
  const font = 12 / scale;
  return (
    <Group {...entityAttrs('zone', z.id)}>
      {/* The fill is not pickable, so marquee selection and clicks on items inside the zone work;
          zones are picked by their outline or label. */}
      <Line points={flat(z.points)} closed fill={color} opacity={mono ? 0.08 : 0.16} listening={false} />
      <Line points={flat(z.points)} closed stroke={selected ? canvasColors.select : hovered ? canvasColors.hover : color} strokeWidth={selected ? 2 : 1.25} dash={[10, 6]} strokeScaleEnabled={false} hitStrokeWidth={12} fillEnabled={false} />
      <Text
        x={c.x}
        y={c.y}
        rotation={-viewRot}
        text={selected ? `${z.name.toUpperCase()}\n${fmt.area(area(z.points))}` : z.name.toUpperCase()}
        fontSize={font}
        lineHeight={1.3}
        letterSpacing={1.5 / scale}
        fontStyle="600"
        width={300 / scale}
        offsetX={150 / scale}
        offsetY={font / 2}
        align="center"
        fill={mono ? monochrome.stroke : color}
        opacity={0.95}
      />
    </Group>
  );
});

export function ZonesLayer() {
  const visible = useLayerVisible('zones');
  const zones = useProjectStore((s) => (s.project ? getScenario(s.project).zones : undefined));
  const selection = useUiStore((s) => s.selection);
  const hovered = useUiStore((s) => (s.hovered?.kind === 'zone' ? s.hovered.id : null));
  if (!visible || !zones) return null;
  return (
    <Group>
      {zones.map((z) => {
        const selected = selection.some((s) => s.kind === 'zone' && s.id === z.id);
        return z.hidden && !selected ? null : <ZoneNode key={z.id} zone={z} selected={selected} hovered={hovered === z.id} />;
      })}
    </Group>
  );
}

/** Point handles of the selected zone (overlay slot). */
export function ZoneHandlesLayer() {
  const sel = useUiStore((s) => (s.selection.length === 1 && s.selection[0]!.kind === 'zone' ? s.selection[0]!.id : null));
  const zone = useProjectStore((s) => (s.project && sel ? getScenario(s.project).zones.find((z) => z.id === sel) : undefined));
  const patch = usePreview<WorkflowZone>('zone', sel ?? '');
  const tool = useUiStore((s) => s.tool);
  const scale = useScale();
  if (!zone || zone.locked || tool !== 'select') return null;
  const z = withPreview(zone, patch);
  const r = 5 / scale;
  return (
    <Group>
      {z.points.map((p, i) => (
        <Circle key={i} {...handleAttrs(`zone:${z.id}:${i}`)} x={p.x} y={p.y} radius={r} fill="#fff" stroke={canvasColors.select} strokeWidth={1.5} strokeScaleEnabled={false} hitStrokeWidth={10} />
      ))}
    </Group>
  );
}

// ───────────── measurements ─────────────

/** A dimension line a→b with end ticks and a centered label (world units). */
export function DimensionLine({ a, b, offset = 0, text, color, scale, viewRot, strokeWidth = 1.25, dash }: { a: Point; b: Point; offset?: number; text: string; color: string; scale: number; viewRot: number; strokeWidth?: number; dash?: number[] }) {
  const dir = normalize(sub(b, a));
  const n = perp(dir);
  const off = vscale(n, offset);
  const A = add(a, off);
  const B = add(b, off);
  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  const tick = 6 / scale;
  const font = 11 / scale;
  const tw = 280 / scale;
  return (
    <>
      {offset !== 0 && (
        <>
          <Line points={flat([a, add(A, vscale(n, Math.sign(offset) * tick))])} stroke={color} strokeWidth={0.75} strokeScaleEnabled={false} opacity={0.6} />
          <Line points={flat([b, add(B, vscale(n, Math.sign(offset) * tick))])} stroke={color} strokeWidth={0.75} strokeScaleEnabled={false} opacity={0.6} />
        </>
      )}
      <Line points={flat([A, B])} stroke={color} strokeWidth={strokeWidth} strokeScaleEnabled={false} hitStrokeWidth={10} dash={dash} />
      <Line points={flat([add(A, vscale(add(n, dir), -tick * 0.7)), add(A, vscale(add(n, dir), tick * 0.7))])} stroke={color} strokeWidth={strokeWidth} strokeScaleEnabled={false} />
      <Line points={flat([add(B, vscale(add(n, dir), -tick * 0.7)), add(B, vscale(add(n, dir), tick * 0.7))])} stroke={color} strokeWidth={strokeWidth} strokeScaleEnabled={false} />
      <Group x={mid.x} y={mid.y} rotation={uprightAngle(angleOf(dir), viewRot)} listening={false}>
        <Text text={text} fontSize={font} fontFamily={MONO_FONT} width={tw} offsetX={tw / 2} offsetY={font * 1.35} align="center" fill={color} />
      </Group>
    </>
  );
}

const MeasurementNode = memo(function MeasurementNode({ measurement, selected, hovered }: { measurement: Measurement; selected: boolean; hovered: boolean }) {
  const m = withPreview(measurement, usePreview<Measurement>('measurement', measurement.id));
  const project = useProjectStore((s) => s.project);
  const scale = useScale();
  const viewRot = useViewRotation();
  const mono = useMonochrome();
  const fmt = useFormatters();
  if (!project) return null;
  const r = resolveMeasurement(project, getScenario(project), m);
  const color = selected ? canvasColors.select : hovered ? canvasColors.hover : mono ? monochrome.stroke : r.live ? canvasColors.dimension : canvasColors.inkMuted;
  const hr = 5 / scale;
  const handles = selected && (
    <>
      {(['a', 'b', ...(m.kind === 'angular' ? ['c'] : [])] as const).map((end) => {
        const p = end === 'a' ? r.a : end === 'b' ? r.b : r.c!;
        return <Circle key={end} {...handleAttrs(`measure:${m.id}:${end}`)} x={p.x} y={p.y} radius={hr} fill="#fff" stroke={canvasColors.select} strokeWidth={1.5} strokeScaleEnabled={false} hitStrokeWidth={10} />;
      })}
    </>
  );
  if (m.kind === 'angular' && r.c) {
    const a1 = angleOf(sub(r.b, r.a));
    const a2 = angleOf(sub(r.c, r.a));
    let d = a2 - a1;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    const rad = 40 / scale;
    const midA = ((a1 + d / 2) * Math.PI) / 180;
    const font = 11 / scale;
    return (
      <Group {...entityAttrs('measurement', m.id)}>
        <Line points={flat([r.b, r.a, r.c])} stroke={color} strokeWidth={1.25} strokeScaleEnabled={false} hitStrokeWidth={10} />
        <Line points={flat(arcPoints(r.a, rad, a1, a1 + d))} stroke={color} strokeWidth={1.25} strokeScaleEnabled={false} />
        <Text
          x={r.a.x + Math.cos(midA) * rad * 1.6}
          y={r.a.y + Math.sin(midA) * rad * 1.6}
          rotation={-viewRot}
          text={`${m.label ? `${m.label}: ` : ''}${fmt.angle(r.value)}`}
          fontSize={font}
          fontFamily={MONO_FONT}
          width={160 / scale}
          offsetX={80 / scale}
          offsetY={font / 2}
          align="center"
          fill={color}
          listening={false}
        />
        {handles}
      </Group>
    );
  }
  const text = `${r.title ? `${r.title} = ` : ''}${fmt.length(r.value)}${r.live ? '' : ' (anchor removed)'}`;
  return (
    <Group {...entityAttrs('measurement', m.id)}>
      <DimensionLine a={r.a} b={r.b} offset={m.offset} text={text} color={color} scale={scale} viewRot={viewRot} dash={m.kind === 'clearance' ? [6, 3] : undefined} />
      {handles}
    </Group>
  );
});

export function MeasurementsLayer() {
  const visible = useLayerVisible('measurements');
  const measurements = useProjectStore((s) => (s.project ? getScenario(s.project).measurements : undefined));
  const selection = useUiStore((s) => s.selection);
  const hovered = useUiStore((s) => (s.hovered?.kind === 'measurement' ? s.hovered.id : null));
  if (!visible || !measurements) return null;
  return (
    <Group>
      {measurements.map((m) => {
        const selected = selection.some((s) => s.kind === 'measurement' && s.id === m.id);
        return m.hidden && !selected ? null : <MeasurementNode key={m.id} measurement={m} selected={selected} hovered={hovered === m.id} />;
      })}
    </Group>
  );
}
