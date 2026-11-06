/**
 * Hatch fill patterns for Konva shapes (so overlays are told apart by pattern, not only color).
 * Patterns are small canvases drawn once per (color, style); scale them by 1/zoom with
 * `fillPatternScale` so they stay a constant size on screen.
 */
export type HatchStyle = 'diag' | 'back-diag' | 'cross' | 'dots';

const cache = new Map<string, HTMLCanvasElement>();

export function hatch(color: string, style: HatchStyle, size = 8, alpha = 0.55): HTMLCanvasElement | undefined {
  if (typeof document === 'undefined') return undefined;
  const key = `${color}|${style}|${size}|${alpha}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (!g) return undefined;
  g.globalAlpha = alpha;
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 1;
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  };
  if (style === 'diag' || style === 'cross') {
    line(0, size, size, 0);
    line(-1, 1, 1, -1);
    line(size - 1, size + 1, size + 1, size - 1);
  }
  if (style === 'back-diag' || style === 'cross') {
    line(0, 0, size, size);
    line(size - 1, -1, size + 1, 1);
    line(-1, size - 1, 1, size + 1);
  }
  if (style === 'dots') {
    g.beginPath();
    g.arc(size / 2, size / 2, 1.1, 0, Math.PI * 2);
    g.fill();
  }
  cache.set(key, c);
  return c;
}

/** CSS equivalent for legend swatches. */
export function cssHatch(color: string, style: HatchStyle): string {
  switch (style) {
    case 'diag':
      return `repeating-linear-gradient(-45deg, ${color}99 0 1px, transparent 1px 5px)`;
    case 'back-diag':
      return `repeating-linear-gradient(45deg, ${color}99 0 1px, transparent 1px 5px)`;
    case 'cross':
      return `repeating-linear-gradient(45deg, ${color}99 0 1px, transparent 1px 5px), repeating-linear-gradient(-45deg, ${color}99 0 1px, transparent 1px 5px)`;
    case 'dots':
      return `radial-gradient(${color} 1px, transparent 1.2px) 0 0 / 5px 5px`;
  }
}
