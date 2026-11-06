/**
 * Add / update / delete commands for the simpler entity collections. Project-scoped: architecture,
 * electrical. Scenario-scoped: vehicles, lights, zones, measurements, relationships, dust runs/fittings.
 */
import { z } from 'zod';
import {
  ArchitecturalFeatureSchema,
  DuctRunSchema,
  DustFittingSchema,
  ElectricalPointSchema,
  LightingFixtureSchema,
  MeasurementSchema,
  RelationshipSchema,
  VehicleSchema,
  WorkflowZoneSchema,
  type Project,
} from '../../schema';
import { CommandError, defineCommand } from '../registry';
import { applyPatch, assertUniqueId, normalizeRotationOf, patchOf, removeByIds, scenarioOf } from '../helpers';

type Getter = (project: Project, scenarioId?: string) => Array<{ id: string; locked?: boolean; name?: string }>;

function crud<const P extends string, S extends z.ZodObject>(prefix: P, noun: string, schema: S, get: Getter) {
  const Patch = patchOf(schema);
  const add = defineCommand({
    type: `${prefix}.add` as `${P}.add`,
    label: `Add ${noun}`,
    payload: z.object({ scenarioId: z.string().optional(), items: z.array(schema).min(1) }),
    execute(project, p) {
      const list = get(project, p.scenarioId);
      for (const item of p.items as Array<{ id: string; rotation?: unknown }>) {
        assertUniqueId(list, item.id, noun);
        normalizeRotationOf(item);
        list.push(item);
      }
    },
  });
  const update = defineCommand({
    type: `${prefix}.update` as `${P}.update`,
    label: `Edit ${noun}`,
    payload: z.object({ scenarioId: z.string().optional(), id: z.string(), patch: Patch.optional(), unset: z.array(z.string()).default([]) }),
    execute(project, p) {
      const list = get(project, p.scenarioId);
      const item = list.find((i) => i.id === p.id);
      if (!item) throw new CommandError(`The ${noun} you are editing no longer exists.`);
      applyPatch(item, (p.patch ?? {}) as object);
      for (const k of p.unset) delete (item as Record<string, unknown>)[k];
      normalizeRotationOf(item as { rotation?: unknown });
      const check = schema.safeParse(JSON.parse(JSON.stringify(item)));
      if (!check.success) throw new CommandError(`That change would make the ${noun} invalid: ${check.error.issues[0]?.message}`);
    },
  });
  const remove = defineCommand({
    type: `${prefix}.delete` as `${P}.delete`,
    label: `Delete ${noun}`,
    payload: z.object({ scenarioId: z.string().optional(), ids: z.array(z.string()).min(1), force: z.boolean().default(false) }),
    execute(project, p) {
      const list = get(project, p.scenarioId);
      const ids = new Set(p.ids);
      const locked = list.find((i) => ids.has(i.id) && i.locked);
      if (locked && !p.force) throw new CommandError(`"${locked.name ?? noun}" is locked. Unlock it to delete it.`);
      removeByIds(list, ids);
    },
  });
  return { add, update, remove };
}

export const featureCommands = crud('feature', 'architectural feature', ArchitecturalFeatureSchema, (p) => p.architecture);
export const electricalCommands = crud('electrical', 'electrical point', ElectricalPointSchema, (p) => p.electrical);
export const vehicleCommands = crud('vehicle', 'vehicle', VehicleSchema, (p, s) => scenarioOf(p, s).vehicles);
export const lightCommands = crud('light', 'light fixture', LightingFixtureSchema, (p, s) => scenarioOf(p, s).lights);
export const zoneCommands = crud('zone', 'zone', WorkflowZoneSchema, (p, s) => scenarioOf(p, s).zones);
export const measurementCommands = crud('measurement', 'measurement', MeasurementSchema, (p, s) => scenarioOf(p, s).measurements);
export const relationshipCommands = crud('relationship', 'relationship', RelationshipSchema, (p, s) => scenarioOf(p, s).relationships);
export const ductCommands = crud('duct', 'duct run', DuctRunSchema, (p, s) => scenarioOf(p, s).dust.runs);
export const fittingCommands = crud('fitting', 'dust fitting', DustFittingSchema, (p, s) => scenarioOf(p, s).dust.fittings);

type Crud<T> = T extends { add: infer A; update: infer U; remove: infer R }
  ? { add: A; update: U; remove: R }
  : never;
type In<C> = C extends { payload: infer S extends z.ZodType } ? z.input<S> : never;
type AddIn<T> = In<Crud<T>['add']>;
type UpdateIn<T> = In<Crud<T>['update']>;
type DeleteIn<T> = In<Crud<T>['remove']>;

declare module '../registry' {
  interface CommandPayloads {
    'feature.add': AddIn<typeof featureCommands>;
    'feature.update': UpdateIn<typeof featureCommands>;
    'feature.delete': DeleteIn<typeof featureCommands>;
    'electrical.add': AddIn<typeof electricalCommands>;
    'electrical.update': UpdateIn<typeof electricalCommands>;
    'electrical.delete': DeleteIn<typeof electricalCommands>;
    'vehicle.add': AddIn<typeof vehicleCommands>;
    'vehicle.update': UpdateIn<typeof vehicleCommands>;
    'vehicle.delete': DeleteIn<typeof vehicleCommands>;
    'light.add': AddIn<typeof lightCommands>;
    'light.update': UpdateIn<typeof lightCommands>;
    'light.delete': DeleteIn<typeof lightCommands>;
    'zone.add': AddIn<typeof zoneCommands>;
    'zone.update': UpdateIn<typeof zoneCommands>;
    'zone.delete': DeleteIn<typeof zoneCommands>;
    'measurement.add': AddIn<typeof measurementCommands>;
    'measurement.update': UpdateIn<typeof measurementCommands>;
    'measurement.delete': DeleteIn<typeof measurementCommands>;
    'relationship.add': AddIn<typeof relationshipCommands>;
    'relationship.update': UpdateIn<typeof relationshipCommands>;
    'relationship.delete': DeleteIn<typeof relationshipCommands>;
    'duct.add': AddIn<typeof ductCommands>;
    'duct.update': UpdateIn<typeof ductCommands>;
    'duct.delete': DeleteIn<typeof ductCommands>;
    'fitting.add': AddIn<typeof fittingCommands>;
    'fitting.update': UpdateIn<typeof fittingCommands>;
    'fitting.delete': DeleteIn<typeof fittingCommands>;
  }
}
