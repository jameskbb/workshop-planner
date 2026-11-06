import { ObjectDefinitionSchema, type ClearanceKind, type ClearanceZone, type ObjectDefinition, type ObjectDefinitionInput } from '@/domain/schema';
import { inches, lb } from '@/domain/units';

export const APPROXIMATE_NOTE =
  'Approximate typical size for this kind of item. Measure your own and override the dimensions.';

let zoneSeq = 0;
function zone(kind: ClearanceKind, shape: ClearanceZone['shape'], label?: string, sharable = true): ClearanceZone {
  return { id: `z${++zoneSeq}`, kind, shape, sharable, ...(label ? { label } : {}) };
}

/** Clearance band in front of the item (operator side), depth in inches. */
export const front = (depthIn: number, kind: ClearanceKind = 'operator', label?: string, extendIn = 0) =>
  zone(kind, { type: 'side', side: 'front', depth: inches(depthIn), ...(extendIn ? { extend: inches(extendIn) } : {}) }, label);
export const back = (depthIn: number, kind: ClearanceKind = 'outfeed', label?: string, extendIn = 0) =>
  zone(kind, { type: 'side', side: 'back', depth: inches(depthIn), ...(extendIn ? { extend: inches(extendIn) } : {}) }, label);
export const left = (depthIn: number, kind: ClearanceKind = 'side', label?: string) =>
  zone(kind, { type: 'side', side: 'left', depth: inches(depthIn) }, label);
export const right = (depthIn: number, kind: ClearanceKind = 'side', label?: string) =>
  zone(kind, { type: 'side', side: 'right', depth: inches(depthIn) }, label);
export const around = (marginIn: number, kind: ClearanceKind = 'maintenance', label?: string) =>
  zone(kind, { type: 'around', margin: inches(marginIn) }, label);

export interface LibraryItemInput extends Omit<ObjectDefinitionInput, 'width' | 'depth' | 'height' | 'weightKg' | 'defaultElevation' | 'source' | 'approximate'> {
  /** Width in inches (local x, left–right as seen from the front). */
  w: number;
  /** Depth in inches (local y, back–front). */
  d: number;
  /** Height in inches. */
  h: number;
  /** Weight in pounds. */
  lbs?: number;
  /** Bottom elevation in inches for wall-mounted items. */
  elevationIn?: number;
}

/** Build a validated built-in definition from inch-based data. */
export function item(input: LibraryItemInput): ObjectDefinition {
  const { w, d, h, lbs, elevationIn, notes, ...rest } = input;
  return ObjectDefinitionSchema.parse({
    ...rest,
    width: inches(w),
    depth: inches(d),
    height: inches(h),
    ...(lbs !== undefined ? { weightKg: lb(lbs) } : {}),
    ...(elevationIn !== undefined ? { defaultElevation: inches(elevationIn) } : {}),
    notes: notes ? `${notes} ${APPROXIMATE_NOTE}` : APPROXIMATE_NOTE,
    source: 'builtin',
    approximate: true,
  });
}
