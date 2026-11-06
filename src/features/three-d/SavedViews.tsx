/** Saved 3D cameras (project SavedView, mode '3d'): create, rename, delete, recall. */
import { Camera, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { RenameDialog } from '@/app/home/RenameDialog';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui';
import type { SavedView } from '@/domain/schema';
import { dispatch, useProjectStore } from '@/stores/projectStore';
import { uiActions } from '@/stores/uiStore';
import { newId } from '@/utils/id';
import { cameraRef, view3d } from './store';

export function saveCurrentView(name: string): SavedView | null {
  const pose = cameraRef.current;
  if (!pose) return null;
  const view: SavedView = {
    id: newId(),
    name,
    mode: '3d',
    camera3d: {
      position: pose.position,
      target: pose.target,
      fov: pose.fov,
      orthographic: pose.orthographic ?? false,
    },
  };
  dispatch({ type: 'view.save', payload: { view } });
  uiActions.flash(`Saved view "${name}".`);
  return view;
}

export function recallView(v: SavedView) {
  if (!v.camera3d) return;
  view3d.recall({
    position: v.camera3d.position,
    target: v.camera3d.target,
    fov: v.camera3d.fov,
    orthographic: v.camera3d.orthographic,
  });
}

export function SavedViewsMenu() {
  const views = useProjectStore((s) => s.project?.savedViews);
  const [naming, setNaming] = useState<{ id?: string; initial: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const rename = (id: string, initial: string) => {
    setMenuOpen(false);
    setNaming({ id, initial });
  };
  const list = (views ?? []).filter((v) => v.mode === '3d');
  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" data-testid="three-saved-views">
            <Camera /> Views{list.length ? ` (${list.length})` : ''}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem
            onSelect={() => setNaming({ initial: `View ${list.length + 1}` })}
            data-testid="three-save-view"
          >
            <Camera /> Save current view…
          </DropdownMenuItem>
          {list.length > 0 && <DropdownMenuSeparator />}
          {list.map((v) => (
            <div key={v.id} className="group flex items-center">
              <DropdownMenuItem
                className="flex-1"
                onSelect={() => recallView(v)}
                data-testid="three-view-item"
              >
                {v.name}
              </DropdownMenuItem>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Rename ${v.name}`}
                onClick={() => rename(v.id, v.name)}
              >
                <Pencil />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Delete ${v.name}`}
                onClick={() => {
                  setMenuOpen(false);
                  dispatch({ type: 'view.delete', payload: { id: v.id } });
                }}
                data-testid="three-view-delete"
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {naming && (
        <RenameDialog
          open
          title={naming.id ? 'Rename view' : 'Save view'}
          initial={naming.initial}
          onOpenChange={(o) => !o && setNaming(null)}
          onSubmit={(name) => {
            if (naming.id) {
              const v = list.find((x) => x.id === naming.id);
              if (v) dispatch({ type: 'view.save', payload: { view: { ...v, name } } });
            } else saveCurrentView(name);
          }}
        />
      )}
    </>
  );
}
