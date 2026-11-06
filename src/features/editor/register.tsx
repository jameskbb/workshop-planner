/**
 * Editor registrations: entity adapters, feedback layers (guides, HUD), keyboard shortcuts, context
 * menu, command palette entries, the Arrange menu and the multi-selection inspector.
 */
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDownToLine,
  ArrowUpToLine,
  BringToFront,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Eye,
  EyeOff,
  Focus,
  Group,
  LayoutGrid,
  Lock,
  LockOpen,
  MapPin,
  Ruler,
  RotateCw,
  Scissors,
  SendToBack,
  Shield,
  Star,
  Trash2,
  Truck,
  Ungroup,
} from 'lucide-react';
import {
  canvasLayers,
  canvasOverlays,
  contextMenuActions,
  inspectorSections,
  paletteCommands,
  shellExtras,
  shortcuts,
  toolbarItems,
  type SelectionContext,
} from '@/app/registry';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Kbd, Tip } from '@/components/ui';
import { ToolbarLabel } from '@/components/shell';
import { shortcutLabel } from '@/app/shell/keyboard';
import { findObject } from '@/domain/resolve';
import { bbox, bboxUnion } from '@/geometry';
import { useFormatters } from '@/hooks/useFormatters';
import { useProjectStore } from '@/stores/projectStore';
import { editorActions, useEditorStore } from '@/stores/editorStore';
import { uiActions, useUiStore } from '@/stores/uiStore';
import './adapters';
import { GuidesLayer, HudOverlay } from './canvasLayers';
import { EditorDialogs } from './dialogs';
import { CanvasEmptyState, Compass, Minimap, Rulers } from './viewChrome';
import './viewMenu';
import {
  alignSelection,
  copySelection,
  deleteSelection,
  distributeSelection,
  duplicateSelection,
  fitSelection,
  focusInspectorField,
  groupSelection,
  nudge,
  pasteClipboard,
  reorderSelection,
  rotateSelection,
  setParkedPosition,
  setWorkingPosition,
  toggleFlag,
  ungroupSelection,
} from './ops';
import { adapter } from './selection';

// ───────────── layers, overlays, dialogs ─────────────

canvasLayers.register({ id: 'editor.guides', slot: 'ui', order: 10, component: GuidesLayer });
canvasOverlays.register({ id: 'editor.rulers', order: 10, component: Rulers });
canvasOverlays.register({ id: 'editor.compass', order: 20, component: Compass });
canvasOverlays.register({ id: 'editor.minimap', order: 30, component: Minimap });
canvasOverlays.register({ id: 'editor.hud', order: 50, component: HudOverlay });
canvasOverlays.register({ id: 'editor.empty', order: 90, component: CanvasEmptyState });
shellExtras.register({ id: 'editor.dialogs', order: 10, component: EditorDialogs });

// ───────────── shortcuts ─────────────

const hasProject = () => useProjectStore.getState().project !== null;
const hasSelection = () => hasProject() && useUiStore.getState().selection.length > 0;
const in2d = () => hasProject() && useUiStore.getState().view === '2d';

