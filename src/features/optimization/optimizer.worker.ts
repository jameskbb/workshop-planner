/**
 * Web Worker host for the Smart Layout Assistant: runs the annealing + evaluation off the UI
 * thread and posts progress. Cancel = the page terminates the worker.
 */
import type { Project } from '@/domain/schema';
import { runAssistant } from './evaluate';
import type { OptimizeOptions } from './optimizer';

export type WorkerRequest = { project: Project; scenarioId: string; options: OptimizeOptions };
export type WorkerMessage =
  | { type: 'progress'; fraction: number; message: string }
  | { type: 'done'; result: ReturnType<typeof runAssistant> }
  | { type: 'error'; message: string };

const ctx = self as unknown as { postMessage(m: WorkerMessage): void; onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null };
ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { project, scenarioId, options } = e.data;
  try {
    const result = runAssistant(project, scenarioId, options, {
      onProgress: (fraction, message) => ctx.postMessage({ type: 'progress', fraction, message } satisfies WorkerMessage),
    });
    ctx.postMessage({ type: 'done', result } satisfies WorkerMessage);
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies WorkerMessage);
  }
};
