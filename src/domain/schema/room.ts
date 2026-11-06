import { z } from 'zod';
import { ColorSchema, DegreesSchema, DimensionMmSchema, IdSchema, MmSchema, NonNegativeMmSchema, PositiveMmSchema } from './common';

export const VertexSchema = z.object({ id: IdSchema, x: MmSchema, y: MmSchema });
export type Vertex = z.infer<typeof VertexSchema>;

/** Optional CAD-style constraints on a wall (enforced by the room editor). */
export const WallConstraintsSchema = z.object({
  horizontal: z.boolean().optional(),
  vertical: z.boolean().optional(),
  lockLength: z.boolean().optional(),
  lockAngle: z.boolean().optional(),
  parallelTo: IdSchema.optional(),
  perpendicularTo: IdSchema.optional(),
});
export type WallConstraints = z.infer<typeof WallConstraintsSchema>;

/**
 * Wall i runs from room.vertices[i] to room.vertices[(i + 1) % n] along the INTERIOR face.
 * Thickness grows outward. Height defaults to the room ceiling height.
 */
export const WallSchema = z.object({
  id: IdSchema,
  name: z.string().optional(),
  thickness: PositiveMmSchema,
  height: PositiveMmSchema.optional(),
  material: z.string().optional(),
  color: ColorSchema.optional(),
  notes: z.string().default(''),
  constraints: WallConstraintsSchema.default({}),
});
export type Wall = z.infer<typeof WallSchema>;

export const RoomSchema = z
  .object({
    /** Interior outline, in order (either winding). Empty for a blank project. */
    vertices: z.array(VertexSchema),
    walls: z.array(WallSchema),
    ceilingHeight: PositiveMmSchema,
    floorColor: ColorSchema.optional(),
  })
  .superRefine((room, ctx) => {
    if (room.vertices.length > 0 && room.vertices.length < 3) {
      ctx.addIssue({ code: 'custom', message: 'A room needs at least 3 corners.', path: ['vertices'] });
    }
    if (room.walls.length !== room.vertices.length) {
      ctx.addIssue({
        code: 'custom',
        message: `The room has ${room.vertices.length} corners but ${room.walls.length} walls; they must match.`,
        path: ['walls'],
      });
    }
  });
export type Room = z.infer<typeof RoomSchema>;

// ───────────────────────────── placement ─────────────────────────────

/**
 * Where a fixed feature sits: hosted on a wall (follows the wall when the room is edited) or free.
 * For wall placement, `offset` is the distance along the wall (from its start vertex) to the feature
 * CENTER; the feature's depth extends into the room from the wall's interior face.
 */
export const PlacementSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('wall'), wallId: IdSchema, offset: MmSchema }),
  z.object({ type: z.literal('free'), x: MmSchema, y: MmSchema, rotation: DegreesSchema }),
]);
export type Placement = z.infer<typeof PlacementSchema>;

// ───────────────────────────── architectural features ─────────────────────────────

export const ARCHITECTURE_KINDS = [
  'door',
  'double-door',
  'garage-door',
  'window',
  'support-pole',
  'column',
  'stairs',
  'steps',
  'utility-closet',
  'water-heater',
  'hvac',
  'attic-ladder',
  'permanent-shelving',
  'sink',
  'hose-bib',
  'wall-protrusion',
  'ceiling-obstruction',
  'ceiling-beam',
  'built-in-cabinet',
  'worktop',
] as const;
export const ArchitectureKindSchema = z.enum(ARCHITECTURE_KINDS);
export type ArchitectureKind = z.infer<typeof ArchitectureKindSchema>;

export const DoorSpecSchema = z.object({
  /** Which way the leaf swings relative to the room. */
  swing: z.enum(['in', 'out', 'none']).default('in'),
  /** Hinge side as seen from inside the room looking at the wall. */
  hinge: z.enum(['left', 'right']).default('left'),
  openAngle: z.number().min(0).max(180).default(90),
});
export type DoorSpec = z.infer<typeof DoorSpecSchema>;

export const GarageDoorSpecSchema = z.object({
  openingHeight: PositiveMmSchema,
  /** How far the horizontal tracks run into the garage (mm). */
  trackLength: PositiveMmSchema,
  /** Height of the tracks / open door panel above the floor (mm). */
  trackHeight: PositiveMmSchema,
  kind: z.enum(['sectional', 'roll-up', 'tilt-up']).default('sectional'),
  state: z.enum(['closed', 'open']).default('closed'),
});
export type GarageDoorSpec = z.infer<typeof GarageDoorSpecSchema>;

export const ArchitecturalFeatureSchema = z.object({
  id: IdSchema,
  kind: ArchitectureKindSchema,
  name: z.string().min(1),
  placement: PlacementSchema,
  /** Along-wall width (wall placement) or local-x width (free placement). */
  width: DimensionMmSchema,
  /** Depth into the room (wall placement) or local-y depth (free placement). For doors/windows: wall thickness is used. */
  depth: PositiveMmSchema,
  height: PositiveMmSchema,
  /** Bottom elevation above floor (mm): window sills, ceiling obstructions, beams. */
  elevation: NonNegativeMmSchema.default(0),
  /** Round features (support poles) use `width` as the diameter. */
  shape: z.enum(['rect', 'round']).default('rect'),
  door: DoorSpecSchema.optional(),
  garageDoor: GarageDoorSpecSchema.optional(),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  color: ColorSchema.optional(),
  notes: z.string().default(''),
});
export type ArchitecturalFeature = z.infer<typeof ArchitecturalFeatureSchema>;
export type ArchitecturalFeatureInput = z.input<typeof ArchitecturalFeatureSchema>;

/** Kinds that are openings in a wall (no floor footprint of their own). */
export const OPENING_KINDS: ReadonlySet<ArchitectureKind> = new Set(['door', 'double-door', 'garage-door', 'window']);
/** Kinds that are overhead (do not block the floor, matter for vertical clearance). */
export const OVERHEAD_KINDS: ReadonlySet<ArchitectureKind> = new Set(['ceiling-obstruction', 'ceiling-beam', 'attic-ladder']);

// ───────────────────────────── electrical ─────────────────────────────

export const ELECTRICAL_KINDS = ['outlet-120', 'outlet-240', 'ceiling-outlet', 'extension-point', 'panel'] as const;
export const ElectricalKindSchema = z.enum(ELECTRICAL_KINDS);
export type ElectricalKind = z.infer<typeof ElectricalKindSchema>;

/**
 * Outlets, extension points and the electrical panel. Planning aid only; no code-compliance claims.
 * The panel's box size uses width/height; outlets use them for their plate.
 */
export const ElectricalPointSchema = z.object({
  id: IdSchema,
  kind: ElectricalKindSchema,
  label: z.string().default(''),
  placement: PlacementSchema,
  elevation: NonNegativeMmSchema.default(0),
  width: PositiveMmSchema.default(70),
  height: PositiveMmSchema.default(115),
  circuit: z.string().optional(),
  voltage: z.union([z.literal(120), z.literal(240)]).default(120),
  amperage: z.number().positive().default(15),
  gfci: z.boolean().default(false),
  dedicated: z.boolean().default(false),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  notes: z.string().default(''),
});
export type ElectricalPoint = z.infer<typeof ElectricalPointSchema>;
export type ElectricalPointInput = z.input<typeof ElectricalPointSchema>;
