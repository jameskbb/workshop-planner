import { z } from 'zod';
import { LayerIdSchema, ProjectSettingsSchema } from '../../schema';
import { defineCommand } from '../registry';
import { patchOf } from '../helpers';

export const renameProject = defineCommand({
  type: 'project.rename',
  label: 'Rename project',
  payload: z.object({ name: z.string().trim().min(1, 'Name cannot be empty') }),
  execute(project, p) {
    project.name = p.name;
  },
});

export const setProjectNotes = defineCommand({
  type: 'project.setNotes',
  label: 'Edit project notes',
  payload: z.object({ notes: z.string() }),
  execute(project, p) {
    project.notes = p.notes;
  },
});

const SettingsPatch = patchOf(ProjectSettingsSchema);

export const updateSettings = defineCommand({
  type: 'project.updateSettings',
  label: 'Change project settings',
  payload: z.object({ patch: SettingsPatch }),
  execute(project, p) {
    const next = ProjectSettingsSchema.parse({ ...project.settings, ...p.patch });
    Object.assign(project.settings, next);
  },
});

export const setLayerVisibility = defineCommand({
  type: 'layer.setVisibility',
  label: (p) => `${p.visible ? 'Show' : 'Hide'} ${p.layer} layer`,
  history: false,
  payload: z.object({ layer: LayerIdSchema, visible: z.boolean() }),
  execute(project, p) {
    project.layers[p.layer] = { ...project.layers[p.layer], visible: p.visible };
  },
});

export const setLayerLocked = defineCommand({
  type: 'layer.setLocked',
  label: (p) => `${p.locked ? 'Lock' : 'Unlock'} ${p.layer} layer`,
  payload: z.object({ layer: LayerIdSchema, locked: z.boolean() }),
  execute(project, p) {
    project.layers[p.layer] = { ...project.layers[p.layer], locked: p.locked };
  },
});

declare module '../registry' {
  interface CommandPayloads {
    'project.rename': z.input<typeof renameProject.payload>;
    'project.setNotes': z.input<typeof setProjectNotes.payload>;
    'project.updateSettings': z.input<typeof updateSettings.payload>;
    'layer.setVisibility': z.input<typeof setLayerVisibility.payload>;
    'layer.setLocked': z.input<typeof setLayerLocked.payload>;
  }
}
