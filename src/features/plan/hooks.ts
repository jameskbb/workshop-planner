import { useMemo } from 'react';
import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { useUiStore } from '@/stores/uiStore';
import type { LayerId, ObjectCategory, Room } from '@/domain/schema';
import { categoryColors, monochrome } from '@/styles/tokens';
import { categoryColorsExt } from '@/features/editor/prefs';

/** Current canvas scale (px per mm). Components that size text/handles in screen px use this. */
export const useScale = (): number => useUiStore((s) => s.viewport.scale);

/** View rotation (degrees). Screen-aligned text uses `rotation={-viewRot}`; see `uprightAngle`. */
export const useViewRotation = (): number => useUiStore((s) => s.viewport.rotation ?? 0);

/** World size (mm) of `px` screen pixels at the current zoom. */
export const usePx = (px: number): number => useUiStore((s) => px / s.viewport.scale);

export const useLayerVisible = (layer: LayerId): boolean => useProjectStore((s) => s.project?.layers[layer]?.visible ?? true);

export const useMonochrome = (): boolean => useProjectStore((s) => s.project?.settings.monochrome ?? false);

/**
 * The room as it should be drawn right now: the live corner-drag preview if one is in progress,
 * otherwise the stored room. Anything positioned relative to walls should use this.
 */
export function useLiveRoom(): Room | undefined {
  const room = useProjectStore((s) => s.project?.room);
  const preview = useEditorStore((s) => s.roomPreview);
  return useMemo(() => (room && preview && preview.length === room.vertices.length ? { ...room, vertices: preview } : room), [room, preview]);
}

/** Category fill/stroke with the user's per-project overrides and monochrome mode applied. */
export function useCategoryPalette(): (category: ObjectCategory | 'unknown') => { fill: string; stroke: string } {
  const mono = useMonochrome();
  const overrides = useProjectStore((s) => (s.project ? categoryColorsExt.read(s.project) : undefined));
  return useMemo(() => {
    return (category) => {
      if (mono) return { fill: monochrome.fill, stroke: monochrome.stroke };
      const base = categoryColors[category];
      const o = overrides?.[category];
      return o ? { fill: o, stroke: base.stroke } : base;
    };
  }, [mono, overrides]);
}
