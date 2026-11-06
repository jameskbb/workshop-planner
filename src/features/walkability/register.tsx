/**
 * Walkability mode: choose a minimum aisle width (24/30/36/42"), see a clearance heatmap with
 * open / narrow / unreachable floor (patterns + legend, not color alone), pinch points labeled with
 * their width, dead ends, and plain-language path warnings ("Main path from garage entry to
 * workbench narrows to 19" beside the cabinet").
 */
import { Footprints } from 'lucide-react';
import { useMemo } from 'react';
import { Circle, Group, Image as KImage, Line, Text } from 'react-konva';
import { buildAnalysisContext, type Warning } from '@/analysis';
import { canvasLayers, paletteCommands, sidebarSections } from '@/app/registry';
import { Section } from '@/components/shell';
import { Switch } from '@/components/ui';
import type { Project } from '@/domain/schema';
import { WALK_NARROW, WALK_OPEN, WALK_UNREACHABLE, WALK_BLOCKED, type WalkabilityResult } from '@/geometry';
import { useFormatters } from '@/hooks/useFormatters';
import { dispatch, useProjectStore } from '@/stores/projectStore';
import { isOverlayOn, uiActions, useUiStore } from '@/stores/uiStore';
import { cn } from '@/utils/cn';
import { useScale, useViewRotation } from '@/features/plan/hooks';
import { showHighlight } from '@/features/ask/overlays';
import { useWarnings } from '@/features/warnings/analysisClient';
import { AISLE_WIDTHS, pathReports, walkability, walkPrefs } from './model';

const OVERLAY = 'walkability';
const PX = 4;

/**
 * The walkability grid for the open project. `enabled` is false while nothing shows it, so a
 * committed edit never pays for the grid just because the layer is mounted (R-002).
 */
function useWalk(enabled: boolean): { project: Project | null; walk: WalkabilityResult | null; aisle: number } {
  const project = useProjectStore((s) => s.project);
  return useMemo(() => {
    if (!project) return { project, walk: null, aisle: 0 };
    const aisle = walkPrefs.read(project).aisleWidth;
    if (!enabled) return { project, walk: null, aisle };
    return { project, walk: walkability(buildAnalysisContext(project), aisle), aisle };
  }, [project, enabled]);
}

