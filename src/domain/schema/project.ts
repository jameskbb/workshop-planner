import { z } from 'zod';
import { IdSchema, LAYER_IDS, LayerIdSchema, MmSchema, PositiveMmSchema, TimestampSchema } from './common';
import { ObjectDefinitionSchema } from './objects';
import { ArchitecturalFeatureSchema, ElectricalPointSchema, RoomSchema } from './room';
import { ScenarioSchema } from './scenario';

/** Current portable project format version. Bump + add a migration in src/domain/migrations.ts. */
export const CURRENT_SCHEMA_VERSION = 3;

export const SnapSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  grid: z.boolean().default(true),
  walls: z.boolean().default(true),
  corners: z.boolean().default(true),
  wallCenters: z.boolean().default(true),
  objectEdges: z.boolean().default(true),
  objectCenters: z.boolean().default(true),
});
export type SnapSettings = z.infer<typeof SnapSettingsSchema>;

export const ProjectSettingsSchema = z.object({
  unitSystem: z.enum(['imperial', 'metric']).default('imperial'),
  /** Imperial fraction denominator (16 = 1/16"). */
  imperialPrecision: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8), z.literal(16), z.literal(32), z.literal(64)]).default(16),
  metricUnit: z.enum(['mm', 'cm', 'm']).default('mm'),
  /** Grid spacing in mm (1", 2", 3", 6", 12" presets in imperial). */
  gridSize: PositiveMmSchema.default(152.4),
  showGrid: z.boolean().default(true),
  snapping: SnapSettingsSchema.default({
    enabled: true,
    grid: true,
    walls: true,
    corners: true,
    wallCenters: true,
    objectEdges: true,
    objectCenters: true,
  }),
  /** Rotation snap step in degrees (15, 45 or 90). */
  rotationSnap: z.number().positive().default(15),
  /** Desired minimum aisle width for walkability (mm). */
  aisleWidth: PositiveMmSchema.default(762),
  defaultWallThickness: PositiveMmSchema.default(139.7),
  /** Monochrome technical-drawing mode (for printing). */
  monochrome: z.boolean().default(false),
  showLabels: z.boolean().default(true),
  showDimensions: z.boolean().default(true),
  /** Scorecard / optimizer priority weights by metric or priority id (0–1). */
  priorities: z.record(z.string(), z.number().min(0).max(1)).default({}),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

export const LayerStateSchema = z.object({ visible: z.boolean().default(true), locked: z.boolean().default(false) });
export type LayerState = z.infer<typeof LayerStateSchema>;

const defaultLayers = Object.fromEntries(LAYER_IDS.map((id) => [id, { visible: true, locked: false }])) as Record<
  (typeof LAYER_IDS)[number],
  LayerState
>;

export const LayersSchema = z
  .partialRecord(LayerIdSchema, LayerStateSchema)
  .default(defaultLayers)
  .transform((v): Layers => ({ ...defaultLayers, ...v }));
export type Layers = Record<(typeof LAYER_IDS)[number], LayerState>;

export const SavedViewSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  mode: z.enum(['2d', '3d']),
  camera2d: z.object({ x: MmSchema, y: MmSchema, zoom: z.number().positive() }).optional(),
  camera3d: z
    .object({
      position: z.tuple([z.number(), z.number(), z.number()]),
      target: z.tuple([z.number(), z.number(), z.number()]),
      fov: z.number().positive().optional(),
      orthographic: z.boolean().default(false),
    })
    .optional(),
});
export type SavedView = z.infer<typeof SavedViewSchema>;

export const ReorganizationSchema = z.object({
  currentScenarioId: IdSchema.optional(),
  targetScenarioId: IdSchema.optional(),
  /** Move-plan step key → status. */
  stepStatus: z.record(z.string(), z.enum(['moved', 'skipped', 'blocked'])).default({}),
});
export type Reorganization = z.infer<typeof ReorganizationSchema>;

export const ProjectSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    id: IdSchema,
    name: z.string().min(1),
    description: z.string().default(''),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    /** Increments on every committed change (sync-ready optimistic concurrency). */
    revision: z.number().int().nonnegative().default(0),
    settings: ProjectSettingsSchema,
    room: RoomSchema,
    architecture: z.array(ArchitecturalFeatureSchema).default([]),
    electrical: z.array(ElectricalPointSchema).default([]),
    /** Every object definition used by this project (built-in copies + custom), so files are self-contained. */
    definitions: z.array(ObjectDefinitionSchema).default([]),
    scenarios: z.array(ScenarioSchema).min(1),
    activeScenarioId: IdSchema,
    layers: LayersSchema,
    savedViews: z.array(SavedViewSchema).default([]),
    reorganization: ReorganizationSchema.default({ stepStatus: {} }),
    /** Inventory line key → note. */
    inventoryNotes: z.record(z.string(), z.string()).default({}),
    notes: z.string().default(''),
    /** Per-feature project data (see docs/ARCHITECTURE.md "Extensions"). */
    extensions: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((p, ctx) => {
    if (!p.scenarios.some((s) => s.id === p.activeScenarioId)) {
      ctx.addIssue({ code: 'custom', message: 'activeScenarioId does not match any scenario.', path: ['activeScenarioId'] });
    }
    const ids = new Set<string>();
    for (const [i, s] of p.scenarios.entries()) {
      if (ids.has(s.id)) ctx.addIssue({ code: 'custom', message: `Duplicate scenario id "${s.id}".`, path: ['scenarios', i, 'id'] });
      ids.add(s.id);
    }
  });
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectInput = z.input<typeof ProjectSchema>;
