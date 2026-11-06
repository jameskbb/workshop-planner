/**
 * Editor dialogs opened through `editorActions.openDialog(id, props)`: confirmation, name prompt
 * (save as custom object) and "copy to another layout". Other features add their own dialogs by
 * registering a `shellExtras` component that reads `useEditorStore(s => s.dialog)`.
 */
import { useState } from 'react';
import { Button, ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label } from '@/components/ui';
import { useProjectStore } from '@/stores/projectStore';
import { editorActions, useEditorStore } from '@/stores/editorStore';
import { copyToLayout, saveSelectionAsCustomObject } from './ops';

function ConfirmHost() {
  const dialog = useEditorStore((s) => (s.dialog?.id === 'confirm' ? s.dialog : null));
  const p = (dialog?.props ?? {}) as { title?: string; description?: string; confirmLabel?: string; onConfirm?: () => void; destructive?: boolean };
  return (
    <ConfirmDialog
      open={!!dialog}
      onOpenChange={(o) => !o && editorActions.closeDialog()}
      title={p.title ?? 'Are you sure?'}
      description={p.description ?? ''}
      confirmLabel={p.confirmLabel ?? 'Confirm'}
      destructive={p.destructive ?? true}
      onConfirm={() => {
        editorActions.closeDialog();
        p.onConfirm?.();
      }}
    />
  );
}

function SaveCustomHost() {
  const dialog = useEditorStore((s) => (s.dialog?.id === 'save-custom' ? s.dialog : null));
  const initial = (dialog?.props?.name as string | undefined) ?? 'My object';
  return dialog ? <SaveCustomDialog key={initial} initial={initial} /> : null;
}

function SaveCustomDialog({ initial }: { initial: string }) {
  const [name, setName] = useState(initial);
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    editorActions.closeDialog();
    void saveSelectionAsCustomObject(n);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && editorActions.closeDialog()}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Save to My objects</DialogTitle>
            <DialogDescription>Reusable in every project from the Object library. Groups are saved as one object that places all of its parts together.</DialogDescription>
          </DialogHeader>
          <Label htmlFor="custom-name">Name</Label>
          <Input id="custom-name" className="mt-1" autoFocus value={name} onChange={(e) => setName(e.target.value)} data-testid="custom-name" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => editorActions.closeDialog()}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!name.trim()}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CopyToLayoutHost() {
  const dialog = useEditorStore((s) => (s.dialog?.id === 'copy-to-layout' ? s.dialog : null));
  const project = useProjectStore((s) => s.project);
  if (!dialog || !project) return null;
  const others = project.scenarios.filter((s) => s.id !== project.activeScenarioId);
  return (
    <Dialog open onOpenChange={(o) => !o && editorActions.closeDialog()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy to another layout</DialogTitle>
          <DialogDescription>The selection is copied at the same position. The same physical items keep their identity across layouts.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1">
          {others.map((s) => (
            <li key={s.id}>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => {
                  editorActions.closeDialog();
                  copyToLayout(s.id);
                }}
              >
                {s.name}
                <span className="ml-auto text-2xs text-ink-faint">{s.objects.length} objects</span>
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export function EditorDialogs() {
  return (
    <>
      <ConfirmHost />
      <SaveCustomHost />
      <CopyToLayoutHost />
    </>
  );
}
