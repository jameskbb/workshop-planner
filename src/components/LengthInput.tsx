/**
 * Exact numeric entry for lengths and angles. Accepts every supported syntax (48", 4' 6",
 * 4 ft 6 in, 1372 mm…), commits on Enter/blur, reverts on Escape, and explains invalid input
 * inline instead of silently ignoring it. ↑/↓ nudge by one grid-ish step (Shift = ×10).
 */
import { useEffect, useId, useRef, useState } from 'react';
import { parseAngle } from '@/domain/units';
import { useFormatters } from '@/hooks/useFormatters';
import { cn } from '@/utils/cn';
import { inputClass } from '@/components/ui';

interface BaseProps {
  id?: string;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
  'data-testid'?: string;
}

export interface LengthInputProps extends BaseProps {
  /** Millimeters. */
  value: number;
  onCommit(mm: number): void;
  allowNegative?: boolean;
  allowZero?: boolean;
  /** Arrow-key step in mm (default 1" in imperial, 10 mm in metric). */
  step?: number;
}

function useEditableText(display: string) {
  const [text, setText] = useState(display);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(display);
  }, [display, editing]);
  return { text, setText, editing, setEditing };
}

export function LengthInput({ value, onCommit, allowNegative, allowZero = true, step, className, ...rest }: LengthInputProps) {
  const fmt = useFormatters();
  const display = fmt.length(value);
  const { text, setText, setEditing } = useEditableText(display);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const ref = useRef<HTMLInputElement>(null);
  const stepMm = step ?? (fmt.system === 'imperial' ? 25.4 : 10);

  const commit = () => {
    setEditing(false);
    if (text.trim() === display) {
      setError(null);
      return;
    }
    const r = fmt.parse(text, { allowNegative, allowZero });
    if (!r.ok) {
      setError(r.error);
      setEditing(true);
      return;
    }
    setError(null);
    if (r.mm !== value) onCommit(r.mm);
    setText(fmt.length(r.mm));
  };

  return (
    <div className="relative">
      <input
        ref={ref}
        {...rest}
        type="text"
        inputMode="decimal"
        spellCheck={false}
        autoComplete="off"
        className={cn(inputClass, 'num', className)}
        value={text}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onFocus={(e) => {
          setEditing(true);
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            ref.current?.blur();
          } else if (e.key === 'Escape') {
            setText(display);
            setError(null);
            setEditing(false);
            ref.current?.blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const delta = (e.key === 'ArrowUp' ? 1 : -1) * stepMm * (e.shiftKey ? 10 : 1);
            const next = value + delta;
            if ((next > 0 || (allowZero && next === 0) || allowNegative) && Number.isFinite(next)) {
              onCommit(Math.round(next * 100) / 100);
            }
          }
        }}
      />
      {error && (
        <div id={errorId} role="alert" className="absolute left-0 right-0 top-full z-10 mt-1 rounded border border-danger/50 bg-panel-3 px-2 py-1 text-2xs text-danger shadow-lg">
          {error}
        </div>
      )}
    </div>
  );
}

export interface AngleInputProps extends BaseProps {
  value: number;
  onCommit(deg: number): void;
}

export function AngleInput({ value, onCommit, className, ...rest }: AngleInputProps) {
  const fmt = useFormatters();
  const display = fmt.angle(value);
  const { text, setText, setEditing } = useEditableText(display);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const commit = () => {
    setEditing(false);
    if (text.trim() === display) return;
    const r = parseAngle(text);
    if (!r.ok) {
      setError(r.error);
      setEditing(true);
      return;
    }
    setError(null);
    const deg = ((r.degrees % 360) + 360) % 360;
    if (deg !== value) onCommit(deg);
    setText(fmt.angle(deg));
  };
  return (
    <div className="relative">
      <input
        ref={ref}
        {...rest}
        type="text"
        inputMode="decimal"
        className={cn(inputClass, 'num', className)}
        value={text}
        aria-invalid={error ? true : undefined}
        onFocus={(e) => {
          setEditing(true);
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            ref.current?.blur();
          } else if (e.key === 'Escape') {
            setText(display);
            setError(null);
            setEditing(false);
            ref.current?.blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const d = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 15 : 1);
            onCommit((((value + d) % 360) + 360) % 360);
          }
        }}
      />
      {error && <div role="alert" className="absolute left-0 right-0 top-full z-10 mt-1 rounded border border-danger/50 bg-panel-3 px-2 py-1 text-2xs text-danger">{error}</div>}
    </div>
  );
}
