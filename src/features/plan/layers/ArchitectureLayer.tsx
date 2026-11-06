import { memo } from 'react';
import { Circle, Group, Line, Text } from 'react-konva';
import { entityAttrs } from '@/app/canvas/PlanCanvas';
import { featureFootprint, resolvePlacement, roomGeometry } from '@/domain/resolve';
import type { ArchitecturalFeature, Room } from '@/domain/schema';
import { add, angleOf, pointOnWall, rotate, scale as vscale, signedArea, type Point } from '@/geometry';
import { useFormatters } from '@/hooks/useFormatters';
import { useProjectStore } from '@/stores/projectStore';
import { usePreview, withPreview } from '@/stores/editorStore';
import { useUiStore } from '@/stores/uiStore';
import { canvasColors, monochrome } from '@/styles/tokens';
import { useLayerVisible, useLiveRoom, useMonochrome, useScale, useViewRotation } from '../hooks';
import { uprightAngle } from './RoomLayer';
import { LockGlyph } from './ObjectsLayer';

const flat = (pts: Point[]) => pts.flatMap((p) => [p.x, p.y]);

export function arcPoints(center: Point, radius: number, fromDeg: number, toDeg: number, steps = 24): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((fromDeg + ((toDeg - fromDeg) * i) / steps) * Math.PI) / 180;
    pts.push({ x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius });
  }
  return pts;
}

/** Door leaf + swing arc for a wall-hosted door (single or double). */
function DoorSwing({ room, f }: { room: Room; f: ArchitecturalFeature }) {
  if (f.placement.type !== 'wall' || !f.door || f.door.swing === 'none') return null;
  const g = roomGeometry(room);
  const wall = g.walls[g.wallIndex.get(f.placement.wallId) ?? -1];
  if (!wall) return null;
  const s0 = f.placement.offset - f.width / 2;
  const s1 = f.placement.offset + f.width / 2;
  const into = f.door.swing === 'in' ? wall.inward : wall.outward;
  const t = g.thickness[wall.index] ?? 0;
  const faceOffset = f.door.swing === 'in' ? 0 : -t;
  const leaves: Array<{ hinge: Point; closedDir: Point; length: number }> = [];
  const a = pointOnWall(wall, s0, faceOffset);
  const b = pointOnWall(wall, s1, faceOffset);
  if (f.kind === 'double-door') {
    leaves.push({ hinge: a, closedDir: wall.dir, length: f.width / 2 }, { hinge: b, closedDir: vscale(wall.dir, -1), length: f.width / 2 });
  } else {
    // Seen from inside facing the wall, the wall's start vertex is on the LEFT for positively wound rooms.
    const leftIsStart = (f.door.hinge === 'left') === signedArea(g.polygon) > 0;
    leaves.push(leftIsStart ? { hinge: a, closedDir: wall.dir, length: f.width } : { hinge: b, closedDir: vscale(wall.dir, -1), length: f.width });
  }
  const openAngle = f.door.openAngle;
  return (
    <>
      {leaves.map((leaf, i) => {
        const closed = angleOf(leaf.closedDir);
        const open = angleOf(into);
        // Sweep the short way from closed to open.
        let delta = open - closed;
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
        const end = closed + Math.sign(delta) * Math.min(Math.abs(delta), openAngle);
        const tip = add(leaf.hinge, vscale(rotate({ x: 1, y: 0 }, end), leaf.length));
        return (
          <Group key={i} listening={false}>
            <Line points={flat(arcPoints(leaf.hinge, leaf.length, closed, end))} stroke={canvasColors.doorSwing} strokeWidth={1} dash={[4, 3]} strokeScaleEnabled={false} />
            <Line points={flat([leaf.hinge, tip])} stroke={canvasColors.ink} strokeWidth={1.5} strokeScaleEnabled={false} />
          </Group>
        );
      })}
    </>
  );
}

/** Garage door opening + overhead track / open-panel area (dashed). */
function GarageDoor({ room, f }: { room: Room; f: ArchitecturalFeature }) {
  if (f.placement.type !== 'wall' || !f.garageDoor) return null;
  const g = roomGeometry(room);
  const wall = g.walls[g.wallIndex.get(f.placement.wallId) ?? -1];
  if (!wall) return null;
  const s0 = f.placement.offset - f.width / 2;
  const s1 = f.placement.offset + f.width / 2;
  const L = f.garageDoor.trackLength;
  const area = [pointOnWall(wall, s0, 0), pointOnWall(wall, s1, 0), pointOnWall(wall, s1, L), pointOnWall(wall, s0, L)];
  const open = f.garageDoor.state === 'open';
  // Track rails along both sides of the opening.
  const railL = [pointOnWall(wall, s0 - 40, 0), pointOnWall(wall, s0 - 40, L)];
  const railR = [pointOnWall(wall, s1 + 40, 0), pointOnWall(wall, s1 + 40, L)];
  return (
    <Group listening={false}>
      <Line points={flat(area)} closed fill={open ? 'rgba(95,102,109,0.18)' : canvasColors.garageTrack} stroke={canvasColors.doorSwing} strokeWidth={1} dash={[8, 5]} strokeScaleEnabled={false} />
      <Line points={flat(railL)} stroke={canvasColors.doorSwing} strokeWidth={1.5} strokeScaleEnabled={false} />
      <Line points={flat(railR)} stroke={canvasColors.doorSwing} strokeWidth={1.5} strokeScaleEnabled={false} />
    </Group>
  );
}

