/**
 * Custom objects: the full create/edit dialog, the "My objects" manager (edit, duplicate, delete,
 * add to plan; shared across all projects), "Save as custom object…" for a selected item and
 * palette commands. Dialog id: `custom-object` with props `{ definitionId? , fromObjectId? }`.
 */
import { Copy, Pencil, Plus, Shapes, Star, Trash2 } from 'lucide-react';
import { contextMenuActions, paletteCommands, shellExtras, sidebarSections } from '@/app/registry';
import { deleteCustomDefinition, saveCustomDefinition, useCustomLibrary } from '@/app/services';
import { Section } from '@/components/shell';
import { Badge, Button, EmptyState, Tip } from '@/components/ui';
import type { ObjectDefinition } from '@/domain/schema';
import { useFormatters } from '@/hooks/useFormatters';
import { editorActions, useEditorStore } from '@/stores/editorStore';
import { useUiStore } from '@/stores/uiStore';
import { categoryColors } from '@/styles/tokens';
import { newId } from '@/utils/id';
import { nowIso } from '@/utils/time';
import { addObjectFromDefinition } from '@/features/objects/register';
import { CATEGORY_LABEL, CustomObjectDialog } from './CustomObjectDialog';

export const openCustomObjectDialog = (props: { definitionId?: string; fromObjectId?: string } = {}) => editorActions.openDialog('custom-object', props);

function DialogHost() {
  const dialog = useEditorStore((s) => (s.dialog?.id === 'custom-object' ? s.dialog : null));
  if (!dialog) return null;
  const p = (dialog.props ?? {}) as { definitionId?: string; fromObjectId?: string };
  return <CustomObjectDialog key={`${p.definitionId ?? ''}|${p.fromObjectId ?? ''}`} definitionId={p.definitionId} fromObjectId={p.fromObjectId} />;
}
shellExtras.register({ id: 'custom-objects.dialog', order: 30, component: DialogHost });

function Row({ def }: { def: ObjectDefinition }) {
  const fmt = useFormatters();
  const c = categoryColors[def.category];
  const confirmDelete = () =>
    editorActions.openDialog('confirm', {
      title: `Delete “${def.name}” from My objects?`,
      description: 'It disappears from the library in every project. Items already placed in projects keep their size and details.',
      confirmLabel: 'Delete',
      onConfirm: () => void deleteCustomDefinition(def.id),
    });
  const duplicate = () => void saveCustomDefinition({ ...structuredClone(def), id: `custom:${newId()}`, name: `${def.name} copy`, updatedAt: nowIso() });
  return (
    <li className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-panel-2" data-testid="custom-object-row">
      {def.image ? <img src={def.image} alt="" className="size-8 shrink-0 rounded border border-line object-cover" /> : <span className="size-8 shrink-0 rounded border" style={{ background: def.color ?? c.fill, borderColor: c.stroke }} />}
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => addObjectFromDefinition(def)} title={`Add ${def.name} to the plan`}>
        <span className="block truncate text-[13px] text-ink">{def.name}</span>
        <span className="num block text-2xs text-ink-faint">
          {fmt.length(def.width)} × {fmt.length(def.depth)} · {fmt.length(def.height)} h · {CATEGORY_LABEL[def.category]}
        </span>
      </button>
      {def.mobility === 'mobile' && <Badge tone="info">mobile</Badge>}
      {def.components?.length ? <Badge>{def.components.length} parts</Badge> : null}
      <div className="flex opacity-60 group-hover:opacity-100">
        <Tip content="Edit">
          <Button size="icon-sm" variant="ghost" aria-label={`Edit ${def.name}`} onClick={() => openCustomObjectDialog({ definitionId: def.id })}>
            <Pencil />
          </Button>
        </Tip>
        <Tip content="Duplicate">
          <Button size="icon-sm" variant="ghost" aria-label={`Duplicate ${def.name}`} onClick={duplicate}>
            <Copy />
          </Button>
        </Tip>
        <Tip content="Delete from My objects">
          <Button size="icon-sm" variant="ghost" aria-label={`Delete ${def.name}`} onClick={confirmDelete}>
            <Trash2 />
          </Button>
        </Tip>
      </div>
    </li>
  );
}

function MyObjectsPanel() {
  const defs = useCustomLibrary((s) => s.definitions);
  const selection = useUiStore((s) => s.selection);
  const oneObject = selection.length === 1 && selection[0]!.kind === 'object' ? selection[0]!.id : null;
  return (
    <div data-testid="my-objects-panel">
      <div className="flex flex-wrap gap-1 border-b border-line p-2">
        <Button size="sm" variant="primary" onClick={() => openCustomObjectDialog()} data-testid="new-custom-object">
          <Plus /> New custom object
        </Button>
        <Tip content={oneObject ? 'Save the selected item with all its details' : 'Select one object on the plan first'}>
          <span>
            <Button size="sm" variant="outline" disabled={!oneObject} onClick={() => oneObject && openCustomObjectDialog({ fromObjectId: oneObject })}>
              <Star /> Save selected…
            </Button>
          </span>
        </Tip>
      </div>
      {defs.length === 0 ? (
        <EmptyState icon={<Shapes />} title="No custom objects yet" action={<Button onClick={() => openCustomObjectDialog()}>Create one</Button>}>
          Measure your own tools and storage (e.g. “My rolling cabinet”, 48″ × 24″ × 72″) and reuse them in every project.
        </EmptyState>
      ) : (
        <Section title={`My objects (${defs.length})`}>
          <ul>
            {defs.map((d) => (
              <Row key={d.id} def={d} />
            ))}
          </ul>
          <p className="px-2 pt-1 text-2xs text-ink-faint">Click one to add it to the plan. Stored in this browser and shared by all your projects.</p>
        </Section>
      )}
    </div>
  );
}
sidebarSections.register({ id: 'my-objects', title: 'My objects', icon: Shapes, order: 45, component: MyObjectsPanel });

contextMenuActions.register({
  id: 'custom-objects.save-detailed',
  group: 'library',
  order: 51,
  icon: Star,
  label: 'Save as custom object (edit details)…',
  appliesTo: (c) => c.single?.kind === 'object',
  run: (c) => openCustomObjectDialog({ fromObjectId: c.single!.id }),
});

paletteCommands.register({ id: 'custom-objects.new', title: 'New custom object…', section: 'Library', icon: Plus, keywords: ['my objects', 'custom', 'create'], when: (c) => !!c.project, run: () => openCustomObjectDialog() });
paletteCommands.register({
  id: 'custom-objects.save-selected',
  title: 'Save selected object as custom object…',
  section: 'Library',
  icon: Star,
  when: (c) => c.selection.length === 1 && c.selection[0]!.kind === 'object',
  run: (c) => openCustomObjectDialog({ fromObjectId: c.selection[0]!.id }),
});
