/**
 * Wall elevation view: a front-facing drawing of one wall as seen from inside the room (wall- and
 * ceiling-mounted storage, floor items standing against the wall, doors / windows / garage door,
 * outlets and the panel, the floor and ceiling lines) with accurate vertical and horizontal
 * dimensions. Items can be dragged along the wall (and wall-mounted items / outlets up and down),
 * with exact entry in the side panel. Stacking opportunities and wall-surface use are listed.
 */
import { ArrowLeft, ChevronLeft, ChevronRight, Layers, Map as MapIcon } from 'lucide-react';
import { useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { LengthInput } from '@/components/LengthInput';
import { PropRow, Section } from '@/components/shell';
import { Badge, Button, EmptyState, Select, Tip } from '@/components/ui';
import type { AppCommand } from '@/domain/commands';
import { getScenario, roomGeometry } from '@/domain/resolve';
import type { Project } from '@/domain/schema';
import { add, scale as vscale, verticalWallUtilization } from '@/geometry';
import { useElementSize } from '@/hooks/useElementSize';
import { useFormatters } from '@/hooks/useFormatters';
import { transact, useProjectStore } from '@/stores/projectStore';
import { uiActions, useUiStore } from '@/stores/uiStore';
import { categoryColors, canvasColors } from '@/styles/tokens';
import { cn } from '@/utils/cn';
import { BUILTIN_OBJECTS } from '@/features/objects/library';
import { stackingOpportunities, wallElevation, type ElevationItem, type WallElevation } from './model';
import { useElevationStore } from './store';

const PAD = { l: 64, r: 96, t: 36, b: 64 };

interface Drag {
  key: string;
  item: ElevationItem;
  startX: number;
  startY: number;
  du: number;
  dz: number;
}

const keyOf = (i: ElevationItem) => `${i.ref.kind}:${i.ref.id}`;

/** Commands that move an elevation item by du along the wall and dz vertically. */
export function moveCommands(project: Project, el: WallElevation, item: ElevationItem, du: number, dz: number): AppCommand[] {
  const cmds: AppCommand[] = [];
  const shift = vscale(el.right, du);
  const sign = Math.sign(el.right.x * el.wall.dir.x + el.right.y * el.wall.dir.y) || 1;
  const scenario = getScenario(project);
  if (item.ref.kind === 'object') {
    const o = scenario.objects.find((x) => x.id === item.ref.id);
    if (!o) return cmds;
    const working = o.mobility === 'mobile' && o.activePosition === 'working' && o.working;
    const pose = working ? o.working! : o;
    if (du !== 0) {
      const p = add(pose, shift);
      cmds.push({ type: 'object.move', payload: { moves: [{ id: o.id, x: p.x, y: p.y, rotation: pose.rotation }], position: working ? 'working' : 'parked' } });
    }
    if (dz !== 0) cmds.push({ type: 'object.update', payload: { id: o.id, patch: { elevation: Math.max(0, o.elevation + dz) } } });
  } else if (item.ref.kind === 'electrical') {
    const e = project.electrical.find((x) => x.id === item.ref.id);
    if (!e || e.placement.type !== 'wall') return cmds;
    cmds.push({ type: 'electrical.update', payload: { id: e.id, patch: { placement: { ...e.placement, offset: e.placement.offset + sign * du }, elevation: Math.max(0, e.elevation + dz) } } });
  } else if (item.ref.kind === 'feature') {
    const f = project.architecture.find((x) => x.id === item.ref.id);
    if (!f || f.placement.type !== 'wall') return cmds;
    cmds.push({ type: 'feature.update', payload: { id: f.id, patch: { placement: { ...f.placement, offset: f.placement.offset + sign * du } } } });
  }
  return cmds;
}

function fillFor(it: ElevationItem): { fill: string; stroke: string; dash?: string } {
  if (it.kind === 'opening') return { fill: '#ffffff', stroke: canvasColors.doorSwing, dash: '6 4' };
  if (it.kind === 'electrical') return { fill: '#f5e7c2', stroke: canvasColors.electrical };
  if (it.kind === 'feature') return { fill: '#d6d8db', stroke: '#6d747c' };
  const c = categoryColors[(it.category as keyof typeof categoryColors) ?? 'unknown'] ?? categoryColors.unknown;
  return { fill: it.color ?? c.fill, stroke: c.stroke, dash: it.mount === 'wall' || it.mount === 'ceiling' ? undefined : undefined };
}

function VDim({ x, z0, z1, Y, text, color = canvasColors.dimension }: { x: number; z0: number; z1: number; Y: (z: number) => number; text: string; color?: string }) {
  const y0 = Y(z0);
  const y1 = Y(z1);
  if (Math.abs(y1 - y0) < 6) return null;
  return (
    <g>
      <line x1={x} x2={x} y1={y0} y2={y1} stroke={color} strokeWidth={1} />
      <line x1={x - 4} x2={x + 4} y1={y0} y2={y0} stroke={color} strokeWidth={1} />
      <line x1={x - 4} x2={x + 4} y1={y1} y2={y1} stroke={color} strokeWidth={1} />
      <text x={x + 5} y={(y0 + y1) / 2} dominantBaseline="middle" fontSize={10} fill={color} className="num">
        {text}
      </text>
    </g>
  );
}

function HDim({ u0, u1, y, X, text, color = canvasColors.dimension }: { u0: number; u1: number; y: number; X: (u: number) => number; text: string; color?: string }) {
  const x0 = X(u0);
  const x1 = X(u1);
  if (Math.abs(x1 - x0) < 6) return null;
  return (
    <g>
      <line x1={x0} x2={x1} y1={y} y2={y} stroke={color} strokeWidth={1} />
      <line x1={x0} x2={x0} y1={y - 4} y2={y + 4} stroke={color} strokeWidth={1} />
      <line x1={x1} x2={x1} y1={y - 4} y2={y + 4} stroke={color} strokeWidth={1} />
      <text x={(x0 + x1) / 2} y={y - 4} textAnchor="middle" fontSize={10} fill={color} className="num">
        {text}
      </text>
    </g>
  );
}

function Drawing({ el, project }: { el: WallElevation; project: Project }) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useElementSize(ref);
  const fmt = useFormatters();
  const selection = useUiStore((s) => s.selection);
  const [drag, setDrag] = useState<Drag | null>(null);
  const top = Math.max(el.height, el.ceiling) + 150;
  const k = Math.max(0.01, Math.min((size.width - PAD.l - PAD.r) / Math.max(1, el.length), (size.height - PAD.t - PAD.b) / top));
  const X = (u: number) => PAD.l + u * k;
  const Y = (z: number) => PAD.t + (top - z) * k;
  const step = fmt.system === 'imperial' ? 25.4 : 10;
  const selKeys = new Set(selection.map((r) => `${r.kind}:${r.id}`));

  const snapDu = (it: ElevationItem, du: number): number => {
    let best = Math.round(du / step) * step;
    const tol = 8 / k;
    for (const o of el.items) {
      if (o === it) continue;
      for (const edge of [o.start, o.end]) {
        for (const mine of [it.start, it.end]) {
          const d = edge - (mine + du);
          if (Math.abs(d) < tol && Math.abs(d) < Math.abs(best - du)) best = du + d;
        }
      }
    }
    for (const edge of [0, el.length]) for (const mine of [it.start, it.end]) if (Math.abs(edge - (mine + du)) < tol) best = edge - mine;
    return best;
  };

  const onDown = (e: RPointerEvent, it: ElevationItem) => {
    e.stopPropagation();
    uiActions.select([it.ref]);
    if (!it.along && !it.vertical) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ key: keyOf(it), item: it, startX: e.clientX, startY: e.clientY, du: 0, dz: 0 });
  };
  const onMove = (e: RPointerEvent) => {
    if (!drag) return;
    const it = drag.item;
    const rawDu = it.along ? (e.clientX - drag.startX) / k : 0;
    const rawDz = it.vertical ? -(e.clientY - drag.startY) / k : 0;
    const du = e.altKey ? rawDu : snapDu(it, rawDu);
    const dz = Math.max(-it.bottom, e.altKey ? rawDz : Math.round(rawDz / step) * step);
    setDrag({ ...drag, du, dz });
  };
  const onUp = () => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (Math.abs(d.du) < 0.5 && Math.abs(d.dz) < 0.5) return;
    const cmds = moveCommands(project, el, d.item, d.du, d.dz);
    if (!cmds.length) return;
    const r = transact(`Move ${d.item.name} on the ${el.name}`, cmds);
    if (!r.ok) uiActions.flash(r.error, 'error');
  };

  const live = (it: ElevationItem): ElevationItem => (drag && drag.key === keyOf(it) ? { ...it, start: it.start + drag.du, end: it.end + drag.du, bottom: it.bottom + drag.dz, top: it.top + drag.dz } : it);
  const selected = el.items.map(live).find((it) => selKeys.has(keyOf(it)));

  return (
    <div ref={ref} className="relative min-h-0 flex-1 overflow-hidden bg-[#f3f2ee]" onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
      {size.width > 0 && (
        <svg width={size.width} height={size.height} className="select-none" data-testid="elevation-svg" role="img" aria-label={`Elevation of the ${el.name}`} onPointerDown={() => uiActions.clearSelection()}>
          {/* wall surface */}
          <rect x={X(0)} y={Y(el.height)} width={el.length * k} height={el.height * k} fill="#fbfaf7" stroke={canvasColors.wallStroke} strokeWidth={1.5} />
          {/* ceiling + floor */}
          <line x1={X(0) - 20} x2={X(el.length) + 20} y1={Y(el.ceiling)} y2={Y(el.ceiling)} stroke={canvasColors.inkMuted} strokeDasharray="8 5" />
          <text x={X(el.length) + 24} y={Y(el.ceiling)} dominantBaseline="middle" fontSize={10} fill={canvasColors.inkMuted}>
            Ceiling {fmt.length(el.ceiling)}
          </text>
          <line x1={X(0) - 20} x2={X(el.length) + 20} y1={Y(0)} y2={Y(0)} stroke={canvasColors.wallStroke} strokeWidth={2} />
          <text x={X(el.length) + 24} y={Y(0)} dominantBaseline="middle" fontSize={10} fill={canvasColors.inkMuted}>
            Floor
          </text>
          {el.items.map((raw) => {
            const it = live(raw);
            const st = fillFor(it);
            const sel = selKeys.has(keyOf(it));
            const w = (it.end - it.start) * k;
            const h = (it.top - it.bottom) * k;
            const far = Math.min(1, it.distance / 600);
            return (
              <g key={keyOf(it)} opacity={1 - far * 0.45} data-testid="elevation-item" data-name={it.name}>
                <rect
                  x={X(it.start)}
                  y={Y(it.top)}
                  width={Math.max(2, w)}
                  height={Math.max(2, h)}
                  fill={st.fill}
                  stroke={sel ? canvasColors.select : st.stroke}
                  strokeWidth={sel ? 2 : 1}
                  strokeDasharray={st.dash}
                  className={cn(it.along || it.vertical ? 'cursor-move' : 'cursor-pointer')}
                  onPointerDown={(e) => onDown(e, raw)}
                >
                  <title>
                    {it.name}: {fmt.length(it.end - it.start)} wide, {fmt.length(it.top - it.bottom)} tall
                    {it.bottom > 0 ? `, bottom at ${fmt.length(it.bottom)}` : ''}
                    {it.distance > 1 ? `, ${fmt.length(it.distance)} out from the wall` : ''}
                  </title>
                </rect>
                {w > 40 && h > 14 && (
                  <text x={X((it.start + it.end) / 2)} y={Y((it.top + it.bottom) / 2)} textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(12, Math.max(9, h / 3))} fill={canvasColors.ink} pointerEvents="none">
                    {it.name.length * 6 > w ? `${it.name.slice(0, Math.max(3, Math.floor(w / 6.5)))}…` : it.name}
                  </text>
                )}
              </g>
            );
          })}
          {/* overall dimensions */}
          <HDim u0={0} u1={el.length} y={Y(0) + 44} X={X} text={`${el.name}: ${fmt.length(el.length)}`} color={canvasColors.ink} />
          <VDim x={X(0) - 40} z0={0} z1={el.height} Y={Y} text={fmt.length(el.height)} color={canvasColors.ink} />
          {/* selected item dimensions */}
          {selected && (
            <g>
              <HDim u0={0} u1={selected.start} y={Y(0) + 22} X={X} text={fmt.length(selected.start)} />
              <HDim u0={selected.start} u1={selected.end} y={Y(0) + 22} X={X} text={fmt.length(selected.end - selected.start)} />
              <HDim u0={selected.end} u1={el.length} y={Y(0) + 22} X={X} text={fmt.length(el.length - selected.end)} />
              <VDim x={X(selected.end) + 8} z0={0} z1={selected.bottom} Y={Y} text={fmt.length(selected.bottom)} />
              <VDim x={X(selected.end) + 8} z0={selected.bottom} z1={selected.top} Y={Y} text={fmt.length(selected.top - selected.bottom)} />
              <VDim x={X(selected.end) + 8} z0={selected.top} z1={el.ceiling} Y={Y} text={`${fmt.length(Math.max(0, el.ceiling - selected.top))} to ceiling`} color={canvasColors.inkMuted} />
            </g>
          )}
        </svg>
      )}
      {drag && (
        <div className="pointer-events-none absolute left-3 top-3 rounded bg-panel/95 px-2 py-1 text-xs text-ink shadow">
          {drag.item.name}: {fmt.length(drag.item.start + drag.du)} from left
          {drag.item.vertical ? ` · bottom ${fmt.length(drag.item.bottom + drag.dz)}` : ''}
          <span className="ml-1 text-ink-faint">(Alt: no snapping)</span>
        </div>
      )}
    </div>
  );
}

