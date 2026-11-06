import { useMemo } from 'react';
import { useProjectStore } from '@/stores/projectStore';
import { formatAngle, formatArea, formatLength, parseLength, type ParseLengthResult, type LengthUnit } from '@/domain/units';
import type { ProjectSettings } from '@/domain/schema';

export interface Formatters {
  system: 'imperial' | 'metric';
  length(mm: number, opts?: { style?: 'auto' | 'feet-inches' | 'inches' }): string;
  area(mm2: number): string;
  angle(deg: number): string;
  /** Parse user input with the project's default unit for bare numbers. */
  parse(text: string, opts?: { allowNegative?: boolean; allowZero?: boolean }): ParseLengthResult;
}

export function makeFormatters(settings: Pick<ProjectSettings, 'unitSystem' | 'imperialPrecision' | 'metricUnit'> | null): Formatters {
  const system = settings?.unitSystem ?? 'imperial';
  const precision = settings?.imperialPrecision ?? 16;
  const metricUnit = settings?.metricUnit ?? 'mm';
  const defaultUnit: LengthUnit = system === 'imperial' ? 'in' : metricUnit;
  return {
    system,
    length: (mm, opts) => formatLength(mm, { system, precision, metricUnit, imperialStyle: opts?.style }),
    area: (mm2) => formatArea(mm2, { system }),
    angle: (deg) => formatAngle(deg),
    parse: (text, opts) => parseLength(text, { defaultUnit, ...opts }),
  };
}

/** Unit-aware formatting/parsing for the open project's settings. */
export function useFormatters(): Formatters {
  const settings = useProjectStore((s) => s.project?.settings ?? null);
  const system = settings?.unitSystem;
  const precision = settings?.imperialPrecision;
  const metricUnit = settings?.metricUnit;
  return useMemo(
    () => makeFormatters(system ? { unitSystem: system, imperialPrecision: precision ?? 16, metricUnit: metricUnit ?? 'mm' } : null),
    [system, precision, metricUnit],
  );
}
