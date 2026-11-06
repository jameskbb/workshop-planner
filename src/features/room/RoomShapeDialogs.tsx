/**
 * Room shape pickers: template picker (rectangle, L, T, two-car, three-car) and the "type your wall
 * lengths" builder (Method 2). Both render live previews and are reused by the New Project wizard.
 */
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Label, Select, Switch } from '@/components/ui';
import { roomProblem, wallLetter } from '@/domain/roomEdit';
import { outlineFromWalls, ROOM_TEMPLATES, templateDefaults, type RoomTemplate, type RoomTemplateId, type TemplateOpening } from '@/domain/roomTemplates';
import { makeFormatters, type Formatters } from '@/hooks/useFormatters';
import { bbox, distance, type Point } from '@/geometry';
import { useProjectStore } from '@/stores/projectStore';
import { editorActions, useEditorStore } from '@/stores/editorStore';
import { cn } from '@/utils/cn';
import { applyOutline } from './build';

// ───────────── preview ─────────────

export function OutlinePreview({ points, openings = [], fmt, className, labels = true }: { points: readonly Point[]; openings?: readonly TemplateOpening[]; fmt: Formatters; className?: string; labels?: boolean }) {
  if (points.length < 2) return <div className={cn('grid place-items-center text-2xs text-ink-faint', className)}>No outline yet</div>;
  const b = bbox(points);
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const pad = Math.max(w, h) * 0.16;
  const vb = `${b.minX - pad} ${b.minY - pad} ${w + pad * 2} ${h + pad * 2}`;
  const sw = Math.max(w, h) / 120;
  const font = Math.max(w, h) / 13;
  const closed = points.length >= 3;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ') + (closed ? ' Z' : '');
  return (
    <svg viewBox={vb} className={cn('h-44 w-full', className)} role="img" aria-label="Room outline preview">
      <path d={path} fill={closed ? 'rgba(255,255,255,0.06)' : 'none'} stroke="currentColor" strokeWidth={sw * 2} strokeLinejoin="round" className="text-ink" />
      {openings.map((o, i) => {
        const a = points[o.wallIndex];
        const c = points[(o.wallIndex + 1) % points.length];
        if (!a || !c) return null;
        const L = distance(a, c);
        const t0 = (o.offset - o.width / 2) / L;
        const t1 = (o.offset + o.width / 2) / L;
        return <line key={i} x1={a.x + (c.x - a.x) * t0} y1={a.y + (c.y - a.y) * t0} x2={a.x + (c.x - a.x) * t1} y2={a.y + (c.y - a.y) * t1} stroke="#ff7a1a" strokeWidth={sw * 4} />;
      })}
      {labels &&
        points.map((p, i) => {
          const q = points[(i + 1) % points.length]!;
          if (!closed && i === points.length - 1) return null;
          return (
            <text key={i} x={(p.x + q.x) / 2} y={(p.y + q.y) / 2} fontSize={font} textAnchor="middle" dominantBaseline="middle" className="fill-ink-muted" style={{ paintOrder: 'stroke' }} stroke="var(--color-panel, #1b1e22)" strokeWidth={font / 4}>
              {wallLetter(i)} {fmt.length(distance(p, q))}
            </text>
          );
        })}
    </svg>
  );
}

// ───────────── template picker ─────────────

export interface TemplateChoice {
  id: RoomTemplateId;
  params: Record<string, number>;
  includeOpenings: boolean;
}

export function buildTemplate(choice: TemplateChoice): { points: Point[]; openings: TemplateOpening[]; error: string | null } {
  const t = ROOM_TEMPLATES.find((x) => x.id === choice.id)!;
  const err = t.validate?.(choice.params) ?? null;
  const { points, openings } = t.build(choice.params);
  return { points, openings: choice.includeOpenings ? openings : [], error: err ?? roomProblem(points) };
}

function ParamInput({ label, hint, value, fmt, onChange, testId }: { label: string; hint?: string; value: number; fmt: Formatters; onChange(mm: number): void; testId?: string }) {
  const [text, setText] = useState(fmt.length(value));
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <Label className="text-2xs text-ink-muted">{label}</Label>
      <input
        className={cn('num mt-0.5 h-7 w-full rounded border bg-panel-2 px-2 text-xs text-ink outline-none focus:border-select', err ? 'border-danger' : 'border-line')}
        value={text}
        title={hint}
        aria-label={label}
        data-testid={testId}
        onChange={(e) => {
          setText(e.target.value);
          const r = fmt.parse(e.target.value, { allowZero: false });
          if (r.ok) {
            setErr(null);
            onChange(r.mm);
          } else setErr(r.error);
        }}
        onBlur={() => !err && setText(fmt.length(value))}
      />
      {err && <p className="mt-0.5 text-2xs text-danger">{err}</p>}
    </div>
  );
}

