/**
 * Dubins paths: shortest forward-only paths for a vehicle with a minimum turning radius,
 * composed of arcs (L/R) and straights (S). Used as the kinematic backbone of the
 * bicycle-model garage-entry planner.
 *
 * Headings are radians measured from +x toward +y. "L" means increasing heading.
 * (Plan coordinates have +y pointing south, so "L" turns appear clockwise on screen; the math
 * is frame-agnostic.)
 */

export type DubinsWord = 'LSL' | 'RSR' | 'LSR' | 'RSL' | 'RLR' | 'LRL';

export interface DubinsConfig {
  x: number;
  y: number;
  /** Heading in radians. */
  theta: number;
}

export interface DubinsPath {
  word: DubinsWord;
  /** Segment lengths in normalized units (multiply by radius for mm). */
  params: [number, number, number];
  radius: number;
  start: DubinsConfig;
  /** Total length in mm. */
  length: number;
}

const TWO_PI = Math.PI * 2;
export const mod2pi = (a: number): number => {
  const r = a - TWO_PI * Math.floor(a / TWO_PI);
  return r >= TWO_PI - 1e-12 ? 0 : r;
};

type Solver = (alpha: number, beta: number, d: number) => [number, number, number] | null;

const solvers: Record<DubinsWord, Solver> = {
  LSL(alpha, beta, d) {
    const sa = Math.sin(alpha);
    const sb = Math.sin(beta);
    const ca = Math.cos(alpha);
    const cb = Math.cos(beta);
    const cab = Math.cos(alpha - beta);
    const pSq = 2 + d * d - 2 * cab + 2 * d * (sa - sb);
    if (pSq < 0) return null;
    const tmp = Math.atan2(cb - ca, d + sa - sb);
    return [mod2pi(tmp - alpha), Math.sqrt(pSq), mod2pi(beta - tmp)];
  },
  RSR(alpha, beta, d) {
    const sa = Math.sin(alpha);
    const sb = Math.sin(beta);
    const ca = Math.cos(alpha);
    const cb = Math.cos(beta);
    const cab = Math.cos(alpha - beta);
    const pSq = 2 + d * d - 2 * cab + 2 * d * (sb - sa);
    if (pSq < 0) return null;
    const tmp = Math.atan2(ca - cb, d - sa + sb);
    return [mod2pi(alpha - tmp), Math.sqrt(pSq), mod2pi(tmp - beta)];
  },
  LSR(alpha, beta, d) {
    const sa = Math.sin(alpha);
    const sb = Math.sin(beta);
    const ca = Math.cos(alpha);
    const cb = Math.cos(beta);
    const cab = Math.cos(alpha - beta);
    const pSq = -2 + d * d + 2 * cab + 2 * d * (sa + sb);
    if (pSq < 0) return null;
    const p = Math.sqrt(pSq);
    const tmp = Math.atan2(-ca - cb, d + sa + sb) - Math.atan2(-2, p);
    return [mod2pi(tmp - alpha), p, mod2pi(tmp - mod2pi(beta))];
  },
  RSL(alpha, beta, d) {
    const sa = Math.sin(alpha);
    const sb = Math.sin(beta);
    const ca = Math.cos(alpha);
    const cb = Math.cos(beta);
    const cab = Math.cos(alpha - beta);
    const pSq = -2 + d * d + 2 * cab - 2 * d * (sa + sb);
    if (pSq < 0) return null;
    const p = Math.sqrt(pSq);
    const tmp = Math.atan2(ca + cb, d - sa - sb) - Math.atan2(2, p);
    return [mod2pi(alpha - tmp), p, mod2pi(beta - tmp)];
  },
  RLR(alpha, beta, d) {
    const sa = Math.sin(alpha);
    const sb = Math.sin(beta);
    const ca = Math.cos(alpha);
    const cb = Math.cos(beta);
    const cab = Math.cos(alpha - beta);
    const tmp = (6 - d * d + 2 * cab + 2 * d * (sa - sb)) / 8;
    if (Math.abs(tmp) > 1) return null;
    const phi = Math.atan2(ca - cb, d - sa + sb);
    const p = mod2pi(TWO_PI - Math.acos(tmp));
    const t = mod2pi(alpha - phi + mod2pi(p / 2));
    return [t, p, mod2pi(alpha - beta - t + mod2pi(p))];
  },
  LRL(alpha, beta, d) {
    const sa = Math.sin(alpha);
    const sb = Math.sin(beta);
    const ca = Math.cos(alpha);
    const cb = Math.cos(beta);
    const cab = Math.cos(alpha - beta);
    const tmp = (6 - d * d + 2 * cab + 2 * d * (sb - sa)) / 8;
    if (Math.abs(tmp) > 1) return null;
    const phi = Math.atan2(ca - cb, d + sa - sb);
    const p = mod2pi(TWO_PI - Math.acos(tmp));
    const t = mod2pi(-alpha - phi + p / 2);
    return [t, p, mod2pi(mod2pi(beta) - alpha - t + mod2pi(p))];
  },
};

