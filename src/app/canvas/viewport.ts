/**
 * Pure viewport math for the plan canvas. screen = R(rotation) · (world × scale) + (x, y);
 * scale is px per mm, rotation (degrees, clockwise) orients the plan (0 = north up, 180 = south up,
 * 90 = west up, 270 = east up). Konva's Stage applies the same transform (x, y, rotation, scale).
 */
import type { BBox, Point } from '@/geometry';
import type { Viewport } from '@/stores/uiStore';

export const MIN_SCALE = 0.004; // 1 px ≈ 250 mm
export const MAX_SCALE = 6; // 6 px per mm

export const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

function rot(p: Point, deg: number): Point {
  if (!deg) return p;
  const r = (deg * Math.PI) / 180;
  const c = Math.round(Math.cos(r) * 1e12) / 1e12;
  const s = Math.round(Math.sin(r) * 1e12) / 1e12;
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function toWorld(v: Viewport, screen: Point): Point {
  const p = rot({ x: screen.x - v.x, y: screen.y - v.y }, -(v.rotation ?? 0));
  return { x: p.x / v.scale, y: p.y / v.scale };
}

export function toScreen(v: Viewport, world: Point): Point {
  const p = rot({ x: world.x * v.scale, y: world.y * v.scale }, v.rotation ?? 0);
  return { x: p.x + v.x, y: p.y + v.y };
}

/** Zoom by `factor` keeping the world point under `screen` fixed. */
export function zoomAt(v: Viewport, screen: Point, factor: number): Viewport {
  const scale = clampScale(v.scale * factor);
  const k = scale / v.scale;
  return { ...v, scale, x: screen.x - (screen.x - v.x) * k, y: screen.y - (screen.y - v.y) * k };
}

/** Viewport that puts world point `center` at screen point `at` (keeping scale and rotation). */
export function centerOn(v: Viewport, center: Point, at: Point): Viewport {
  const p = rot({ x: center.x * v.scale, y: center.y * v.scale }, v.rotation ?? 0);
  return { ...v, x: at.x - p.x, y: at.y - p.y };
}

/** Viewport that fits `box` into a canvas of `size` with `padding` px margins (keeps `rotation`). */
export function fitBounds(box: BBox, size: { width: number; height: number }, padding = 56, rotation = 0): Viewport {
  const quarter = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  const bw = Math.max(1, quarter ? box.maxY - box.minY : box.maxX - box.minX);
  const bh = Math.max(1, quarter ? box.maxX - box.minX : box.maxY - box.minY);
  const w = Math.max(1, size.width - 2 * padding);
  const h = Math.max(1, size.height - 2 * padding);
  const scale = clampScale(Math.min(w / bw, h / bh));
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  return centerOn({ x: 0, y: 0, scale, rotation }, { x: cx, y: cy }, { x: size.width / 2, y: size.height / 2 });
}

/** Visible world rectangle (axis-aligned bounds) for a viewport and canvas size. */
export function visibleWorld(v: Viewport, size: { width: number; height: number }): BBox {
  const pts = [
    toWorld(v, { x: 0, y: 0 }),
    toWorld(v, { x: size.width, y: 0 }),
    toWorld(v, { x: size.width, y: size.height }),
    toWorld(v, { x: 0, y: size.height }),
  ];
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

/** Orientation presets: which compass direction points up on screen. */
export const ORIENTATIONS = { north: 0, east: 270, south: 180, west: 90 } as const;
export type Orientation = keyof typeof ORIENTATIONS;
export const orientationOf = (rotation = 0): Orientation => {
  const r = ((Math.round(rotation) % 360) + 360) % 360;
  return r === 270 ? 'east' : r === 180 ? 'south' : r === 90 ? 'west' : 'north';
};

/** Rotation that keeps text upright on screen for a world direction `deg` under view rotation `viewRot`. */
export function uprightAngle(deg: number, viewRot = 0): number {
  let a = (((deg + viewRot) % 360) + 360) % 360;
  if (a > 90 && a <= 270) a -= 180;
  return a - viewRot;
}

/**
 * Grid spacing to draw: the configured grid, multiplied up until lines are at least `minPx` apart
 * (so zooming out never draws a solid carpet of lines). Returns [minor, major] spacing in mm.
 */
export function adaptiveGrid(gridSize: number, scale: number, minPx = 8): [number, number] {
  let minor = gridSize;
  const steps = [2, 2.5, 2];
  let i = 0;
  while (minor * scale < minPx && i < 40) {
    minor *= steps[i % steps.length]!;
    i++;
  }
  // Major lines: every foot (imperial-ish grids) or every 5 minors, whichever reads better.
  const major = minor * (Math.abs(gridSize - 25.4 * Math.round(gridSize / 25.4)) < 0.01 && minor < 304.8 ? Math.max(1, Math.round(304.8 / minor)) : 5);
  return [minor, major];
}
