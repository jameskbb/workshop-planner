import { memo } from 'react';
import { Circle, Group, Line, Rect, Text } from 'react-konva';
import { entityAttrs } from '@/app/canvas/PlanCanvas';
import { uprightAngle as uprightAngleView } from '@/app/canvas/viewport';
import { roomGeometry } from '@/domain/resolve';
import { wallQuads, angleOf, add, scale as vscale, lerp, interiorAngles, type Point } from '@/geometry';
import { useFormatters } from '@/hooks/useFormatters';
import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { useUiStore } from '@/stores/uiStore';
import { canvasColors, monochrome } from '@/styles/tokens';
import { useLiveRoom, useMonochrome, useScale, useViewRotation } from '../hooks';

const flat = (pts: Point[]) => pts.flatMap((p) => [p.x, p.y]);

/** Readable text rotation for a world direction (keeps labels upright; view rotation aware via `viewRot`). */
export function uprightAngle(deg: number, viewRot = 0): number {
  return uprightAngleView(deg, viewRot);
}

/** Room floor, wall thickness and interior wall dimensions. */
export const RoomLayer = memo(function RoomLayer() {
  const room = useLiveRoom();
  const showDims = useProjectStore((s) => s.project?.settings.showDimensions ?? true);
  const selectedWalls = useUiStore((s) => s.selection.filter((r) => r.kind === 'wall').map((r) => r.id).join(','));
  const hoveredWall = useUiStore((s) => (s.hovered?.kind === 'wall' ? s.hovered.id : null));
  const dragging = useEditorStore((s) => s.roomPreview !== null);
  const scale = useScale();
  const viewRot = useViewRotation();
  const mono = useMonochrome();
  const fmt = useFormatters();
  if (!room || room.vertices.length < 3) return null;
  const g = roomGeometry(room);
  if (g.walls.length === 0) return null;
  const quads = wallQuads(g.polygon, g.thickness);
  const font = 11 / scale;
  const labelW = 160 / scale;
  return (
    <Group>
      <Line points={flat(g.polygon)} closed fill={mono ? '#ffffff' : 'rgba(255,255,255,0.55)'} listening={false} />
      {quads.map((q, i) => {
        const wall = room.walls[i]!;
        const selected = selectedWalls.includes(wall.id);
        const hovered = hoveredWall === wall.id;
        return (
          <Line
            key={wall.id}
            {...entityAttrs('wall', wall.id)}
            points={flat(q)}
            closed
            fill={selected ? '#4b6b9a' : hovered ? '#565d66' : mono ? monochrome.stroke : (wall.color ?? canvasColors.wallFill)}
            stroke={selected ? canvasColors.select : canvasColors.wallStroke}
            strokeWidth={selected ? 2 : 1}
            strokeScaleEnabled={false}
            perfectDrawEnabled={false}
            hitStrokeWidth={8}
          />
        );
      })}
      <Line points={flat(g.polygon)} closed stroke={dragging ? canvasColors.select : canvasColors.roomEdge} strokeWidth={1.25} strokeScaleEnabled={false} listening={false} />
      {(showDims || dragging) &&
        g.walls.map((w) => {
          const mid = lerp(w.a, w.b, 0.5);
          const pos = add(mid, vscale(w.inward, 13 / scale));
          const rot = uprightAngle(angleOf(w.dir), viewRot);
          if (w.length * scale < 40) return null;
          return (
            <Text
              key={`dim-${w.index}`}
              x={pos.x}
              y={pos.y}
              width={labelW}
              offsetX={labelW / 2}
              offsetY={font / 2}
              rotation={rot}
              align="center"
              text={fmt.length(w.length)}
              fontSize={font}
              fontFamily="JetBrains Mono Variable, monospace"
              fill={dragging ? canvasColors.select : mono ? monochrome.stroke : canvasColors.dimension}
              listening={false}
              perfectDrawEnabled={false}
            />
          );
        })}
    </Group>
  );
});

/**
 * Corner grips (overlay slot so they sit above walls): always pickable as `vertex` entities; the
 * selected / dragged corner shows its interior angle.
 */
export function CornerHandlesLayer() {
  const room = useLiveRoom();
  const selected = useUiStore((s) => s.selection.filter((r) => r.kind === 'vertex').map((r) => r.id).join(','));
  const hovered = useUiStore((s) => (s.hovered?.kind === 'vertex' ? s.hovered.id : null));
  const tool = useUiStore((s) => s.tool);
  const archLocked = useProjectStore((s) => s.project?.layers.architecture?.locked ?? false);
  const scale = useScale();
  const viewRot = useViewRotation();
  const fmt = useFormatters();
  if (!room || room.vertices.length < 3 || tool !== 'select' || archLocked) return null;
  const size = 8 / scale;
  const angles = interiorAngles(room.vertices);
  const font = 10 / scale;
  return (
    <Group>
      {room.vertices.map((v, i) => {
        const isSel = selected.includes(v.id);
        const isHover = hovered === v.id;
        return (
          <Group key={v.id} {...entityAttrs('vertex', v.id)} x={v.x} y={v.y}>
            <Circle radius={10 / scale} fill="rgba(0,0,0,0)" />
            <Rect
              x={-size / 2}
              y={-size / 2}
              width={size}
              height={size}
              rotation={-viewRot}
              fill={isSel ? canvasColors.select : '#ffffff'}
              stroke={isSel || isHover ? canvasColors.select : canvasColors.wallStroke}
              strokeWidth={1.25}
              strokeScaleEnabled={false}
              opacity={isSel || isHover ? 1 : 0.85}
            />
            {isSel && (
              <Text
                text={fmt.angle(angles[i] ?? 0)}
                rotation={-viewRot}
                x={0}
                y={0}
                offsetX={-8 / scale}
                offsetY={font * 1.8}
                fontSize={font}
                fontFamily="JetBrains Mono Variable, monospace"
                fill={canvasColors.select}
                listening={false}
              />
            )}
          </Group>
        );
      })}
    </Group>
  );
}