const arrows: Array<[string, number, number]> = [
  ['arrowleft', -1, 0],
  ['arrowright', 1, 0],
  ['arrowup', 0, -1],
  ['arrowdown', 0, 1],
];
for (const [key, dx, dy] of arrows) {
  shortcuts.register({ id: `editor.nudge.${key}`, keys: key, description: 'Nudge the selection', when: hasSelection, run: () => nudge(dx, dy, false) });
  shortcuts.register({ id: `editor.nudge-large.${key}`, keys: `shift+${key}`, description: 'Nudge the selection further', when: hasSelection, run: () => nudge(dx, dy, true) });
}
shortcuts.register({ id: 'editor.duplicate', keys: 'mod+d', description: 'Duplicate', when: hasSelection, run: () => duplicateSelection() });
shortcuts.register({ id: 'editor.copy', keys: 'mod+c', description: 'Copy', when: hasSelection, run: () => copySelection() });
shortcuts.register({ id: 'editor.cut', keys: 'mod+x', description: 'Cut', when: hasSelection, run: () => copySelection(true) });
shortcuts.register({ id: 'editor.paste', keys: 'mod+v', description: 'Paste', when: hasProject, run: () => pasteClipboard() });
shortcuts.register({ id: 'editor.rotate', keys: 'r', description: 'Rotate 90° clockwise', when: hasSelection, run: () => rotateSelection(90) });
shortcuts.register({ id: 'editor.rotate-ccw', keys: 'shift+r', description: 'Rotate 90° counter-clockwise', when: hasSelection, run: () => rotateSelection(-90) });
shortcuts.register({ id: 'editor.lock', keys: 'l', description: 'Lock / unlock', when: hasSelection, run: () => toggleFlag('locked') });
shortcuts.register({ id: 'editor.hide', keys: 'mod+shift+h', description: 'Hide / show', when: hasSelection, run: () => toggleFlag('hidden') });
shortcuts.register({ id: 'editor.group', keys: 'g', description: 'Group', when: hasSelection, run: () => groupSelection() });
shortcuts.register({ id: 'editor.ungroup', keys: 'shift+g', description: 'Ungroup', when: hasSelection, run: () => ungroupSelection() });
shortcuts.register({ id: 'editor.forward', keys: 'mod+]', description: 'Bring forward', when: hasSelection, run: () => reorderSelection('forward') });
shortcuts.register({ id: 'editor.backward', keys: 'mod+[', description: 'Send backward', when: hasSelection, run: () => reorderSelection('backward') });
shortcuts.register({ id: 'editor.front', keys: 'mod+shift+]', description: 'Bring to front', when: hasSelection, run: () => reorderSelection('front') });
shortcuts.register({ id: 'editor.back', keys: 'mod+shift+[', description: 'Send to back', when: hasSelection, run: () => reorderSelection('back') });
shortcuts.register({ id: 'editor.fit-selection', keys: ['shift+2', 'shift+@'], description: 'Zoom to the selection', when: hasSelection, run: () => fitSelection() });
shortcuts.register({ id: 'plan.delete', keys: ['delete', 'backspace'], description: 'Delete the selection', when: () => hasSelection() && in2d(), run: () => deleteSelection() });

// ───────────── context menu ─────────────

const entityRefs = (c: SelectionContext) => c.refs.filter((r) => r.kind !== 'wall' && r.kind !== 'vertex');
const hasEntities = (c: SelectionContext) => entityRefs(c).length > 0;
const objects = (c: SelectionContext) =>
  c.refs
    .filter((r) => r.kind === 'object')
    .map((r) => findObject(c.scenario, r.id))
    .filter((o) => !!o);
const singleObject = (c: SelectionContext) => (c.single?.kind === 'object' ? findObject(c.scenario, c.single.id) : undefined);
const ctx = (c: SelectionContext) => ({ project: c.project, scenario: c.scenario });
const allFlag = (c: SelectionContext, flag: 'locked' | 'hidden') =>
  entityRefs(c).every((r) => (flag === 'locked' ? adapter(r.kind)?.locked?.(ctx(c), r.id) : adapter(r.kind)?.hidden?.(ctx(c), r.id)));

