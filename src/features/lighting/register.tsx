/**
 * Light fixtures: inspector (position, size, mounting height, lumens, beam angle, approximate
 * coverage), the "Light coverage" overlay (each fixture's beam footprint on the work plane) and the
 * "Lighting heatmap" overlay (approximate illuminance grid) with a legend comparing the front /
 * middle / back and left / middle / right thirds of the room. Placement lives in the Fixed
 * features panel. Approximate planning aid, not a photometric calculation.
 */
import { Lightbulb, Sun } from 'lucide-react';
import { useMemo } from 'react';
import { Group, Image as KImage, Line } from 'react-konva';
import { canvasLayers, canvasOverlays, inspectorSections, paletteCommands, type SelectionContext } from '@/app/registry';
import { getScenario, roomPolygon } from '@/domain/resolve';
import { useProjectStore } from '@/stores/projectStore';
import { usePreview, withPreview } from '@/stores/editorStore';
import { isOverlayOn, useUiStore } from '@/stores/uiStore';
import { canvasColors } from '@/styles/tokens';
import { useFormatters } from '@/hooks/useFormatters';
import { coverageFootprint, illuminanceAt, illuminanceGrid, LUX_PER_FC, thirds, WORK_PLANE, type IlluminanceGrid } from './illuminance';
import { PropRow } from '@/components/shell';
import { AngleInput, LengthInput } from '@/components/LengthInput';
import { Input, Select } from '@/components/ui';
import type { LightingFixture } from '@/domain/schema';
import { dispatch } from '@/stores/projectStore';
import { uiActions } from '@/stores/uiStore';
import { NameField, NotesField, SwitchRow } from '@/features/editor/inspectorParts';

const single = (c: SelectionContext): LightingFixture | undefined => (c.single?.kind === 'light' ? c.scenario.lights.find((l) => l.id === c.single!.id) : undefined);
function update(id: string, patch: Partial<LightingFixture>) {
  const r = dispatch({ type: 'light.update', payload: { id, patch } });
  if (!r.ok) uiActions.flash(r.error, 'error');
}

function LightMain({ ctx }: { ctx: SelectionContext }) {
  const l = single(ctx)!;
  return (
    <div className="space-y-1">
      <NameField value={l.name} onCommit={(name) => name && update(l.id, { name })} />
      <PropRow label="Type">
        <Select
          className="h-7"
          ariaLabel="Fixture type"
          value={l.kind}
          onValueChange={(v) => update(l.id, { kind: v as LightingFixture['kind'] })}
          options={[
            { value: 'shop-light', label: 'Shop light (linear)' },
            { value: 'ceiling-fixture', label: 'Ceiling fixture' },
            { value: 'task-light', label: 'Task light' },
          ]}
        />
      </PropRow>
      <div className="grid grid-cols-2 gap-x-2">
        <PropRow label="X">
          <LengthInput aria-label="X position" value={l.x} allowNegative onCommit={(x) => update(l.id, { x })} />
        </PropRow>
        <PropRow label="Y">
          <LengthInput aria-label="Y position" value={l.y} allowNegative onCommit={(y) => update(l.id, { y })} />
        </PropRow>
        <PropRow label="Length">
          <LengthInput aria-label="Length" value={l.length} allowZero={false} onCommit={(length) => update(l.id, { length })} />
        </PropRow>
        <PropRow label="Width">
          <LengthInput aria-label="Width" value={l.width} allowZero={false} onCommit={(width) => update(l.id, { width })} />
        </PropRow>
      </div>
      <PropRow label="Rotation">
        <AngleInput aria-label="Rotation" value={l.rotation} onCommit={(rotation) => update(l.id, { rotation })} />
      </PropRow>
      <PropRow label="Mounted at">
        <LengthInput aria-label="Mounting height" value={l.elevation} onCommit={(elevation) => update(l.id, { elevation })} />
      </PropRow>
    </div>
  );
}