export function TemplatePicker({ value, onChange, fmt }: { value: TemplateChoice; onChange(v: TemplateChoice): void; fmt: Formatters }) {
  const t = ROOM_TEMPLATES.find((x) => x.id === value.id)!;
  const built = useMemo(() => buildTemplate(value), [value]);
  const select = (tpl: RoomTemplate) => onChange({ id: tpl.id, params: templateDefaults(tpl, fmt.system), includeOpenings: value.includeOpenings });
  return (
    <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
      <ul className="space-y-1" role="listbox" aria-label="Room templates">
        {ROOM_TEMPLATES.map((tpl) => (
          <li key={tpl.id}>
            <button
              type="button"
              role="option"
              aria-selected={tpl.id === value.id}
              onClick={() => select(tpl)}
              data-testid={`template-${tpl.id}`}
              className={cn('flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs', tpl.id === value.id ? 'border-select bg-select/15 text-ink' : 'border-line text-ink-muted hover:bg-panel-2')}
            >
              <OutlinePreview points={tpl.build(templateDefaults(tpl, 'imperial')).points} fmt={fmt} labels={false} className="h-8 w-10 shrink-0" />
              {tpl.name}
            </button>
          </li>
        ))}
      </ul>
      <div className="space-y-2">
        <p className="text-2xs text-ink-muted">{t.description}</p>
        <div className="grid grid-cols-2 gap-2">
          {t.params.map((p) => (
            <ParamInput
              key={`${t.id}-${p.key}`}
              label={p.label}
              hint={p.hint}
              value={value.params[p.key]!}
              fmt={fmt}
              testId={`template-param-${p.key}`}
              onChange={(mm) => onChange({ ...value, params: { ...value.params, [p.key]: mm } })}
            />
          ))}
        </div>
        {t.build(value.params).openings.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <Switch checked={value.includeOpenings} onCheckedChange={(v) => onChange({ ...value, includeOpenings: v })} aria-label="Include garage doors" />
            Add the garage door{t.build(value.params).openings.length > 1 ? 's' : ''}
          </label>
        )}
        <div className="rounded-md border border-line bg-panel-2 p-2">
          <OutlinePreview points={built.points} openings={built.openings} fmt={fmt} />
        </div>
        {built.error && (
          <p role="alert" className="text-2xs text-danger">
            {built.error}
          </p>
        )}
        <p className="text-2xs text-ink-faint">Every wall stays editable afterwards: drag corners, type exact lengths, add or remove corners.</p>
      </div>
    </div>
  );
}

// ───────────── wall-lengths builder ─────────────

export interface WallRow {
  length: string;
  turn: string;
}

const TURNS = [
  { value: '90', label: 'Right 90°' },
  { value: '-90', label: 'Left 90°' },
  { value: '45', label: 'Right 45°' },
  { value: '-45', label: 'Left 45°' },
  { value: '0', label: 'Straight' },
  { value: '135', label: 'Right 135°' },
  { value: '-135', label: 'Left 135°' },
];

export function buildFromRows(rows: readonly WallRow[], closeAuto: boolean, startBearing: number, fmt: Formatters): { points: Point[]; error: string | null; closing?: number } {
  const walls: Array<{ length: number; turn: number }> = [];
  for (const [i, r] of rows.entries()) {
    if (!r.length.trim()) continue;
    const p = fmt.parse(r.length, { allowZero: false });
    if (!p.ok) return { points: [], error: `Wall ${wallLetter(i)}: ${p.error}` };
    walls.push({ length: p.mm, turn: Number(r.turn) || 0 });
  }
  if (walls.length === 0) return { points: [], error: 'Type the first wall length.' };
  const o = outlineFromWalls(walls, { startDirection: startBearing - 90, close: closeAuto });
  if (o.points.length < 3) return { points: o.points, error: 'Add at least three walls.' };
  if (!closeAuto && o.closingGap >= 0.5) return { points: o.points, error: `The walls don't meet: the last corner is ${fmt.length(o.closingGap)} from the start. Adjust a length or turn on "Close automatically".` };
  const err = roomProblem(o.points);
  return { points: o.points, error: err, closing: o.closingLength };
}

