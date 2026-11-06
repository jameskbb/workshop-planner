/**
 * "Will It Fit?": enter W × D × H (+ clearance in front) and get concrete locations: wall runs with
 * the length available, corners with the margin left, open floor. Click a result to preview a ghost
 * on the plan; "Place here" adds it (one undoable step).
 *
 * "What could fit here?": drag a region on the plan (or use the context menu on selected items to
 * ask what could take their place) → the free W × D there and every library / custom item that fits.
 */
import { BoxSelect, PackageSearch, Ruler, SquareDashed } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Group, Rect } from 'react-konva';
import { create } from 'zustand';
import { canvasTools, contextMenuActions, paletteCommands, sidebarSections, type SelectionContext } from '@/app/registry';
import { useCustomLibrary } from '@/app/services';
import { fitBoxToView } from '@/app/canvas/PlanCanvas';
import { PropRow, Section } from '@/components/shell';
import { LengthInput } from '@/components/LengthInput';
import { Badge, Button, Input } from '@/components/ui';
import { placeObject } from '@/domain/factories';
import { objectFootprint, resolveObject } from '@/domain/resolve';
import { inches } from '@/domain/units';
import { ObjectDefinitionSchema, type ObjectDefinition } from '@/domain/schema';
import { bbox, type Polygon } from '@/geometry';
import { useFormatters } from '@/hooks/useFormatters';
import { transact, useProjectStore } from '@/stores/projectStore';
import { uiActions, useUiStore } from '@/stores/uiStore';
import { newId } from '@/utils/id';
import { cn } from '@/utils/cn';
import { BUILTIN_OBJECTS } from '@/features/objects/library';
import { clearGhosts, showGhosts } from '@/features/ask/overlays';
import { fitSearch, freeAreaIn, itemsThatFit, type FitLocation, type FitsHere, type FreeArea, type Region } from './search';

interface FitState {
  width: number;
  depth: number;
  height: number;
  clearance: number;
  name: string;
  results: FitLocation[] | null;
  selected: string | null;
  /** What-fits-here. */
  region: Region | null;
  drag: Region | null;
  area: FreeArea | null;
  fits: FitsHere[] | null;
  exclude: string[];
}

export const useFit = create<FitState>()(() => ({
  width: inches(48),
  depth: inches(24),
  height: inches(36),
  clearance: 0,
  name: 'Cabinet',
  results: null,
  selected: null,
  region: null,
  drag: null,
  area: null,
  fits: null,
  exclude: [],
}));

const library = (): ObjectDefinition[] => [...useCustomLibrary.getState().definitions, ...BUILTIN_OBJECTS];

function runSearch(): void {
  const p = useProjectStore.getState().project;
  if (!p) return;
  const s = useFit.getState();
  useFit.setState({ results: fitSearch(p, undefined, { width: s.width, depth: s.depth, height: s.height, clearance: s.clearance }), selected: null });
  clearGhosts('fit');
}

function preview(l: FitLocation, label: string): void {
  useFit.setState({ selected: l.id });
  showGhosts({ source: 'fit', ghosts: [{ polygon: l.footprint, label }, ...(l.clearanceZone ? [{ polygon: l.clearanceZone, secondary: true }] : [])], arrows: [] });
  const b = bbox(l.footprint);
  fitBoxToView({ minX: b.minX - 2000, minY: b.minY - 2000, maxX: b.maxX + 2000, maxY: b.maxY + 2000 });
}