function LightOutput({ ctx }: { ctx: SelectionContext }) {
  const l = single(ctx)!;
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-x-2">
        <PropRow label="Lumens" htmlFor="light-lm">
          <Input
            id="light-lm"
            key={`lm-${l.id}-${l.lumens}`}
            type="number"
            min={1}
            defaultValue={l.lumens}
            className="num h-7"
            onBlur={(e) => Number(e.target.value) > 0 && Number(e.target.value) !== l.lumens && update(l.id, { lumens: Number(e.target.value) })}
          />
        </PropRow>
        <PropRow label="Beam">
          <AngleInput aria-label="Beam angle" value={l.beamAngle} onCommit={(b) => b >= 10 && b <= 180 && update(l.id, { beamAngle: b })} />
        </PropRow>
      </div>
      <LightCoverage l={l} />
      <SwitchRow label="Locked" checked={l.locked} onChange={(locked) => update(l.id, { locked })} />
      <SwitchRow label="Hidden" checked={l.hidden} onChange={(hidden) => update(l.id, { hidden })} />
      <NotesField value={l.notes} onCommit={(notes) => update(l.id, { notes })} />
    </div>
  );
}

function useIlluminanceUnit() {
  const fmt = useFormatters();
  const imperial = fmt.system === 'imperial';
  return { unit: imperial ? 'fc' : 'lux', conv: (lux: number) => (imperial ? lux / LUX_PER_FC : lux) };
}

function LightCoverage({ l }: { l: LightingFixture }) {
  const fmt = useFormatters();
  const { unit, conv } = useIlluminanceUnit();
  const h = Math.max(0, l.elevation - WORK_PLANE);
  const radius = h * Math.tan((Math.min(170, l.beamAngle) / 2) * (Math.PI / 180));
  const under = illuminanceAt([l], { x: l.x, y: l.y });
  return (
    <p className="text-2xs leading-snug text-ink-muted" data-testid="light-coverage">
      About {Math.round(conv(under))} {unit} on a bench directly below (this fixture alone); the beam spreads {fmt.length(radius)} around it at bench height ({fmt.length(WORK_PLANE)}).
    </p>
  );
}

const is = (c: SelectionContext) => !!single(c);
inspectorSections.register({ id: 'light.main', title: 'Light fixture', order: 10, appliesTo: is, component: LightMain });
inspectorSections.register({ id: 'light.output', title: 'Output & options', order: 40, appliesTo: is, component: LightOutput });

// ───────────── overlays ─────────────

const OVERLAY_COVERAGE = 'lighting-coverage';
const OVERLAY_HEATMAP = 'lighting-heatmap';

function CoverageNode({ light }: { light: LightingFixture }) {
  const l = withPreview(light, usePreview<LightingFixture>('light', light.id));
  const fp = coverageFootprint(l);
  return <Line points={fp.flatMap((p) => [p.x, p.y])} closed fill={canvasColors.lightGlow} stroke={canvasColors.light} strokeWidth={1} dash={[4, 4]} strokeScaleEnabled={false} listening={false} />;
}

function CoverageLayer() {
  const lights = useProjectStore((s) => (s.project ? getScenario(s.project).lights : undefined));
  if (!lights) return null;
  return (
    <Group listening={false}>
      {lights
        .filter((l) => !l.hidden)
        .map((l) => (
          <CoverageNode key={l.id} light={l} />
        ))}
    </Group>
  );
}

/** Sequential ramp (dark → bright) for the heatmap; stops chosen to read in color and grayscale. */
const RAMP: Array<[number, [number, number, number]]> = [
  [0, [30, 36, 64]],
  [0.25, [55, 80, 150]],
  [0.5, [60, 150, 150]],
  [0.75, [230, 190, 60]],
  [1, [255, 245, 190]],
];
function rampColor(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < RAMP.length; i++) {
    const [t1, c1] = RAMP[i]!;
    const [t0, c0] = RAMP[i - 1]!;
    if (x <= t1) {
      const k = (x - t0) / (t1 - t0);
      return [0, 1, 2].map((j) => Math.round(c0[j]! + (c1[j]! - c0[j]!) * k)) as [number, number, number];
    }
  }
  return RAMP[RAMP.length - 1]![1];
}

/** Heatmap scale top (lux): 100 fc ≈ 1076 lux, or the grid max if higher. */
const scaleTop = (g: IlluminanceGrid) => Math.max(1076, g.stats.max);

function useGrid(): IlluminanceGrid | null {
  const project = useProjectStore((s) => s.project);
  return useMemo(() => {
    if (!project || project.room.vertices.length < 3) return null;
    const lights = getScenario(project).lights.filter((l) => !l.hidden);
    return illuminanceGrid(roomPolygon(project.room), lights, { cell: 150, ceiling: project.room.ceilingHeight });
  }, [project]);
}

