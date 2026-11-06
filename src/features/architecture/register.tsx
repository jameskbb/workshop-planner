/**
 * Architecture: the "Fixed features" sidebar (doors, windows, garage doors, structure, utilities,
 * built-ins, electrical points and lights; click to place), the list of what is placed, the
 * architectural feature inspector, and the Place tool.
 */
import { Building2, DoorOpen, Lightbulb, Lock, Plug, Warehouse } from 'lucide-react';
import { canvasTools, inspectorSections, paletteCommands, sidebarSections, type SelectionContext } from '@/app/registry';
import { PropRow, Section } from '@/components/shell';
import { LengthInput } from '@/components/LengthInput';
import { Badge, Select } from '@/components/ui';
import { OPENING_KINDS, type ArchitecturalFeature, type ArchitectureKind } from '@/domain/schema';
import { useFormatters } from '@/hooks/useFormatters';
import { dispatch, useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { uiActions, useUiStore } from '@/stores/uiStore';
import { cn } from '@/utils/cn';
import { getScenario } from '@/domain/resolve';
import { ARCHITECTURE_TEMPLATES, ELECTRICAL_TEMPLATES, LIGHT_TEMPLATES, type ArchitectureTemplate } from '@/features/objects/library';
import { ColorField, NameField, NotesField, PlacementFields, SwitchRow } from '@/features/editor/inspectorParts';
import { placeTool, startPlacing } from './place';

canvasTools.register(placeTool);

export const KIND_LABELS: Record<ArchitectureKind, string> = {
  door: 'Door',
  'double-door': 'Double door',
  'garage-door': 'Garage door',
  window: 'Window',
  'support-pole': 'Support pole',
  column: 'Column',
  stairs: 'Stairs',
  steps: 'Steps',
  'utility-closet': 'Utility closet',
  'water-heater': 'Water heater',
  hvac: 'HVAC unit',
  'attic-ladder': 'Attic ladder',
  'permanent-shelving': 'Permanent shelving',
  sink: 'Sink',
  'hose-bib': 'Hose bib',
  'wall-protrusion': 'Wall protrusion',
  'ceiling-obstruction': 'Ceiling obstruction',
  'ceiling-beam': 'Ceiling beam',
  'built-in-cabinet': 'Built-in cabinet',
  worktop: 'Built-in worktop',
};

const GROUPS: Array<{ title: string; kinds: ArchitectureKind[] }> = [
  { title: 'Doors & windows', kinds: ['door', 'double-door', 'garage-door', 'window'] },
  { title: 'Structure', kinds: ['support-pole', 'column', 'stairs', 'steps', 'wall-protrusion', 'ceiling-beam', 'ceiling-obstruction', 'attic-ladder'] },
  { title: 'Utilities', kinds: ['water-heater', 'hvac', 'utility-closet', 'sink', 'hose-bib'] },
  { title: 'Built-ins', kinds: ['permanent-shelving', 'built-in-cabinet', 'worktop'] },
];

export const templateKey = (t: ArchitectureTemplate) => `${t.kind}:${t.name}`;

function PlaceButton({ label, sub, onClick, testId, active }: { label: string; sub?: string; onClick(): void; testId?: string; active?: boolean }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        aria-pressed={active}
        className={cn('flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-panel-2', active ? 'bg-select/15 text-ink' : 'text-ink')}
      >
        <span className="truncate">{label}</span>
        {sub && <span className="num shrink-0 text-2xs text-ink-faint">{sub}</span>}
      </button>
    </li>
  );
}

