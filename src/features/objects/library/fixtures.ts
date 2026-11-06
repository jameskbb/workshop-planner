/**
 * Templates for fixed architecture, electrical points and light fixtures (approximate defaults).
 * Placement is supplied by the caller (wall-hosted or free).
 */
import type { ArchitectureKind, ArchitecturalFeatureInput, ElectricalKind, ElectricalPointInput, LightingFixture } from '@/domain/schema';
import { feetInches, inches } from '@/domain/units';

export interface ArchitectureTemplate {
  kind: ArchitectureKind;
  name: string;
  /** Hosted on a wall by default (doors, windows, panels…) or free-standing. */
  hosting: 'wall' | 'free';
  width: number;
  depth: number;
  height: number;
  elevation?: number;
  shape?: 'rect' | 'round';
  door?: ArchitecturalFeatureInput['door'];
  garageDoor?: ArchitecturalFeatureInput['garageDoor'];
}

export const ARCHITECTURE_TEMPLATES: readonly ArchitectureTemplate[] = [
  { kind: 'door', name: 'Entry door', hosting: 'wall', width: inches(36), depth: inches(5.5), height: inches(80), door: { swing: 'in', hinge: 'left', openAngle: 90 } },
  { kind: 'double-door', name: 'Double door', hosting: 'wall', width: inches(60), depth: inches(5.5), height: inches(80), door: { swing: 'out', hinge: 'left', openAngle: 90 } },
  {
    kind: 'garage-door',
    name: 'Garage door (16 ft)',
    hosting: 'wall',
    width: feetInches(16, 0),
    depth: inches(5.5),
    height: feetInches(7, 0),
    garageDoor: { openingHeight: feetInches(7, 0), trackLength: feetInches(8, 6), trackHeight: feetInches(7, 6), kind: 'sectional', state: 'closed' },
  },
  {
    kind: 'garage-door',
    name: 'Garage door (9 ft)',
    hosting: 'wall',
    width: feetInches(9, 0),
    depth: inches(5.5),
    height: feetInches(7, 0),
    garageDoor: { openingHeight: feetInches(7, 0), trackLength: feetInches(8, 6), trackHeight: feetInches(7, 6), kind: 'sectional', state: 'closed' },
  },
  { kind: 'window', name: 'Window', hosting: 'wall', width: inches(36), depth: inches(5.5), height: inches(36), elevation: inches(42) },
  { kind: 'support-pole', name: 'Support pole', hosting: 'free', width: inches(4), depth: inches(4), height: feetInches(9, 0), shape: 'round' },
  { kind: 'column', name: 'Column', hosting: 'free', width: inches(12), depth: inches(12), height: feetInches(9, 0) },
  { kind: 'stairs', name: 'Stairs', hosting: 'free', width: inches(36), depth: inches(120), height: feetInches(9, 0) },
  { kind: 'steps', name: 'Entry steps', hosting: 'wall', width: inches(48), depth: inches(30), height: inches(22) },
  { kind: 'utility-closet', name: 'Utility closet', hosting: 'wall', width: inches(48), depth: inches(30), height: feetInches(8, 0) },
  { kind: 'water-heater', name: 'Water heater', hosting: 'free', width: inches(22), depth: inches(22), height: inches(60), shape: 'round' },
  { kind: 'hvac', name: 'HVAC unit', hosting: 'free', width: inches(30), depth: inches(30), height: inches(48) },
  { kind: 'attic-ladder', name: 'Attic ladder', hosting: 'free', width: inches(22), depth: inches(54), height: inches(12), elevation: feetInches(8, 0) },
  { kind: 'permanent-shelving', name: 'Built-in shelving', hosting: 'wall', width: inches(96), depth: inches(16), height: inches(84) },
  { kind: 'sink', name: 'Utility sink', hosting: 'wall', width: inches(24), depth: inches(24), height: inches(36) },
  { kind: 'hose-bib', name: 'Hose bib', hosting: 'wall', width: inches(4), depth: inches(4), height: inches(4), elevation: inches(18) },
  { kind: 'wall-protrusion', name: 'Wall protrusion', hosting: 'wall', width: inches(24), depth: inches(8), height: feetInches(9, 0) },
  { kind: 'ceiling-obstruction', name: 'Ceiling obstruction', hosting: 'free', width: inches(24), depth: inches(24), height: inches(12), elevation: inches(96) },
  { kind: 'ceiling-beam', name: 'Ceiling beam', hosting: 'free', width: feetInches(20, 0), depth: inches(6), height: inches(12), elevation: inches(96) },
  { kind: 'built-in-cabinet', name: 'Built-in cabinet', hosting: 'wall', width: inches(36), depth: inches(24), height: inches(36) },
  { kind: 'worktop', name: 'Built-in worktop', hosting: 'wall', width: inches(96), depth: inches(25), height: inches(36) },
];

export interface ElectricalTemplate {
  kind: ElectricalKind;
  name: string;
  defaults: Partial<ElectricalPointInput>;
}

export const ELECTRICAL_TEMPLATES: readonly ElectricalTemplate[] = [
  { kind: 'outlet-120', name: '120V outlet', defaults: { voltage: 120, amperage: 15, elevation: inches(16) } },
  { kind: 'outlet-240', name: '240V outlet', defaults: { voltage: 240, amperage: 20, elevation: inches(24), dedicated: true } },
  { kind: 'ceiling-outlet', name: 'Ceiling outlet', defaults: { voltage: 120, amperage: 15, elevation: feetInches(9, 0) } },
  { kind: 'extension-point', name: 'Extension cord point', defaults: { voltage: 120, amperage: 15, elevation: 0 } },
  { kind: 'panel', name: 'Electrical panel', defaults: { voltage: 240, amperage: 100, elevation: inches(48), width: inches(14.5), height: inches(30) } },
];

export interface LightTemplate {
  kind: LightingFixture['kind'];
  name: string;
  length: number;
  width: number;
  lumens: number;
  beamAngle: number;
}

export const LIGHT_TEMPLATES: readonly LightTemplate[] = [
  { kind: 'shop-light', name: '4 ft LED shop light', length: inches(48), width: inches(3), lumens: 5000, beamAngle: 120 },
  { kind: 'ceiling-fixture', name: 'Ceiling fixture', length: inches(14), width: inches(14), lumens: 3000, beamAngle: 140 },
  { kind: 'task-light', name: 'Task light', length: inches(8), width: inches(8), lumens: 1000, beamAngle: 60 },
];
