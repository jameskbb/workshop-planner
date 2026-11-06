import { z } from 'zod';
import { CommandError, defineCommand } from '../registry';
import { assertUniqueId, findOrThrow } from '../helpers';
import type { Scenario } from '../../schema';

function emptyScenario(id: string, name: string, now: string): Scenario {
  return {
    id,
    name,
    description: '',
    createdAt: now,
    updatedAt: now,
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
  };
}

export const setActiveScenario = defineCommand({
  type: 'scenario.setActive',
  label: 'Switch layout',
  history: false,
  payload: z.object({ scenarioId: z.string() }),
  execute(project, p) {
    findOrThrow(project.scenarios, p.scenarioId, 'layout');
    project.activeScenarioId = p.scenarioId;
  },
});

export const createScenarioCmd = defineCommand({
  type: 'scenario.create',
  label: (p) => `New layout "${p.name}"`,
  payload: z.object({ id: z.string().optional(), name: z.string().trim().min(1), activate: z.boolean().default(true) }),
  execute(project, p, ctx) {
    const id = p.id ?? ctx.newId();
    assertUniqueId(project.scenarios, id, 'layout');
    project.scenarios.push(emptyScenario(id, p.name, ctx.now));
    if (p.activate) project.activeScenarioId = id;
  },
});

/**
 * Duplicate a scenario's arrangement (room geometry is shared, so it is preserved automatically).
 * Entity ids are kept so the same physical item is recognizable across scenarios.
 */
export const duplicateScenarioCmd = defineCommand({
  type: 'scenario.duplicate',
  label: (p) => `Duplicate layout as "${p.name}"`,
  payload: z.object({
    sourceId: z.string().optional(),
    id: z.string().optional(),
    name: z.string().trim().min(1),
    activate: z.boolean().default(true),
  }),
  execute(project, p, ctx) {
    const source = findOrThrow(project.scenarios, p.sourceId ?? project.activeScenarioId, 'layout');
    const id = p.id ?? ctx.newId();
    assertUniqueId(project.scenarios, id, 'layout');
    // Drafts are proxies; a JSON round-trip yields a plain deep copy (all project data is JSON-safe).
    const copy = JSON.parse(JSON.stringify(source)) as Scenario;
    copy.id = id;
    copy.name = p.name;
    copy.createdAt = ctx.now;
    copy.updatedAt = ctx.now;
    const index = project.scenarios.findIndex((s) => s.id === source.id);
    project.scenarios.splice(index + 1, 0, copy);
    if (p.activate) project.activeScenarioId = id;
  },
});

export const renameScenario = defineCommand({
  type: 'scenario.rename',
  label: 'Rename layout',
  payload: z.object({ scenarioId: z.string(), name: z.string().trim().min(1), description: z.string().optional() }),
  execute(project, p, ctx) {
    const s = findOrThrow(project.scenarios, p.scenarioId, 'layout');
    s.name = p.name;
    if (p.description !== undefined) s.description = p.description;
    s.updatedAt = ctx.now;
  },
});

export const deleteScenario = defineCommand({
  type: 'scenario.delete',
  label: 'Delete layout',
  payload: z.object({ scenarioId: z.string() }),
  execute(project, p) {
    if (project.scenarios.length <= 1) throw new CommandError('A project needs at least one layout, so the last one cannot be deleted.');
    const index = project.scenarios.findIndex((s) => s.id === p.scenarioId);
    if (index < 0) throw new CommandError('That layout no longer exists.');
    project.scenarios.splice(index, 1);
    if (project.activeScenarioId === p.scenarioId) project.activeScenarioId = project.scenarios[Math.max(0, index - 1)]!.id;
    if (project.reorganization.currentScenarioId === p.scenarioId) delete project.reorganization.currentScenarioId;
    if (project.reorganization.targetScenarioId === p.scenarioId) delete project.reorganization.targetScenarioId;
  },
});

export const reorderScenarios = defineCommand({
  type: 'scenario.reorder',
  label: 'Reorder layouts',
  payload: z.object({ order: z.array(z.string()) }),
  execute(project, p) {
    if (p.order.length !== project.scenarios.length || !project.scenarios.every((s) => p.order.includes(s.id))) {
      throw new CommandError('The new layout order must include every layout exactly once.');
    }
    project.scenarios.sort((a, b) => p.order.indexOf(a.id) - p.order.indexOf(b.id));
  },
});

declare module '../registry' {
  interface CommandPayloads {
    'scenario.setActive': z.input<typeof setActiveScenario.payload>;
    'scenario.create': z.input<typeof createScenarioCmd.payload>;
    'scenario.duplicate': z.input<typeof duplicateScenarioCmd.payload>;
    'scenario.rename': z.input<typeof renameScenario.payload>;
    'scenario.delete': z.input<typeof deleteScenario.payload>;
    'scenario.reorder': z.input<typeof reorderScenarios.payload>;
  }
}