function PlacedList() {
  const project = useProjectStore((s) => s.project);
  const selection = useUiStore((s) => s.selection);
  if (!project) return null;
  const lights = getScenario(project).lights;
  const rows = [
    ...project.architecture.map((f) => ({ kind: 'feature' as const, id: f.id, name: f.name, locked: f.locked, hidden: f.hidden })),
    ...project.electrical.map((e) => ({ kind: 'electrical' as const, id: e.id, name: e.label || ELECTRICAL_TEMPLATES.find((t) => t.kind === e.kind)?.name || 'Outlet', locked: e.locked, hidden: e.hidden })),
    ...lights.map((l) => ({ kind: 'light' as const, id: l.id, name: l.name, locked: l.locked, hidden: l.hidden })),
  ];
  if (rows.length === 0) return <p className="text-2xs text-ink-faint">Nothing placed yet. Pick an item above, then click on the plan. Doors, windows and outlets snap to the nearest wall.</p>;
  return (
    <ul className="space-y-0.5" aria-label="Placed features">
      {rows.map((r) => {
        const sel = selection.some((s) => s.kind === r.kind && s.id === r.id);
        return (
          <li key={r.id}>
            <button
              type="button"
              className={cn('flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-panel-2', sel ? 'bg-select/15 text-ink' : 'text-ink-muted', r.hidden && 'line-through')}
              onClick={() => uiActions.select([{ kind: r.kind, id: r.id }])}
            >
              {r.kind === 'feature' ? <Building2 className="size-3" /> : r.kind === 'electrical' ? <Plug className="size-3" /> : <Lightbulb className="size-3" />}
              <span className="flex-1 truncate">{r.name}</span>
              {r.locked && <Lock className="size-3" aria-label="Locked" />}
              {r.hidden && <span className="text-2xs">hidden</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ArchitecturePanel() {
  const fmt = useFormatters();
  const placing = useEditorStore((s) => s.placing);
  const hasRoom = useProjectStore((s) => (s.project?.room.vertices.length ?? 0) >= 3);
  const isActive = (kind: string, id: string) => placing?.kind === kind && placing.templateId === id;
  return (
    <div>
      {!hasRoom && <p className="m-3 rounded-md border border-warn/40 bg-warn/10 px-2 py-1.5 text-2xs text-ink">Draw the room first: doors, windows and outlets attach to walls.</p>}
      {GROUPS.map((g) => (
        <Section key={g.title} title={g.title}>
          <ul>
            {ARCHITECTURE_TEMPLATES.filter((t) => g.kinds.includes(t.kind)).map((t) => (
              <PlaceButton
                key={templateKey(t)}
                label={t.name}
                sub={t.shape === 'round' ? `⌀ ${fmt.length(t.width)}` : fmt.length(t.width)}
                active={isActive('feature', templateKey(t))}
                testId={`place-${t.kind}`}
                onClick={() => startPlacing({ kind: 'feature', templateId: templateKey(t), label: t.name })}
              />
            ))}
          </ul>
        </Section>
      ))}
      <Section title="Electrical">
        <ul>
          {ELECTRICAL_TEMPLATES.map((t) => (
            <PlaceButton key={t.kind} label={t.name} sub={`${t.defaults.voltage ?? 120}V`} active={isActive('electrical', t.kind)} testId={`place-${t.kind}`} onClick={() => startPlacing({ kind: 'electrical', templateId: t.kind, label: t.name })} />
          ))}
        </ul>
        <p className="mt-1 text-2xs text-ink-faint">Planning aid only, not an electrical code check.</p>
      </Section>
      <Section title="Lighting">
        <ul>
          {LIGHT_TEMPLATES.map((t) => (
            <PlaceButton key={t.name} label={t.name} sub={`${t.lumens} lm`} active={isActive('light', t.name)} testId={`place-light-${t.kind}`} onClick={() => startPlacing({ kind: 'light', templateId: t.name, label: t.name })} />
          ))}
        </ul>
      </Section>
      <Section title="Placed">
        <PlacedList />
      </Section>
    </div>
  );
}

sidebarSections.register({ id: 'architecture', title: 'Fixed features', icon: DoorOpen, order: 30, component: ArchitecturePanel });

// ───────────── feature inspector ─────────────

const singleFeature = (c: SelectionContext): ArchitecturalFeature | undefined => (c.single?.kind === 'feature' ? c.project.architecture.find((f) => f.id === c.single!.id) : undefined);
function update(id: string, patch: Partial<ArchitecturalFeature>, unset: string[] = []) {
  const r = dispatch({ type: 'feature.update', payload: { id, patch, unset } });
  if (!r.ok) uiActions.flash(r.error, 'error');
}

function FeatureMain({ ctx }: { ctx: SelectionContext }) {
  const f = singleFeature(ctx)!;
  const opening = OPENING_KINDS.has(f.kind);
  const round = f.shape === 'round';
  const overhead = f.kind === 'ceiling-beam' || f.kind === 'ceiling-obstruction' || f.kind === 'attic-ladder';
  return (
    <div className="space-y-1">
      <NameField value={f.name} onCommit={(name) => name && update(f.id, { name })} testId="feature-name" />
      <PropRow label="Type">
        <span className="flex items-center gap-1.5 text-xs text-ink-muted">
          {KIND_LABELS[f.kind]} {f.locked && <Badge>locked</Badge>}
        </span>
      </PropRow>
      <PlacementFields room={ctx.project.room} placement={f.placement} width={f.width} depth={f.depth} allowFree={!opening} freeRotation={!round} onChange={(placement) => update(f.id, { placement })} />
      <div className="grid grid-cols-2 gap-x-2">
        <PropRow label={round ? 'Diameter' : 'Width'}>
          <LengthInput aria-label={round ? 'Diameter' : 'Width'} value={f.width} allowZero={false} onCommit={(width) => update(f.id, { width, ...(round ? { depth: width } : {}) })} data-testid="feature-width" />
        </PropRow>
        {!opening && !round && (
          <PropRow label="Depth">
            <LengthInput aria-label="Depth" value={f.depth} allowZero={false} onCommit={(depth) => update(f.id, { depth })} data-testid="feature-depth" />
          </PropRow>
        )}
        <PropRow label="Height">
          <LengthInput aria-label="Height" value={f.height} allowZero={false} onCommit={(height) => update(f.id, { height })} />
        </PropRow>
        {(f.kind === 'window' || overhead || f.kind === 'hose-bib') && (
          <PropRow label={f.kind === 'window' ? 'Sill' : 'Bottom'}>
            <LengthInput aria-label={f.kind === 'window' ? 'Sill height' : 'Height above floor'} value={f.elevation} onCommit={(elevation) => update(f.id, { elevation })} />
          </PropRow>
        )}
      </div>
    </div>
  );
}

function DoorSection({ ctx }: { ctx: SelectionContext }) {
  const f = singleFeature(ctx)!;
  const d = f.door ?? { swing: 'in' as const, hinge: 'left' as const, openAngle: 90 };
  const set = (patch: Partial<typeof d>) => update(f.id, { door: { ...d, ...patch } });
  return (
    <div className="space-y-1">
      <PropRow label="Swings">
        <Select className="h-7" ariaLabel="Door swing" value={d.swing} onValueChange={(v) => set({ swing: v as typeof d.swing })} options={[{ value: 'in', label: 'Into the garage' }, { value: 'out', label: 'Outward' }, { value: 'none', label: 'Sliding / none' }]} />
      </PropRow>
      {f.kind === 'door' && (
        <PropRow label="Hinge">
          <Select className="h-7" ariaLabel="Hinge side" value={d.hinge} onValueChange={(v) => set({ hinge: v as typeof d.hinge })} options={[{ value: 'left', label: 'Left (seen from inside)' }, { value: 'right', label: 'Right (seen from inside)' }]} />
        </PropRow>
      )}
      <PropRow label="Opens to">
        <Select className="h-7" ariaLabel="Opening angle" value={String(d.openAngle)} onValueChange={(v) => set({ openAngle: Number(v) })} options={[60, 90, 110, 135, 180].map((a) => ({ value: String(a), label: `${a}°` }))} />
      </PropRow>
      <p className="text-2xs text-ink-faint">The dashed arc on the plan is the swing radius; keep it clear.</p>
    </div>
  );
}

function GarageDoorSection({ ctx }: { ctx: SelectionContext }) {
  const f = singleFeature(ctx)!;
  const g = f.garageDoor!;
  const set = (patch: Partial<typeof g>) => update(f.id, { garageDoor: { ...g, ...patch } });
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-x-2">
        <PropRow label="Opening W">
          <LengthInput aria-label="Opening width" value={f.width} allowZero={false} onCommit={(width) => update(f.id, { width })} />
        </PropRow>
        <PropRow label="Opening H">
          <LengthInput aria-label="Opening height" value={g.openingHeight} allowZero={false} onCommit={(openingHeight) => set({ openingHeight })} data-testid="garage-opening-height" />
        </PropRow>
        <PropRow label="Track depth">
          <LengthInput aria-label="How far the tracks run into the garage" value={g.trackLength} allowZero={false} onCommit={(trackLength) => set({ trackLength })} />
        </PropRow>
        <PropRow label="Track height">
          <LengthInput aria-label="Height of the tracks / open door above the floor" value={g.trackHeight} allowZero={false} onCommit={(trackHeight) => set({ trackHeight })} />
        </PropRow>
      </div>
      <PropRow label="Type">
        <Select className="h-7" ariaLabel="Door type" value={g.kind} onValueChange={(v) => set({ kind: v as typeof g.kind })} options={[{ value: 'sectional', label: 'Sectional (overhead tracks)' }, { value: 'roll-up', label: 'Roll-up' }, { value: 'tilt-up', label: 'Tilt-up' }]} />
      </PropRow>
      <PropRow label="State">
        <Select className="h-7" ariaLabel="Door state" value={g.state} onValueChange={(v) => set({ state: v as typeof g.state })} options={[{ value: 'closed', label: 'Closed' }, { value: 'open', label: 'Open' }]} />
      </PropRow>
      <p className="text-2xs text-ink-faint">The dashed band is the overhead area the tracks and open door occupy. Tall items there may hit the door.</p>
    </div>
  );
}

function FeatureFlags({ ctx }: { ctx: SelectionContext }) {
  const f = singleFeature(ctx)!;
  return (
    <div>
      <SwitchRow label="Locked" checked={f.locked} onChange={(locked) => update(f.id, { locked })} testId="feature-locked" hint="Locked items can't be moved or deleted by accident" />
      <SwitchRow label="Hidden" checked={f.hidden} onChange={(hidden) => update(f.id, { hidden })} />
      {!OPENING_KINDS.has(f.kind) && <ColorField value={f.color} fallback="#c7ccd1" onChange={(color) => update(f.id, { color })} onReset={() => update(f.id, {}, ['color'])} />}
      <NotesField value={f.notes} onCommit={(notes) => update(f.id, { notes })} />
    </div>
  );
}

const isFeature = (c: SelectionContext) => !!singleFeature(c);
inspectorSections.register({ id: 'feature.main', title: 'Feature', order: 10, appliesTo: isFeature, component: FeatureMain });
inspectorSections.register({ id: 'feature.door', title: 'Door swing', order: 40, appliesTo: (c) => ['door', 'double-door'].includes(singleFeature(c)?.kind ?? ''), component: DoorSection });
inspectorSections.register({ id: 'feature.garage', title: 'Garage door', order: 40, appliesTo: (c) => !!singleFeature(c)?.garageDoor, component: GarageDoorSection });
inspectorSections.register({ id: 'feature.flags', title: 'Options & notes', order: 90, appliesTo: isFeature, component: FeatureFlags });

// ───────────── palette ─────────────

for (const t of ARCHITECTURE_TEMPLATES) {
  paletteCommands.register({
    id: `architecture.place.${templateKey(t)}`,
    title: `Add ${t.name}`,
    section: 'Fixed features',
    icon: t.kind === 'garage-door' ? Warehouse : Building2,
    keywords: [t.kind, 'architecture'],
    order: 60,
    when: (c) => !!c.project,
    run: () => startPlacing({ kind: 'feature', templateId: templateKey(t), label: t.name }),
  });
}
for (const t of ELECTRICAL_TEMPLATES) {
  paletteCommands.register({ id: `electrical.place.${t.kind}`, title: `Add ${t.name}`, section: 'Electrical', icon: Plug, keywords: ['outlet', 'power'], order: 60, when: (c) => !!c.project, run: () => startPlacing({ kind: 'electrical', templateId: t.kind, label: t.name }) });
}
for (const t of LIGHT_TEMPLATES) {
  paletteCommands.register({ id: `lighting.place.${t.kind}`, title: `Add ${t.name}`, section: 'Lighting', icon: Lightbulb, keywords: ['light', 'lamp'], order: 60, when: (c) => !!c.project, run: () => startPlacing({ kind: 'light', templateId: t.name, label: t.name }) });
}
