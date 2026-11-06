/**
 * Editable list of clearance zones (kind, label, shape: side band / all-around margin / rectangle,
 * depth, extension, shared). Used by the object inspector and the custom object dialog.
 */
import { AlertTriangle, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { LengthInput } from '@/components/LengthInput';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Input, Select, Switch, Tip } from '@/components/ui';
import { CLEARANCE_KINDS, type ClearanceKind, type ClearanceZone } from '@/domain/schema';
import { inches } from '@/domain/units';
import { cn } from '@/utils/cn';
import { KIND_LABEL, ZONE_PRESETS, zoneGroup } from './presets';

export interface ZoneStatus {
  blocked: boolean;
  text: string;
}

type Shape = ClearanceZone['shape'];

/** One labelled length cell. Labels stay short so two fit side by side in the 288 px inspector. */
function DimField({ label, tip, children }: { label: string; tip: string; children: ReactNode }) {
  return (
    <Tip content={tip}>
      <label className="flex min-w-0 items-center gap-1 text-2xs text-ink-muted">
        <span className="shrink-0">{label}</span>
        <span className="min-w-0 flex-1">{children}</span>
      </label>
    </Tip>
  );
}

/** The "which side" chooser: only the side shape has one; it sits next to the shape select. */
function ShapeInline({ shape, onChange, name }: { shape: Shape; onChange(s: Shape): void; name: string }) {
  if (shape.type !== 'side') return null;
  return (
    <Select
      className="h-7 min-w-0 flex-1"
      ariaLabel={`${name} side`}
      value={shape.side}
      onValueChange={(v) => onChange({ ...shape, side: v as typeof shape.side })}
      options={['front', 'back', 'left', 'right'].map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) }))}
    />
  );
}

/**
 * The shape's measurements, on their own row. Every field is a min-w-0 cell so a row never
 * overflows the inspector (at most two length inputs per line).
 */
function ShapeDims({ shape, onChange, name }: { shape: Shape; onChange(s: Shape): void; name: string }) {
  if (shape.type === 'side') {
    return (
      <div className="grid min-w-0 grid-cols-2 gap-1">
        <DimField label="Out" tip="Depth: how far the zone reaches out from that side">
          <LengthInput aria-label={`${name} depth`} value={shape.depth} allowZero={false} onCommit={(depth) => onChange({ ...shape, depth })} />
        </DimField>
        <DimField label="Past" tip="Extend past both ends of the side">
          <LengthInput aria-label={`${name} extension`} value={shape.extend ?? 0} onCommit={(extend) => onChange({ ...shape, extend })} />
        </DimField>
      </div>
    );
  }
  if (shape.type === 'around') {
    return (
      <div className="grid min-w-0 grid-cols-2 gap-1">
        <DimField label="All round" tip="Margin kept clear on every side">
          <LengthInput aria-label={`${name} margin`} value={shape.margin} allowZero={false} onCommit={(margin) => onChange({ ...shape, margin })} />
        </DimField>
      </div>
    );
  }
  if (shape.type === 'rect') {
    return (
      <div className="grid min-w-0 grid-cols-2 gap-1">
        <DimField label="X" tip="Rectangle center, left–right from the object's center">
          <LengthInput aria-label={`${name} center x`} value={shape.x} allowNegative onCommit={(x) => onChange({ ...shape, x })} />
        </DimField>
        <DimField label="Y" tip="Rectangle center, front–back from the object's center">
          <LengthInput aria-label={`${name} center y`} value={shape.y} allowNegative onCommit={(y) => onChange({ ...shape, y })} />
        </DimField>
        <DimField label="W" tip="Rectangle width">
          <LengthInput aria-label={`${name} width`} value={shape.width} allowZero={false} onCommit={(width) => onChange({ ...shape, width })} />
        </DimField>
        <DimField label="D" tip="Rectangle depth">
          <LengthInput aria-label={`${name} depth`} value={shape.depth} allowZero={false} onCommit={(depth) => onChange({ ...shape, depth })} />
        </DimField>
      </div>
    );
  }
  return <p className="text-2xs text-ink-faint">Custom outline with {shape.points.length} corners.</p>;
}