function HeatmapLayer() {
  const grid = useGrid();
  const room = useProjectStore((s) => (s.project ? roomPolygon(s.project.room) : null));
  const image = useMemo(() => {
    if (!grid || typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = grid.cols;
    c.height = grid.rows;
    const g = c.getContext('2d');
    if (!g) return null;
    const img = g.createImageData(grid.cols, grid.rows);
    const top = scaleTop(grid);
    for (let i = 0; i < grid.lux.length; i++) {
      const v = grid.lux[i]!;
      const [r, gg, b] = rampColor(Number.isNaN(v) ? 0 : v / top);
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = gg;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = Number.isNaN(v) ? 0 : 150;
    }
    g.putImageData(img, 0, 0);
    return c;
  }, [grid]);
  if (!grid || !image || !room) return null;
  return (
    <Group
      listening={false}
      clipFunc={(ctx) => {
        ctx.beginPath();
        room.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
      }}
    >
      <KImage image={image as unknown as HTMLImageElement} x={grid.box.minX} y={grid.box.minY} width={grid.cols * grid.cell} height={grid.rows * grid.cell} />
    </Group>
  );
}

canvasLayers.register({ id: 'lighting-heatmap', slot: 'background', order: 60, component: HeatmapLayer, overlay: { key: OVERLAY_HEATMAP, label: 'Lighting heatmap', defaultOn: false, group: 'Lighting' } });
canvasLayers.register({ id: 'lighting-coverage', slot: 'overlay', order: 45, component: CoverageLayer, overlay: { key: OVERLAY_COVERAGE, label: 'Light coverage', defaultOn: false, group: 'Lighting' } });

function HeatmapLegend() {
  const on = useUiStore((s) => isOverlayOn(s, OVERLAY_HEATMAP));
  const view = useUiStore((s) => s.view);
  const grid = useGrid();
  const { unit, conv } = useIlluminanceUnit();
  if (!on || view !== '2d' || !grid) return null;
  const top = scaleTop(grid);
  const r = (v: number) => Math.round(conv(v));
  const ns = thirds(grid, 'y');
  const we = thirds(grid, 'x');
  const gradient = `linear-gradient(to right, ${RAMP.map(([t, c]) => `rgb(${c.join(',')}) ${t * 100}%`).join(', ')})`;
  return (
    <div className="pointer-events-auto absolute bottom-3 right-3 z-10 w-72 rounded-md border border-line bg-panel/95 p-2 text-2xs text-ink-muted shadow-lg" data-testid="lighting-legend">
      <div className="mb-1 flex items-center gap-1 font-semibold uppercase tracking-wide text-ink-faint">
        <Sun className="size-3" /> Approx. light at bench height
      </div>
      <div className="h-2 rounded" style={{ background: gradient }} />
      <div className="num mt-0.5 flex justify-between">
        <span>0</span>
        <span>
          {r(top)} {unit}
        </span>
      </div>
      <dl className="num mt-1 grid grid-cols-[1fr_auto] gap-y-0.5">
        <dt>Average / darkest</dt>
        <dd className="text-ink">
          {r(grid.stats.average)} / {r(grid.stats.min)} {unit}
        </dd>
        <dt>North · middle · south</dt>
        <dd className="text-ink">{ns.map(r).join(' · ')}</dd>
        <dt>West · middle · east</dt>
        <dd className="text-ink">{we.map(r).join(' · ')}</dd>
        <dt>Evenness (darkest ÷ avg)</dt>
        <dd className="text-ink">{Math.round(grid.stats.uniformity * 100)}%</dd>
      </dl>
      <p className="mt-1 leading-snug text-ink-faint">Planning estimate from lumens, beam angle and mounting height (plus some bounce light). Move lights and compare.</p>
    </div>
  );
}
canvasOverlays.register({ id: 'lighting.legend', order: 62, component: HeatmapLegend });

paletteCommands.register({ id: 'lighting.toggle-heatmap', title: 'Toggle: Lighting heatmap', section: 'View', icon: Sun, keywords: ['light', 'illumination', 'foot-candles', 'lux'], when: (c) => !!c.project, run: () => useUiStore.setState((s) => ({ overlays: { ...s.overlays, [OVERLAY_HEATMAP]: !(s.overlays[OVERLAY_HEATMAP] ?? false) } })) });
paletteCommands.register({ id: 'lighting.toggle-coverage', title: 'Toggle: Light coverage', section: 'View', icon: Lightbulb, keywords: ['light', 'beam'], when: (c) => !!c.project, run: () => useUiStore.setState((s) => ({ overlays: { ...s.overlays, [OVERLAY_COVERAGE]: !(s.overlays[OVERLAY_COVERAGE] ?? false) } })) });
