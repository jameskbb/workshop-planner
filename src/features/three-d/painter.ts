/**
 * Software painter for the 3D view when WebGL is unavailable: the three.js scene graph is turned
 * into world-space convex polygons once, arranged in a BSP tree (polygons that straddle a
 * splitting plane are cut in two), and every frame the tree is walked back-to-front from the
 * camera. That ordering is exact for any viewpoint: interpenetrating solids (a pole through a
 * car, walls meeting at corners, a bench against a wall) are drawn correctly, which a
 * per-face "average depth" sort cannot do.
 *
 * Output is a list of screen-space polygons with a flat-shaded fill, drawn by the caller (SVG).
 */
import * as THREE from 'three';

export type V3 = [number, number, number];

export interface Poly {
  pts: V3[];
  /** Unit normal of the visible side. */
  n: V3;
  /** Plane offset: n·p + d = 0 on the polygon. */
  d: number;
  /** Shaded fill (CSS hex). */
  fill: string;
  opacity: number;
  /** Single-sided polygons are skipped when seen from behind. */
  cull: boolean;
  owner: THREE.Object3D;
}

interface Node {
  n: V3;
  d: number;
  polys: Poly[];
  front: Node | null;
  back: Node | null;
}

export interface ScreenPoly {
  pts: Array<[number, number]>;
  poly: Poly;
}

const EPS = 1e-5; // meters (0.01 mm)

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const same = (a: V3, b: V3) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7 && Math.abs(a[2] - b[2]) < 1e-7;

function area(pts: V3[]): number {
  let s: V3 = [0, 0, 0];
  for (let i = 1; i + 1 < pts.length; i++) {
    const c = cross(sub(pts[i]!, pts[0]!), sub(pts[i + 1]!, pts[0]!));
    s = [s[0] + c[0], s[1] + c[1], s[2] + c[2]];
  }
  return Math.hypot(...s) / 2;
}

// ───────────────────────────── collection ─────────────────────────────

function hex(c: THREE.Color, k: number, add?: THREE.Color): string {
  const rgb = { r: 0, g: 0, b: 0 };
  c.getRGB(rgb, THREE.SRGBColorSpace);
  const e = { r: 0, g: 0, b: 0 };
  add?.getRGB(e, THREE.SRGBColorSpace);
  const f = (v: number, x: number) => Math.max(0, Math.min(255, Math.round((v * k + x) * 255)));
  return `#${((f(rgb.r, e.r) << 16) | (f(rgb.g, e.g) << 8) | f(rgb.b, e.b)).toString(16).padStart(6, '0')}`;
}

/** Try to merge two coplanar triangles that share an edge into one convex quad. */
function mergeQuad(a: V3[], b: V3[], n: V3): V3[] | null {
  const extra = b.filter((p) => !a.some((q) => same(p, q)));
  if (extra.length !== 1) return null;
  const x = extra[0]!;
  for (let i = 0; i < 3; i++) {
    const p = a[i]!;
    const q = a[(i + 1) % 3]!;
    if (b.some((r) => same(r, p)) && b.some((r) => same(r, q))) {
      const quad = [...a.slice(0, i + 1), x, ...a.slice(i + 1)];
      // Convex and consistently wound?
      for (let k = 0; k < 4; k++) {
        const c = cross(sub(quad[(k + 1) % 4]!, quad[k]!), sub(quad[(k + 2) % 4]!, quad[(k + 1) % 4]!));
        if (dot(c, n) <= 1e-12) return null;
      }
      return quad;
    }
  }
  return null;
}

/**
 * World-space polygons of every mesh under `root`, flat-shaded with an ambient + one directional
 * light (`light` points from the scene toward the light).
 */
