/**
 * Factories for new domain entities. All produce schema-valid values with fresh UUIDs.
 */
import { newId } from '@/utils/id';
import { nowIso } from '@/utils/time';
import { feetInches, inches } from './units';
import {
  CURRENT_SCHEMA_VERSION,
  ProjectSettingsSchema,
  type Layers,
  type ObjectDefinition,
  type PlacedObject,
  type PlacedObjectInput,
  type Project,
  type ProjectSettings,
  type Room,
  type Scenario,
  LAYER_IDS,
} from './schema';
import type { PointData, PoseData } from './schema/common';

export const DEFAULT_CEILING_HEIGHT = feetInches(9, 0);
export const DEFAULT_WALL_THICKNESS = inches(5.5);

export function defaultSettings(overrides: Partial<ProjectSettings> = {}): ProjectSettings {
  return { ...ProjectSettingsSchema.parse({}), ...overrides };
}

export function defaultLayers(): Layers {
  return Object.fromEntries(LAYER_IDS.map((id) => [id, { visible: true, locked: false }])) as Layers;
}

/** A room from interior corner points. */
export function createRoom(points: readonly PointData[], opts: { ceilingHeight?: number; wallThickness?: number } = {}): Room {
  const vertices = points.map((p) => ({ id: newId(), x: p.x, y: p.y }));
  return {
    vertices,
    walls: vertices.map(() => ({
      id: newId(),
      thickness: opts.wallThickness ?? DEFAULT_WALL_THICKNESS,
      notes: '',
      constraints: {},
    })),
    ceilingHeight: opts.ceilingHeight ?? DEFAULT_CEILING_HEIGHT,
  };
}

/** Axis-aligned rectangle room with its NW interior corner at (0, 0). */
export function rectangleRoomPoints(width: number, depth: number): PointData[] {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: depth },
    { x: 0, y: depth },
  ];
}

export function createScenario(name: string, init: Partial<Omit<Scenario, 'id' | 'name'>> = {}): Scenario {
  const t = nowIso();
  return {
    id: newId(),
    name,
    description: '',
    createdAt: t,
    updatedAt: t,
    objects: [],
    groups: [],
    vehicles: [],
    lights: [],
    zones: [],
    measurements: [],
    relationships: [],
    dust: { runs: [], fittings: [] },
    acknowledgedWarnings: {},
    extensions: {},
    ...init,
  };
}

/**
 * Duplicate a scenario: deep copy with a new scenario id and name. Entity ids inside are KEPT so the
 * same physical item keeps its identity across scenarios (compare / move plan rely on this).
 * Warning acknowledgments are copied too (same ids ⇒ same warnings).
 */
export function duplicateScenario(source: Scenario, name: string): Scenario {
  const copy = structuredClone(source) as Scenario;
  const t = nowIso();
  return { ...copy, id: newId(), name, createdAt: t, updatedAt: t };
}

export interface CreateProjectOptions {
  name: string;
  settings?: Partial<ProjectSettings>;
  roomPoints?: readonly PointData[];
  ceilingHeight?: number;
  wallThickness?: number;
  scenarioName?: string;
}

export function createProject(opts: CreateProjectOptions): Project {
  const t = nowIso();
  const scenario = createScenario(opts.scenarioName ?? 'Layout A');
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: newId(),
    name: opts.name,
    description: '',
    createdAt: t,
    updatedAt: t,
    revision: 0,
    settings: defaultSettings(opts.settings),
    room: createRoom(opts.roomPoints ?? [], { ceilingHeight: opts.ceilingHeight, wallThickness: opts.wallThickness }),
    architecture: [],
    electrical: [],
    definitions: [],
    scenarios: [scenario],
    activeScenarioId: scenario.id,
    layers: defaultLayers(),
    savedViews: [],
    reorganization: { stepStatus: {} },
    inventoryNotes: {},
    notes: '',
    extensions: {},
  };
}

/** A placed instance of a definition at a pose. Dimensions are copied (per-instance overrides allowed). */
export function placeObject(def: ObjectDefinition, pose: PoseData, overrides: Partial<PlacedObjectInput> = {}): PlacedObject {
  return {
    id: newId(),
    definitionId: def.id,
    name: def.name,
    x: pose.x,
    y: pose.y,
    rotation: pose.rotation,
    width: def.width,
    depth: def.depth,
    height: def.height,
    elevation: def.mount === 'floor' ? 0 : def.defaultElevation,
    mount: def.mount,
    mobility: def.mobility,
    activePosition: 'parked',
    stateId: def.defaultStateId,
    notes: '',
    locked: false,
    hidden: false,
    ...overrides,
  } as PlacedObject;
}