contextMenuActions.register({ id: 'object.duplicate', group: 'edit', order: 10, label: 'Duplicate', icon: CopyPlus, shortcut: 'mod+d', appliesTo: hasEntities, run: () => duplicateSelection() });
contextMenuActions.register({ id: 'editor.copy', group: 'edit', order: 12, label: 'Copy', icon: Copy, shortcut: 'mod+c', appliesTo: hasEntities, run: () => copySelection() });
contextMenuActions.register({
  id: 'editor.paste',
  group: 'edit',
  order: 14,
  label: 'Paste',
  icon: ClipboardPaste,
  shortcut: 'mod+v',
  appliesTo: () => !!useEditorStore.getState().clipboard,
  run: () => pasteClipboard(),
});
contextMenuActions.register({
  id: 'editor.rotate',
  group: 'edit',
  order: 16,
  label: 'Rotate 90°',
  icon: RotateCw,
  shortcut: 'r',
  appliesTo: (c) => entityRefs(c).some((r) => adapter(r.kind)?.rotate?.(ctx(c), r.id, { x: 0, y: 0 }, 0)),
  run: () => rotateSelection(90),
});
contextMenuActions.register({
  id: 'object.lock',
  group: 'edit',
  order: 20,
  label: (c) => (allFlag(c, 'locked') ? 'Unlock' : 'Lock'),
  icon: Lock,
  shortcut: 'l',
  appliesTo: (c) => entityRefs(c).some((r) => adapter(r.kind)?.locked),
  run: () => toggleFlag('locked'),
});
contextMenuActions.register({
  id: 'object.hide',
  group: 'edit',
  order: 30,
  label: (c) => (allFlag(c, 'hidden') ? 'Show' : 'Hide'),
  icon: EyeOff,
  shortcut: 'mod+shift+h',
  appliesTo: hasEntities,
  run: () => toggleFlag('hidden'),
});
contextMenuActions.register({
  id: 'editor.group',
  group: 'arrange',
  order: 10,
  label: 'Group',
  icon: Group,
  shortcut: 'g',
  appliesTo: (c) => objects(c).length >= 2 && new Set(objects(c).map((o) => o!.groupId ?? o!.id)).size > 1,
  run: () => groupSelection(),
});
contextMenuActions.register({
  id: 'editor.ungroup',
  group: 'arrange',
  order: 12,
  label: 'Ungroup',
  icon: Ungroup,
  shortcut: 'shift+g',
  appliesTo: (c) => objects(c).some((o) => o!.groupId),
  run: () => ungroupSelection(),
});
contextMenuActions.register({ id: 'editor.forward', group: 'arrange', order: 20, label: 'Bring forward', icon: BringToFront, shortcut: 'mod+]', appliesTo: (c) => objects(c).length > 0, run: () => reorderSelection('forward') });
contextMenuActions.register({ id: 'editor.backward', group: 'arrange', order: 22, label: 'Send backward', icon: SendToBack, shortcut: 'mod+[', appliesTo: (c) => objects(c).length > 0, run: () => reorderSelection('backward') });
contextMenuActions.register({
  id: 'editor.parked',
  group: 'mobile',
  order: 10,
  label: 'Set parked position',
  icon: MapPin,
  appliesTo: (c) => !!singleObject(c),
  run: () => setParkedPosition(),
});
contextMenuActions.register({
  id: 'editor.working',
  group: 'mobile',
  order: 12,
  label: 'Set working position',
  icon: Truck,
  appliesTo: (c) => !!singleObject(c),
  run: () => setWorkingPosition(),
});
contextMenuActions.register({
  id: 'editor.view-clearances',
  group: 'inspect',
  order: 10,
  label: 'View clearances',
  icon: Shield,
  appliesTo: (c) => objects(c).length > 0,
  run: () => {
    uiActions.setOverlay('clearances', true);
    uiActions.flash('Clearance zones are shown (toggle them in the Overlays menu).');
  },
});
contextMenuActions.register({
  id: 'editor.edit-dimensions',
  group: 'inspect',
  order: 12,
  label: 'Edit dimensions…',
  icon: Ruler,
  appliesTo: (c) => !!singleObject(c) || c.single?.kind === 'feature' || c.single?.kind === 'wall',
  run: (c) => focusInspectorField(c.single?.kind === 'wall' ? 'wall-length' : c.single?.kind === 'feature' ? 'feature-width' : 'inspector-width'),
});
contextMenuActions.register({ id: 'editor.fit-selection', group: 'inspect', order: 14, label: 'Zoom to selection', icon: Focus, shortcut: 'shift+2', appliesTo: (c) => c.refs.length > 0, run: () => fitSelection() });
contextMenuActions.register({
  id: 'editor.copy-to-layout',
  group: 'inspect',
  order: 16,
  label: 'Copy to another layout…',
  icon: LayoutGrid,
  appliesTo: (c) => c.project.scenarios.length > 1 && entityRefs(c).some((r) => ['object', 'vehicle', 'light', 'zone', 'measurement'].includes(r.kind)),
  run: () => editorActions.openDialog('copy-to-layout'),
});
contextMenuActions.register({
  id: 'object.save-to-library',
  group: 'library',
  order: 50,
  label: (c) => (objects(c).length > 1 ? 'Save group to My objects…' : 'Save to My objects…'),
  icon: Star,
  appliesTo: (c) => objects(c).length > 0,
  run: (c) => {
    const os = objects(c);
    const g = os[0]?.groupId ? c.scenario.groups.find((x) => x.id === os[0]!.groupId)?.name : undefined;
    editorActions.openDialog('save-custom', { name: os.length === 1 ? (os[0]!.label ?? os[0]!.name) : (g ?? 'My station') });
  },
});
contextMenuActions.register({
  id: 'object.delete',
  group: 'danger',
  order: 90,
  label: 'Delete',
  icon: Trash2,
  shortcut: 'delete',
  destructive: true,
  appliesTo: (c) => hasEntities(c) || c.kinds.has('vertex'),
  run: () => deleteSelection(),
});

