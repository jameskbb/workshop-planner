/**
 * 3D view registration. The view itself (three.js + React Three Fiber) is a separate lazy chunk,
 * loaded the first time the user switches to 3D.
 */
import { Box, Square } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { appViews, paletteCommands } from '@/app/registry';
import { uiActions } from '@/stores/uiStore';
import { CAMERA_PRESETS } from './model';
import { view3d } from './store';

const ThreeViewLazy = lazy(() => import('./ThreeView'));

function ThreeViewHost() {
  return (
    <Suspense
      fallback={
        <div className="grid size-full place-items-center bg-[#20252b] text-xs text-ink-muted">
          Loading 3D view…
        </div>
      }
    >
      <ThreeViewLazy />
    </Suspense>
  );
}

appViews.register({ id: '3d', label: '3D', icon: Box, order: 20, component: ThreeViewHost });

paletteCommands.register({
  id: 'view.3d',
  title: 'Switch to 3D view',
  section: 'View',
  icon: Box,
  keywords: ['three', 'perspective', 'walk'],
  when: (c) => !!c.project,
  run: () => uiActions.setView('3d'),
});
paletteCommands.register({
  id: 'view.2d',
  title: 'Switch to 2D plan',
  section: 'View',
  icon: Square,
  keywords: ['plan', 'top'],
  when: (c) => !!c.project,
  run: () => uiActions.setView('2d'),
});
for (const p of CAMERA_PRESETS) {
  paletteCommands.register({
    id: `view.3d.${p.id}`,
    title: `3D camera: ${p.label}`,
    section: 'View',
    icon: Box,
    keywords: ['3d', 'camera', p.id],
    when: (c) => !!c.project,
    run: () => {
      uiActions.setView('3d');
      view3d.preset(p.id);
    },
  });
}