const FeatureNode = memo(function FeatureNode({ feature, room, selected, hovered }: { feature: ArchitecturalFeature; room: Room; selected: boolean; hovered: boolean }) {
  const patch = usePreview<ArchitecturalFeature>('feature', feature.id);
  const f = withPreview(feature, patch);
  const scale = useScale();
  const viewRot = useViewRotation();
  const mono = useMonochrome();
  const fmt = useFormatters();
  const fp = featureFootprint(room, f);
  if (fp.length < 3) return null;
  const stroke = selected ? canvasColors.select : hovered ? canvasColors.hover : mono ? monochrome.stroke : canvasColors.ink;
  const sw = selected ? 2 : 1;
  const font = 10 / scale;
  const opening = f.kind === 'door' || f.kind === 'double-door' || f.kind === 'garage-door' || f.kind === 'window';
  const { pose } = resolvePlacement(room, f.placement, f.width, f.depth);
  const lock = f.locked && (selected || hovered) ? <LockGlyph x={pose.x} y={pose.y - font * 1.6} scale={scale} /> : null;
  if (opening) {
    const mid = fp.length === 4 ? { x: (fp[0]!.x + fp[1]!.x) / 2, y: (fp[0]!.y + fp[1]!.y) / 2 } : pose;
    return (
      <Group {...entityAttrs('feature', f.id)}>
        {f.kind === 'garage-door' && <GarageDoor room={room} f={f} />}
        {/* Opening cut through the wall */}
        <Line
          points={flat(fp)}
          closed
          fill={f.kind === 'window' ? (mono ? '#ffffff' : '#dbe9f4') : canvasColors.paper}
          stroke={f.kind === 'window' && !selected ? canvasColors.window : stroke}
          strokeWidth={sw}
          strokeScaleEnabled={false}
          hitStrokeWidth={10}
        />
        {f.kind === 'window' && fp.length === 4 && <Line points={flat([mid, { x: (fp[2]!.x + fp[3]!.x) / 2, y: (fp[2]!.y + fp[3]!.y) / 2 }])} stroke={canvasColors.window} strokeWidth={1} strokeScaleEnabled={false} listening={false} />}
        {(f.kind === 'door' || f.kind === 'double-door') && <DoorSwing room={room} f={f} />}
        {f.kind === 'garage-door' && fp.length === 4 && (
          <Text
            x={mid.x}
            y={mid.y}
            text={`${f.name}\n${fmt.length(f.width)} × ${fmt.length(f.garageDoor?.openingHeight ?? f.height)} opening`}
            fontSize={font}
            lineHeight={1.25}
            width={240 / scale}
            offsetX={120 / scale}
            offsetY={-font * 0.8}
            align="center"
            rotation={uprightAngle(pose.rotation, viewRot)}
            fill={canvasColors.inkMuted}
            listening={false}
          />
        )}
        {lock}
      </Group>
    );
  }
  if (f.shape === 'round') {
    return (
      <Group {...entityAttrs('feature', f.id)}>
        <Circle x={pose.x} y={pose.y} radius={f.width / 2} fill={mono ? '#ffffff' : '#9aa1a8'} stroke={stroke} strokeWidth={sw} strokeScaleEnabled={false} hitStrokeWidth={10} />
        {(f.width * scale > 30 || selected) && (
          <Text
            x={pose.x}
            y={pose.y + (f.width * scale > 30 ? 0 : f.width / 2 + font)}
            rotation={-viewRot}
            text={selected || f.kind === 'support-pole' ? `${f.name}\n⌀ ${fmt.length(f.width)}` : f.name}
            fontSize={font}
            lineHeight={1.2}
            width={140 / scale}
            offsetX={70 / scale}
            offsetY={f.width * scale > 30 ? font : 0}
            align="center"
            fill={canvasColors.ink}
            listening={false}
          />
        )}
        {lock}
      </Group>
    );
  }
  const overhead = f.kind === 'ceiling-obstruction' || f.kind === 'ceiling-beam' || f.kind === 'attic-ladder';
  return (
    <Group {...entityAttrs('feature', f.id)}>
      <Line
        points={flat(fp)}
        closed
        fill={overhead ? 'rgba(109,116,124,0.08)' : mono ? '#ffffff' : (f.color ?? '#c7ccd1')}
        stroke={stroke}
        strokeWidth={sw}
        dash={overhead ? [6, 4] : undefined}
        strokeScaleEnabled={false}
      />
      {!overhead && <Line points={flat([fp[0]!, fp[2]!])} stroke={canvasColors.inkMuted} strokeWidth={0.75} strokeScaleEnabled={false} listening={false} opacity={0.5} />}
      <Text
        x={pose.x}
        y={pose.y}
        rotation={-viewRot}
        text={overhead ? `${f.name} (overhead)` : f.name}
        fontSize={font}
        width={Math.max(f.width, 80 / scale)}
        offsetX={Math.max(f.width, 80 / scale) / 2}
        offsetY={font / 2}
        align="center"
        wrap="none"
        ellipsis
        fill={canvasColors.ink}
        listening={false}
      />
      {lock}
    </Group>
  );
});

export function ArchitectureLayer() {
  const visible = useLayerVisible('architecture');
  const room = useLiveRoom();
  const features = useProjectStore((s) => s.project?.architecture);
  const selected = useUiStore((s) => s.selection);
  const hovered = useUiStore((s) => (s.hovered?.kind === 'feature' ? s.hovered.id : null));
  if (!visible || !room || !features || room.vertices.length < 3) return null;
  return (
    <Group>
      {features.map((f) =>
        f.hidden && !selected.some((r) => r.kind === 'feature' && r.id === f.id) ? null : (
          <FeatureNode key={f.id} feature={f} room={room} hovered={hovered === f.id} selected={selected.some((r) => r.kind === 'feature' && r.id === f.id)} />
        ),
      )}
    </Group>
  );
}
