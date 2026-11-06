/**
 * Room feature: the Room sidebar panel (outline actions, wall table with exact lengths / bearings,
 * ceiling), wall and corner inspectors (dimensions, constraints, appearance, notes), the Wall
 * drawing tool and room dialogs.
 */
import { Lock, PenLine, Ruler, Scissors, Shapes, SquareDashed, Trash2 } from 'lucide-react';
import { canvasTools, inspectorSections, paletteCommands, shellExtras, sidebarSections, type SelectionContext } from '@/app/registry';
import { PropRow, Section } from '@/components/shell';
import { AngleInput, LengthInput } from '@/components/LengthInput';
import { Button, EmptyState, Input, Select, Switch, Textarea, Tip } from '@/components/ui';
import { roomGeometry } from '@/domain/resolve';
import { bearingOfDirection, directionOfBearing, wallLetter } from '@/domain/roomEdit';
import type { Wall, WallConstraints } from '@/domain/schema';
import { angleOf, area, interiorAngles, perimeter } from '@/geometry';
import { useFormatters } from '@/hooks/useFormatters';
import { dispatch, transact, useProjectStore } from '@/stores/projectStore';
import { editorActions } from '@/stores/editorStore';
import { uiActions, useUiStore } from '@/stores/uiStore';
import { cn } from '@/utils/cn';
import { newId } from '@/utils/id';
import { wallTool } from './drawTool';
import { RoomDialogs } from './RoomShapeDialogs';

canvasTools.register(wallTool);
shellExtras.register({ id: 'room.dialogs', order: 20, component: RoomDialogs });

const flashIfRefused = (r: { ok: boolean; error?: string }) => {
  if (!r.ok && r.error) uiActions.flash(r.error, 'error');
};

// ───────────── panel ─────────────

function OutlineActions() {
  return (
    <div className="grid grid-cols-1 gap-1.5">
      <Button size="sm" variant="outline" className="justify-start" onClick={() => uiActions.setTool('wall')} data-testid="room-draw">
        <PenLine /> Draw walls on the plan <span className="ml-auto text-2xs text-ink-faint">W</span>
      </Button>
      <Button size="sm" variant="outline" className="justify-start" onClick={() => editorActions.openDialog('room-template')} data-testid="room-template">
        <Shapes /> Start from a template…
      </Button>
      <Button size="sm" variant="outline" className="justify-start" onClick={() => editorActions.openDialog('room-lengths')} data-testid="room-lengths">
        <Ruler /> Type wall lengths…
      </Button>
    </div>
  );
}