function convert(shape: Shape, to: 'side' | 'around' | 'rect'): Shape {
  if (shape.type === to) return shape;
  const d = shape.type === 'side' ? shape.depth : shape.type === 'around' ? shape.margin : inches(24);
  if (to === 'side') return { type: 'side', side: 'front', depth: d };
  if (to === 'around') return { type: 'around', margin: d };
  return { type: 'rect', x: 0, y: 0, width: d, depth: d };
}

export function ZoneListEditor({ zones, onChange, statuses, testId }: { zones: readonly ClearanceZone[]; onChange(z: ClearanceZone[]): void; statuses?: ReadonlyMap<string, ZoneStatus>; testId?: string }) {
  const set = (i: number, patch: Partial<ClearanceZone>) => onChange(zones.map((z, k) => (k === i ? { ...z, ...patch } : z)));
  return (
    <div className="space-y-2" data-testid={testId}>
      {zones.length === 0 && <p className="text-2xs text-ink-faint">No working clearances. Add the space this item needs around it to be used.</p>}
      {zones.map((z, i) => {
        const st = statuses?.get(z.id);
        const name = z.label || KIND_LABEL[z.kind];
        return (
          <div key={z.id} className={cn('min-w-0 space-y-1 rounded-md border p-1.5', st?.blocked ? 'border-warn/60 bg-warn/5' : 'border-line')} data-testid="zone-row">
            <div className="flex min-w-0 items-center gap-1">
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-sm border"
                style={zoneGroup(z) === 'maintenance' ? { background: 'repeating-linear-gradient(45deg,#8a7cc455 0 2px,transparent 2px 5px)', borderColor: '#8a7cc4' } : { background: 'repeating-linear-gradient(-45deg,#e08a2e55 0 2px,transparent 2px 5px)', borderColor: '#e08a2e' }}
              />
              <Select className="h-7 w-24 shrink-0" ariaLabel={`Zone ${i + 1} kind`} value={z.kind} onValueChange={(v) => set(i, { kind: v as ClearanceKind })} options={CLEARANCE_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
              <Input
                key={`${z.id}-${z.label ?? ''}`}
                aria-label={`Zone ${i + 1} label`}
                className="h-7 min-w-0 flex-1"
                defaultValue={z.label ?? ''}
                placeholder={KIND_LABEL[z.kind]}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (z.label ?? '')) set(i, { label: v || undefined });
                }}
              />
              <Tip content="Remove this zone">
                <Button size="icon-sm" variant="ghost" className="shrink-0" aria-label={`Remove ${name} zone`} onClick={() => onChange(zones.filter((_, k) => k !== i))}>
                  <Trash2 />
                </Button>
              </Tip>
            </div>
            <div className="flex min-w-0 items-center gap-1">
              <Select
                className="h-7 w-24 shrink-0"
                ariaLabel={`Zone ${i + 1} shape`}
                value={z.shape.type === 'polygon' ? 'rect' : z.shape.type}
                onValueChange={(v) => set(i, { shape: convert(z.shape, v as 'side' | 'around' | 'rect') })}
                options={[
                  { value: 'side', label: 'One side' },
                  { value: 'around', label: 'All around' },
                  { value: 'rect', label: 'Rectangle' },
                ]}
              />
              <ShapeInline shape={z.shape} name={name} onChange={(shape) => set(i, { shape })} />
            </div>
            <ShapeDims shape={z.shape} name={name} onChange={(shape) => set(i, { shape })} />
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <label className="flex min-w-0 items-center gap-1.5 text-2xs leading-snug text-ink-muted">
                <span className="shrink-0">
                  <Switch checked={z.sharable} onCheckedChange={(v) => set(i, { sharable: v })} aria-label={`${name} can overlap other zones`} />
                </span>
                <span className="min-w-0">May overlap other items' zones</span>
              </label>
              {st && (
                <span className={cn('flex shrink-0 items-center gap-1 text-2xs', st.blocked ? 'text-warn' : 'text-ok')}>
                  {st.blocked ? <AlertTriangle className="size-3" /> : <CheckCircle2 className="size-3" />}
                  {st.blocked ? 'Blocked' : 'Clear'}
                </span>
              )}
            </div>
            {st?.blocked && <p className="text-2xs leading-snug text-ink-muted">{st.text}</p>}
          </div>
        );
      })}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" data-testid="add-zone">
            <Plus /> Add clearance zone
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64">
          {ZONE_PRESETS.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => onChange([...zones, p.make()])}>
              {p.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
