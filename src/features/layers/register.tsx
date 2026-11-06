/**
 * Layers panel: show/hide and lock each visibility category (persisted in the project; visibility
 * is not undoable, locking is), category colors with per-project overrides, monochrome technical
 * mode, label/dimension toggles, and a list of hidden items so nothing gets lost.
 */
import { Eye, EyeOff, Layers, Lock, LockOpen, RotateCcw } from 'lucide-react';
import { entityAdapters, paletteCommands, sidebarSections } from '@/app/registry';
import { Section } from '@/components/shell';
import { Button, Switch, Tip } from '@/components/ui';
import type { AppCommand } from '@/domain/commands';
import { getScenario } from '@/domain/resolve';
import { LAYER_IDS, OBJECT_CATEGORIES, type LayerId } from '@/domain/schema';
import { dispatch, transact, useProjectStore } from '@/stores/projectStore';
import { uiActions } from '@/stores/uiStore';
import { categoryColors, layerColors } from '@/styles/tokens';
import { cn } from '@/utils/cn';
import { categoryColorsExt } from '@/features/editor/prefs';

export const LAYER_LABELS: Record<LayerId, string> = {
  architecture: 'Architecture',
  electrical: 'Electrical',
  lighting: 'Lighting',
  storage: 'Storage',
  woodworking: 'Woodworking',
  vehicle: 'Vehicles',
  clearances: 'Clearances',
  measurements: 'Measurements',
  zones: 'Zones',
  dust: 'Dust collection',
  general: 'Furniture & misc',
};

const CATEGORY_LABELS: Record<string, string> = {
  'work-surface': 'Work surfaces',
  'stationary-tool': 'Stationary tools',
  storage: 'Storage',
  misc: 'Miscellaneous',
  'dust-collection': 'Dust collection',
};

function setVisible(layer: LayerId, visible: boolean) {
  dispatch({ type: 'layer.setVisibility', payload: { layer, visible } });
}

