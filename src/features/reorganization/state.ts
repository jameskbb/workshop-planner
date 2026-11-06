/**
 * Reorganization state: Current/Target designation (core `project.reorganization`), live step
 * statuses (core `stepStatus`) and the statuses the plan was last regenerated with (extension
 * `reorganization.plan`), plus transient UI state (highlighted step).
 */
import { useMemo } from 'react';
import { z } from 'zod';
import { create } from 'zustand';
import { defineExtension } from '@/domain/extensions';
import type { Project } from '@/domain/schema';
import { dispatch, transact, useProjectStore } from '@/stores/projectStore';
import { uiActions } from '@/stores/uiStore';
import { buildPlannerInput, type LayoutDiffEntry } from './input';
import { planMoves, type MovePlan, type StepStatus } from './planner';

const StatusSchema = z.enum(['moved', 'skipped', 'blocked']);

/** Statuses the current plan was generated with ("Regenerate remaining plan" snapshots them). */
export const planExt = defineExtension(
  'reorganization.plan',
  z.object({ applied: z.record(z.string(), StatusSchema), current: z.string().optional(), target: z.string().optional() }),
  { applied: {} } as { applied: Record<string, StepStatus>; current?: string; target?: string },
);

export const OVERLAY_KEY = 'before-after';

export const useReorgUi = create<{ highlight: string | null }>(() => ({ highlight: null }));

export interface Designation {
  currentId: string;
  targetId: string;
  /** False until the user picks both layouts. */
  designated: boolean;
}

export function designation(project: Project): Designation | null {
  if (project.scenarios.length < 2) return null;
  const r = project.reorganization;
  const has = (id?: string) => !!id && project.scenarios.some((s) => s.id === id);
  const currentId = has(r.currentScenarioId) ? r.currentScenarioId! : project.scenarios[0]!.id;
  let targetId = has(r.targetScenarioId) ? r.targetScenarioId! : (project.scenarios.find((s) => s.id !== currentId)?.id ?? currentId);
  if (targetId === currentId) targetId = project.scenarios.find((s) => s.id !== currentId)!.id;
  return { currentId, targetId, designated: has(r.currentScenarioId) && has(r.targetScenarioId) };
}

export interface ReorgModel {
  d: Designation;
  plan: MovePlan;
  diff: LayoutDiffEntry[];
  applied: Record<string, StepStatus>;
  live: Record<string, StepStatus>;
  /** Live statuses differ from those the plan was generated with. */
  stale: boolean;
}

/** Memoized per project revision. */
const cache = new WeakMap<Project, ReorgModel | null>();
export function reorgModel(project: Project): ReorgModel | null {
  if (cache.has(project)) return cache.get(project)!;
  const d = designation(project);
  let model: ReorgModel | null = null;
  if (d) {
    const ext = planExt.read(project);
    // Applied statuses only count for the pair they were generated for.
    const applied = ext.current === d.currentId && ext.target === d.targetId ? ext.applied : {};
    const { input, diff } = buildPlannerInput(project, d.currentId, d.targetId, applied);
    const plan = planMoves(input);
    const live = project.reorganization.stepStatus as Record<string, StepStatus>;
    const keys = new Set([...Object.keys(applied), ...Object.keys(live)]);
    const stale = [...keys].some((k) => applied[k] !== live[k]);
    model = { d, plan, diff, applied, live, stale };
  }
  cache.set(project, model);
  return model;
}

export function useReorgModel(): ReorgModel | null {
  const project = useProjectStore((s) => s.project);
  return useMemo(() => (project ? reorgModel(project) : null), [project]);
}

export function setLayouts(currentId: string, targetId: string) {
  dispatch({ type: 'reorganization.setScenarios', payload: { currentScenarioId: currentId, targetScenarioId: targetId } });
}

export function setStepStatus(key: string, status: StepStatus | null) {
  dispatch({ type: 'reorganization.setStepStatus', payload: { stepKey: key, status } });
}

/** Re-plan the remaining moves from the statuses marked so far. */
export function regenerate(project: Project) {
  const m = reorgModel(project);
  if (!m) return;
  dispatch({
    type: 'extension.set',
    payload: { target: 'project', key: planExt.key, value: { applied: { ...m.live }, current: m.d.currentId, target: m.d.targetId }, label: 'Regenerate move plan' },
  });
  uiActions.flash('Move plan regenerated from your progress.');
}

export function resetProgress(project: Project) {
  const keys = Object.keys(project.reorganization.stepStatus);
  const cmds = keys.map((k) => ({ type: 'reorganization.setStepStatus' as const, payload: { stepKey: k, status: null } }));
  transact('Reset move plan progress', [...cmds, { type: 'extension.set', payload: { target: 'project', key: planExt.key, value: { applied: {} } } }]);
}
