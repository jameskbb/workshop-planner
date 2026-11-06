/**
 * Global keyboard shortcut dispatch over the `shortcuts` registry.
 * Key specs: 'mod+z', 'mod+shift+z', 'delete', 'backspace', 'escape', 'r', 'shift+arrowleft'.
 * `mod` = ⌘ on macOS, Ctrl elsewhere.
 */
import { canvasTools, shortcuts } from '@/app/registry';
import { uiActions, useUiStore } from '@/stores/uiStore';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Human label for a key spec ("mod+shift+z" → "⌘⇧Z" / "Ctrl+Shift+Z"). */
export function shortcutLabel(spec: string): string {
  const parts = spec.split('+');
  const names = parts.map((p) => {
    switch (p) {
      case 'mod':
        return isMac ? '⌘' : 'Ctrl';
      case 'shift':
        return isMac ? '⇧' : 'Shift';
      case 'alt':
        return isMac ? '⌥' : 'Alt';
      case 'delete':
        return 'Del';
      case 'escape':
        return 'Esc';
      case 'arrowleft':
        return '←';
      case 'arrowright':
        return '→';
      case 'arrowup':
        return '↑';
      case 'arrowdown':
        return '↓';
      default:
        return p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1);
    }
  });
  return isMac ? names.join('') : names.join('+');
}

export function eventSpec(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('mod');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  let key = e.key.toLowerCase();
  if (key === ' ') key = 'space';
  if (key === 'del') key = 'delete';
  if (key === '+') key = '=';
  parts.push(key);
  return parts.join('+');
}

function normalize(spec: string): string {
  const parts = spec.toLowerCase().split('+');
  const key = parts.pop()!;
  const mods = ['mod', 'shift', 'alt'].filter((m) => parts.includes(m));
  return [...mods, key].join('+');
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

/** Handle a keydown against registered shortcuts and single-key tool shortcuts. Returns true if handled. */
export function handleShortcut(e: KeyboardEvent): boolean {
  const spec = eventSpec(e);
  const typing = isTypingTarget(e.target);
  for (const s of shortcuts.list()) {
    const keys = Array.isArray(s.keys) ? s.keys : [s.keys];
    if (!keys.some((k) => normalize(k) === spec)) continue;
    if (typing && !s.allowInInputs) continue;
    if (s.when && !s.when()) continue;
    const r = s.run(e);
    if (r !== false) {
      e.preventDefault();
      return true;
    }
  }
  // Canvas tools belong to the 2D plan: their single-key shortcuts stay out of the way in the 3D /
  // Elevation / Compare views (where W/A/S/D drive walk mode) instead of switching a hidden tool.
  if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && useUiStore.getState().view === '2d') {
    const tool = canvasTools.list().find((t) => t.shortcut && t.shortcut.toLowerCase() === spec);
    if (tool) {
      uiActions.setTool(tool.id);
      e.preventDefault();
      return true;
    }
  }
  return false;
}
