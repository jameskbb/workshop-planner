import type { EntityRef, Project, Scenario } from '@/domain/schema';
import type { MultiPolygon, Point, Polygon } from '@/geometry';
import type { AnalysisContext } from './context';

export type Severity = 'critical' | 'warning' | 'info';

/**
 * Warning categories. Core analyzers use the first three; Phase 3/4 analyzers add the rest
 * (the union is open: any string is accepted, these are the documented ones).
 */
export type WarningCategory =
  | 'collision'
  | 'bounds'
  | 'clearance'
  | 'doorway'
  | 'garage-door'
  | 'vehicle'
  | 'walkway'
  | 'electrical'
  | 'panel-access'
  | 'hazard'
  | 'overhead'
  | 'dust'
  | 'lighting'
  | (string & {});

export interface Highlight {
  /** Regions to tint (overlap areas, intrusions). */
  regions?: MultiPolygon;
  polygons?: Polygon[];
  points?: Point[];
  lines?: Array<[Point, Point]>;
}

/** A named quantity behind a warning, for UI chips and tests ("depth": 457.2 mm). */
export interface WarningQuantity {
  name: string;
  /** Millimeters (length) or mm² (area) depending on `kind`. */
  value: number;
  kind: 'length' | 'area' | 'count' | 'angle';
}

export interface Warning {
  /** Stable id: same situation ⇒ same id across recomputes (used for acknowledgment). */
  id: string;
  analyzerId: string;
  category: WarningCategory;
  severity: Severity;
  /** Short title ("Outfeed clearance blocked"). */
  title: string;
  /** Full human explanation with formatted quantities. */
  message: string;
  /** Entities involved (for selection / highlighting). */
  involved: EntityRef[];
  highlight: Highlight;
  quantities: WarningQuantity[];
  /** Structured facts for programmatic consumers (Ask the Layout, NL, scorecards). */
  data?: Record<string, unknown>;
  /** Filled from the scenario's acknowledgments. */
  acknowledged?: 'acknowledged' | 'ignored';
}

export type WarningInput = Omit<Warning, 'acknowledged' | 'analyzerId' | 'quantities' | 'highlight'> & {
  quantities?: WarningQuantity[];
  highlight?: Highlight;
};

export interface Analyzer {
  id: string;
  label: string;
  /** Short description for the safety panel's check list. */
  description: string;
  category: WarningCategory;
  /** Lower runs first; also the display order of checks. */
  order?: number;
  run(ctx: AnalysisContext): WarningInput[];
}

export interface MetricValue {
  value: number | null;
  /** Pre-formatted value for display (uses project units). */
  display: string;
  /** One-sentence explanation of how it was computed (no magic numbers). */
  explanation: string;
}

export interface Metric {
  id: string;
  label: string;
  description: string;
  unit: 'length' | 'area' | 'count' | 'percent' | 'ratio';
  /** Which direction is better, for comparisons. */
  better: 'higher' | 'lower';
  order?: number;
  compute(ctx: AnalysisContext): MetricValue;
}

export interface AnalyzeOptions {
  /** Restrict to these analyzer ids. */
  analyzers?: readonly string[];
  /** Include hidden objects (default false: hidden items are treated as absent). */
  includeHidden?: boolean;
  /** Evaluate mobile items at their parked/working position instead of the active one. */
  positions?: 'active' | 'parked' | 'working';
}

export type { AnalysisContext, Project, Scenario };