export function WallLengthsEditor({ rows, setRows, closeAuto, setCloseAuto, fmt }: { rows: WallRow[]; setRows(r: WallRow[]): void; closeAuto: boolean; setCloseAuto(v: boolean): void; fmt: Formatters }) {
  const built = useMemo(() => buildFromRows(rows, closeAuto, 90, fmt), [rows, closeAuto, fmt]);
  const update = (i: number, patch: Partial<WallRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
      <div className="space-y-1">
        <p className="text-2xs text-ink-muted">Walk the room clockwise starting at the northwest corner, heading east. Type each wall's inside length and which way you turn at its end.</p>
        <ol className="space-y-1">
          {rows.map((r, i) => (
            <li key={i} className="flex items-center gap-1">
              <span className="w-12 shrink-0 text-2xs text-ink-muted">Wall {wallLetter(i)}</span>
              <input
                className="num h-7 w-24 rounded border border-line bg-panel-2 px-2 text-xs text-ink outline-none focus:border-select"
                value={r.length}
                placeholder={`21' 6"`}
                aria-label={`Wall ${wallLetter(i)} length`}
                data-testid={`wall-row-length-${i}`}
                onChange={(e) => update(i, { length: e.target.value })}
              />
              {i > 0 ? (
                <Select className="h-7 w-28" ariaLabel={`Turn before wall ${wallLetter(i)}`} value={r.turn} onValueChange={(v) => update(i, { turn: v })} options={TURNS} />
              ) : (
                <span className="w-28 text-2xs text-ink-faint">heading east</span>
              )}
              <Button size="icon-sm" variant="ghost" aria-label={`Remove wall ${wallLetter(i)}`} disabled={rows.length <= 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ol>
        <Button size="sm" variant="outline" onClick={() => setRows([...rows, { length: '', turn: '90' }])} data-testid="add-wall-row">
          <Plus /> Add wall
        </Button>
        <label className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
          <Switch checked={closeAuto} onCheckedChange={setCloseAuto} aria-label="Close automatically" />
          Close automatically (compute the last wall)
        </label>
      </div>
      <div className="space-y-1">
        <div className="rounded-md border border-line bg-panel-2 p-2">
          <OutlinePreview points={built.points} fmt={fmt} />
        </div>
        {built.closing !== undefined && !built.error && <p className="text-2xs text-ink-muted">Closing wall {wallLetter(built.points.length - 1)}: {fmt.length(built.closing)}</p>}
        {built.error && (
          <p role="alert" className="text-2xs text-danger">
            {built.error}
          </p>
        )}
      </div>
    </div>
  );
}

// ───────────── dialogs (opened via editorActions.openDialog) ─────────────

function useFmt(): Formatters {
  const settings = useProjectStore((s) => s.project?.settings ?? null);
  return useMemo(() => makeFormatters(settings), [settings]);
}

function TemplateDialog() {
  const fmt = useFmt();
  const [choice, setChoice] = useState<TemplateChoice>(() => ({ id: 'two-car', params: templateDefaults(ROOM_TEMPLATES[3]!, fmt.system), includeOpenings: true }));
  const built = buildTemplate(choice);
  return (
    <Dialog open onOpenChange={(o) => !o && editorActions.closeDialog()}>
      <DialogContent className="w-[min(94vw,760px)]">
        <DialogHeader>
          <DialogTitle>Room from a template</DialogTitle>
          <DialogDescription>Pick a shape and type its inside dimensions.</DialogDescription>
        </DialogHeader>
        <TemplatePicker value={choice} onChange={setChoice} fmt={fmt} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => editorActions.closeDialog()}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!!built.error}
            data-testid="apply-template"
            onClick={() => {
              editorActions.closeDialog();
              applyOutline(built.points, { label: `Room from template`, openings: built.openings });
            }}
          >
            Use this outline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WallLengthsDialog() {
  const fmt = useFmt();
  const [rows, setRows] = useState<WallRow[]>([
    { length: '', turn: '0' },
    { length: '', turn: '90' },
    { length: '', turn: '90' },
  ]);
  const [closeAuto, setCloseAuto] = useState(true);
  const built = buildFromRows(rows, closeAuto, 90, fmt);
  return (
    <Dialog open onOpenChange={(o) => !o && editorActions.closeDialog()}>
      <DialogContent className="w-[min(94vw,760px)]">
        <DialogHeader>
          <DialogTitle>Room from wall lengths</DialogTitle>
          <DialogDescription>Wall A: 21′ 6″, Wall B: 24′, Wall C: 3′ …; type what your tape measure says.</DialogDescription>
        </DialogHeader>
        <WallLengthsEditor rows={rows} setRows={setRows} closeAuto={closeAuto} setCloseAuto={setCloseAuto} fmt={fmt} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => editorActions.closeDialog()}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!!built.error}
            data-testid="apply-wall-lengths"
            onClick={() => {
              editorActions.closeDialog();
              applyOutline(built.points, { label: 'Room from wall lengths' });
            }}
          >
            Create outline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RoomDialogs() {
  const id = useEditorStore((s) => s.dialog?.id);
  if (id === 'room-template') return <TemplateDialog />;
  if (id === 'room-lengths') return <WallLengthsDialog />;
  return null;
}
