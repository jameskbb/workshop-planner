/**
 * Before/after overlay on the plan: Current positions dashed, Target positions solid, movement
 * arrows between them, unchanged items dimmed; plus the highlight for the selected move step.
 */
import { Arrow, Group, Line, Rect, Text } from 'react-konva';
import { bbox, centroid, type Point, type Polygon } from '@/geometry';
import { useProjectStore } from '@/stores/projectStore';
import { isOverlayOn, useUiStore } from '@/stores/uiStore';
import { canvasColors } from '@/styles/tokens';
import { useScale, useViewRotation } from '@/features/plan/hooks';
import { OVERLAY_KEY, useReorgModel, useReorgUi } from './state';

const flat = (pts: Point[]) => pts.flatMap((p) => [p.x, p.y]);

export const BA_COLORS = {
  current: '#8a6d3b',
  target: '#2f7df6',
  arrow: '#e0761f',
  removed: '#c2410c',
  added: '#15803d',
  unchanged: '#9aa0a6',
  highlight: '#e5484d',
} as const;

export function BeforeAfterLayer() {
  const model = useReorgModel();
  const room = useProjectStore((s) => s.project?.room.vertices);
  const scale = useScale();
  const viewRot = useViewRotation();
  if (!model || !room || room.length < 3) return null;
  const font = 11 / scale;
  const b = bbox(room);
  const pad = 2000;
  return (
    <Group listening={false}>
      {/* Veil: dims everything drawn underneath (unchanged items stay faintly visible). */}
      <Rect x={b.minX - pad} y={b.minY - pad} width={b.maxX - b.minX + 2 * pad} height={b.maxY - b.minY + 2 * pad} fill="#f3f2ee" opacity={0.72} />
      {model.diff.map((d) => {
        if (d.change === 'unchanged') {
          const poly = d.to!.polygon;
          return <Line key={d.id} points={flat(poly)} closed stroke={BA_COLORS.unchanged} strokeWidth={1} strokeScaleEnabled={false} fill="rgba(154,160,166,0.12)" />;
        }
        const from = d.from?.polygon;
        const to = d.to?.polygon;
        const a = from ? centroid(from) : null;
        const c = to ? centroid(to) : null;
        const color = d.change === 'removed' ? BA_COLORS.removed : d.change === 'added' ? BA_COLORS.added : BA_COLORS.target;
        return (
          <Group key={d.id}>
            {from && <Line points={flat(from)} closed stroke={d.change === 'removed' ? BA_COLORS.removed : BA_COLORS.current} strokeWidth={1.6} dash={[7, 5]} strokeScaleEnabled={false} />}
            {d.change === 'removed' && a && <Text x={a.x} y={a.y} rotation={-viewRot} text="✕ out" fontSize={font} width={80 / scale} offsetX={40 / scale} offsetY={font / 2} align="center" fill={BA_COLORS.removed} fontStyle="600" />}
            {to && <Line points={flat(to)} closed stroke={color} strokeWidth={2} fill={d.change === 'added' ? 'rgba(21,128,61,0.12)' : 'rgba(47,125,246,0.12)'} strokeScaleEnabled={false} />}
            {a && c && d.change === 'moved' && (
              <Arrow
                points={[a.x, a.y, c.x, c.y]}
                stroke={BA_COLORS.arrow}
                fill={BA_COLORS.arrow}
                strokeWidth={2}
                pointerLength={12 / scale}
                pointerWidth={10 / scale}
                strokeScaleEnabled={false}
              />
            )}
            {c && (
              <Text x={c.x} y={c.y} rotation={-viewRot} text={d.name} fontSize={font} width={160 / scale} offsetX={80 / scale} offsetY={-font * 0.6} align="center" fill={canvasColors.ink} fontStyle="600" />
            )}
          </Group>
        );
      })}
    </Group>
  );
}

/** Highlighted move step (drawn whenever a step is selected in the panel). */
export function StepHighlightLayer() {
  const model = useReorgModel();
  const key = useReorgUi((s) => s.highlight);
  const scale = useScale();
  const step = key ? model?.plan.steps.find((s) => s.key === key) : undefined;
  if (!step) return null;
  const outline = (p: Polygon | undefined, dash?: number[]) =>
    p && <Line points={flat(p)} closed stroke={BA_COLORS.highlight} strokeWidth={3} dash={dash} fill={dash ? undefined : 'rgba(229,72,77,0.15)'} strokeScaleEnabled={false} />;
  const a = step.fromPolygon ? centroid(step.fromPolygon) : null;
  const c = step.toPolygon ? centroid(step.toPolygon) : null;
  return (
    <Group listening={false}>
      {outline(step.fromPolygon, [8, 5])}
      {outline(step.toPolygon)}
      {a && c && <Arrow points={[a.x, a.y, c.x, c.y]} stroke={BA_COLORS.highlight} fill={BA_COLORS.highlight} strokeWidth={2.5} pointerLength={14 / scale} pointerWidth={11 / scale} strokeScaleEnabled={false} />}
    </Group>
  );
}

/** HTML legend while the before/after overlay is on. */
export function BeforeAfterLegend() {
  const on = useUiStore((s) => isOverlayOn(s, OVERLAY_KEY));
  const model = useReorgModel();
  const scenarios = useProjectStore((s) => s.project?.scenarios);
  if (!on || !model || !scenarios) return null;
  const n = (id: string) => scenarios.find((x) => x.id === id)?.name ?? '';
  const names = { current: n(model.d.currentId), target: n(model.d.targetId) };
  const moved = model.diff.filter((d) => d.change === 'moved').length;
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-md border border-line-strong bg-panel/95 px-3 py-2 text-2xs text-ink shadow-lg" data-testid="before-after-legend">
      <div className="mb-1 font-semibold">
        Before / after · {names.current} → {names.target} · {moved} moved
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Key swatch={<span className="block h-2.5 w-5 border-[1.5px] border-dashed" style={{ borderColor: BA_COLORS.current }} />} label="Current position" />
        <Key swatch={<span className="block h-2.5 w-5 border-2" style={{ borderColor: BA_COLORS.target, background: 'rgba(47,125,246,.15)' }} />} label="Target position" />
        <Key swatch={<span className="block h-0.5 w-5" style={{ background: BA_COLORS.arrow }} />} label="Move" />
        <Key swatch={<span className="block h-2.5 w-5 border border-dashed" style={{ borderColor: BA_COLORS.removed }} />} label="Leaves the garage" />
        <Key swatch={<span className="block h-2.5 w-5 border-2" style={{ borderColor: BA_COLORS.added }} />} label="New" />
        <Key swatch={<span className="block h-2.5 w-5 border" style={{ borderColor: BA_COLORS.unchanged, background: 'rgba(154,160,166,.2)' }} />} label="Unchanged (dimmed)" />
      </div>
    </div>
  );
}

function Key({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {swatch}
      {label}
    </span>
  );
}