/** Heatmap image: clearance ramp + class patterns (hatch = narrow, dots = unreachable, cross = blocked). */
function heatmapCanvas(walk: WalkabilityResult): HTMLCanvasElement {
  const { grid, clearance, classes, aisleWidth } = walk;
  const c = document.createElement('canvas');
  c.width = grid.cols * PX;
  c.height = grid.rows * PX;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(c.width, c.height);
  const set = (x: number, y: number, r: number, g: number, b: number, a: number) => {
    const i = (y * c.width + x) * 4;
    img.data[i] = r;
    img.data[i + 1] = g;
    img.data[i + 2] = b;
    img.data[i + 3] = a;
  };
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const k = row * grid.cols + col;
      const cls = classes[k];
      for (let dy = 0; dy < PX; dy++) {
        for (let dx = 0; dx < PX; dx++) {
          const x = col * PX + dx;
          const y = row * PX + dy;
          if (cls === WALK_OPEN) {
            // Wider = deeper teal.
            const t = Math.min(1, clearance[k]! / aisleWidth);
            set(x, y, Math.round(40 + 60 * (1 - t)), Math.round(150 + 40 * t), Math.round(120 + 40 * t), Math.round(40 + 60 * t));
          } else if (cls === WALK_NARROW) {
            const stripe = (x + y) % 6 < 2;
            set(x, y, 224, 150, 20, stripe ? 170 : 70);
          } else if (cls === WALK_UNREACHABLE) {
            const dot = x % 4 === 1 && y % 4 === 1;
            set(x, y, 150, 90, 200, dot ? 220 : 50);
          } else if (cls === WALK_BLOCKED) {
            const cross = (x + y) % 8 === 0 || (x - y + 800) % 8 === 0;
            set(x, y, 90, 90, 90, cross ? 110 : 0);
          }
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function WalkabilityLayer() {
  const on = useUiStore((s) => isOverlayOn(s, OVERLAY));
  const { project, walk, aisle } = useWalk(on);
  const scale = useScale();
  const viewRot = useViewRotation();
  const fmt = useFormatters();
  const image = useMemo(() => (walk && on ? heatmapCanvas(walk) : null), [walk, on]);
  const pinches = useMemo(() => {
    if (!project || !on) return [];
    const reports = pathReports(buildAnalysisContext(project), aisle).filter((r) => !r.blocked && r.width < aisle);
    const seen: typeof reports = [];
    for (const r of reports) if (!seen.some((s) => Math.hypot(s.point.x - r.point.x, s.point.y - r.point.y) < 300)) seen.push(r);
    return seen;
  }, [project, aisle, on]);
  if (!walk || !image) return null;
  const g = walk.grid;
  const font = 11 / scale;
  return (
    <Group listening={false}>
      <KImage image={image} x={g.originX} y={g.originY} width={g.cols * g.cellSize} height={g.rows * g.cellSize} imageSmoothingEnabled={false} />
      {walk.deadEnds.map((d, i) => (
        <Group key={`d${i}`}>
          <Line points={d.path.flatMap((p) => [p.x, p.y])} stroke="#8a5cc4" strokeWidth={1.5} dash={[4, 3]} strokeScaleEnabled={false} />
          <Group x={d.point.x} y={d.point.y} rotation={-viewRot}>
            <Circle radius={5 / scale} fill="#8a5cc4" />
            <Text text="dead end" x={7 / scale} y={-font / 2} fontSize={font} fill="#6b3fa6" fontStyle="bold" />
          </Group>
        </Group>
      ))}
      {pinches.map((r, i) => (
        <Group key={`p${i}`} x={r.point.x} y={r.point.y} rotation={-viewRot}>
          <Circle radius={6 / scale} stroke="#c2410c" strokeWidth={2} strokeScaleEnabled={false} />
          <Text text={`${fmt.length(r.width)} wide`} x={9 / scale} y={-font / 2} fontSize={font} fill="#c2410c" fontStyle="bold" />
        </Group>
      ))}
    </Group>
  );
}

canvasLayers.register({ id: 'walkability', slot: 'overlay', order: 10, component: WalkabilityLayer, overlay: { key: OVERLAY, label: 'Walkability heatmap', defaultOn: false } });

function Swatch({ kind }: { kind: 'open' | 'narrow' | 'unreachable' | 'blocked' }) {
  const style: Record<string, React.CSSProperties> = {
    open: { background: 'rgba(60,180,150,0.45)' },
    narrow: { background: 'repeating-linear-gradient(45deg, rgba(224,150,20,0.8) 0 2px, rgba(224,150,20,0.25) 2px 5px)' },
    unreachable: { background: 'radial-gradient(circle, rgba(150,90,200,0.9) 1px, rgba(150,90,200,0.2) 1.5px) 0 0 / 4px 4px' },
    blocked: { background: 'repeating-linear-gradient(45deg, rgba(90,90,90,0.5) 0 1px, transparent 1px 5px), repeating-linear-gradient(-45deg, rgba(90,90,90,0.5) 0 1px, transparent 1px 5px)' },
  };
  return <span className="inline-block size-3.5 shrink-0 rounded-sm border border-line-strong" style={style[kind]} aria-hidden />;
}

function WalkPanel() {
  const project = useProjectStore((s) => s.project);
  const on = useUiStore((s) => isOverlayOn(s, OVERLAY));
  const fmt = useFormatters();
  const { walk, aisle } = useWalk(true);
  // Walkway warnings come from the shared (worker) analysis result, not a second main-thread run.
  const all = useWarnings();
  const warnings = useMemo<Warning[]>(() => all.filter((w) => w.analyzerId === 'walkway' && !w.acknowledged), [all]);
  if (!project) return null;
  const setAisle = (w: number) => dispatch({ type: 'extension.set', payload: { target: 'project', key: walkPrefs.key, value: { aisleWidth: w }, label: 'Change aisle width', history: false } });
  const st = walk?.stats;
  const focus = (w: Warning) => {
    showHighlight({ source: 'walk', polygons: w.highlight.polygons ?? [], points: w.highlight.points ?? [], lines: w.highlight.lines ?? [], label: w.quantities[0] ? fmt.length(w.quantities[0].value) : undefined });
    const refs = w.involved.filter((r) => r.kind === 'object' || r.kind === 'vehicle' || r.kind === 'feature');
    if (refs.length) uiActions.select(refs);
  };
  return (
    <div data-testid="walk-panel">
      <Section title="Aisle width">
        <div className="flex gap-1" role="radiogroup" aria-label="Minimum aisle width">
          {AISLE_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={Math.abs(aisle - w) < 1}
              onClick={() => setAisle(w)}
              className={cn('flex-1 rounded border px-1 py-1 text-xs', Math.abs(aisle - w) < 1 ? 'border-select bg-select/20 text-ink' : 'border-line text-ink-muted hover:text-ink')}
              data-testid={`aisle-${Math.round(w / 25.4)}`}
            >
              {fmt.length(w)}
            </button>
          ))}
        </div>
        <label className="mt-3 flex items-center justify-between text-xs text-ink">
          Show heatmap on the plan
          <Switch checked={on} onCheckedChange={(v) => uiActions.setOverlay(OVERLAY, v)} data-testid="walk-overlay" />
        </label>
        <ul className="mt-3 space-y-1 text-xs">
          <li className="flex items-center gap-2">
            <Swatch kind="open" /> <span className="flex-1 text-ink">Open: a {fmt.length(aisle)} aisle reaches it</span>
            <span className="num text-ink-muted">{st ? fmt.area(st.openArea) : 'n/a'}</span>
          </li>
          <li className="flex items-center gap-2">
            <Swatch kind="narrow" /> <span className="flex-1 text-ink">Narrow: floor you can only squeeze into</span>
            <span className="num text-ink-muted">{st ? fmt.area(st.narrowArea) : 'n/a'}</span>
          </li>
          <li className="flex items-center gap-2">
            <Swatch kind="unreachable" /> <span className="flex-1 text-ink">Cut off: wide enough, but not reachable from a door</span>
            <span className="num text-ink-muted">{st ? fmt.area(st.unreachableArea) : 'n/a'}</span>
          </li>
          <li className="flex items-center gap-2">
            <Swatch kind="blocked" /> <span className="flex-1 text-ink">Blocked by objects, vehicles, fixtures</span>
            <span className="num text-ink-muted">{st ? fmt.area(st.blockedArea) : 'n/a'}</span>
          </li>
        </ul>
        <p className="mt-2 text-2xs text-ink-faint">Computed on a 2" grid from every door (±2"). Wall-hung items above 3′ do not block walking. Deeper teal = more room.</p>
      </Section>
      <Section title={`Paths & dead ends (${warnings.length})`}>
        {warnings.length === 0 ? (
          <p className="text-xs text-ok">Every main path from the doors is at least {fmt.length(aisle)} wide.</p>
        ) : (
          <ul className="space-y-1.5">
            {warnings.map((w) => (
              <li key={w.id}>
                <button type="button" className="text-left text-xs leading-snug text-ink hover:text-select" onClick={() => focus(w)} data-testid="walk-warning">
                  <span className={cn('mr-1 text-2xs font-semibold uppercase', w.severity === 'warning' ? 'text-warn' : 'text-info')}>{w.severity === 'warning' ? 'Warning' : 'Note'}</span>
                  {w.message}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

sidebarSections.register({ id: 'walkability', title: 'Walkways', icon: Footprints, order: 104, component: WalkPanel });
paletteCommands.register({
  id: 'walkability.toggle',
  title: 'Toggle walkability heatmap',
  section: 'Analysis',
  icon: Footprints,
  keywords: ['walkway', 'aisle', 'path', 'heatmap'],
  when: (c) => !!c.project,
  run: () => {
    uiActions.toggleOverlay(OVERLAY);
    uiActions.setLeftSection('walkability');
  },
});
