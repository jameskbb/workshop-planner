/**
 * Shell-level contributions that every feature relies on: tool picker, undo/redo, command palette,
 * and their shortcuts. (Feature-specific UI registers from src/features/<feature>/register.tsx.)
 */
import { Command, Redo2, Undo2 } from 'lucide-react';
import { canvasTools, paletteCommands, shortcuts, toolbarItems } from '@/app/registry';
import { ToolbarButton } from '@/components/shell';
import { canRedo, canUndo, redo, redoLabel, undo, undoLabel, useProjectStore } from '@/stores/projectStore';
import { uiActions, useUiStore } from '@/stores/uiStore';
import { isTypingTarget } from './keyboard';

function ToolPicker() {
  const tools = canvasTools.useItems().filter((t) => !t.hidden);
  const active = useUiStore((s) => s.tool);
  return (
    <>
      {tools.map((t) => (
        <ToolbarButton key={t.id} icon={t.icon} label={t.label} shortcut={t.shortcut} active={active === t.id} onClick={() => uiActions.setTool(t.id)} testId={`tool-${t.id}`} />
      ))}
    </>
  );
}

function UndoRedo() {
  const u = useProjectStore(canUndo);
  const r = useProjectStore(canRedo);
  const ul = useProjectStore(undoLabel);
  const rl = useProjectStore(redoLabel);
  return (
    <>
      <ToolbarButton icon={Undo2} label={ul ? `Undo ${ul}` : 'Undo'} shortcut="mod+z" disabled={!u} onClick={() => undo()} testId="undo" />
      <ToolbarButton icon={Redo2} label={rl ? `Redo ${rl}` : 'Redo'} shortcut="mod+shift+z" disabled={!r} onClick={() => redo()} testId="redo" />
    </>
  );
}

function PaletteButton() {
  return <ToolbarButton icon={Command} label="Command palette" shortcut="mod+k" onClick={() => uiActions.setCommandPaletteOpen(true)} testId="open-palette" />;
}

// Canvas tools draw on the 2D plan: hidden in the 3D / Elevation / Compare views (no fake buttons).
toolbarItems.register({ id: 'core.tools', group: 'tools', order: 10, views: ['2d'], component: ToolPicker });
toolbarItems.register({ id: 'core.undo-redo', group: 'edit', order: 10, component: UndoRedo });
toolbarItems.register({ id: 'core.palette', group: 'right', order: 90, component: PaletteButton });

const hasProject = () => useProjectStore.getState().project !== null;

shortcuts.register({ id: 'core.undo', keys: 'mod+z', description: 'Undo', when: hasProject, run: () => void undo() });
shortcuts.register({ id: 'core.redo', keys: ['mod+shift+z', 'mod+y'], description: 'Redo', when: hasProject, run: () => void redo() });
shortcuts.register({
  id: 'core.palette',
  keys: 'mod+k',
  description: 'Open the command palette',
  allowInInputs: true,
  when: hasProject,
  run: () => uiActions.setCommandPaletteOpen(!useUiStore.getState().commandPaletteOpen),
});
shortcuts.register({
  id: 'core.escape',
  keys: 'escape',
  description: 'Clear selection / return to the select tool',
  run: (e) => {
    if (isTypingTarget(e.target)) return false;
    const s = useUiStore.getState();
    if (s.tool !== 'select') uiActions.setTool('select');
    else if (s.selection.length) uiActions.clearSelection();
    else return false;
  },
});

paletteCommands.register({ id: 'core.undo', title: 'Undo', section: 'Edit', icon: Undo2, shortcut: 'mod+z', when: (c) => !!c.project, run: () => void undo() });
paletteCommands.register({ id: 'core.redo', title: 'Redo', section: 'Edit', icon: Redo2, shortcut: 'mod+shift+z', when: (c) => !!c.project, run: () => void redo() });
