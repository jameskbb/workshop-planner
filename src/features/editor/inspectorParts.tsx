/**
 * Reusable inspector building blocks: flag switches, notes, color, wall-hosted / free placement
 * fields. Use them in `inspectorSections` components so every entity's inspector feels the same.
 */
import { useId } from 'react';
import { PropRow } from '@/components/shell';
import { AngleInput, LengthInput } from '@/components/LengthInput';
import { Button, Input, Select, Switch, Textarea } from '@/components/ui';
import { resolvePlacement, roomGeometry } from '@/domain/resolve';
import { wallLetter } from '@/domain/roomEdit';
import type { Placement, Room } from '@/domain/schema';
import { quantize } from '@/domain/units';
import { useFormatters } from '@/hooks/useFormatters';

export function SwitchRow({ label, checked, onChange, testId, hint }: { label: string; checked: boolean; onChange(v: boolean): void; testId?: string; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between py-0.5" title={hint}>
      <label htmlFor={id} className="text-xs text-ink-muted">
        {label}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} data-testid={testId} />
    </div>
  );
}

export function NameField({ value, onCommit, testId, placeholder, label = 'Name' }: { value: string; onCommit(v: string): void; testId?: string; placeholder?: string; label?: string }) {
  const id = useId();
  return (
    <PropRow label={label} htmlFor={id}>
      <Input
        id={id}
        key={value}
        defaultValue={value}
        placeholder={placeholder}
        data-testid={testId}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v !== value && (v || placeholder !== undefined)) onCommit(v);
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    </PropRow>
  );
}

export function NotesField({ value, onCommit, placeholder = 'Notes…' }: { value: string; onCommit(v: string): void; placeholder?: string }) {
  return <Textarea key={value} className="mt-1 text-xs" placeholder={placeholder} aria-label="Notes" defaultValue={value} onBlur={(e) => e.target.value !== value && onCommit(e.target.value)} />;
}

export function ColorField({ value, fallback, onChange, onReset, label = 'Color' }: { value?: string; fallback: string; onChange(hex: string): void; onReset(): void; label?: string }) {
  return (
    <PropRow label={label}>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={label} className="h-7 w-10 cursor-pointer rounded border border-line bg-transparent" value={value ?? fallback} onChange={(e) => onChange(e.target.value)} />
        {value ? (
          <Button size="sm" variant="ghost" onClick={onReset}>
            Default color
          </Button>
        ) : (
          <span className="text-2xs text-ink-faint">Category color</span>
        )}
      </div>
    </PropRow>
  );
}

/**
 * Where a fixture sits: on a wall (wall picker + exact distance from the wall's start corner to the
 * item's center, plus the gaps to each end) or free (X / Y / rotation).
 */
export function PlacementFields({ room, placement, width, depth, onChange, allowFree = true, freeRotation = true }: { room: Room; placement: Placement; width: number; depth: number; onChange(p: Placement): void; allowFree?: boolean; freeRotation?: boolean }) {
  const fmt = useFormatters();
  const g = roomGeometry(room);
  const wallOptions = room.walls.map((w, i) => ({ value: w.id, label: `${wallLetter(i)} · ${g.walls[i]?.name ?? ''}` }));
  const { pose } = resolvePlacement(room, placement, width, depth);
  const mode = (
    <PropRow label="Mounted">
      <Select
        className="h-7"
        ariaLabel="Mounting"
        value={placement.type === 'wall' ? placement.wallId : 'free'}
        onValueChange={(v) => {
          if (v === 'free') onChange({ type: 'free', x: quantize(pose.x), y: quantize(pose.y), rotation: pose.rotation });
          else {
            const i = g.wallIndex.get(v)!;
            const L = g.walls[i]!.length;
            onChange({ type: 'wall', wallId: v, offset: quantize(Math.min(Math.max(width / 2, L / 2), L)) });
          }
        }}
        options={[...wallOptions, ...(allowFree ? [{ value: 'free', label: 'Free-standing' }] : [])]}
      />
    </PropRow>
  );
  if (placement.type === 'wall') {
    const i = g.wallIndex.get(placement.wallId);
    const wall = i === undefined ? undefined : g.walls[i];
    const L = wall?.length ?? 0;
    const startGap = placement.offset - width / 2;
    const endGap = L - placement.offset - width / 2;
    return (
      <div className="space-y-1">
        {mode}
        <PropRow label="From start">
          <LengthInput aria-label={`Gap from the start of the wall (corner ${wallLetter(i ?? 0)}) to the item`} value={startGap} allowNegative onCommit={(v) => onChange({ ...placement, offset: quantize(v + width / 2) })} data-testid="placement-start-gap" />
        </PropRow>
        <PropRow label="To end">
          <LengthInput aria-label="Gap from the item to the end of the wall" value={endGap} allowNegative onCommit={(v) => onChange({ ...placement, offset: quantize(L - v - width / 2) })} />
        </PropRow>
        {(startGap < -0.5 || endGap < -0.5) && <p className="text-2xs text-warn">It extends past the end of the {wall?.name ?? 'wall'} by {fmt.length(-Math.min(startGap, endGap))}.</p>}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {mode}
      <div className="grid grid-cols-2 gap-x-2">
        <PropRow label="X">
          <LengthInput aria-label="X position" value={placement.x} allowNegative onCommit={(x) => onChange({ ...placement, x })} data-testid="placement-x" />
        </PropRow>
        <PropRow label="Y">
          <LengthInput aria-label="Y position" value={placement.y} allowNegative onCommit={(y) => onChange({ ...placement, y })} data-testid="placement-y" />
        </PropRow>
      </div>
      {freeRotation && (
        <PropRow label="Rotation">
          <AngleInput aria-label="Rotation" value={placement.rotation} onCommit={(rotation) => onChange({ ...placement, rotation })} />
        </PropRow>
      )}
    </div>
  );
}