function SidePanel({ el, project, planKey }: { el: WallElevation; project: Project; planKey: React.ReactNode }) {
  const fmt = useFormatters();
  const selection = useUiStore((s) => s.selection);
  const item = el.items.find((it) => selection.some((r) => r.kind === it.ref.kind && r.id === it.ref.id));
  const stacking = useMemo(() => stackingOpportunities(el, BUILTIN_OBJECTS, fmt.length), [el, fmt]);
  const util = useMemo(() => {
    const storage = el.items.filter((i) => i.kind === 'object').map((i) => ({ start: i.start, end: i.end, bottom: i.bottom, top: i.top }));
    const openings = el.items.filter((i) => i.kind === 'opening').map((i) => ({ start: i.start, end: i.end, bottom: i.bottom, top: i.top }));
    return verticalWallUtilization(el.length, el.height, storage, openings);
  }, [el]);
  const move = (du: number, dz: number) => {
    if (!item) return;
    const r = transact(`Move ${item.name} on the ${el.name}`, moveCommands(project, el, item, du, dz));
    if (!r.ok) uiActions.flash(r.error, 'error');
  };
  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-line bg-panel" aria-label="Elevation details">
      <div className="flex items-center gap-2 border-b border-line p-2">
        {planKey}
        <p className="text-2xs leading-snug text-ink-faint">Click a wall in the key to switch walls. You are standing inside the room looking at the highlighted wall.</p>
      </div>
      <Section title={item ? item.name : 'Selected item'}>
        {item ? (
          <div className="space-y-1" data-testid="elevation-selected">
            <PropRow label="From left">
              <LengthInput aria-label="Distance from the left end of the wall" value={item.start} allowNegative disabled={!item.along} onCommit={(v) => move(v - item.start, 0)} data-testid="elevation-from-left" />
            </PropRow>
            <PropRow label="Bottom (Z)">
              <LengthInput aria-label="Height of the bottom above the floor" value={item.bottom} disabled={!item.vertical} onCommit={(v) => move(0, v - item.bottom)} data-testid="elevation-bottom" />
            </PropRow>
            <dl className="grid grid-cols-[1fr_auto] gap-y-0.5 pt-1 text-2xs text-ink-muted">
              <dt>Width along the wall</dt>
              <dd className="num text-ink">{fmt.length(item.end - item.start)}</dd>
              <dt>Height</dt>
              <dd className="num text-ink">{fmt.length(item.top - item.bottom)}</dd>
              <dt>Top at</dt>
              <dd className="num text-ink">{fmt.length(item.top)}</dd>
              <dt>Clear to ceiling</dt>
              <dd className="num text-ink">{fmt.length(Math.max(0, el.ceiling - item.top))}</dd>
              {item.distance > 1 && (
                <>
                  <dt>Out from the wall</dt>
                  <dd className="num text-ink">{fmt.length(item.distance)}</dd>
                </>
              )}
            </dl>
            {!item.along && !item.vertical && <p className="text-2xs text-ink-faint">{item.locked ? 'Locked. Unlock it to move it.' : 'Move this one on the plan.'}</p>}
            {item.along && !item.vertical && item.kind === 'object' && <p className="text-2xs text-ink-faint">Floor items slide along the wall here; set Z in the inspector for items standing on something.</p>}
          </div>
        ) : (
          <p className="text-2xs text-ink-faint">Click an item to see its exact position. Drag to slide it along the wall; wall-mounted items and outlets also move up and down.</p>
        )}
      </Section>
      <Section title="Stacking opportunities">
        {stacking.length === 0 ? (
          <p className="text-2xs text-ink-faint">No floor items along this wall with room for storage above them.</p>
        ) : (
          <ul className="space-y-1.5" data-testid="stacking-list">
            {stacking.map((s) => (
              <li key={s.objectId} className="text-xs leading-snug text-ink">
                {s.message}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Wall surface">
        <dl className="grid grid-cols-[1fr_auto] gap-y-0.5 text-2xs text-ink-muted">
          <dt>Length × height</dt>
          <dd className="num text-ink">
            {fmt.length(el.length)} × {fmt.length(el.height)}
          </dd>
          <dt>Covered by items</dt>
          <dd className="num text-ink">
            {fmt.area(util.covered)} ({Math.round(util.pctCovered)}%)
          </dd>
          <dt>Doors & windows</dt>
          <dd className="num text-ink">{fmt.area(util.openings)}</dd>
          <dt>Unused</dt>
          <dd className="num text-ink">{fmt.area(util.unused)}</dd>
        </dl>
      </Section>
      <Section title="Legend" defaultOpen={false}>
        <ul className="space-y-1 text-2xs text-ink-muted">
          <li>Solid boxes: items against or on this wall. Faded boxes stand farther out from the wall.</li>
          <li>Dashed outlines: doors, windows and the garage door opening.</li>
          <li>Dashed line: the ceiling.</li>
        </ul>
      </Section>
    </aside>
  );
}

/** Tiny plan key: the room outline with the viewed wall highlighted; click a wall to switch. */
function PlanKey({ project, wallId }: { project: Project; wallId: string }) {
  const g = roomGeometry(project.room);
  if (g.polygon.length < 3) return null;
  const xs = g.polygon.map((p) => p.x);
  const ys = g.polygon.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(...xs) - minX || 1;
  const h = Math.max(...ys) - minY || 1;
  const s = 88 / Math.max(w, h);
  const P = (p: { x: number; y: number }) => `${6 + (p.x - minX) * s},${6 + (p.y - minY) * s}`;
  return (
    <svg width={100} height={100} className="shrink-0 rounded border border-line bg-[#f3f2ee]" aria-label="Choose a wall">
      <polygon points={g.polygon.map(P).join(' ')} fill="#fbfaf7" stroke="none" />
      {g.walls.map((wl, i) => {
        const id = project.room.walls[i]!.id;
        const on = id === wallId;
        const [ax, ay] = P(wl.a).split(',').map(Number);
        const [bx, by] = P(wl.b).split(',').map(Number);
        return (
          <line key={id} x1={ax} y1={ay} x2={bx} y2={by} stroke={on ? canvasColors.select : 'transparent'} strokeWidth={on ? 4 : 10} className="cursor-pointer" onClick={() => useElevationStore.setState({ wallId: id })}>
            <title>{wl.name}</title>
          </line>
        );
      })}
      {g.walls.map((wl, i) => {
        const id = project.room.walls[i]!.id;
        const [ax, ay] = P(wl.a).split(',').map(Number);
        const [bx, by] = P(wl.b).split(',').map(Number);
        return id === wallId ? null : <line key={`v${id}`} x1={ax} y1={ay} x2={bx} y2={by} stroke={canvasColors.inkMuted} strokeWidth={1.5} pointerEvents="none" />;
      })}
    </svg>
  );
}

export function ElevationView() {
  const project = useProjectStore((s) => s.project);
  const stored = useElevationStore((s) => s.wallId);
  const walls = project?.room.walls ?? [];
  const wallId = walls.some((w) => w.id === stored) ? stored! : walls[0]?.id;
  const el = useMemo(() => (project && wallId ? wallElevation(project, wallId) : null), [project, wallId]);
  const names = useMemo(() => (project ? roomGeometry(project.room).walls.map((w) => w.name) : []), [project]);
  if (!project || walls.length < 3 || !el || !wallId) {
    return (
      <div className="grid size-full place-items-center">
        <EmptyState icon={<Layers />} title="No walls yet" action={<Button onClick={() => uiActions.setView('2d')}>Back to the plan</Button>}>
          Draw the room first; then each wall gets a front-facing elevation.
        </EmptyState>
      </div>
    );
  }
  const idx = walls.findIndex((w) => w.id === wallId);
  const go = (d: number) => useElevationStore.setState({ wallId: walls[(idx + d + walls.length) % walls.length]!.id });
  const count = el.items.filter((i) => i.kind === 'object').length;
  return (
    <div className="flex size-full flex-col" data-testid="elevation-view">
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-1.5">
        <Tip content="Back to the floor plan">
          <Button size="sm" variant="ghost" onClick={() => uiActions.setView('2d')}>
            <ArrowLeft /> Plan
          </Button>
        </Tip>
        <Button size="icon-sm" variant="ghost" aria-label="Previous wall" onClick={() => go(-1)}>
          <ChevronLeft />
        </Button>
        <Select className="h-7 w-56" ariaLabel="Wall" value={wallId} onValueChange={(v) => useElevationStore.setState({ wallId: v })} options={walls.map((w, i) => ({ value: w.id, label: names[i] ?? `Wall ${i + 1}` }))} />
        <Button size="icon-sm" variant="ghost" aria-label="Next wall" onClick={() => go(1)}>
          <ChevronRight />
        </Button>
        <span className="text-xs text-ink-muted" data-testid="elevation-title">
          Looking at the <b className="text-ink">{el.name}</b> from inside
        </span>
        <Badge>{count} item{count === 1 ? '' : 's'}</Badge>
        <Tip content="Select this wall on the plan">
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => {
              uiActions.select([{ kind: 'wall', id: wallId }]);
              uiActions.setView('2d');
            }}
          >
            <MapIcon /> Show on plan
          </Button>
        </Tip>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col">
          <Drawing el={el} project={project} />
        </div>
        <SidePanel el={el} project={project} planKey={<PlanKey project={project} wallId={wallId} />} />
      </div>
    </div>
  );
}