function HiddenItems() {
  const project = useProjectStore((s) => s.project);
  if (!project) return null;
  const c = { project, scenario: getScenario(project) };
  const hidden: Array<{ kind: string; id: string; name: string }> = [];
  for (const a of entityAdapters.list()) {
    if (!a.hidden) continue;
    for (const id of a.ids(c)) if (a.hidden(c, id)) hidden.push({ kind: a.kind, id, name: a.name(c, id) });
  }
  if (hidden.length === 0) return <p className="text-2xs text-ink-faint">Nothing is hidden. Hide items with Ctrl/⌘ Shift H; hidden items are left out of the analysis.</p>;
  const showAll = () => {
    const cmds: AppCommand[] = [];
    for (const h of hidden) cmds.push(...(entityAdapters.get(h.kind)?.setFlag?.(c, [h.id], 'hidden', false) ?? []));
    transact(`Show ${hidden.length} hidden items`, cmds);
  };
  return (
    <div className="space-y-1">
      <ul className="space-y-0.5">
        {hidden.map((h) => (
          <li key={`${h.kind}:${h.id}`} className="flex items-center gap-1 text-xs">
            <button type="button" className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-ink-muted hover:bg-panel-2" onClick={() => uiActions.select([{ kind: h.kind as never, id: h.id }])}>
              {h.name} <span className="text-2xs text-ink-faint">({h.kind})</span>
            </button>
            <Tip content="Show">
              <Button size="icon-sm" variant="ghost" aria-label={`Show ${h.name}`} onClick={() => transact(`Show ${h.name}`, entityAdapters.get(h.kind)?.setFlag?.(c, [h.id], 'hidden', false) ?? [])}>
                <Eye />
              </Button>
            </Tip>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="outline" onClick={showAll}>
        Show all {hidden.length}
      </Button>
    </div>
  );
}

function LayersPanel() {
  const project = useProjectStore((s) => s.project);
  if (!project) return null;
  const layers = project.layers;
  const settings = project.settings;
  const overrides = categoryColorsExt.read(project);
  const setOverride = (cat: string, color: string | null) => {
    const next = { ...overrides };
    if (color) next[cat] = color;
    else delete next[cat];
    dispatch({ type: 'extension.set', payload: { target: 'project', key: categoryColorsExt.key, value: next, label: 'Change category color' } });
  };
  return (
    <div>
      <Section title="Layers">
        <ul aria-label="Layers">
          {LAYER_IDS.map((id) => {
            const visible = layers[id]?.visible ?? true;
            const locked = layers[id]?.locked ?? false;
            return (
              <li key={id} className="flex items-center gap-1">
                <button
                  type="button"
                  aria-pressed={visible}
                  aria-label={`${visible ? 'Hide' : 'Show'} the ${LAYER_LABELS[id]} layer`}
                  data-testid={`layer-${id}`}
                  onClick={() => setVisible(id, !visible)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-panel-2"
                >
                  <span className="size-2.5 rounded-full" style={{ background: layerColors[id], opacity: visible ? 1 : 0.3 }} />
                  <span className={cn('flex-1 text-[13px]', visible ? 'text-ink' : 'text-ink-faint line-through')}>{LAYER_LABELS[id]}</span>
                  {visible ? <Eye className="size-3.5 text-ink-muted" /> : <EyeOff className="size-3.5 text-ink-faint" />}
                </button>
                <Tip content={locked ? 'Unlock layer' : 'Lock layer (items can’t be selected or moved)'}>
                  <Button size="icon-sm" variant="ghost" aria-pressed={locked} aria-label={`${locked ? 'Unlock' : 'Lock'} the ${LAYER_LABELS[id]} layer`} onClick={() => dispatch({ type: 'layer.setLocked', payload: { layer: id, locked: !locked } })} data-testid={`layer-lock-${id}`}>
                    {locked ? <Lock className="text-warn" /> : <LockOpen className="opacity-50" />}
                  </Button>
                </Tip>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 flex gap-3 px-2">
          <button type="button" className="text-2xs text-select hover:underline" onClick={() => LAYER_IDS.forEach((id) => setVisible(id, true))}>
            Show all
          </button>
          <button
            type="button"
            className="text-2xs text-select hover:underline"
            onClick={() => transact('Unlock all layers', LAYER_IDS.filter((id) => layers[id]?.locked).map((layer) => ({ type: 'layer.setLocked' as const, payload: { layer, locked: false } })))}
          >
            Unlock all
          </button>
        </div>
      </Section>
      <Section title="Colors & drawing style">
        <div className="space-y-1">
          <label className="flex items-center justify-between py-0.5 text-xs text-ink-muted">
            Monochrome (technical drawing)
            <Switch checked={settings.monochrome} onCheckedChange={(v) => dispatch({ type: 'project.updateSettings', payload: { patch: { monochrome: v } } })} aria-label="Monochrome technical drawing mode" />
          </label>
          <label className="flex items-center justify-between py-0.5 text-xs text-ink-muted">
            Object labels
            <Switch checked={settings.showLabels} onCheckedChange={(v) => dispatch({ type: 'project.updateSettings', payload: { patch: { showLabels: v } } })} aria-label="Object labels" />
          </label>
          <label className="flex items-center justify-between py-0.5 text-xs text-ink-muted">
            Wall dimensions
            <Switch checked={settings.showDimensions} onCheckedChange={(v) => dispatch({ type: 'project.updateSettings', payload: { patch: { showDimensions: v } } })} aria-label="Wall dimensions" />
          </label>
          <div className="pt-1 panel-heading">Category colors</div>
          <ul className="space-y-0.5">
            {OBJECT_CATEGORIES.map((cat) => {
              const color = overrides[cat] ?? categoryColors[cat].fill;
              return (
                <li key={cat} className="flex items-center gap-2 text-xs">
                  <input type="color" aria-label={`${CATEGORY_LABELS[cat]} color`} className="h-6 w-8 cursor-pointer rounded border border-line bg-transparent" value={color} onChange={(e) => setOverride(cat, e.target.value)} disabled={settings.monochrome} />
                  <span className="flex-1 text-ink-muted">{CATEGORY_LABELS[cat]}</span>
                  {overrides[cat] && (
                    <Tip content="Back to the default color">
                      <Button size="icon-sm" variant="ghost" aria-label={`Reset ${CATEGORY_LABELS[cat]} color`} onClick={() => setOverride(cat, null)}>
                        <RotateCcw />
                      </Button>
                    </Tip>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-2xs text-ink-faint">Individual objects can override their color in the inspector.</p>
        </div>
      </Section>
      <Section title="Hidden items" defaultOpen={false}>
        <HiddenItems />
      </Section>
    </div>
  );
}

sidebarSections.register({ id: 'layers', title: 'Layers', icon: Layers, order: 80, component: LayersPanel });

for (const id of LAYER_IDS) {
  paletteCommands.register({
    id: `layers.toggle.${id}`,
    title: `Toggle ${LAYER_LABELS[id]} layer`,
    section: 'Layers',
    keywords: ['show', 'hide', id],
    when: (c) => !!c.project,
    run: (c) => setVisible(id, !(c.project!.layers[id]?.visible ?? true)),
  });
}
