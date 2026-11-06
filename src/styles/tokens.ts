/**
 * Canvas (Konva) color tokens. Keep in sync with src/styles/index.css. Konva cannot read CSS
 * variables, so the plan's colors live here. Category colors are deliberately subtle.
 */
import type { LayerId, ObjectCategory } from '@/domain/schema';

export const canvasColors = {
  paper: '#f3f2ee',
  gridMinor: '#e4e2dc',
  gridMajor: '#d2cfc7',
  outside: '#e9e7e1',
  wallFill: '#3b4046',
  wallStroke: '#2a2e32',
  roomEdge: '#2a2e32',
  ink: '#22262a',
  inkMuted: '#5f666d',
  dimension: '#4a6fa5',
  select: '#2f7df6',
  selectFill: 'rgba(47,125,246,0.08)',
  hover: '#6aa0f8',
  warn: '#e0a100',
  danger: '#e5484d',
  dangerFill: 'rgba(229,72,77,0.28)',
  warnFill: 'rgba(224,161,0,0.25)',
  doorSwing: '#7a828a',
  garageTrack: 'rgba(95,102,109,0.12)',
  window: '#7fb2d9',
  electrical: '#c98f0c',
  light: '#e3b320',
  lightGlow: 'rgba(245,200,66,0.10)',
  vehicleFill: '#c9d3dc',
  vehicleStroke: '#51606d',
  ghostStroke: '#7c848c',
} as const;

export const categoryColors: Record<ObjectCategory | 'unknown', { fill: string; stroke: string }> = {
  'work-surface': { fill: '#e6d5b8', stroke: '#8a6d3b' },
  'stationary-tool': { fill: '#cfd9e4', stroke: '#4d6680' },
  storage: { fill: '#d9e0cc', stroke: '#617046' },
  misc: { fill: '#e2ddd6', stroke: '#6f665b' },
  'dust-collection': { fill: '#ddd4e8', stroke: '#6c5a86' },
  unknown: { fill: '#e2e2e2', stroke: '#666666' },
};

export const layerColors: Record<LayerId, string> = {
  architecture: '#6d747c',
  electrical: '#c98f0c',
  lighting: '#e3b320',
  storage: '#617046',
  woodworking: '#4d6680',
  vehicle: '#51606d',
  clearances: '#e08a2e',
  measurements: '#4a6fa5',
  zones: '#8a7cc4',
  dust: '#6c5a86',
  general: '#6f665b',
};

export const zoneKindColors: Record<string, string> = {
  parking: '#8da4b8',
  woodworking: '#c9a66b',
  assembly: '#b7c98a',
  'lumber-storage': '#b89a6b',
  finishing: '#d7a3a3',
  automotive: '#9fb0c4',
  'lawn-equipment': '#9cc48a',
  'tool-storage': '#a7b59a',
  'walking-aisle': '#c4c4c4',
  staging: '#c9b8e0',
  'project-storage': '#d6c79c',
  other: '#bdbdbd',
};

/** Monochrome technical-drawing palette (print mode). */
export const monochrome = { fill: '#ffffff', stroke: '#1a1a1a', muted: '#8a8a8a' } as const;