export function collectPolygons(root: THREE.Object3D, light: V3): Poly[] {
  const L = new THREE.Vector3(...light).normalize();
  const l: V3 = [L.x, L.y, L.z];
  root.updateMatrixWorld(true);
  const out: Poly[] = [];
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const material = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.Material & {
      color?: THREE.Color;
      emissive?: THREE.Color;
      emissiveIntensity?: number;
    };
    if (!material?.color) return;
    const geo = o.geometry as THREE.BufferGeometry;
    const pos = geo.getAttribute('position');
    if (!pos) return;
    const index = geo.getIndex();
    const count = index ? index.count : pos.count;
    const world = (i: number): V3 => {
      v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(o.matrixWorld);
      return [v.x, v.y, v.z];
    };
    const back = material.side === THREE.BackSide;
    const cull = material.side !== THREE.DoubleSide;
    const opacity = material.transparent ? (material.opacity ?? 1) : 1;
    const glow =
      material.emissive && (material.emissiveIntensity ?? 0) > 0 && material.emissive.getHex() !== 0
        ? material.emissive.clone().multiplyScalar(Math.min(1, (material.emissiveIntensity ?? 1) * 0.6))
        : undefined;
    let pending: { pts: V3[]; n: V3 } | null = null;
    const flush = () => {
      if (!pending) return;
      const { pts, n } = pending;
      const lambert = Math.max(0, dot(n, l));
      const k = 0.62 + 0.38 * lambert + 0.06 * n[1];
      out.push({ pts, n, d: -dot(n, pts[0]!), fill: hex(material.color!, glow ? 1 : k, glow), opacity, cull, owner: o });
      pending = null;
    };
    for (let i = 0; i + 2 < count; i += 3) {
      let tri: V3[] = [world(i), world(i + 1), world(i + 2)];
      if (back) tri = [tri[0]!, tri[2]!, tri[1]!];
      const c = cross(sub(tri[1]!, tri[0]!), sub(tri[2]!, tri[0]!));
      const len = Math.hypot(...c);
      if (len < 1e-12) continue;
      const n: V3 = [c[0] / len, c[1] / len, c[2] / len];
      if (pending && dot(pending.n, n) > 1 - 1e-9 && pending.pts.length === 3) {
        const q = mergeQuad(pending.pts, tri, n);
        if (q && Math.abs(dot(n, q[3]!) - dot(n, q[0]!)) < EPS) {
          pending.pts = q;
          continue;
        }
      }
      flush();
      pending = { pts: tri, n };
    }
    flush();
  });
  return out;
}

// ───────────────────────────── BSP ─────────────────────────────

const COPLANAR = 0;
const FRONT = 1;
const BACK = 2;
const SPANNING = 3;

/** Split `p` by the plane (n, d) into the four buckets. */
function splitPoly(p: Poly, n: V3, d: number, coplanar: Poly[], front: Poly[], back: Poly[]) {
  let type = 0;
  const types: number[] = [];
  for (const pt of p.pts) {
    const s = dot(n, pt) + d;
    const t = s < -EPS ? BACK : s > EPS ? FRONT : COPLANAR;
    type |= t;
    types.push(t);
  }
  if (type === COPLANAR) coplanar.push(p);
  else if (type === FRONT) front.push(p);
  else if (type === BACK) back.push(p);
  else {
    const f: V3[] = [];
    const b: V3[] = [];
    for (let i = 0; i < p.pts.length; i++) {
      const j = (i + 1) % p.pts.length;
      const ti = types[i]!;
      const tj = types[j]!;
      const vi = p.pts[i]!;
      const vj = p.pts[j]!;
      if (ti !== BACK) f.push(vi);
      if (ti !== FRONT) b.push(vi);
      if ((ti | tj) === SPANNING) {
        const t = (-d - dot(n, vi)) / dot(n, sub(vj, vi));
        const x = lerp(vi, vj, t);
        f.push(x);
        b.push(x);
      }
    }
    if (f.length >= 3) front.push({ ...p, pts: f });
    if (b.length >= 3) back.push({ ...p, pts: b });
  }
}

