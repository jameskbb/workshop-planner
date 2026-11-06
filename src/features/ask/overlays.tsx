/**
 * Shared canvas feedback for the layout-intelligence features (Ask the Layout answers, command
 * previews, Will It Fit? suggestions, assistant candidates):
 *  - `useIntelHighlight`: an answer's highlight (regions, route lines, points), dashed accent.
 *  - `usePreviewGhosts`: proposed footprints ("this is where it would go"), dashed blue ghosts
 *    with optional movement arrows. Nothing here ever changes the project.
 */
import { Arrow, Circle, Group, Line, Text } from 'react-konva';
import { create } from 'zustand';
import type { Point, Polygon } from '@/geometry';
import { useScale, useViewRotation } from '@/features/plan/hooks';

export interface IntelHighlight {
  source: string;
  polygons: Polygon[];
  points: Point[];
  lines: Array<[Point, Point]>;
  label?: string;
}

export const useIntelHighlight = create<{ current: IntelHighlight | null }>()(() => ({ current: null }));

export function showHighlight(h: IntelHighlight | null): void {
  useIntelHighlight.setState({ current: h });
}

export interface Ghost {
  polygon: Polygon;
  label?: string;
  /** Secondary outline (e.g. required clearance in front). */
  secondary?: boolean;
}

export interface PreviewGhosts {
  source: string;
  ghosts: Ghost[];
  arrows: Array<[Point, Point]>;
}

export const usePreviewGhosts = create<{ current: PreviewGhosts | null }>()(() => ({ current: null }));

export function showGhosts(p: PreviewGhosts | null): void {
  usePreviewGhosts.setState({ current: p });
}

/** Clear ghosts only if they belong to `source` (so one panel does not wipe another's preview). */
export function clearGhosts(source: string): void {
  if (usePreviewGhosts.getState().current?.source === source) usePreviewGhosts.setState({ current: null });
}

export function clearHighlight(source: string): void {
  if (useIntelHighlight.getState().current?.source === source) useIntelHighlight.setState({ current: null });
}

const ACCENT = '#d9480f';
const GHOST = '#2f7df6';

export function IntelHighlightLayer() {
  const h = useIntelHighlight((s) => s.current);
  const scale = useScale();
  const viewRot = useViewRotation();
  if (!h) return null;
  const r = 7 / scale;
  return (
    <Group listening={false}>
      {h.polygons.map((p, i) => (
        <Line key={`p${i}`} points={p.flatMap((q) => [q.x, q.y])} closed fill="rgba(217,72,15,0.12)" stroke={ACCENT} strokeWidth={1.5} dash={[6, 4]} strokeScaleEnabled={false} />
      ))}
      {h.lines.map(([a, b], i) => (
        <Line key={`l${i}`} points={[a.x, a.y, b.x, b.y]} stroke={ACCENT} strokeWidth={2} strokeScaleEnabled={false} opacity={0.8} />
      ))}
      {h.points.map((p, i) => (
        <Group key={`c${i}`}>
          <Circle x={p.x} y={p.y} radius={r} stroke={ACCENT} strokeWidth={2} strokeScaleEnabled={false} />
          <Line points={[p.x - r * 1.6, p.y, p.x + r * 1.6, p.y]} stroke={ACCENT} strokeWidth={1} strokeScaleEnabled={false} />
          <Line points={[p.x, p.y - r * 1.6, p.x, p.y + r * 1.6]} stroke={ACCENT} strokeWidth={1} strokeScaleEnabled={false} />
        </Group>
      ))}
      {h.label && h.points[0] && (
        <Group x={h.points[0].x} y={h.points[0].y} rotation={-viewRot}>
          <Text text={h.label} x={r * 2} y={-r * 2.4} fontSize={12 / scale} fontStyle="bold" fill={ACCENT} />
        </Group>
      )}
    </Group>
  );
}

export function PreviewGhostsLayer() {
  const g = usePreviewGhosts((s) => s.current);
  const scale = useScale();
  const viewRot = useViewRotation();
  if (!g) return null;
  return (
    <Group listening={false}>
      {g.ghosts.map((gh, i) => (
        <Line
          key={i}
          points={gh.polygon.flatMap((q) => [q.x, q.y])}
          closed
          fill={gh.secondary ? 'rgba(47,125,246,0.05)' : 'rgba(47,125,246,0.16)'}
          stroke={GHOST}
          strokeWidth={gh.secondary ? 1 : 2}
          dash={gh.secondary ? [3, 4] : [8, 4]}
          strokeScaleEnabled={false}
        />
      ))}
      {g.ghosts.map((gh, i) => {
        if (!gh.label) return null;
        const cx = gh.polygon.reduce((s, p) => s + p.x, 0) / gh.polygon.length;
        const cy = gh.polygon.reduce((s, p) => s + p.y, 0) / gh.polygon.length;
        const w = 220 / scale;
        return (
          <Group key={`t${i}`} x={cx} y={cy} rotation={-viewRot}>
            <Text text={gh.label} width={w} offsetX={w / 2} offsetY={6 / scale} align="center" fontSize={11 / scale} fill={GHOST} fontStyle="bold" />
          </Group>
        );
      })}
      {g.arrows.map(([a, b], i) => (
        <Arrow key={`a${i}`} points={[a.x, a.y, b.x, b.y]} stroke={GHOST} fill={GHOST} strokeWidth={1.5} pointerLength={9 / scale} pointerWidth={7 / scale} strokeScaleEnabled={false} dash={[4, 3]} />
      ))}
    </Group>
  );
}
