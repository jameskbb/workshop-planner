import { z } from 'zod';
import { DegreesSchema, GroupSchema, MmSchema, ObjectDefinitionSchema, PlacedObjectSchema, PoseSchema, type PlacedObject } from '../../schema';
import { CommandError, defineCommand } from '../registry';
import { applyPatch, assertUniqueId, findOrThrow, normalizeRotation, normalizeRotationOf, patchOf, removeByIds, ScenarioRef, scenarioOf } from '../helpers';
import { quantize } from '../../units';

const PlacedPatch = patchOf(PlacedObjectSchema);

/** Snap a pose onto the canonical lattice: position quantized, rotation normalized into [0, 360). */
function q(o: { x: number; y: number; rotation?: number }) {
  o.x = quantize(o.x);
  o.y = quantize(o.y);
  normalizeRotationOf(o);
}

/** Upsert a definition into the project (embedded copy so project files are self-contained). */
export const upsertDefinition = defineCommand({
  type: 'definition.upsert',
  label: (p) => `Save "${p.definition.name}" definition`,
  payload: z.object({ definition: ObjectDefinitionSchema }),
  execute(project, p) {
    const i = project.definitions.findIndex((d) => d.id === p.definition.id);
    if (i >= 0) project.definitions[i] = p.definition;
    else project.definitions.push(p.definition);
  },
});

export const addObjects = defineCommand({
  type: 'object.add',
  label: (p) => (p.objects.length === 1 ? `Add ${p.objects[0]!.name}` : `Add ${p.objects.length} objects`),
  payload: z.object({
    ...ScenarioRef,
    objects: z.array(PlacedObjectSchema).min(1),
    /** Definitions to embed if the project does not have them yet (e.g. from the built-in library). */
    definitions: z.array(ObjectDefinitionSchema).default([]),
  }),
  execute(project, p) {
    const s = scenarioOf(project, p.scenarioId);
    for (const def of p.definitions) {
      if (!project.definitions.some((d) => d.id === def.id)) project.definitions.push(def);
    }
    for (const o of p.objects) {
      if (!project.definitions.some((d) => d.id === o.definitionId)) {
        throw new CommandError(`"${o.name}" refers to an unknown object type.`);
      }
      assertUniqueId(s.objects, o.id, 'object');
      const copy = { ...o, ...(o.working ? { working: { ...o.working } } : {}) };
      q(copy);
      if (copy.working) q(copy.working);
      s.objects.push(copy);
    }
  },
});

export const updateObject = defineCommand({
  type: 'object.update',
  label: (p, project) => {
    const name = project.scenarios.flatMap((s) => s.objects).find((o) => o.id === p.id)?.name ?? 'object';
    return `Edit ${name}`;
  },
  payload: z.object({ ...ScenarioRef, id: z.string(), patch: PlacedPatch.optional(), unset: z.array(z.string()).default([]) }),
  execute(project, p) {
    const s = scenarioOf(project, p.scenarioId);
    const o = findOrThrow(s.objects, p.id, 'object');
    applyPatch(o, (p.patch ?? {}) as Partial<PlacedObject>);
    for (const key of p.unset) delete (o as Record<string, unknown>)[key];
    q(o);
    if (o.working) q(o.working);
    const check = PlacedObjectSchema.safeParse(JSON.parse(JSON.stringify(o)));
    if (!check.success) throw new CommandError(`That change would make "${o.name}" invalid: ${check.error.issues[0]?.message}`);
  },
});

