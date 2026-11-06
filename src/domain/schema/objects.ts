import { z } from 'zod';
import {
  ColorSchema,
  DegreesSchema,
  DimensionMmSchema,
  IdSchema,
  LayerIdSchema,
  MmSchema,
  NonNegativeMmSchema,
  PointSchema,
  PoseSchema,
  PositiveMmSchema,
  TimestampSchema,
} from './common';

// ───────────────────────────── clearance zones ─────────────────────────────

export const ZoneSideSchema = z.enum(['front', 'back', 'left', 'right']);

/** Mirrors `ZoneShape` in src/geometry/clearance.ts (local frame: +y front, −x left). */
export const ZoneShapeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('side'),
    side: ZoneSideSchema,
    depth: PositiveMmSchema,
    extend: NonNegativeMmSchema.optional(),
    offset: NonNegativeMmSchema.optional(),
  }),
  z.object({ type: z.literal('around'), margin: PositiveMmSchema }),
  z.object({ type: z.literal('rect'), x: MmSchema, y: MmSchema, width: PositiveMmSchema, depth: PositiveMmSchema }),
  z.object({ type: z.literal('polygon'), points: z.array(PointSchema).min(3) }),
]);
export type ZoneShapeData = z.infer<typeof ZoneShapeSchema>;

export const CLEARANCE_KINDS = ['operator', 'infeed', 'outfeed', 'side', 'operational', 'maintenance', 'access'] as const;
export const ClearanceKindSchema = z.enum(CLEARANCE_KINDS);
export type ClearanceKind = z.infer<typeof ClearanceKindSchema>;

/**
 * A named working-clearance zone attached to an object, defined in its local frame so it rotates
 * with it. `kind` is the purpose; overlay grouping is derived: maintenance → "maintenance",
 * everything else → "operational" (see `clearanceOverlayGroup`).
 */
export const ClearanceZoneSchema = z.object({
  id: IdSchema,
  kind: ClearanceKindSchema,
  label: z.string().optional(),
  shape: ZoneShapeSchema,
  /** When true, overlap with another object's clearance zone is expected and not reported. */
  sharable: z.boolean().default(true),
});
export type ClearanceZone = z.infer<typeof ClearanceZoneSchema>;

export const clearanceOverlayGroup = (kind: ClearanceKind): 'operational' | 'maintenance' =>
  kind === 'maintenance' ? 'maintenance' : 'operational';

// ───────────────────────────── object definitions ─────────────────────────────

export const OBJECT_CATEGORIES = ['work-surface', 'stationary-tool', 'storage', 'misc', 'dust-collection'] as const;
export const ObjectCategorySchema = z.enum(OBJECT_CATEGORIES);
export type ObjectCategory = z.infer<typeof ObjectCategorySchema>;

export const MobilitySchema = z.enum(['static', 'mobile']);
export type Mobility = z.infer<typeof MobilitySchema>;
/** floor = stands on the floor; wall = hung on a wall at `elevation`; ceiling = hung from the ceiling (overhead racks). */
export const MountSchema = z.enum(['floor', 'wall', 'ceiling']);
export type Mount = z.infer<typeof MountSchema>;

export const ElectricalRequirementSchema = z.object({
  voltage: z.union([z.literal(120), z.literal(240)]),
  amperage: z.number().positive(),
  dedicated: z.boolean().default(false),
  plug: z.string().optional(),
});
export type ElectricalRequirement = z.infer<typeof ElectricalRequirementSchema>;

/** Dust port position in the object's local frame (mm from footprint center) and diameter. */
export const DustPortSchema = z.object({
  diameter: PositiveMmSchema,
  x: MmSchema,
  y: MmSchema,
  /** Height of the port above the floor (mm), for hose/duct routing. */
  z: NonNegativeMmSchema.optional(),
});
export type DustPort = z.infer<typeof DustPortSchema>;

/** Footprint override for a state (e.g. miter station wings open). */
export const StateFootprintSchema = z.object({
  width: PositiveMmSchema,
  depth: PositiveMmSchema,
  /** Shift of the footprint center in the local frame. */
  offsetX: MmSchema.default(0),
  offsetY: MmSchema.default(0),
});
export type StateFootprint = z.infer<typeof StateFootprintSchema>;

export const ObjectStateDefSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  footprint: StateFootprintSchema.optional(),
  height: PositiveMmSchema.optional(),
  /** Replaces the object's clearance zones while in this state. */
  clearances: z.array(ClearanceZoneSchema).optional(),
});
export type ObjectStateDef = z.infer<typeof ObjectStateDefSchema>;

export const HazardsSchema = z.object({
  hot: z.boolean().default(false),
  finishing: z.boolean().default(false),
  flammable: z.boolean().default(false),
  sparks: z.boolean().default(false),
});
export type Hazards = z.infer<typeof HazardsSchema>;

