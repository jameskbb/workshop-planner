/**
 * Scenarios UI: the extended layout switcher (toolbar), [ / ] fast switching, the side-by-side
 * Compare view, and the Scorecard panel (descriptive metrics with explanations + priority weights).
 * Layout management itself lives in the Project panel (ScenarioManager).
 */
import { ClipboardList, Columns2, FilePlus2, Layers3 } from 'lucide-react';
import { appViews, paletteCommands, shortcuts, sidebarSections, toolbarItems } from '@/app/registry';
import { Section } from '@/components/shell';
import { Button, Select } from '@/components/ui';
import { dispatch, useProjectStore } from '@/stores/projectStore';
import { useUiStore } from '@/stores/uiStore';
import { useMetrics } from '@/features/warnings/analysisClient';
import { CompareView } from './compare';
import { createBlankLayout, duplicateLayout, LayoutSwitcher, openCompare, switchLayout } from './manager';
import { scorecardPrefs, weightOf, WEIGHT_LABELS } from './scorecard';

// Replaces the editor's basic switcher (features load alphabetically: scenarios after editor).
toolbarItems.register({ id: 'editor.layouts', group: 'right', order: 20, component: LayoutSwitcher });

appViews.register({ id: 'compare', label: 'Compare', icon: Columns2, order: 40, component: CompareView });

const inEditor = () => !!useProjectStore.getState().project;
shortcuts.register({ id: 'scenarios.next', keys: ']', description: 'Next layout', when: inEditor, run: () => switchLayout(1) });
shortcuts.register({ id: 'scenarios.prev', keys: '[', description: 'Previous layout', when: inEditor, run: () => switchLayout(-1) });

paletteCommands.register({ id: 'scenarios.next', title: 'Next layout', section: 'Layouts', icon: Layers3, shortcut: ']', keywords: ['scenario', 'switch'], when: (c) => (c.project?.scenarios.length ?? 0) > 1, run: () => switchLayout(1) });
paletteCommands.register({ id: 'scenarios.prev', title: 'Previous layout', section: 'Layouts', icon: Layers3, shortcut: '[', keywords: ['scenario', 'switch'], when: (c) => (c.project?.scenarios.length ?? 0) > 1, run: () => switchLayout(-1) });
paletteCommands.register({ id: 'scenarios.blank', title: 'New blank layout', section: 'Layouts', icon: FilePlus2, keywords: ['scenario', 'empty', 'alternative'], when: (c) => !!c.project, run: (c) => createBlankLayout(c.project!) });
paletteCommands.register({ id: 'scenarios.from-current', title: 'New layout from current', section: 'Layouts', icon: FilePlus2, keywords: ['scenario', 'duplicate', 'copy', 'alternative'], when: (c) => !!c.project, run: (c) => duplicateLayout(c.project!, c.project!.activeScenarioId) });
paletteCommands.register({ id: 'scenarios.compare', title: 'Compare layouts side by side', section: 'Layouts', icon: Columns2, keywords: ['scenario', 'compare', 'scorecard'], when: (c) => (c.project?.scenarios.length ?? 0) > 1, run: () => openCompare() });
paletteCommands.register({ id: 'scenarios.scorecard', title: 'Open layout scorecard', section: 'Analysis', icon: ClipboardList, keywords: ['metrics', 'score', 'compare'], when: (c) => !!c.project, run: () => useUiStore.setState({ leftSection: 'scorecard' }) });

function ScorecardPanel() {
  const project = useProjectStore((s) => s.project);
  const metrics = useMetrics();
  if (!project) return null;
  const weights = scorecardPrefs.read(project).weights;
  const active = project.scenarios.find((s) => s.id === project.activeScenarioId)!;
  const setWeight = (id: string, w: number) =>
    dispatch({ type: 'extension.set', payload: { target: 'project', key: scorecardPrefs.key, value: { weights: { ...weights, [id]: w } }, label: 'Change scorecard priority', history: false } });
  return (
    <div data-testid="scorecard-panel">
      <div className="border-b border-line px-3 py-2 text-2xs text-ink-faint">
        Measured for <span className="text-ink">{active.name}</span>. Each number says how it was computed; there is no single magic score. Priorities weight the relative summary in the Compare view.
      </div>
      {metrics === null && <p className="px-3 py-3 text-2xs text-ink-faint">Measuring this layout…</p>}
      <ul>
        {(metrics ?? []).map(({ metric, result }) => (
          <li key={metric.id} className="border-b border-line px-3 py-2" data-testid="scorecard-metric">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] text-ink">{metric.label}</span>
              <span className="num text-[13px] font-semibold text-ink">{result.display}</span>
            </div>
            <p className="mt-0.5 text-2xs leading-snug text-ink-muted">{result.explanation}</p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-2xs text-ink-faint">{metric.better === 'higher' ? 'Higher is better' : 'Lower is better'}</span>
              <div className="w-24">
                <Select
                  ariaLabel={`Priority of ${metric.label}`}
                  value={String(weightOf(weights, metric.id))}
                  onValueChange={(v) => setWeight(metric.id, Number(v))}
                  options={WEIGHT_LABELS.map((l, i) => ({ value: String(i), label: l }))}
                  className="h-6 text-2xs"
                />
              </div>
            </div>
          </li>
        ))}
      </ul>
      <Section title="Compare">
        <Button size="sm" variant="outline" className="w-full" disabled={project.scenarios.length < 2} onClick={() => openCompare()}>
          <Columns2 /> Compare layouts side by side
        </Button>
      </Section>
    </div>
  );
}

sidebarSections.register({ id: 'scorecard', title: 'Scorecard', icon: ClipboardList, order: 101, component: ScorecardPanel });