/** Move/rotate many objects at once (drag, nudge, align). Locked objects are refused. */
export const moveObjects = defineCommand({
  type: 'object.move',
  label: (p) => (p.moves.length === 1 ? 'Move object' : `Move ${p.moves.length} objects`),
  payload: z.object({
    ...ScenarioRef,
    moves: z.array(z.object({ id: z.string(), x: MmSchema, y: MmSchema, rotation: DegreesSchema.optional() })).min(1),
    /** Which position to move for mobile items. Default: the parked position. */
    position: z.enum(['parked', 'working']).default('parked'),
    /** Allow moving locked objects (explicit user override). */
    force: z.boolean().default(false),
  }),
  execute(project, p) {
    const s = scenarioOf(project, p.scenarioId);
    for (const m of p.moves) {
      const o = findOrThrow(s.objects, m.id, 'object');
      if (o.locked && !p.force) throw new CommandError(`"${o.name}" is locked. Unlock it to move it.`);
      if (p.position === 'working') {
        const base = o.working ?? { x: o.x, y: o.y, rotation: o.rotation };
        o.working = { x: quantize(m.x), y: quantize(m.y), rotation: normalizeRotation(m.rotation ?? base.rotation) };
      } else {
        o.x = quantize(m.x);
        o.y = quantize(m.y);
        if (m.rotation !== undefined) o.rotation = normalizeRotation(m.rotation);
      }
    }
  },
});

export const deleteObjects = defineCommand({
  type: 'object.delete',
  label: (p) => (p.ids.length === 1 ? 'Delete object' : `Delete ${p.ids.length} objects`),
  payload: z.object({ ...ScenarioRef, ids: z.array(z.string()).min(1), force: z.boolean().default(false) }),
  execute(project, p) {
    const s = scenarioOf(project, p.scenarioId);
    const ids = new Set(p.ids);
    const locked = s.objects.filter((o) => ids.has(o.id) && o.locked);
    if (locked.length && !p.force) throw new CommandError(`"${locked[0]!.name}" is locked. Unlock it to delete it.`);
    removeByIds(s.objects, ids);
    // Remove dangling references.
    s.relationships = s.relationships.filter((r) => !ids.has(r.fromId) && !ids.has(r.toId));
    const usedGroups = new Set(s.objects.map((o) => o.groupId).filter(Boolean));
    s.groups = s.groups.filter((g) => usedGroups.has(g.id));
  },
});

export const duplicateObjects = defineCommand({
  type: 'object.duplicate',
  label: (p) => (p.ids.length === 1 ? 'Duplicate object' : `Duplicate ${p.ids.length} objects`),
  payload: z.object({
    ...ScenarioRef,
    ids: z.array(z.string()).min(1),
    offset: z.object({ x: MmSchema, y: MmSchema }).default({ x: 304.8, y: 304.8 }),
    /** Optional explicit id mapping (old → new) for deterministic replay. */
    idMap: z.record(z.string(), z.string()).optional(),
  }),
  execute(project, p, ctx) {
    const s = scenarioOf(project, p.scenarioId);
    const groupMap = new Map<string, string>();
    for (const id of p.ids) {
      const o = findOrThrow(s.objects, id, 'object');
      const copy = JSON.parse(JSON.stringify(o)) as PlacedObject;
      copy.id = p.idMap?.[id] ?? ctx.newId();
      assertUniqueId(s.objects, copy.id, 'object');
      copy.x = quantize(o.x + p.offset.x);
      copy.y = quantize(o.y + p.offset.y);
      if (copy.working) copy.working = { ...copy.working, x: quantize(copy.working.x + p.offset.x), y: quantize(copy.working.y + p.offset.y) };
      copy.locked = false;
      if (o.groupId) {
        // Duplicated group members form a new group together.
        let g = groupMap.get(o.groupId);
        if (!g) {
          g = ctx.newId();
          groupMap.set(o.groupId, g);
          const orig = s.groups.find((x) => x.id === o.groupId);
          s.groups.push({ id: g, name: `${orig?.name ?? 'Group'} copy`, locked: false });
        }
        copy.groupId = g;
      }
      s.objects.push(copy);
    }
  },
});

/** Change z-order (bring forward / send backward / to front / to back). */
export const reorderObject = defineCommand({
  type: 'object.reorder',
  label: 'Change stacking order',
  payload: z.object({ ...ScenarioRef, id: z.string(), to: z.enum(['forward', 'backward', 'front', 'back']) }),
  execute(project, p) {
    const s = scenarioOf(project, p.scenarioId);
    const i = s.objects.findIndex((o) => o.id === p.id);
    if (i < 0) throw new CommandError('That object no longer exists.');
    const [o] = s.objects.splice(i, 1);
    const n = s.objects.length;
    const j = p.to === 'front' ? n : p.to === 'back' ? 0 : p.to === 'forward' ? Math.min(n, i + 1) : Math.max(0, i - 1);
    s.objects.splice(j, 0, o!);
  },
});