export const DUBINS_WORDS: DubinsWord[] = ['LSL', 'RSR', 'LSR', 'RSL', 'RLR', 'LRL'];

/** All valid Dubins paths between two configurations, shortest first. */
export function dubinsPaths(start: DubinsConfig, goal: DubinsConfig, radius: number): DubinsPath[] {
  const dx = goal.x - start.x;
  const dy = goal.y - start.y;
  const D = Math.hypot(dx, dy);
  const d = D / radius;
  const phi = D < 1e-12 ? 0 : mod2pi(Math.atan2(dy, dx));
  const alpha = mod2pi(start.theta - phi);
  const beta = mod2pi(goal.theta - phi);
  const out: DubinsPath[] = [];
  for (const word of DUBINS_WORDS) {
    const params = solvers[word](alpha, beta, d);
    if (!params || params.some((v) => !Number.isFinite(v))) continue;
    out.push({ word, params, radius, start, length: (params[0] + params[1] + params[2]) * radius });
  }
  return out.sort((a, b) => a.length - b.length);
}

export function shortestDubins(start: DubinsConfig, goal: DubinsConfig, radius: number): DubinsPath | null {
  return dubinsPaths(start, goal, radius)[0] ?? null;
}

function segment(t: number, q: DubinsConfig, type: 'L' | 'R' | 'S'): DubinsConfig {
  // Normalized (radius = 1) segment integration.
  switch (type) {
    case 'L':
      return { x: q.x + Math.sin(q.theta + t) - Math.sin(q.theta), y: q.y - Math.cos(q.theta + t) + Math.cos(q.theta), theta: q.theta + t };
    case 'R':
      return { x: q.x - Math.sin(q.theta - t) + Math.sin(q.theta), y: q.y + Math.cos(q.theta - t) - Math.cos(q.theta), theta: q.theta - t };
    case 'S':
      return { x: q.x + Math.cos(q.theta) * t, y: q.y + Math.sin(q.theta) * t, theta: q.theta };
  }
}

/** Configuration at arc-length `s` (mm) along the path. */
export function dubinsSample(path: DubinsPath, s: number): DubinsConfig {
  const r = path.radius;
  const tprime = Math.max(0, Math.min(s, path.length)) / r;
  const types = path.word.split('') as Array<'L' | 'R' | 'S'>;
  let q: DubinsConfig = { x: 0, y: 0, theta: path.start.theta };
  const [p1, p2] = path.params;
  let out: DubinsConfig;
  if (tprime < p1) out = segment(tprime, q, types[0]!);
  else {
    q = segment(p1, q, types[0]!);
    if (tprime < p1 + p2) out = segment(tprime - p1, q, types[1]!);
    else {
      q = segment(p2, q, types[1]!);
      out = segment(tprime - p1 - p2, q, types[2]!);
    }
  }
  return { x: out.x * r + path.start.x, y: out.y * r + path.start.y, theta: mod2pi(out.theta) };
}

/** Sample configurations every `step` mm (always including both ends). */
export function dubinsSamples(path: DubinsPath, step: number): DubinsConfig[] {
  const n = Math.max(1, Math.ceil(path.length / step));
  const out: DubinsConfig[] = [];
  for (let i = 0; i <= n; i++) out.push(dubinsSample(path, (i / n) * path.length));
  return out;
}