function RoomPanel() {
  const room = useProjectStore((s) => s.project?.room);
  const settings = useProjectStore((s) => s.project?.settings);
  const selectedWall = useUiStore((s) => (s.selection.length === 1 && s.selection[0]!.kind === 'wall' ? s.selection[0]!.id : null));
  const fmt = useFormatters();
  if (!room || !settings) return null;
  if (room.vertices.length < 3) {
    return (
      <div className="p-3">
        <EmptyState icon={<SquareDashed />} title="No room outline yet">
          Draw your garage wall by wall, start from a common shape, or type the lengths you measured.
        </EmptyState>
        <OutlineActions />
      </div>
    );
  }
  const g = roomGeometry(room);
  const angles = interiorAngles(g.polygon);
  const square = angles.every((a) => Math.abs(a - 90) < 0.05 || Math.abs(a - 270) < 0.05);
  return (
    <div>
      <Section title="Outline">
        <dl className="grid grid-cols-[88px_1fr] gap-y-1 text-xs">
          <dt className="text-ink-muted">Floor area</dt>
          <dd className="num">{fmt.area(area(g.polygon))}</dd>
          <dt className="text-ink-muted">Perimeter</dt>
          <dd className="num">{fmt.length(perimeter(g.polygon))}</dd>
          <dt className="text-ink-muted">Corners</dt>
          <dd className="num">
            {room.vertices.length} {square ? '(all square)' : ''}
          </dd>
        </dl>
        <p className="mt-2 text-2xs text-ink-faint">Drag corners or walls on the plan. Double-click a wall to add a corner; select a corner and press Delete to remove it.</p>
      </Section>
      <Section title="Walls">
        <table className="w-full text-xs" aria-label="Walls">
          <thead>
            <tr className="text-left text-2xs text-ink-faint">
              <th className="w-6 font-normal">#</th>
              <th className="font-normal">Length</th>
              <th className="w-[74px] font-normal">Bearing</th>
            </tr>
          </thead>
          <tbody>
            {room.walls.map((w, i) => {
              const geo = g.walls[i]!;
              const locked = w.constraints?.lockLength;
              return (
                <tr key={w.id} className={cn('align-middle', selectedWall === w.id && 'bg-select/10')}>
                  <td>
                    <Tip content={`${geo.name}: select on plan`}>
                      <button
                        type="button"
                        className={cn('grid size-5 place-items-center rounded text-2xs font-semibold', selectedWall === w.id ? 'bg-select text-white' : 'bg-panel-3 text-ink-muted hover:text-ink')}
                        onClick={() => uiActions.select([{ kind: 'wall', id: w.id }])}
                        aria-label={`Select wall ${wallLetter(i)} (${geo.name})`}
                      >
                        {wallLetter(i)}
                      </button>
                    </Tip>
                  </td>
                  <td className="py-0.5 pr-1">
                    <div className="flex items-center gap-1">
                      <LengthInput
                        aria-label={`Wall ${wallLetter(i)} length`}
                        value={geo.length}
                        allowZero={false}
                        disabled={locked}
                        onCommit={(length) => flashIfRefused(dispatch({ type: 'room.setWallLength', payload: { wallId: w.id, length } }))}
                        data-testid={`wall-table-length-${i}`}
                      />
                      {locked && <Lock className="size-3 shrink-0 text-ink-faint" aria-label="Length locked" />}
                    </div>
                  </td>
                  <td className="py-0.5">
                    <AngleInput
                      aria-label={`Wall ${wallLetter(i)} bearing`}
                      value={bearingOfDirection(angleOf(geo.dir))}
                      onCommit={(b) => flashIfRefused(dispatch({ type: 'room.setWallDirection', payload: { wallId: w.id, direction: directionOfBearing(b) } }))}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-1.5 text-2xs text-ink-faint">Bearing: N 0°, E 90°, S 180°, W 270°. Changing a length moves the walls after it; the next wall stretches to keep the room closed.</p>
      </Section>
      <Section title="Height & thickness">
        <PropRow label="Ceiling">
          <LengthInput aria-label="Ceiling height" value={room.ceilingHeight} allowZero={false} onCommit={(height) => dispatch({ type: 'room.setCeilingHeight', payload: { height } })} data-testid="ceiling-height" />
        </PropRow>
        <PropRow label="All walls">
          <LengthInput
            aria-label="Thickness of every wall"
            value={settings.defaultWallThickness}
            allowZero={false}
            onCommit={(t) =>
              flashIfRefused(
                transact('Set wall thickness', [
                  { type: 'project.updateSettings', payload: { patch: { defaultWallThickness: t } } },
                  ...room.walls.map((w) => ({ type: 'room.updateWall' as const, payload: { wallId: w.id, patch: { thickness: t } } })),
                ]),
              )
            }
          />
        </PropRow>
      </Section>
      <Section title="Replace outline" defaultOpen={false}>
        <OutlineActions />
      </Section>
    </div>
  );
}

sidebarSections.register({ id: 'room', title: 'Room', icon: SquareDashed, order: 20, component: RoomPanel });

// ───────────── wall inspector ─────────────

const singleWall = (c: SelectionContext) => (c.single?.kind === 'wall' ? c.project.room.walls.find((w) => w.id === c.single!.id) : undefined);
const wallIndex = (c: SelectionContext, w: Wall) => c.project.room.walls.findIndex((x) => x.id === w.id);

function updateWall(wallId: string, patch: Partial<Wall>, unset: string[] = []) {
  flashIfRefused(dispatch({ type: 'room.updateWall', payload: { wallId, patch, unset } }));
}

function WallIdentity({ ctx }: { ctx: SelectionContext }) {
  const w = singleWall(ctx)!;
  const i = wallIndex(ctx, w);
  const geo = roomGeometry(ctx.project.room).walls[i]!;
  return (
    <div className="space-y-1">
      <PropRow label="Wall">
        <span className="text-xs text-ink">
          <b>{wallLetter(i)}</b> · <span className="text-ink-muted">faces {geo.compass}</span>
        </span>
      </PropRow>
      <PropRow label="Name" htmlFor="wall-name">
        <Input
          id="wall-name"
          key={`wn-${w.id}`}
          defaultValue={w.name ?? ''}
          placeholder={geo.name}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v === (w.name ?? '')) return;
            if (v) updateWall(w.id, { name: v });
            else updateWall(w.id, {}, ['name']);
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          data-testid="wall-name"
        />
      </PropRow>
    </div>
  );
}

function WallGeometry({ ctx }: { ctx: SelectionContext }) {
  const w = singleWall(ctx)!;
  const i = wallIndex(ctx, w);
  const room = ctx.project.room;
  const geo = roomGeometry(room).walls[i]!;
  const corner = interiorAngles(roomGeometry(room).polygon)[i] ?? 90;
  const c = w.constraints ?? {};
  const dirLocked = !!(c.horizontal || c.vertical || c.lockAngle);
  return (
    <div className="space-y-1">
      <PropRow label="Length">
        <LengthInput aria-label="Wall length" value={geo.length} allowZero={false} disabled={c.lockLength} onCommit={(length) => flashIfRefused(dispatch({ type: 'room.setWallLength', payload: { wallId: w.id, length } }))} data-testid="wall-length" />
      </PropRow>
      <PropRow label="Bearing">
        <AngleInput aria-label="Wall bearing" value={bearingOfDirection(angleOf(geo.dir))} disabled={dirLocked} onCommit={(b) => flashIfRefused(dispatch({ type: 'room.setWallDirection', payload: { wallId: w.id, direction: directionOfBearing(b) } }))} data-testid="wall-bearing" />
      </PropRow>
      <PropRow label="Start corner">
        <AngleInput aria-label="Interior angle at the wall's start corner" value={corner} disabled={dirLocked} onCommit={(angle) => angle > 0 && flashIfRefused(dispatch({ type: 'room.setCornerAngle', payload: { vertexId: room.vertices[i]!.id, angle } }))} />
      </PropRow>
      <div className="grid grid-cols-2 gap-x-2">
        <PropRow label="Thickness">
          <LengthInput aria-label="Wall thickness" value={w.thickness} allowZero={false} onCommit={(thickness) => updateWall(w.id, { thickness })} data-testid="wall-thickness" />
        </PropRow>
        <PropRow label="Height">
          <LengthInput aria-label="Wall height" value={w.height ?? room.ceilingHeight} allowZero={false} onCommit={(height) => updateWall(w.id, { height })} />
        </PropRow>
      </div>
      <p className="text-2xs text-ink-faint">Lengths are measured along the inside face. The start corner stays fixed; later walls follow.</p>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          const vertexId = newId();
          const r = dispatch({ type: 'room.insertVertex', payload: { wallId: w.id, offset: Math.round((geo.length / 2) * 100) / 100, vertexId, newWallId: newId() } });
          if (r.ok) uiActions.select([{ kind: 'vertex', id: vertexId }]);
          else uiActions.flash(r.error, 'error');
        }}
      >
        <Scissors /> Split wall at its middle
      </Button>
    </div>
  );
}

function WallConstraintsSection({ ctx }: { ctx: SelectionContext }) {
  const w = singleWall(ctx)!;
  const c: WallConstraints = w.constraints ?? {};
  const g = roomGeometry(ctx.project.room);
  const set = (next: WallConstraints) => flashIfRefused(dispatch({ type: 'room.setWallConstraints', payload: { wallId: w.id, constraints: next } }));
  const toggle = (key: 'horizontal' | 'vertical' | 'lockLength' | 'lockAngle', v: boolean) => {
    const next: WallConstraints = { ...c, [key]: v || undefined };
    if (v && key === 'horizontal') delete next.vertical;
    if (v && key === 'vertical') delete next.horizontal;
    for (const k of Object.keys(next) as Array<keyof WallConstraints>) if (next[k] === undefined) delete next[k];
    set(next);
  };
  const others = ctx.project.room.walls
    .map((x, i) => ({ value: x.id, label: `${wallLetter(i)} · ${g.walls[i]?.name ?? ''}` }))
    .filter((o) => o.value !== w.id);
  const row = (label: string, key: 'horizontal' | 'vertical' | 'lockLength' | 'lockAngle', hint: string) => (
    <div className="flex items-center justify-between py-0.5">
      <Tip content={hint} side="left">
        <label htmlFor={`wc-${key}`} className="text-xs text-ink-muted">
          {label}
        </label>
      </Tip>
      <Switch id={`wc-${key}`} checked={!!c[key]} onCheckedChange={(v) => toggle(key, v)} data-testid={`wall-constraint-${key}`} />
    </div>
  );
  const relation = (label: string, key: 'parallelTo' | 'perpendicularTo') => (
    <PropRow label={label}>
      <Select
        className="h-7"
        ariaLabel={label}
        value={c[key] ?? 'none'}
        onValueChange={(v) => {
          const next: WallConstraints = { ...c };
          if (v === 'none') delete next[key];
          else next[key] = v;
          set(next);
        }}
        options={[{ value: 'none', label: 'No' }, ...others]}
      />
    </PropRow>
  );
  return (
    <div>
      {row('Horizontal (east–west)', 'horizontal', 'Keep this wall running exactly east–west')}
      {row('Vertical (north–south)', 'vertical', 'Keep this wall running exactly north–south')}
      {row('Lock length', 'lockLength', 'Keep the current length when other corners move')}
      {row('Lock angle', 'lockAngle', 'Keep the current direction when other corners move')}
      {relation('Parallel to', 'parallelTo')}
      {relation('Perpendicular', 'perpendicularTo')}
      <p className="mt-1 text-2xs text-ink-faint">Constraints are kept when you drag corners. Edits that would break one are refused with an explanation.</p>
    </div>
  );
}

const MATERIALS = ['Drywall', 'Concrete', 'Concrete block', 'Brick', 'OSB / plywood', 'Wood siding', 'Metal'];

function WallAppearance({ ctx }: { ctx: SelectionContext }) {
  const w = singleWall(ctx)!;
  return (
    <div className="space-y-1">
      <PropRow label="Material">
        <Select
          className="h-7"
          ariaLabel="Wall material"
          value={w.material && MATERIALS.includes(w.material) ? w.material : w.material ? 'other' : 'none'}
          onValueChange={(v) => (v === 'none' ? updateWall(w.id, {}, ['material']) : v !== 'other' && updateWall(w.id, { material: v }))}
          options={[{ value: 'none', label: 'Not set' }, ...MATERIALS.map((m) => ({ value: m, label: m })), ...(w.material && !MATERIALS.includes(w.material) ? [{ value: 'other', label: w.material }] : [])]}
        />
      </PropRow>
      <PropRow label="Color">
        <div className="flex items-center gap-2">
          <input type="color" aria-label="Wall color" className="h-7 w-10 cursor-pointer rounded border border-line bg-transparent" value={w.color ?? '#3b4046'} onChange={(e) => updateWall(w.id, { color: e.target.value })} />
          {w.color && (
            <Button size="sm" variant="ghost" onClick={() => updateWall(w.id, {}, ['color'])}>
              Reset
            </Button>
          )}
        </div>
      </PropRow>
      <Textarea key={`wnotes-${w.id}`} className="mt-1 text-xs" placeholder="Notes (studs, outlets, what's behind it…)" aria-label="Wall notes" defaultValue={w.notes} onBlur={(e) => e.target.value !== w.notes && updateWall(w.id, { notes: e.target.value })} />
    </div>
  );
}

const isWall = (c: SelectionContext) => !!singleWall(c);
inspectorSections.register({ id: 'wall.identity', title: 'Wall', order: 10, appliesTo: isWall, component: WallIdentity });
inspectorSections.register({ id: 'wall.geometry', title: 'Dimensions', order: 20, appliesTo: isWall, component: WallGeometry });
inspectorSections.register({ id: 'wall.constraints', title: 'Constraints', order: 25, appliesTo: isWall, component: WallConstraintsSection });
inspectorSections.register({ id: 'wall.appearance', title: 'Material, color & notes', order: 30, appliesTo: isWall, component: WallAppearance });

// ───────────── corner inspector ─────────────

function CornerSection({ ctx }: { ctx: SelectionContext }) {
  const room = ctx.project.room;
  const i = room.vertices.findIndex((v) => v.id === ctx.single!.id);
  const v = room.vertices[i]!;
  const angle = interiorAngles(roomGeometry(room).polygon)[i] ?? 90;
  const move = (x: number, y: number) => flashIfRefused(dispatch({ type: 'room.moveVertex', payload: { vertexId: v.id, x, y } }));
  return (
    <div className="space-y-1">
      <p className="text-xs text-ink-muted">Between walls {wallLetter((i - 1 + room.vertices.length) % room.vertices.length)} and {wallLetter(i)}.</p>
      <div className="grid grid-cols-2 gap-x-2">
        <PropRow label="X">
          <LengthInput aria-label="Corner X" value={v.x} allowNegative onCommit={(x) => move(x, v.y)} data-testid="vertex-x" />
        </PropRow>
        <PropRow label="Y">
          <LengthInput aria-label="Corner Y" value={v.y} allowNegative onCommit={(y) => move(v.x, y)} data-testid="vertex-y" />
        </PropRow>
      </div>
      <PropRow label="Angle">
        <AngleInput aria-label="Interior corner angle" value={angle} onCommit={(a) => a > 0 && flashIfRefused(dispatch({ type: 'room.setCornerAngle', payload: { vertexId: v.id, angle: a } }))} />
      </PropRow>
      <Button
        size="sm"
        variant="outline"
        disabled={room.vertices.length <= 3}
        onClick={() => {
          const r = dispatch({ type: 'room.deleteVertex', payload: { vertexId: v.id } });
          if (r.ok) uiActions.clearSelection();
          else uiActions.flash(r.error, 'error');
        }}
      >
        <Trash2 /> Remove corner
      </Button>
    </div>
  );
}
inspectorSections.register({ id: 'vertex.position', title: 'Corner', order: 10, appliesTo: (c) => c.single?.kind === 'vertex', component: CornerSection });

// ───────────── palette ─────────────

paletteCommands.register({ id: 'room.draw', title: 'Draw walls', section: 'Room', icon: PenLine, shortcut: 'w', keywords: ['outline', 'room'], when: (c) => !!c.project, run: () => uiActions.setTool('wall') });
paletteCommands.register({ id: 'room.template', title: 'Room from a template…', section: 'Room', icon: Shapes, keywords: ['rectangle', 'l-shaped', 't-shaped', 'two-car', 'three-car', 'garage'], when: (c) => !!c.project, run: () => editorActions.openDialog('room-template') });
paletteCommands.register({ id: 'room.lengths', title: 'Room from wall lengths…', section: 'Room', icon: Ruler, keywords: ['dimensions', 'measure'], when: (c) => !!c.project, run: () => editorActions.openDialog('room-lengths') });
paletteCommands.register({ id: 'room.panel', title: 'Edit walls (Room panel)', section: 'Room', icon: SquareDashed, when: (c) => !!c.project, run: () => uiActions.setLeftSection('room') });