export const groupObjects = defineCommand({
  type: 'object.group',
  label: 'Group objects',
  payload: z.object({ ...ScenarioRef, ids: z.array(z.string()).min(2), group: GroupSchema }),
  execute(project, p) {
    const s = scenarioOf(project, p.scenarioId);
    assertUniqueId(s.groups, p.group.id, 'group');
    s.groups.push(p.group);
    for (const id of p.ids) findOrThrow(s.objects, id, 'object').groupId = p.group.id;
    const used = new Set(s.objects.map((o) => o.groupId).filter(Boolean));
    s.groups = s.groups.filter((g) => used.has(g.id));
  },
});

export const ungroupObjects = defineCommand({
  type: 'object.ungroup',
  label: 'Ungroup',
  payload: z.object({ ...ScenarioRef, groupId: z.string() }),
  execute(project, p) {
    const s = scenarioOf(project, p.scenarioId);
    for (const o of s.objects) if (o.groupId === p.groupId) delete o.groupId;
    s.groups = s.groups.filter((g) => g.id !== p.groupId);
  },
});

/** Copy objects (with their definitions) into another scenario, e.g. paste across scenarios. */
export const copyObjectsToScenario = defineCommand({
  type: 'object.copyToScenario',
  label: 'Copy to layout',
  payload: z.object({
    fromScenarioId: z.string(),
    toScenarioId: z.string(),
    ids: z.array(z.string()).min(1),
    /** Keep ids (same physical item) when not already present in the target; otherwise new ids. */
    keepIds: z.boolean().default(true),
  }),
  execute(project, p, ctx) {
    const from = scenarioOf(project, p.fromScenarioId);
    const to = scenarioOf(project, p.toScenarioId);
    const groupMap = new Map<string, string>();
    for (const id of p.ids) {
      const o = findOrThrow(from.objects, id, 'object');
      const copy = JSON.parse(JSON.stringify(o)) as PlacedObject;
      if (!p.keepIds || to.objects.some((x) => x.id === copy.id)) copy.id = ctx.newId();
      if (copy.groupId) {
        let g = groupMap.get(copy.groupId);
        if (!g) {
          const src = from.groups.find((x) => x.id === copy.groupId);
          g = to.groups.some((x) => x.id === copy.groupId) ? ctx.newId() : copy.groupId;
          groupMap.set(copy.groupId, g);
          to.groups.push({ id: g, name: src?.name ?? 'Group', locked: src?.locked ?? false });
        }
        copy.groupId = g;
      }
      to.objects.push(copy);
    }
  },
});

export const setObjectPose = defineCommand({
  type: 'object.setWorkingPosition',
  label: 'Set working position',
  payload: z.object({ ...ScenarioRef, id: z.string(), pose: PoseSchema.nullable() }),
  execute(project, p) {
    const s = scenarioOf(project, p.scenarioId);
    const o = findOrThrow(s.objects, p.id, 'object');
    if (p.pose === null) {
      delete o.working;
      o.activePosition = 'parked';
    } else {
      o.working = { x: quantize(p.pose.x), y: quantize(p.pose.y), rotation: normalizeRotation(p.pose.rotation) };
    }
  },
});

declare module '../registry' {
  interface CommandPayloads {
    'definition.upsert': z.input<typeof upsertDefinition.payload>;
    'object.add': z.input<typeof addObjects.payload>;
    'object.update': z.input<typeof updateObject.payload>;
    'object.move': z.input<typeof moveObjects.payload>;
    'object.delete': z.input<typeof deleteObjects.payload>;
    'object.duplicate': z.input<typeof duplicateObjects.payload>;
    'object.reorder': z.input<typeof reorderObject.payload>;
    'object.group': z.input<typeof groupObjects.payload>;
    'object.ungroup': z.input<typeof ungroupObjects.payload>;
    'object.copyToScenario': z.input<typeof copyObjectsToScenario.payload>;
    'object.setWorkingPosition': z.input<typeof setObjectPose.payload>;
  }
}
