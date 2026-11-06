/** Print mode: toolbar button, Ctrl/Cmd+P, palette command, and the full-screen print preview. */
import { Printer } from 'lucide-react';
import { paletteCommands, shellExtras, shortcuts, toolbarItems } from '@/app/registry';
import { ToolbarButton } from '@/components/shell';
import { useProjectStore } from '@/stores/projectStore';
import { openPrintMode, PrintMode } from './PrintMode';

function PrintButton() {
  return <ToolbarButton icon={Printer} label="Print" shortcut="mod+p" onClick={openPrintMode} testId="print-button" />;
}

toolbarItems.register({ id: 'print.button', group: 'right', order: 48, component: PrintButton });
shellExtras.register({ id: 'print.mode', order: 70, component: PrintMode });
shortcuts.register({
  id: 'print.open',
  keys: 'mod+p',
  description: 'Print mode',
  allowInInputs: true,
  when: () => !!useProjectStore.getState().project,
  run: () => openPrintMode(),
});
paletteCommands.register({
  id: 'print.open',
  title: 'Print mode…',
  section: 'Export',
  icon: Printer,
  shortcut: 'mod+p',
  keywords: ['print', 'paper', 'letter', 'a4', 'tabloid'],
  when: (c) => !!c.project,
  run: openPrintMode,
});
