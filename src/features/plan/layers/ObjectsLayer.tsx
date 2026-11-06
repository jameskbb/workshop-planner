/**
 * Placed objects: one memoized node per object id, subscribed to that object (and its live drag
 * preview) only, so editing or dragging one object re-renders one node (hundreds of objects stay
 * responsive).
 */
import { memo, useMemo } from 'react';
import { Arrow, Group, Line, Rect, Text } from 'react-konva';
import { entityAttrs } from '@/app/canvas/PlanCanvas';
import { electricalPosition, findObject, getScenario, resolveObject, type ResolvedObject } from '@/domain/resolve';
import type { PlacedObject } from '@/domain/schema';
import type { Pose } from '@/geometry';
import { useProjectStore } from '@/stores/projectStore';
import { usePreview, withPreview } from '@/stores/editorStore';
import { useUiStore } from '@/stores/uiStore';
import { canvasColors, monochrome } from '@/styles/tokens';
import { useObjectIds, useSelectedIds } from '@/hooks/useProject';
import { layoutLabels, textWidth, type LabelCandidate, type LabelPlacement, type Rect as LabelRect } from '../labelLayout';
import { useCategoryPalette, useMonochrome, useScale, useViewRotation } from '../hooks';

function useResolved(id: string): ResolvedObject | null {
  // resolveObject is memoized per (definitions, object), so this selector is stable unless THIS object changes.
  const base = useProjectStore((s) => {
    if (!s.project) return null;
    const o = findObject(getScenario(s.project), id);
    return o ? resolveObject(s.project, o) : null;
  });
  const patch = usePreview<PlacedObject>('object', id);
  return useMemo(() => {
    const project = useProjectStore.getState().project;
    return base && patch && project ? resolveObject(project, withPreview(base.object, patch)) : base;
  }, [base, patch]);
}

/** A tiny padlock drawn in screen px (non-color "locked" indicator). */
export function LockGlyph({ x, y, scale, color = canvasColors.inkMuted }: { x: number; y: number; scale: number; color?: string }) {
  const u = 1 / scale;
  return (
    <Group x={x} y={y} listening={false}>
      <Rect x={-4 * u} y={-1 * u} width={8 * u} height={6 * u} fill={color} cornerRadius={1 * u} />
      <Line points={[-2.5 * u, -1 * u, -2.5 * u, -3.5 * u, 0, -5.5 * u, 2.5 * u, -3.5 * u, 2.5 * u, -1 * u]} stroke={color} strokeWidth={1.4} strokeScaleEnabled={false} tension={0.4} />
    </Group>
  );
}