// ───────────── arrange menu (toolbar) ─────────────

function ArrangeMenu() {
  const n = useUiStore((s) => s.selection.length);
  const item = (label: string, Icon: typeof Copy, run: () => void, min: number, sc?: string) => (
    <DropdownMenuItem disabled={n < min} onSelect={run}>
      <Icon /> {label}
      {sc && <Kbd className="ml-auto">{shortcutLabel(sc)}</Kbd>}
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <Tip content="Arrange: align, distribute, group, order">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="Arrange" data-testid="arrange-menu">
            <AlignStartVertical /> <ToolbarLabel>Arrange</ToolbarLabel>
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent className="w-60">
        <DropdownMenuLabel>Align (2+ items)</DropdownMenuLabel>
        {item('Align left', AlignStartVertical, () => alignSelection('left'), 2)}
        {item('Align centers (horizontal)', AlignCenterVertical, () => alignSelection('center-horizontal'), 2)}
        {item('Align right', AlignEndVertical, () => alignSelection('right'), 2)}
        {item('Align top', AlignStartHorizontal, () => alignSelection('top'), 2)}
        {item('Align centers (vertical)', AlignCenterHorizontal, () => alignSelection('center-vertical'), 2)}
        {item('Align bottom', AlignEndHorizontal, () => alignSelection('bottom'), 2)}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Distribute (3+ items)</DropdownMenuLabel>
        {item('Distribute horizontally', AlignHorizontalDistributeCenter, () => distributeSelection('horizontal'), 3)}
        {item('Distribute vertically', AlignVerticalDistributeCenter, () => distributeSelection('vertical'), 3)}
        <DropdownMenuSeparator />
        {item('Group', Group, groupSelection, 2, 'g')}
        {item('Ungroup', Ungroup, ungroupSelection, 1, 'shift+g')}
        {item('Bring forward', ArrowUpToLine, () => reorderSelection('forward'), 1, 'mod+]')}
        {item('Send backward', ArrowDownToLine, () => reorderSelection('backward'), 1, 'mod+[')}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
toolbarItems.register({ id: 'editor.arrange', group: 'edit', order: 30, component: ArrangeMenu });

// ───────────── multi-selection inspector ─────────────

function MultiSelection({ ctx: c }: { ctx: SelectionContext }) {
  const fmt = useFormatters();
  const boxes = c.refs.map((r) => adapter(r.kind)?.outline(ctx(c), r.id)).filter((o) => o && o.length).map((o) => bbox(o!));
  const b = boxes.length ? bboxUnion(...boxes) : null;
  const counts = new Map<string, number>();
  for (const r of c.refs) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  const locked = allFlag(c, 'locked');
  const hidden = allFlag(c, 'hidden');
  const btn = (label: string, Icon: typeof Copy, run: () => void, disabled = false, testId?: string) => (
    <Tip content={label}>
      <Button size="icon-sm" variant="outline" aria-label={label} onClick={run} disabled={disabled} data-testid={testId}>
        <Icon />
      </Button>
    </Tip>
  );
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">
        {[...counts.entries()].map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`).join(', ')}
        {b && (
          <span className="num block text-ink">
            {fmt.length(b.maxX - b.minX)} × {fmt.length(b.maxY - b.minY)} overall
          </span>
        )}
      </p>
      <div>
        <div className="panel-heading mb-1">Align</div>
        <div className="flex flex-wrap gap-1">
          {btn('Align left', AlignStartVertical, () => alignSelection('left'), false, 'align-left')}
          {btn('Align centers horizontally', AlignCenterVertical, () => alignSelection('center-horizontal'))}
          {btn('Align right', AlignEndVertical, () => alignSelection('right'))}
          {btn('Align top', AlignStartHorizontal, () => alignSelection('top'), false, 'align-top')}
          {btn('Align centers vertically', AlignCenterHorizontal, () => alignSelection('center-vertical'))}
          {btn('Align bottom', AlignEndHorizontal, () => alignSelection('bottom'))}
          {btn('Distribute horizontally', AlignHorizontalDistributeCenter, () => distributeSelection('horizontal'), c.refs.length < 3)}
          {btn('Distribute vertically', AlignVerticalDistributeCenter, () => distributeSelection('vertical'), c.refs.length < 3)}
        </div>
        <p className="mt-1 text-2xs text-ink-faint">Locked items stay put and act as the anchor.</p>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="outline" onClick={duplicateSelection}>
          <CopyPlus /> Duplicate
        </Button>
        <Button size="sm" variant="outline" onClick={groupSelection} disabled={(counts.get('object') ?? 0) < 2} data-testid="group-selection">
          <Group /> Group
        </Button>
        <Button size="sm" variant="outline" onClick={() => toggleFlag('locked')}>
          {locked ? <LockOpen /> : <Lock />} {locked ? 'Unlock' : 'Lock'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => toggleFlag('hidden')}>
          {hidden ? <Eye /> : <EyeOff />} {hidden ? 'Show' : 'Hide'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => editorActions.openDialog('save-custom', { name: 'My station' })} disabled={!counts.get('object')}>
          <Star /> Save as object…
        </Button>
        <Button size="sm" variant="ghost" className="text-danger" onClick={deleteSelection}>
          <Trash2 /> Delete
        </Button>
      </div>
    </div>
  );
}
inspectorSections.register({ id: 'multi.objects', title: 'Selection', order: 10, appliesTo: (c) => c.refs.length > 1, component: MultiSelection });

// ───────────── palette ─────────────

const sel = (c: { selection: readonly unknown[] }) => c.selection.length > 0;
const P = (id: string, title: string, run: () => void, opts: { section?: string; shortcut?: string; icon?: typeof Copy; when?: (c: { project: unknown; selection: readonly unknown[] }) => boolean; keywords?: string[] } = {}) =>
  paletteCommands.register({ id, title, section: opts.section ?? 'Edit', icon: opts.icon, shortcut: opts.shortcut, keywords: opts.keywords, when: (c) => !!c.project && (opts.when ? opts.when(c) : true), run });

P('editor.duplicate', 'Duplicate selection', duplicateSelection, { shortcut: 'mod+d', icon: CopyPlus, when: sel });
P('editor.copy', 'Copy selection', () => copySelection(), { shortcut: 'mod+c', icon: Copy, when: sel });
P('editor.cut', 'Cut selection', () => copySelection(true), { shortcut: 'mod+x', icon: Scissors, when: sel });
P('editor.paste', 'Paste', pasteClipboard, { shortcut: 'mod+v', icon: ClipboardPaste, when: () => !!useEditorStore.getState().clipboard });
P('editor.delete', 'Delete selection', deleteSelection, { shortcut: 'delete', icon: Trash2, when: sel });
P('editor.rotate', 'Rotate 90° clockwise', () => rotateSelection(90), { shortcut: 'r', icon: RotateCw, when: sel });
P('editor.rotate-ccw', 'Rotate 90° counter-clockwise', () => rotateSelection(-90), { shortcut: 'shift+r', when: sel });
P('editor.lock', 'Lock / unlock selection', () => toggleFlag('locked'), { shortcut: 'l', icon: Lock, when: sel });
P('editor.hide', 'Hide / show selection', () => toggleFlag('hidden'), { shortcut: 'mod+shift+h', icon: EyeOff, when: sel });
P('editor.group', 'Group selection', groupSelection, { shortcut: 'g', icon: Group, when: sel, section: 'Arrange' });
P('editor.ungroup', 'Ungroup', ungroupSelection, { shortcut: 'shift+g', icon: Ungroup, when: sel, section: 'Arrange' });
P('editor.forward', 'Bring forward', () => reorderSelection('forward'), { shortcut: 'mod+]', icon: BringToFront, when: sel, section: 'Arrange' });
P('editor.backward', 'Send backward', () => reorderSelection('backward'), { shortcut: 'mod+[', icon: SendToBack, when: sel, section: 'Arrange' });
P('editor.align-left', 'Align left', () => alignSelection('left'), { icon: AlignStartVertical, when: sel, section: 'Arrange' });
P('editor.align-right', 'Align right', () => alignSelection('right'), { icon: AlignEndVertical, when: sel, section: 'Arrange' });
P('editor.align-top', 'Align top', () => alignSelection('top'), { icon: AlignStartHorizontal, when: sel, section: 'Arrange' });
P('editor.align-bottom', 'Align bottom', () => alignSelection('bottom'), { icon: AlignEndHorizontal, when: sel, section: 'Arrange' });
P('editor.align-ch', 'Align centers horizontally', () => alignSelection('center-horizontal'), { icon: AlignCenterVertical, when: sel, section: 'Arrange' });
P('editor.align-cv', 'Align centers vertically', () => alignSelection('center-vertical'), { icon: AlignCenterHorizontal, when: sel, section: 'Arrange' });
P('editor.distribute-h', 'Distribute horizontally', () => distributeSelection('horizontal'), { icon: AlignHorizontalDistributeCenter, when: sel, section: 'Arrange' });
P('editor.distribute-v', 'Distribute vertically', () => distributeSelection('vertical'), { icon: AlignVerticalDistributeCenter, when: sel, section: 'Arrange' });
P('editor.fit-selection', 'Zoom to selection', fitSelection, { shortcut: 'shift+2', icon: Focus, when: sel, section: 'View' });
P('editor.working', 'Set working position', setWorkingPosition, { icon: Truck, when: sel, section: 'Mobile tools', keywords: ['mobile', 'roll'] });
P('editor.parked', 'Set parked position', setParkedPosition, { icon: MapPin, when: sel, section: 'Mobile tools', keywords: ['mobile', 'store'] });
P('editor.save-custom', 'Save selection to My objects…', () => editorActions.openDialog('save-custom', { name: 'My object' }), { icon: Star, when: sel, section: 'Library' });
P('editor.show-clearances', 'Show clearances', () => uiActions.setOverlay('clearances', true), { icon: Shield, section: 'View', keywords: ['overlay', 'operational'] });
