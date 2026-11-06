/**
 * Web Worker host for layout analysis (R-002): analyzers and metrics run here instead of blocking
 * the editor's main thread. The page keeps the previous result until a new one arrives
 * (src/features/warnings/analysisClient.ts).
 */
import { runAnalysisJob, type AnalysisJobRequest, type AnalysisJobResponse } from './job';

const ctx = self as unknown as { postMessage(m: AnalysisJobResponse): void; onmessage: ((e: MessageEvent<AnalysisJobRequest>) => void) | null };
ctx.onmessage = (e: MessageEvent<AnalysisJobRequest>) => ctx.postMessage(runAnalysisJob(e.data));
