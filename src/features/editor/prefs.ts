/**
 * Editor preferences: persistent per-project data (extensions) and per-browser view preferences
 * (rulers, minimap, tour state) kept in localStorage.
 */
import { z } from 'zod';
import { create } from 'zustand';
import { defineExtension } from '@/domain/extensions';
import { ColorSchema } from '@/domain/schema/common';

/** Per-project override of object category fill colors (category → hex). */
export const categoryColorsExt = defineExtension('editor.category-colors', z.record(z.string(), ColorSchema), {} as Record<string, string>);

const KEY = 'wp.viewPrefs';

export interface ViewPrefs {
  rulers: boolean;
  minimap: boolean;
  /** Show live distance labels while dragging. */
  liveDistances: boolean;
  tourDismissed: boolean;
}

const defaults: ViewPrefs = { rulers: true, minimap: true, liveDistances: true, tourDismissed: false };

function load(): ViewPrefs {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<ViewPrefs>) } : defaults;
  } catch {
    return defaults;
  }
}

export const useViewPrefs = create<ViewPrefs>()(() => load());

export function setViewPref<K extends keyof ViewPrefs>(key: K, value: ViewPrefs[K]): void {
  useViewPrefs.setState({ [key]: value } as Pick<ViewPrefs, K>);
  try {
    localStorage.setItem(KEY, JSON.stringify(useViewPrefs.getState()));
  } catch {
    /* storage unavailable: preference lasts for this session */
  }
}