/** Count how a candidate splitter would divide `list` (splits are weighted heavily). */
function score(list: Poly[], n: V3, d: number): number {
  let f = 0;
  let b = 0;
  let s = 0;
  for (const p of list) {
    let type = 0;
    for (const pt of p.pts) {
      const x = dot(n, pt) + d;
      type |= x < -EPS ? BACK : x > EPS ? FRONT : COPLANAR;
      if (type === SPANNING) break;
    }
    if (type === SPANNING) s++;
    else if (type === FRONT) f++;
    else if (type === BACK) b++;
  }
  return s * 6 + Math.abs(f - b);
}

/** Build a BSP tree. Large polygons (floor, walls) are preferred as splitters. */
export function buildBsp(polys: Poly[]): Node | null {
  const sorted = polys.slice().sort((a, b) => area(b.pts) - area(a.pts));
  let root: Node | null = null;
  const stack: Array<{ list: Poly[]; set: (n: Node) => void }> = [{ list: sorted, set: (n) => (root = n) }];
  while (stack.length) {
    const { list, set } = stack.pop()!;
    if (!list.length) continue;
    let best = list[0]!;
    if (list.length > 2) {
      let bestScore = Infinity;
      const candidates = list.length > 400 ? 6 : 10;
      for (let i = 0; i < Math.min(candidates, list.length); i++) {
        const c = list[i]!;
        const sc = score(list, c.n, c.d);
        if (sc < bestScore) {
          bestScore = sc;
          best = c;
        }
      }
    }
    const node: Node = { n: best.n, d: best.d, polys: [], front: null, back: null };
    const front: Poly[] = [];
    const back: Poly[] = [];
    for (const p of list) splitPoly(p, node.n, node.d, node.polys, front, back);
    set(node);
    stack.push({ list: front, set: (c) => (node.front = c) }, { list: back, set: (c) => (node.back = c) });
  }
  return root;
}

/**
 * Polygons in back-to-front order for a viewer. `eye` is the camera position (perspective); for an
 * orthographic camera pass `dir` (the view direction) instead.
 */
export function backToFront(root: Node | null, view: { eye?: V3; dir?: V3 }, visit: (p: Poly) => void) {
  const side = (n: V3, d: number) => (view.dir ? -dot(n, view.dir) : dot(n, view.eye!) + d);
  const stack: Array<Node | Poly[]> = root ? [root] : [];
  while (stack.length) {
    const item = stack.pop()!;
    if (Array.isArray(item)) {
      for (const p of item) {
        if (p.cull && side(p.n, p.d) <= 0) continue;
        visit(p);
      }
      continue;
    }
    const inFront = side(item.n, item.d) >= 0;
    const near = inFront ? item.front : item.back;
    const far = inFront ? item.back : item.front;
    // LIFO: far is drawn first, then the splitter's own polygons, then the near side.
    if (near) stack.push(near);
    stack.push(item.polys);
    if (far) stack.push(far);
  }
}

// ───────────────────────────── painter ─────────────────────────────

function visibleChain(o: THREE.Object3D, cache: Map<THREE.Object3D, boolean>): boolean {
  const hit = cache.get(o);
  if (hit !== undefined) return hit;
  const vis = o.visible && (!o.parent || visibleChain(o.parent, cache));
  cache.set(o, vis);
  return vis;
}

