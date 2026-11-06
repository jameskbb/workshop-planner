import { create } from 'zustand';

/** Which wall the elevation view shows (UI state, not persisted). */
export const useElevationStore = create<{ wallId: string | null }>()(() => ({ wallId: null }));

/** Switch the center area to the elevation of a wall. */
export function openElevation(wallId: string, setView: (v: string) => void): void {
  useElevationStore.setState({ wallId });
  setView('elevation');
}