function Footprint({ r, pose, ghost, selected, hovered, fill, stroke }: { r: ResolvedObject; pose: Pose; ghost?: boolean; selected: boolean; hovered: boolean; fill: string; stroke: string }) {
  const strokeC = selected ? canvasColors.select : hovered ? canvasColors.hover : stroke;
  const { width: w, depth: d, offsetX = 0, offsetY = 0 } = r.footprint;
  const round = r.definition?.shape === 'round';
  const dash = ghost ? [5, 4] : r.elevated ? [7, 4] : undefined;
  return (
    <Group x={pose.x} y={pose.y} rotation={pose.rotation}>
      <Rect
        x={offsetX - w / 2}
        y={offsetY - d / 2}
        width={w}
        height={d}
        cornerRadius={round ? Math.min(w, d) / 2 : 0}
        fill={ghost ? undefined : fill}
        opacity={ghost ? 0.9 : r.elevated ? 0.75 : 1}
        stroke={ghost ? canvasColors.ghostStroke : strokeC}
        strokeWidth={selected ? 2 : 1}
        dash={dash}
        strokeScaleEnabled={false}
        perfectDrawEnabled={false}
        shadowForStrokeEnabled={false}
      />
      {!ghost && !round && (
        // Front edge marker (local +y is the front / operator side).
        <Line
          points={[offsetX - w * 0.18, offsetY + d / 2, offsetX, offsetY + d / 2 - Math.min(d * 0.12, 120), offsetX + w * 0.18, offsetY + d / 2]}
          stroke={strokeC}
          strokeWidth={1}
          strokeScaleEnabled={false}
          listening={false}
          opacity={0.7}
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  );
}

/**
 * Where every object label goes, decided in one pass so they do not sit on top of each other (or on
 * an outlet glyph). Screen px; each node then draws its label at `dx/dy` inside a view-aligned
 * group. Recomputed only when the plan, the zoom or the orientation changes.
 */
function useLabelPlacements(ids: readonly string[]): Map<string, LabelPlacement & { width: number }> {
  const project = useProjectStore((s) => s.project);
  const scale = useScale();
  const viewRot = useViewRotation();
  const selection = useSelectedIds('object');
  const showLabels = useProjectStore((s) => s.project?.settings.showLabels ?? true);
  return useMemo(() => {
    const out = new Map<string, LabelPlacement & { width: number }>();
    if (!project || !showLabels) return out;
    const font = 11;
    const rot = (viewRot * Math.PI) / 180;
    const toScreen = (p: { x: number; y: number }) => ({ x: (p.x * Math.cos(rot) - p.y * Math.sin(rot)) * scale, y: (p.x * Math.sin(rot) + p.y * Math.cos(rot)) * scale });
    const scenario = getScenario(project);
    const candidates: LabelCandidate[] = [];
    const sizes = new Map<string, number>();
    for (const id of ids) {
      const o = findObject(scenario, id);
      if (!o || o.hidden) continue;
      const layer = project.layers[resolveObject(project, o).layer];
      if (layer && !layer.visible) continue;
      const r = resolveObject(project, o);
      const c = toScreen(r.pose);
      const th = ((r.pose.rotation + viewRot) * Math.PI) / 180;
      const fw = r.footprint.width * scale;
      const fd = r.footprint.depth * scale;
      const halfW = (Math.abs(fw * Math.cos(th)) + Math.abs(fd * Math.sin(th))) / 2;
      const halfH = (Math.abs(fw * Math.sin(th)) + Math.abs(fd * Math.cos(th))) / 2;
      const w = Math.min(textWidth(r.label, font) + 4, 200);
      const h = font + 2;
      const gapY = halfH + h / 2 + 3;
      const gapX = halfW + w / 2 + 4;
      const offsets = [{ dx: 0, dy: 0 }, { dx: 0, dy: -gapY }, { dx: 0, dy: gapY }, { dx: -gapX, dy: 0 }, { dx: gapX, dy: 0 }];
      // Tiny footprints have no room for the label inside them: start outside.
      if (halfW * 2 < w || halfH * 2 < h) offsets.shift();
      candidates.push({ id, x: c.x, y: c.y, w, h, offsets, priority: (selection.includes(id) ? 1e9 : 0) + halfW * halfH });
      sizes.set(id, w);
    }
    // Outlet / panel glyphs are drawn under the labels: keep text off them.
    const obstacles: LabelRect[] = [];
    for (const e of project.electrical) {
      if (e.hidden) continue;
      const p = toScreen(electricalPosition(project.room, e));
      obstacles.push({ x: p.x, y: p.y, w: 26, h: 26 });
    }
    for (const [id, p] of layoutLabels(candidates, obstacles)) out.set(id, { ...p, width: sizes.get(id) ?? 90 });
    return out;
  }, [project, ids, scale, viewRot, selection, showLabels]);
}

const ObjectNode = memo(function ObjectNode({ id, labelDx, labelDy, labelW, labelHidden }: { id: string; labelDx: number; labelDy: number; labelW: number; labelHidden: boolean }) {
  const r = useResolved(id);
  const selected = useUiStore((s) => s.selection.some((x) => x.kind === 'object' && x.id === id));
  const hovered = useUiStore((s) => s.hovered?.kind === 'object' && s.hovered.id === id);
  const layerVisible = useProjectStore((s) => (r ? (s.project?.layers[r.layer]?.visible ?? true) : true));
  const showLabels = useProjectStore((s) => s.project?.settings.showLabels ?? true);
  const scale = useScale();
  const viewRot = useViewRotation();
  const mono = useMonochrome();
  const palette = useCategoryPalette();
  if (!r || (r.object.hidden && !selected) || !layerVisible) return null;
  const base = palette(r.category);
  const fill = mono ? monochrome.fill : (r.object.color ?? r.definition?.color ?? base.fill);
  const stroke = base.stroke;
  const font = 11 / scale;
  const labelWidth = labelW / scale;
  const other: Pose | undefined = r.mobile && r.workingPose ? (r.object.activePosition === 'working' ? r.parkedPose : r.workingPose) : undefined;
  const showLabel = showLabels && !labelHidden && Math.min(r.footprint.width, r.footprint.depth) * scale > 14;
  return (
    <Group {...entityAttrs('object', r.object.id)} opacity={r.object.hidden ? 0.4 : 1}>
      {other && (
        <Group listening={false}>
          <Footprint r={r} pose={other} ghost selected={false} hovered={false} fill={fill} stroke={stroke} />
          <Arrow
            points={[r.pose.x, r.pose.y, other.x, other.y]}
            stroke={canvasColors.ghostStroke}
            fill={canvasColors.ghostStroke}
            strokeWidth={1}
            dash={[4, 4]}
            pointerLength={8 / scale}
            pointerWidth={6 / scale}
            strokeScaleEnabled={false}
          />
          <Text
            x={other.x}
            y={other.y}
            rotation={-viewRot}
            text={r.object.activePosition === 'working' ? 'Parked' : 'Working'}
            fontSize={font * 0.9}
            width={80 / scale}
            offsetX={40 / scale}
            offsetY={font / 2}
            align="center"
            fill={canvasColors.inkMuted}
            fontStyle="italic"
          />
        </Group>
      )}
      <Footprint r={r} pose={r.pose} selected={selected} hovered={hovered} fill={fill} stroke={stroke} />
      {showLabel && (
        // Inside a view-aligned group so the collision solver's screen-space offset applies as-is.
        <Group x={r.pose.x} y={r.pose.y} rotation={-viewRot} listening={false}>
          <Text
            x={labelDx / scale}
            y={labelDy / scale}
            width={labelWidth}
            offsetX={labelWidth / 2}
            offsetY={font / 2}
            text={r.label}
            fontSize={font}
            fontStyle="500"
            align="center"
            wrap="none"
            ellipsis
            fill={mono ? monochrome.stroke : canvasColors.ink}
            listening={false}
            perfectDrawEnabled={false}
          />
        </Group>
      )}
      {r.object.locked && (selected || hovered) && <LockGlyph x={r.pose.x} y={r.pose.y - font * 1.3} scale={scale} />}
    </Group>
  );
});

export function ObjectsLayer() {
  const ids = useObjectIds();
  const labels = useLabelPlacements(ids);
  return (
    <Group>
      {ids.map((id) => {
        const l = labels.get(id);
        return <ObjectNode key={id} id={id} labelDx={l?.dx ?? 0} labelDy={l?.dy ?? 0} labelW={l?.width ?? 90} labelHidden={l?.hidden ?? false} />;
      })}
    </Group>
  );
}
