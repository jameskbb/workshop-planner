/**
 * Clearance-zone presets and labels (pure) shared by the inspector's zone editor and the custom
 * object dialog.
 */
import { clearanceOverlayGroup, type ClearanceKind, type ClearanceZone } from '@/domain/schema';
import { inches } from '@/domain/units';
import { newId } from '@/utils/id';

export const KIND_LABEL: Record<ClearanceKind, string> = {
  operator: 'Operator',
  infeed: 'Infeed',
  outfeed: 'Outfeed',
  side: 'Side',
  operational: 'Working',
  maintenance: 'Maintenance',
  access: 'Access',
};

export interface ZonePreset {
  id: string;
  label: string;
  make(): ClearanceZone;
}

const side = (kind: ClearanceKind, s: 'front' | 'back' | 'left' | 'right', depthIn: number, label: string): ZonePreset => ({
  id: `${kind}-${s}-${depthIn}`,
  label: `${label} (${s}, ${depthIn}″)`,
  make: () => ({ id: newId(), kind, label, shape: { type: 'side', side: s, depth: inches(depthIn) }, sharable: true }),
});

export const ZONE_PRESETS: ZonePreset[] = [
  side('operator', 'front', 36, 'Operator'),
  side('infeed', 'front', 96, 'Infeed'),
  side('outfeed', 'back', 96, 'Outfeed'),
  side('side', 'left', 24, 'Left side'),
  side('side', 'right', 24, 'Right side'),
  side('access', 'front', 30, 'Access'),
  {
    id: 'maintenance-around-24',
    label: 'Maintenance (all around, 24″)',
    make: () => ({ id: newId(), kind: 'maintenance', label: 'Maintenance', shape: { type: 'around', margin: inches(24) }, sharable: true }),
  },
];

export const zoneGroup = (z: ClearanceZone): 'operational' | 'maintenance' => clearanceOverlayGroup(z.kind);

export function zoneTitle(z: ClearanceZone): string {
  return z.label || KIND_LABEL[z.kind];
}