/** A custom definition for the searched size (kept in the project; not added to My objects). */
function customDefinition(s: FitState): ObjectDefinition {
  const key = `${Math.round(s.width)}x${Math.round(s.depth)}x${Math.round(s.height)}`;
  return ObjectDefinitionSchema.parse({
    id: `fit:${key}:${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: s.name.trim() || 'New item',
    category: 'storage',
    width: s.width,
    depth: s.depth,
    height: s.height,
    source: 'custom',
    approximate: false,
    layer: 'storage',
    clearances: s.clearance > 0 ? [{ id: 'front', kind: 'access', shape: { type: 'side', side: 'front', depth: s.clearance }, sharable: true }] : [],
  });
}

function placeAt(l: FitLocation): void {
  const s = useFit.getState();
  const def = customDefinition(s);
  const d = l.rotated ? { ...def, width: s.depth, depth: s.width } : def;
  const obj = placeObject(d, l.pose, { id: newId(), width: d.width, depth: d.depth });
  const r = transact(`Place ${def.name}`, [{ type: 'object.add', payload: { objects: [{ ...obj, definitionId: def.id }], definitions: [def] } }]);
  if (!r.ok) return uiActions.flash(r.error, 'error');
  uiActions.select([{ kind: 'object', id: obj.id }]);
  clearGhosts('fit');
  uiActions.flash(`Placed ${def.name} at ${l.location}. Undo with Ctrl/Cmd+Z.`);
  runSearch();
}

function computeHere(region: Region, exclude: string[] = []): void {
  const p = useProjectStore.getState().project;
  if (!p) return;
  const ex = new Set(exclude);
  const area = freeAreaIn(p, undefined, region, ex);
  useFit.setState({ region, area, exclude, fits: area ? itemsThatFit(p, undefined, area, library(), ex) : [] });
  uiActions.setLeftSection('fitcheck');
  if (area) {
    showGhosts({ source: 'fit-here', ghosts: [{ polygon: rectPoly(area), secondary: true }], arrows: [] });
  }
}

const rectPoly = (r: Region): Polygon => [
  { x: r.minX, y: r.minY },
  { x: r.maxX, y: r.minY },
  { x: r.maxX, y: r.maxY },
  { x: r.minX, y: r.maxY },
];

function placeFits(f: FitsHere): void {
  const p = useProjectStore.getState().project;
  if (!p) return;
  const obj = placeObject(f.definition, f.pose, { id: newId() });
  const r = transact(`Add ${f.definition.name}`, [{ type: 'object.add', payload: { objects: [obj], definitions: [f.definition] } }]);
  if (!r.ok) return uiActions.flash(r.error, 'error');
  uiActions.select([{ kind: 'object', id: obj.id }]);
  const { region, exclude } = useFit.getState();
  if (region) computeHere(region, exclude);
}

// ───────────── region tool ─────────────

function RegionOverlay() {
  const drag = useFit((s) => s.drag);
  if (!drag) return null;
  return (
    <Group listening={false}>
      <Rect x={drag.minX} y={drag.minY} width={drag.maxX - drag.minX} height={drag.maxY - drag.minY} fill="rgba(47,125,246,0.08)" stroke="#2f7df6" strokeWidth={1.5} dash={[6, 4]} strokeScaleEnabled={false} />
    </Group>
  );
}

let start: { x: number; y: number } | null = null;
canvasTools.register({
  id: 'fit-region',
  label: 'What could fit here? (drag a region)',
  icon: BoxSelect,
  cursor: 'crosshair',
  hidden: true,
  order: 95,
  onPointerDown(e) {
    start = e.world;
    useFit.setState({ drag: { minX: e.world.x, minY: e.world.y, maxX: e.world.x, maxY: e.world.y } });
  },
  onPointerMove(e) {
    if (!start) return;
    useFit.setState({ drag: { minX: Math.min(start.x, e.world.x), minY: Math.min(start.y, e.world.y), maxX: Math.max(start.x, e.world.x), maxY: Math.max(start.y, e.world.y) } });
  },
  onPointerUp(_e, api) {
    const d = useFit.getState().drag;
    start = null;
    useFit.setState({ drag: null });
    api.resetTool();
    if (!d || d.maxX - d.minX < 50 || d.maxY - d.minY < 50) {
      uiActions.flash('Drag a rectangle over the empty space you want to use.', 'warning');
      return;
    }
    computeHere(d);
  },
  onKeyDown(e, api) {
    if (e.key === 'Escape') {
      start = null;
      useFit.setState({ drag: null });
      api.resetTool();
      return true;
    }
  },
  overlay: RegionOverlay,
});

contextMenuActions.register({
  id: 'fitcheck.here',
  group: 'analysis',
  label: 'What could fit here instead?',
  icon: PackageSearch,
  appliesTo: (c: SelectionContext) => c.refs.length > 0 && c.refs.every((r) => r.kind === 'object'),
  run: (c: SelectionContext) => {
    const polys = c.refs.map((r) => objectFootprint(resolveObject(c.project, c.scenario.objects.find((o) => o.id === r.id)!)));
    const b = bbox(polys.flat());
    computeHere({ minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY }, c.refs.map((r) => r.id));
  },
});

// ───────────── panel ─────────────

function FitPanel() {
  const project = useProjectStore((s) => s.project);
  const st = useFit();
  const fmt = useFormatters();
  const tool = useUiStore((s) => s.tool);
  useEffect(() => () => {
    clearGhosts('fit');
    clearGhosts('fit-here');
  }, []);
  const label = useMemo(() => `${st.name || 'Item'} ${fmt.length(st.width)} × ${fmt.length(st.depth)}`, [st.name, st.width, st.depth, fmt]);
  if (!project) return null;
  const describe = (l: FitLocation) =>
    l.kind === 'floor' ? `Open floor${l.rotated ? ' (turned 90°)' : ''}` : l.kind === 'corner' ? `${l.location}: fits with ${fmt.length(l.remaining)} remaining` : `${l.location}: ${fmt.length(l.available)} available${l.rotated ? ' (turned sideways)' : ''}`;
  return (
    <div data-testid="fit-panel">
      <Section title="Will It Fit?">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runSearch();
          }}
        >
          <PropRow label="Name">
            <Input value={st.name} onChange={(e) => useFit.setState({ name: e.target.value })} aria-label="Item name" className="h-7" />
          </PropRow>
          <div className="grid grid-cols-2">
            <PropRow label="Width">
              <LengthInput value={st.width} allowZero={false} onCommit={(v) => useFit.setState({ width: v })} aria-label="Width" data-testid="fit-width" />
            </PropRow>
            <PropRow label="Depth">
              <LengthInput value={st.depth} allowZero={false} onCommit={(v) => useFit.setState({ depth: v })} aria-label="Depth" data-testid="fit-depth" />
            </PropRow>
            <PropRow label="Height">
              <LengthInput value={st.height} allowZero={false} onCommit={(v) => useFit.setState({ height: v })} aria-label="Height" data-testid="fit-height" />
            </PropRow>
            <PropRow label="Clear front">
              <LengthInput value={st.clearance} onCommit={(v) => useFit.setState({ clearance: v })} aria-label="Clearance required in front" data-testid="fit-clearance" />
            </PropRow>
          </div>
          <Button type="submit" size="sm" variant="primary" className="mt-2 w-full" data-testid="fit-search">
            <Ruler /> Find places
          </Button>
        </form>
        <p className="mt-1.5 text-2xs text-ink-faint">Height matters: wall cabinets, windows and anything above count only if they overlap its height. Door swings and the garage-door opening are kept clear.</p>
        {st.results && (
          <div className="mt-3">
            {st.results.length === 0 ? (
              <p className="text-xs text-ink-muted">No place fits a {label}. Try a smaller size, less clearance, or move something first.</p>
            ) : (
              <ul className="space-y-1" aria-label="Places it fits">
                {st.results.map((l) => (
                  <li key={l.id} className={cn('flex items-center gap-1 rounded-md border px-2 py-1.5', st.selected === l.id ? 'border-select bg-select/10' : 'border-line')} data-testid="fit-result">
                    <button type="button" className="min-w-0 flex-1 text-left text-xs text-ink" onClick={() => preview(l, label)}>
                      <Badge tone={l.kind === 'wall' ? 'info' : l.kind === 'corner' ? 'accent' : 'neutral'} className="mr-1">
                        {l.kind}
                      </Badge>
                      {describe(l)}
                    </button>
                    {st.selected === l.id && (
                      <Button size="sm" variant="primary" onClick={() => placeAt(l)} data-testid="fit-place">
                        Place here
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Section>
      <Section title="What could fit here?">
        <Button size="sm" variant={tool === 'fit-region' ? 'primary' : 'outline'} className="w-full" onClick={() => uiActions.setTool(tool === 'fit-region' ? 'select' : 'fit-region')} data-testid="fit-pick-region">
          <SquareDashed /> {tool === 'fit-region' ? 'Drag a region on the plan… (Esc cancels)' : 'Pick a region on the plan'}
        </Button>
        <p className="mt-1.5 text-2xs text-ink-faint">Or right-click selected items → “What could fit here instead?”.</p>
        {st.region &&
          (st.area ? (
            <div className="mt-2">
              <p className="text-xs text-ink" data-testid="fit-here-area">
                Available: <span className="num font-semibold">{fmt.length(st.area.width)} × {fmt.length(st.area.depth)}</span>
                {st.exclude.length ? ' (if the selected items move)' : ''}
              </p>
              {st.fits && st.fits.length > 0 ? (
                <ul className="mt-1.5 space-y-0.5" aria-label="Items that fit">
                  {st.fits.slice(0, 30).map((f) => (
                    <li key={f.definition.id}>
                      <button type="button" className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-panel-2" onClick={() => placeFits(f)} title={`Place a ${f.definition.name} here`} data-testid="fit-here-item">
                        <span className="truncate text-ink">
                          {f.definition.name}
                          {f.rotated ? <span className="text-ink-faint"> (turned 90°)</span> : null}
                        </span>
                        <span className="num shrink-0 text-2xs text-ink-faint">
                          {fmt.length(f.definition.width)} × {fmt.length(f.definition.depth)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-ink-muted">Nothing in the library fits in that space.</p>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-ink-muted">That region has no free floor.</p>
          ))}
      </Section>
    </div>
  );
}

sidebarSections.register({ id: 'fitcheck', title: 'Will It Fit?', icon: PackageSearch, order: 103, component: FitPanel });
paletteCommands.register({ id: 'fitcheck.open', title: 'Will It Fit?…', section: 'Analysis', icon: PackageSearch, keywords: ['fit', 'space', 'room for', 'place'], when: (c) => !!c.project, run: () => uiActions.setLeftSection('fitcheck') });
paletteCommands.register({
  id: 'fitcheck.here',
  title: 'What could fit here? (drag a region)',
  section: 'Analysis',
  icon: BoxSelect,
  keywords: ['empty', 'region', 'space'],
  when: (c) => !!c.project,
  run: () => {
    uiActions.setLeftSection('fitcheck');
    uiActions.setTool('fit-region');
  },
});