/** A component of a group template (a custom object built from a group). */
export const ComponentSchema = z.object({
  definitionId: IdSchema,
  name: z.string().optional(),
  x: MmSchema,
  y: MmSchema,
  rotation: DegreesSchema,
  width: PositiveMmSchema.optional(),
  depth: PositiveMmSchema.optional(),
  height: PositiveMmSchema.optional(),
});
export type Component = z.infer<typeof ComponentSchema>;

/** Largest embedded object image we store (~400 KB of base64; the dialog downscales to 256 px). */
export const MAX_IMAGE_DATA_URL = 400_000;

/**
 * A custom object's picture, as an EMBEDDED image (R-018). A remote URL is refused: a project file
 * from someone else must never make the browser fetch anything, and an unbounded string must never
 * reach storage.
 */
export const ObjectImageSchema = z
  .string()
  .regex(/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/, 'An object image must be an embedded PNG, JPEG, WebP or GIF (data:image/…;base64,…).')
  .max(MAX_IMAGE_DATA_URL, `An object image must be smaller than ${Math.round(MAX_IMAGE_DATA_URL / 1000)} KB.`);

/**
 * An object TYPE: built-in library item or user-created custom object. Placed instances copy its
 * dimensions at placement time (users may override per instance) and reference it for everything else.
 */
export const ObjectDefinitionSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  category: ObjectCategorySchema,
  subcategory: z.string().optional(),
  tags: z.array(z.string()).default([]),
  width: DimensionMmSchema,
  depth: DimensionMmSchema,
  height: DimensionMmSchema,
  weightKg: z.number().nonnegative().optional(),
  mobility: MobilitySchema.default('static'),
  mount: MountSchema.default('floor'),
  /** Bottom elevation for wall-mounted items (mm above floor). */
  defaultElevation: NonNegativeMmSchema.default(0),
  shape: z.enum(['rect', 'round']).default('rect'),
  electrical: ElectricalRequirementSchema.optional(),
  dustPort: DustPortSchema.optional(),
  clearances: z.array(ClearanceZoneSchema).default([]),
  states: z.array(ObjectStateDefSchema).default([]),
  defaultStateId: IdSchema.optional(),
  hazards: HazardsSchema.optional(),
  color: ColorSchema.optional(),
  /** Embedded image of a user-supplied object (custom objects). */
  image: ObjectImageSchema.optional(),
  notes: z.string().default(''),
  /** Built-in defaults are approximate; the UI must say so. */
  approximate: z.boolean().default(true),
  source: z.enum(['builtin', 'custom']).default('custom'),
  layer: LayerIdSchema.default('general'),
  components: z.array(ComponentSchema).optional(),
  updatedAt: TimestampSchema.optional(),
});
export type ObjectDefinition = z.infer<typeof ObjectDefinitionSchema>;
export type ObjectDefinitionInput = z.input<typeof ObjectDefinitionSchema>;

// ───────────────────────────── placed objects ─────────────────────────────

/**
 * An instance of a definition in a scenario. `id` is unique within a scenario and is SHARED across
 * scenarios for the same physical item (scenario duplication copies ids), which is how scenario
 * comparison and the move plan match items. Pose (x, y) is the footprint CENTER in the PARKED
 * position; `working` holds the working position for mobile items.
 */
export const PlacedObjectSchema = z.object({
  id: IdSchema,
  definitionId: IdSchema,
  name: z.string().min(1),
  /** Optional canvas label override (e.g. "4' Tool Cabinet"). */
  label: z.string().optional(),
  x: MmSchema,
  y: MmSchema,
  rotation: DegreesSchema,
  width: DimensionMmSchema,
  depth: DimensionMmSchema,
  height: DimensionMmSchema,
  /** Bottom elevation above floor (mm). 0 for floor objects. */
  elevation: NonNegativeMmSchema.default(0),
  mount: MountSchema.default('floor'),
  /** Wall the item is attached to (room wall id), when wall-mounted or pushed against a wall. */
  wallId: IdSchema.optional(),
  mobility: MobilitySchema.default('static'),
  /** Working position for mobile items. */
  working: PoseSchema.optional(),
  activePosition: z.enum(['parked', 'working']).default('parked'),
  stateId: IdSchema.optional(),
  /** Instance override of the definition's clearance zones. */
  clearances: z.array(ClearanceZoneSchema).optional(),
  electrical: ElectricalRequirementSchema.optional(),
  weightKg: z.number().nonnegative().optional(),
  color: ColorSchema.optional(),
  notes: z.string().default(''),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  groupId: IdSchema.optional(),
  zoneId: IdSchema.optional(),
  layer: LayerIdSchema.optional(),
});
export type PlacedObject = z.infer<typeof PlacedObjectSchema>;
export type PlacedObjectInput = z.input<typeof PlacedObjectSchema>;

export const GroupSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  locked: z.boolean().default(false),
});
export type Group = z.infer<typeof GroupSchema>;
