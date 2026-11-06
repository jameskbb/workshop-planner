/** Current time as an ISO string (single seam so tests can control it). */
let clock: () => Date = () => new Date();

export const nowIso = (): string => clock().toISOString();

export function setClock(fn: () => Date): () => void {
  const prev = clock;
  clock = fn;
  return () => {
    clock = prev;
  };
}

/** "2 minutes ago" style relative time. */
export function relativeTime(iso: string, now: Date = clock()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.round((now.getTime() - t) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? '1 minute ago' : `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? '1 hour ago' : `${h} hours ago`;
  const d = Math.round(h / 24);
  if (d < 30) return d === 1 ? 'yesterday' : `${d} days ago`;
  return new Date(iso).toLocaleDateString();
}
