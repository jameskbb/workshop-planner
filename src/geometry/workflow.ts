/**
 * Workflow travel distance between a chain of stations (e.g. lumber rack → miter saw → table saw).
 * Uses walking distance on the walkability grid when available, straight-line distance otherwise.
 */
import { walkingDistance, type WalkabilityResult } from './walkability';
import { distance, type Point } from './vec';

export interface WorkflowLeg {
  from: number;
  to: number;
  /** Distance in mm (walking if possible, else straight line). */
  distance: number;
  /** True when the legs uses the grid route; false when it fell back to straight-line or is blocked. */
  walked: boolean;
  /** True when no walkable route exists (distance is then the straight-line lower bound). */
  blocked: boolean;
}

export interface WorkflowTravel {
  legs: WorkflowLeg[];
  total: number;
}

export function workflowTravel(stations: readonly Point[], walk?: WalkabilityResult | null, bodyWidth = 450): WorkflowTravel {
  const legs: WorkflowLeg[] = [];
  for (let i = 0; i + 1 < stations.length; i++) {
    const a = stations[i]!;
    const b = stations[i + 1]!;
    const straight = distance(a, b);
    if (walk) {
      const d = walkingDistance(walk, a, b, bodyWidth);
      if (d !== null) legs.push({ from: i, to: i + 1, distance: Math.max(d, straight), walked: true, blocked: false });
      else legs.push({ from: i, to: i + 1, distance: straight, walked: false, blocked: true });
    } else {
      legs.push({ from: i, to: i + 1, distance: straight, walked: false, blocked: false });
    }
  }
  return { legs, total: legs.reduce((s, l) => s + l.distance, 0) };
}
