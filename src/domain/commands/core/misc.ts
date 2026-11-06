import { z } from 'zod';
import { getExtensionDef } from '../../extensions';
import { SavedViewSchema } from '../../schema';
import { CommandError, defineCommand } from '../registry';
import { findOrThrow, scenarioOf } from '../helpers';

export const acknowledgeWarning = defineCommand({
  type: 'warning.acknowledge',
  label: (p) => (p.status === 'ignored' ? 'Ignore warning' : 'Acknowledge warning'),
  payload: z.object({
    scenarioId: z.string().optional(),
    warningId: z.string(),
    status: z.enum(['acknowledged', 'ignored']).default('acknowledged'),
    note: z.string().optional(),
  }),
  execute(project, p, ctx) {
    const s = scenarioOf(project, p.scenarioId);
    s.acknowledgedWarnings[p.warningId] = { status: p.status, at: ctx.now, ...(p.note ? { note: p.note } : {}) };
  },
});

export const unacknowledgeWarning = defineCommand({
  type: 'warning.unacknowledge',
  label: 'Restore warning',
  payload: z.object({ scenarioId: z.string().optional(), warningId: z.string() }),
  execute(project, p) {
    const s = scenarioOf(project, p.scenarioId);
    delete s.acknowledgedWarnings[p.warningId];
  },
});

/**
 * Set a feature's extension data (see src/domain/extensions.ts). If the key was declared with
 * `defineExtension`, the value is validated against its schema.
 */
export const setExtension = defineCommand({
  type: 'extension.set',
  label: (p) => p.label ?? 'Change settings',
  history: (p) => p.history !== false,
  payload: z.object({
    target: z.enum(['project', 'scenario']),
    scenarioId: z.string().optional(),
    key: z.string().min(1),
    value: z.unknown(),
    label: z.string().optional(),
    /** Record in undo history (default true). */
    history: z.boolean().optional(),
  }),
  execute(project, p) {
    const def = getExtensionDef(p.key);
    let value = p.value;
    if (def) {
      const r = def.schema.safeParse(value);
      if (!r.success) throw new CommandError(`Invalid data for "${p.key}": ${r.error.issues[0]?.message}`);
      value = r.data;
    }
    const target = p.target === 'project' ? project : scenarioOf(project, p.scenarioId);
    if (value === undefined) delete target.extensions[p.key];
    else target.extensions[p.key] = JSON.parse(JSON.stringify(value));
  },
});

export const saveView = defineCommand({
  type: 'view.save',
  label: (p) => `Save view "${p.view.name}"`,
  payload: z.object({ view: SavedViewSchema }),
  execute(project, p) {
    const i = project.savedViews.findIndex((v) => v.id === p.view.id);
    if (i >= 0) project.savedViews[i] = p.view;
    else project.savedViews.push(p.view);
  },
});

export const deleteView = defineCommand({
  type: 'view.delete',
  label: 'Delete saved view',
  payload: z.object({ id: z.string() }),
  execute(project, p) {
    findOrThrow(project.savedViews, p.id, 'saved view');
    project.savedViews = project.savedViews.filter((v) => v.id !== p.id);
  },
});

export const setInventoryNote = defineCommand({
  type: 'inventory.setNote',
  label: 'Edit inventory note',
  payload: z.object({ key: z.string(), note: z.string() }),
  execute(project, p) {
    if (p.note.trim() === '') delete project.inventoryNotes[p.key];
    else project.inventoryNotes[p.key] = p.note;
  },
});

export const setReorganization = defineCommand({
  type: 'reorganization.setScenarios',
  label: 'Set current/target layouts',
  payload: z.object({ currentScenarioId: z.string().nullable().optional(), targetScenarioId: z.string().nullable().optional() }),
  execute(project, p) {
    const r = project.reorganization;
    for (const key of ['currentScenarioId', 'targetScenarioId'] as const) {
      const v = p[key];
      if (v === undefined) continue;
      if (v === null) delete r[key];
      else {
        findOrThrow(project.scenarios, v, 'layout');
        r[key] = v;
      }
    }
  },
});

export const setMoveStepStatus = defineCommand({
  type: 'reorganization.setStepStatus',
  label: 'Update move step',
  payload: z.object({ stepKey: z.string(), status: z.enum(['moved', 'skipped', 'blocked']).nullable() }),
  execute(project, p) {
    if (p.status === null) delete project.reorganization.stepStatus[p.stepKey];
    else project.reorganization.stepStatus[p.stepKey] = p.status;
  },
});

declare module '../registry' {
  interface CommandPayloads {
    'warning.acknowledge': z.input<typeof acknowledgeWarning.payload>;
    'warning.unacknowledge': z.input<typeof unacknowledgeWarning.payload>;
    'extension.set': z.input<typeof setExtension.payload>;
    'view.save': z.input<typeof saveView.payload>;
    'view.delete': z.input<typeof deleteView.payload>;
    'inventory.setNote': z.input<typeof setInventoryNote.payload>;
    'reorganization.setScenarios': z.input<typeof setReorganization.payload>;
    'reorganization.setStepStatus': z.input<typeof setMoveStepStatus.payload>;
  }
}