/** Project a world polygon to screen pixels, clipped against the near plane. */
function project(pts: V3[], m: THREE.Matrix4, w: number, h: number): Array<[number, number]> | null {
  const e = m.elements;
  let clip = pts.map((p): [number, number, number, number] => [
    e[0]! * p[0] + e[4]! * p[1] + e[8]! * p[2] + e[12]!,
    e[1]! * p[0] + e[5]! * p[1] + e[9]! * p[2] + e[13]!,
    e[2]! * p[0] + e[6]! * p[1] + e[10]! * p[2] + e[14]!,
    e[3]! * p[0] + e[7]! * p[1] + e[11]! * p[2] + e[15]!,
  ]);
  // Near plane: z + w ≥ 0.
  if (clip.some((c) => c[2] + c[3] < 0)) {
    const out: typeof clip = [];
    for (let i = 0; i < clip.length; i++) {
      const a = clip[i]!;
      const b = clip[(i + 1) % clip.length]!;
      const da = a[2] + a[3];
      const db = b[2] + b[3];
      if (da >= 0) out.push(a);
      if (da >= 0 !== db >= 0) {
        const t = da / (da - db);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]);
      }
    }
    clip = out;
  }
  if (clip.length < 3) return null;
  return clip.map((c) => {
    const iw = 1 / Math.max(c[3], 1e-9);
    return [(c[0] * iw * 0.5 + 0.5) * w, (0.5 - c[1] * iw * 0.5) * h];
  });
}

export interface Painter {
  /** Screen polygons back-to-front for the camera (only visible, front-facing ones). */
  paint(camera: THREE.Camera, width: number, height: number): ScreenPoly[];
  polygonCount: number;
}

export function createPainter(root: THREE.Object3D, light: V3): Painter {
  const polys = collectPolygons(root, light);
  const tree = buildBsp(polys);
  const m = new THREE.Matrix4();
  return {
    polygonCount: polys.length,
    paint(camera, width, height) {
      camera.updateMatrixWorld();
      m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      const view: { eye?: V3; dir?: V3 } = {};
      if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
        const d = new THREE.Vector3();
        camera.getWorldDirection(d);
        view.dir = [d.x, d.y, d.z];
      } else {
        const p = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
        view.eye = [p.x, p.y, p.z];
      }
      const cache = new Map<THREE.Object3D, boolean>();
      const out: ScreenPoly[] = [];
      backToFront(tree, view, (p) => {
        if (!visibleChain(p.owner, cache)) return;
        const s = project(p.pts, m, width, height);
        if (!s) return;
        // Off-screen polygons still cost an SVG node, so drop them here.
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const [x, y] of s) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        if (maxX < 0 || minX > width || maxY < 0 || minY > height) return;
        out.push({ pts: s, poly: p });
      });
      return out;
    },
  };
}

/** Project a world segment (for selection outlines); null when behind the camera. */
export function projectSegment(a: V3, b: V3, camera: THREE.Camera, width: number, height: number): [number, number, number, number] | null {
  camera.updateMatrixWorld();
  const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const clip = (p: V3) => new THREE.Vector4(p[0], p[1], p[2], 1).applyMatrix4(m);
  let ca = clip(a);
  let cb = clip(b);
  const da = ca.z + ca.w;
  const db = cb.z + cb.w;
  if (da < 0 && db < 0) return null;
  if (da < 0) ca = ca.clone().lerp(cb, da / (da - db));
  else if (db < 0) cb = cb.clone().lerp(ca, db / (db - da));
  const sx = (c: THREE.Vector4) => (c.x / Math.max(c.w, 1e-9)) * 0.5 * width + width / 2;
  const sy = (c: THREE.Vector4) => (0.5 - (c.y / Math.max(c.w, 1e-9)) * 0.5) * height;
  return [sx(ca), sy(ca), sx(cb), sy(cb)];
}

/** SVG markup for painted polygons. */
export function toSvg(list: ScreenPoly[]): string {
  const parts: string[] = [];
  for (const { pts, poly } of list) {
    let d = '';
    for (let i = 0; i < pts.length; i++) d += `${i ? 'L' : 'M'}${pts[i]![0].toFixed(1)} ${pts[i]![1].toFixed(1)}`;
    // A hairline stroke in the fill colour hides anti-aliasing seams between adjacent polygons.
    parts.push(
      poly.opacity < 1
        ? `<path d="${d}Z" fill="${poly.fill}" fill-opacity="${poly.opacity}"/>`
        : `<path d="${d}Z" fill="${poly.fill}" stroke="${poly.fill}" stroke-width="0.7" stroke-linejoin="round"/>`,
    );
  }
  return parts.join('');
}
