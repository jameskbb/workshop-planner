import { memo } from 'react';
import { Arrow, Group, Line, Rect, Text } from 'react-konva';
import { entityAttrs } from '@/app/canvas/PlanCanvas';
import { getScenario, vehicleGeomSpec } from '@/domain/resolve';
import type { Vehicle } from '@/domain/schema';
import { vehicleMirrorsLocal } from '@/geometry';
import { useProjectStore } from '@/stores/projectStore';
import { usePreview, withPreview } from '@/stores/editorStore';
import { useUiStore } from '@/stores/uiStore';
import { canvasColors, monochrome } from '@/styles/tokens';
import { useLayerVisible, useMonochrome, useScale, useViewRotation } from '../hooks';
import { LockGlyph } from './ObjectsLayer';

const VehicleNode = memo(function VehicleNode({ vehicle, selected, hovered }: { vehicle: Vehicle; selected: boolean; hovered: boolean }) {
  const v = withPreview(vehicle, usePreview<Vehicle>('vehicle', vehicle.id));
  const scale = useScale();
  const viewRot = useViewRotation();
  const mono = useMonochrome();
  const w = v.width;
  const l = v.length;
  const stroke = selected ? canvasColors.select : hovered ? canvasColors.hover : mono ? monochrome.stroke : canvasColors.vehicleStroke;
  const fill = mono ? monochrome.fill : (v.color ?? canvasColors.vehicleFill);
  const mirrors = vehicleMirrorsLocal(vehicleGeomSpec(v));
  const font = 12 / scale;
  // Local frame: +y is the front. Windshield ≈ 30% back from the front bumper.
  const wsY = l / 2 - l * 0.3;
  const rearY = -l / 2 + l * 0.14;
  return (
    <Group {...entityAttrs('vehicle', v.id)} x={v.x} y={v.y} rotation={v.rotation} opacity={v.hidden ? 0.4 : 1}>
      <Rect x={-w / 2} y={-l / 2} width={w} height={l} cornerRadius={Math.min(w, l) * 0.14} fill={fill} stroke={stroke} strokeWidth={selected ? 2 : 1.25} strokeScaleEnabled={false} opacity={0.92} />
      {mirrors.map((m, i) => (
        <Line key={i} points={m.flatMap((p) => [p.x, p.y])} closed fill={fill} stroke={stroke} strokeWidth={1} strokeScaleEnabled={false} />
      ))}
      {/* Windshield and rear window */}
      <Line points={[-w * 0.4, wsY, w * 0.4, wsY]} stroke={stroke} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      <Line points={[-w * 0.38, rearY, w * 0.38, rearY]} stroke={stroke} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      <Arrow points={[0, l / 2 - l * 0.12, 0, l / 2 - l * 0.03]} stroke={stroke} fill={stroke} strokeWidth={1.5} pointerLength={10 / scale} pointerWidth={8 / scale} strokeScaleEnabled={false} listening={false} />
      <Group y={-l * 0.28} rotation={-v.rotation - viewRot} listening={false}>
        <Text text={v.name} fontSize={font} fontStyle="600" width={220 / scale} offsetX={110 / scale} offsetY={font / 2} align="center" fill={mono ? monochrome.stroke : canvasColors.ink} />
      </Group>
      {v.locked && (selected || hovered) && <LockGlyph x={0} y={0} scale={scale} />}
    </Group>
  );
});

export function VehiclesLayer() {
  const visible = useLayerVisible('vehicle');
  const vehicles = useProjectStore((s) => (s.project ? getScenario(s.project).vehicles : undefined));
  const selection = useUiStore((s) => s.selection);
  const hovered = useUiStore((s) => (s.hovered?.kind === 'vehicle' ? s.hovered.id : null));
  if (!visible || !vehicles) return null;
  return (
    <Group>
      {vehicles.map((v) => {
        const selected = selection.some((r) => r.kind === 'vehicle' && r.id === v.id);
        return v.hidden && !selected ? null : <VehicleNode key={v.id} vehicle={v} selected={selected} hovered={hovered === v.id} />;
      })}
    </Group>
  );
}
