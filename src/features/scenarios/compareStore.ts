import { create } from 'zustand';

/** Layouts shown in the side-by-side comparison, and the shared (synced) view of all panels. */
export const useCompareStore = create<{ ids: string[]; view: { cx: number; cy: number; mmPerPx: number } | null }>()(() => ({ ids: [], view: null }));
