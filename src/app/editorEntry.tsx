/**
 * Lazy entry point for the editor: the shell registrations, every feature's register module and
 * the shell itself. The home screen (project list, wizard, backups) does not need any of it, so
 * keeping it behind one dynamic import keeps the first paint small.
 *
 * Order matters: shell registrations first, then every feature's register module, then the shell.
 */
import '@/app/shell/coreRegistrations';
import '@/app/registry/loadFeatures';
import { EditorShell } from './shell/EditorShell';

export default EditorShell;
