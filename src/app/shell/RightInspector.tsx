import { entityAdapters, inspectorSections, type SelectionContext } from '@/app/registry';
import { PanelHeader, Section } from '@/components/shell';
import { useSelectionContext } from '@/hooks/useProject';

function title(ctx: SelectionContext): string {
  if (ctx.refs.length === 0) return 'Properties';
  if (ctx.refs.length > 1) return `${ctx.refs.length} selected`;
  const r = ctx.single!;
  switch (r.kind) {
    case 'object': {
      const o = ctx.scenario.objects.find((x) => x.id === r.id);
      return o?.label ?? o?.name ?? 'Object';
    }
    case 'vehicle':
      return ctx.scenario.vehicles.find((v) => v.id === r.id)?.name ?? 'Vehicle';
    case 'feature':
      return ctx.project.architecture.find((f) => f.id === r.id)?.name ?? 'Feature';
    case 'electrical':
      return ctx.project.electrical.find((e) => e.id === r.id)?.label || 'Electrical point';
    case 'light':
      return ctx.scenario.lights.find((l) => l.id === r.id)?.name ?? 'Light';
    case 'zone':
      return ctx.scenario.zones.find((z) => z.id === r.id)?.name ?? 'Zone';
    case 'vertex':
      return 'Corner';
    default: {
      const name = entityAdapters.get(r.kind)?.name({ project: ctx.project, scenario: ctx.scenario }, r.id);
      return name ? name.charAt(0).toUpperCase() + name.slice(1) : r.kind.charAt(0).toUpperCase() + r.kind.slice(1);
    }
  }
}

export function RightInspector() {
  const ctx = useSelectionContext();
  const sections = inspectorSections.useItems();
  if (!ctx) return null;
  const applicable = sections.filter((s) => s.appliesTo(ctx));
  return (
    /* Fixed width, never grows: wide section content (clearance rows, long names) must wrap or
       truncate inside the panel instead of pushing the canvas and the left rail off screen. */
    <aside className="flex w-[288px] min-w-0 shrink-0 flex-col overflow-hidden bg-panel" aria-label="Inspector" data-testid="inspector">
      <PanelHeader title={title(ctx)} />
      <div className="scroll-thin min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        {applicable.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-ink-muted">Nothing to edit for this selection yet.</p>
        ) : (
          applicable.map((s) => (
            <Section key={s.id} title={s.title} defaultOpen={!s.collapsed}>
              <s.component ctx={ctx} />
            </Section>
          ))
        )}
      </div>
    </aside>
  );
}
