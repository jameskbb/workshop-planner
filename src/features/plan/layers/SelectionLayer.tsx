/**
 * Selection outlines, multi-selection bounds and the transform handles (resize ×8, rotate) for the
 * Select tool. Handles are pickable via `handleAttrs` and hidden while a gesture is live.
 */
import { Circle, Group, Line, Rect } from 'react-konva';
import { entityAdapters } from '@/app/registry';
import { handleAttrs } from '@/app/canvas/PlanCanvas';
import { findObject, getScenario, resolveObject } from '@/domain/resolve';
import { add, bbox, bboxUnion, expandBBox, localToWorld, rotate, scale as vscale, type BBox, type Point } from '@/geometry';
import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { useUiStore } from '@/stores/uiStore';
import { canvasColors } from '@/styles/tokens';
import { useScale, useViewRotation } from '../hooks';

const flat = (pts: Point[]) => pts.flatMap((p) => [p.x, p.y]);

function Handle({ at, name, size, viewRot }: { at: Point; name: string; size: number; viewRot: number }) {
  return (
    <Rect
      {...handleAttrs(name)}
      x={at.x}
      y={at.y}
      width={size}
      height={size}
      offsetX={size / 2}
      offsetY={size / 2}
      rotation={-viewRot}
      fill="#ffffff"
      stroke={canvasColors.select}
      strokeWidth={1.25}
      strokeScaleEnabled={false}
      hitStrokeWidth={6}
    />
  );
}

function RotateKnob({ from, at, scale }: { from: Point; at: Point; scale: number }) {
  return (
    <>
      <Line points={flat([from, at])} stroke={canvasColors.select} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      <Circle {...handleAttrs('rotate')} x={at.x} y={at.y} radius={5.5 / scale} fill="#ffffff" stroke={canvasColors.select} strokeWidth={1.5} strokeScaleEnabled={false} hitStrokeWidth={8} />
    </>
  );
}

export function SelectionLayer() {
  const project = useProjectStore((s) => s.project);
  const selection = useUiStore((s) => s.selection);
  const tool = useUiStore((s) => s.tool);
  const busy = useEditorStore((s) => Object.keys(s.previews).length > 0 || s.roomPreview !== null || s.marquee !== null);
  const scale = useScale();
  const viewRot = useViewRotation();
  if (!project || selection.length === 0 || busy) return null;
  const scenario = getScenario(project);
  const c = { project, scenario };
  const outlines: Point[][] = [];
  const boxes: BBox[] = [];
  let rotatable = 0;
  for (const r of selection) {
    if (r.kind === 'wall' || r.kind === 'vertex') continue;
    const a = entityAdapters.get(r.kind);
    const o = a?.outline(c, r.id);
    if (!a || !o || o.length === 0) continue;
    if (r.kind !== 'measurement') outlines.push(o);
    boxes.push(bbox(o));
    if (a.rotate && !a.locked?.(c, r.id) && a.rotate(c, r.id, { x: 0, y: 0 }, 0)) rotatable++;
  }
  if (boxes.length === 0) return null;
  const px = 1 / scale;
  const hs = 8 * px;
  // "Up" on screen in world coordinates (the rotate knob sits above the selection).
  const up = rotate({ x: 0, y: -1 }, -viewRot);
  const showHandles = tool === 'select';

  let handles: React.ReactNode = null;
  const single = selection.length === 1 ? selection[0]! : null;
  const obj = single?.kind === 'object' ? findObject(scenario, single.id) : undefined;
  if (showHandles && obj && !obj.locked) {
    const r = resolveObject(project, obj);
    const { width: w, depth: d, offsetX = 0, offsetY = 0 } = r.footprint;
    const L = (x: number, y: number) => localToWorld(r.pose, { x: offsetX + x, y: offsetY + y });
    const resizable = !r.state?.footprint;
    const spots: Array<[number, number]> = [
      [-1, -1],
      [0, -1],
      [1, -1],
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
    ];
    const backMid = L(0, -d / 2);
    const knob = L(0, -d / 2 - 26 * px);
    handles = (
      <>
        {resizable &&
          spots
            // Hide edge handles when the object is too small on screen to grab them separately.
            .filter(([hx, hy]) => (hx !== 0 && hy !== 0) || Math.min(w, d) * scale > 36)
            .map(([hx, hy]) => <Handle key={`${hx}:${hy}`} name={`resize:${hx}:${hy}`} at={L((hx * w) / 2, (hy * d) / 2)} size={hs} viewRot={viewRot} />)}
        <RotateKnob from={backMid} at={knob} scale={scale} />
      </>
    );
  } else if (showHandles && rotatable > 0 && (selection.length > 1 || single?.kind !== 'object')) {
    const b = bboxUnion(...boxes);
    const center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    const halfExtent = Math.abs(up.x) > 0.5 ? (b.maxX - b.minX) / 2 : (b.maxY - b.minY) / 2;
    const edge = add(center, vscale(up, halfExtent + 4 * px));
    handles = <RotateKnob from={edge} at={add(edge, vscale(up, 22 * px))} scale={scale} />;
  }

  const box = expandBBox(bboxUnion(...boxes), 4 * px);
  return (
    <Group>
      <Group listening={false}>
        {outlines.map((pts, i) => (
          <Line key={i} points={flat(pts)} closed stroke={canvasColors.select} strokeWidth={selection.length > 1 ? 1.5 : 2} strokeScaleEnabled={false} fill={canvasColors.selectFill} />
        ))}
        {boxes.length > 1 && (
          <Line
            points={flat([
              { x: box.minX, y: box.minY },
              { x: box.maxX, y: box.minY },
              { x: box.maxX, y: box.maxY },
              { x: box.minX, y: box.maxY },
            ])}
            closed
            stroke={canvasColors.select}
            strokeWidth={1}
            dash={[4, 3]}
            strokeScaleEnabled={false}
          />
        )}
      </Group>
      {handles}
    </Group>
  );
}
