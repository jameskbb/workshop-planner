/**
 * Editor feedback drawn on top of the plan: Figma-style snapping guides, the marquee rectangle,
 * live distance labels while dragging (ui slot, not pickable) and the HUD next to the cursor (HTML).
 */
import { Group, Line, Rect, Circle } from 'react-konva';
import type { Guide } from '@/geometry';
import { useFormatters } from '@/hooks/useFormatters';
import { useEditorStore } from '@/stores/editorStore';
import { cn } from '@/utils/cn';
import { useScale, useViewRotation } from '@/features/plan/hooks';
import { DimensionLine } from '@/features/plan/layers/FixturesLayers';
import { useViewPrefs } from './prefs';

const GUIDE = '#e0457b';

function GuideShape({ g, scale }: { g: Guide; scale: number }) {
  if (g.kind === 'point') {
    const r = 6 / scale;
    return (
      <Group>
        <Line points={[g.from.x - r, g.from.y - r, g.from.x + r, g.from.y + r]} stroke={GUIDE} strokeWidth={1.25} strokeScaleEnabled={false} />
        <Line points={[g.from.x - r, g.from.y + r, g.from.x + r, g.from.y - r]} stroke={GUIDE} strokeWidth={1.25} strokeScaleEnabled={false} />
        <Circle x={g.from.x} y={g.from.y} radius={r * 0.9} stroke={GUIDE} strokeWidth={1} strokeScaleEnabled={false} />
      </Group>
    );
  }
  return (
    <Line
      points={[g.from.x, g.from.y, g.to.x, g.to.y]}
      stroke={GUIDE}
      strokeWidth={g.kind === 'segment' ? 2 : 1}
      dash={g.source === 'grid' ? [3, 3] : g.kind === 'segment' ? undefined : [5, 3]}
      strokeScaleEnabled={false}
      opacity={g.kind === 'segment' ? 0.7 : 1}
    />
  );
}

export function GuidesLayer() {
  const guides = useEditorStore((s) => s.guides);
  const marquee = useEditorStore((s) => s.marquee);
  const gaps = useEditorStore((s) => s.gaps);
  const liveDistances = useViewPrefs((s) => s.liveDistances);
  const scale = useScale();
  const viewRot = useViewRotation();
  const fmt = useFormatters();
  return (
    <Group listening={false}>
      {guides.map((g, i) => (
        <GuideShape key={i} g={g} scale={scale} />
      ))}
      {liveDistances &&
        gaps.map((g, i) => <DimensionLine key={`gap-${i}`} a={g.from} b={g.to} text={fmt.length(g.value)} color="#d9480f" scale={scale} viewRot={viewRot} strokeWidth={1} />)}
      {marquee && (
        <Rect
          x={marquee.box.minX}
          y={marquee.box.minY}
          width={marquee.box.maxX - marquee.box.minX}
          height={marquee.box.maxY - marquee.box.minY}
          fill={marquee.mode === 'contain' ? 'rgba(47,125,246,0.08)' : 'rgba(46,160,67,0.08)'}
          stroke={marquee.mode === 'contain' ? '#2f7df6' : '#2ea043'}
          strokeWidth={1}
          dash={marquee.mode === 'cross' ? [5, 4] : undefined}
          strokeScaleEnabled={false}
        />
      )}
    </Group>
  );
}

/** Text next to the cursor during gestures (position, size, angle, or why an edit is refused). */
export function HudOverlay() {
  const hud = useEditorStore((s) => s.hud);
  if (!hud) return null;
  return (
    <div
      className={cn(
        'num pointer-events-none absolute z-30 max-w-80 rounded border px-1.5 py-0.5 text-[11px] leading-snug shadow-md',
        hud.tone === 'error' ? 'border-danger/60 bg-panel-3 text-danger' : 'border-line-strong bg-panel-3/95 text-ink',
      )}
      style={{ left: hud.at.x, top: hud.at.y }}
      role={hud.tone === 'error' ? 'alert' : undefined}
      data-testid="canvas-hud"
    >
      {hud.lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}
