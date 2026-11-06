/**
 * Builds a three.js scene graph from the 3D scene model: walls with openings, floor, ceiling,
 * fixed features, objects by archetype (bench = top + legs, cabinet = box with door lines, tools
 * with a table, shelving with posts and shelves, cylinders), vehicles (body + cabin + wheels) and
 * light fixtures. One builder serves both renderers (WebGL and the software SVG fallback).
 *
 * Pickable groups carry `userData = { kind: 'object' | 'vehicle', id, name }`.
 */
import * as THREE from 'three';
import type { SceneFeature, SceneModel, SceneObject, SceneVehicle } from './model';

export interface BuiltScene {
  root: THREE.Group;
  walls: THREE.Group;
  ceiling: THREE.Object3D | null;
  /** Point lights inside fixtures (WebGL only; the SVG renderer uses ambient + directional). */
  pointLights: THREE.PointLight[];
  dispose(): void;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, rough = 0.75, metal = 0.05, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${rough}|${metal}|${JSON.stringify(extra)}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
    matCache.set(key, m);
  }
  return m;
}

function box(w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.001), Math.max(h, 0.001), Math.max(d, 0.001)), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cylinder(r: number, h: number, material: THREE.Material, segments = 20): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments), material);
  m.castShadow = true;
  return m;
}

function floorShape(model: SceneModel): THREE.ShapeGeometry | null {
  if (model.floor.length < 3) return null;
  // Shape in (x, −z): rotating −90° about x lays it flat with z = plan y.
  return new THREE.ShapeGeometry(new THREE.Shape(model.floor.map(([x, z]) => new THREE.Vector2(x, -z))));
}

// ───────────────────────────── objects ─────────────────────────────

function frontLines(g: THREE.Group, w: number, h: number, d: number, count: number, vertical: boolean) {
  const line = mat('#3a3f45', 0.9, 0);
  for (let i = 1; i < count; i++) {
    const t = i / count;
    g.add(vertical ? box(0.008, h * 0.92, 0.004, line, -w / 2 + w * t, h / 2, d / 2 + 0.002) : box(w * 0.94, 0.008, 0.004, line, 0, h * t, d / 2 + 0.002));
  }
}

export function buildObject(o: SceneObject): THREE.Group {
  const g = new THREE.Group();
  const { width: w, depth: d, height: h, color, accent } = o;
  switch (o.archetype) {
    case 'bench': {
      const top = Math.min(0.05, h * 0.1);
      const leg = Math.min(0.07, w / 8, d / 4);
      g.add(box(w, top, d, mat(color, 0.6), 0, h - top / 2, 0));
      for (const [x, z] of [
        [-w / 2 + leg, -d / 2 + leg],
        [w / 2 - leg, -d / 2 + leg],
        [-w / 2 + leg, d / 2 - leg],
        [w / 2 - leg, d / 2 - leg],
      ] as const)
        g.add(box(leg, h - top, leg, mat(accent), x, (h - top) / 2, z));
      g.add(box(w - leg * 2, 0.02, d - leg * 2, mat(color), 0, (h - top) * 0.25, 0));
      break;
    }
    case 'cabinet':
      g.add(box(w, h, d, mat(color, 0.5, 0.15), 0, h / 2, 0));
      frontLines(g, w, h, d, h > 1.2 ? 2 : Math.max(2, Math.round(h / 0.18)), h > 1.2);
      break;
    case 'tool': {
      const baseH = h * 0.78;
      g.add(box(w * 0.6, baseH, d * 0.6, mat(accent, 0.6, 0.3), 0, baseH / 2, 0));
      g.add(box(w, (h - baseH) * 0.3, d, mat('#aeb4ba', 0.35, 0.6), 0, baseH + (h - baseH) * 0.15, 0));
      g.add(box(Math.min(w, d) * 0.3, (h - baseH) * 0.6, Math.min(w, d) * 0.25, mat(color), 0, baseH + (h - baseH) * 0.6, 0));
      break;
    }
    case 'shelving': {
      const shelves = Math.max(2, Math.round(h / 0.45));
      const post = 0.03;
      for (const [x, z] of [
        [-w / 2 + post / 2, -d / 2 + post / 2],
        [w / 2 - post / 2, -d / 2 + post / 2],
        [-w / 2 + post / 2, d / 2 - post / 2],
        [w / 2 - post / 2, d / 2 - post / 2],
      ] as const)
        g.add(box(post, h, post, mat(accent, 0.6, 0.4), x, h / 2, z));
      for (let i = 0; i <= shelves; i++) g.add(box(w, 0.02, d, mat(color), 0, Math.max(0.05, (h * i) / shelves - 0.01), 0));
      break;
    }
    case 'cylinder': {
      const c = cylinder(Math.min(w, d) / 2, h, mat(color, 0.5), 24);
      c.position.y = h / 2;
      g.add(c);
      break;
    }
    default:
      g.add(box(w, h, d, mat(color), 0, h / 2, 0));
  }
  g.position.set(...o.position);
  g.rotation.y = o.yaw;
  g.userData = { kind: 'object', id: o.id, name: o.name, size: [w, h, d] };
  return g;
}

export function buildVehicle(v: SceneVehicle): THREE.Group {
  const g = new THREE.Group();
  const bodyH = v.height * 0.5;
  const clearance = 0.15;
  const wheelR = Math.min(0.34, v.height * 0.22);
  const axle = v.wheelbase / 2;
  // local +z = front (plan +y)
  g.add(box(v.width, bodyH, v.length, mat(v.color, 0.35, 0.4), 0, clearance + bodyH / 2, 0));
  g.add(box(v.width * 0.86, v.height - bodyH - clearance, v.length * 0.5, mat('#2c3a46', 0.15, 0.3, { transparent: true, opacity: 0.85 }), 0, clearance + bodyH + (v.height - bodyH - clearance) / 2, -v.length * 0.06));
  for (const [x, z] of [
    [-v.width / 2 + 0.1, axle],
    [v.width / 2 - 0.1, axle],
    [-v.width / 2 + 0.1, -axle],
    [v.width / 2 - 0.1, -axle],
  ] as const) {
    const wh = cylinder(wheelR, 0.22, mat('#1e2226', 0.9, 0), 18);
    wh.position.set(x, wheelR, z);
    wh.rotation.z = Math.PI / 2;
    g.add(wh);
  }
  g.position.set(...v.position);
  g.rotation.y = v.yaw;
  g.userData = { kind: 'vehicle', id: v.id, name: v.name, size: [v.width, v.height, v.length] };
  return g;
}

function buildFeature(f: SceneFeature): THREE.Object3D {
  const g = new THREE.Group();
  const m =
    f.shape === 'cylinder' ? cylinder(f.width / 2, f.height, mat(f.color, 0.6, f.width < 0.2 ? 0.5 : 0.1), 24) : box(f.width, f.height, f.depth, mat(f.color, 0.8));
  m.position.y = f.height / 2;
  g.add(m);
  g.position.set(...f.position);
  g.rotation.y = f.yaw;
  return g;
}

// ───────────────────────────── scene ─────────────────────────────

export function buildThreeScene(model: SceneModel, opts: { pointLights?: number } = {}): BuiltScene {
  const root = new THREE.Group();
  const geoms: THREE.BufferGeometry[] = [];
  const fg = floorShape(model);
  if (fg) {
    const floor = new THREE.Mesh(fg, mat('#cfcac1', 0.95, 0));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.name = 'floor';
    root.add(floor);
    geoms.push(fg);
  }
  let ceiling: THREE.Object3D | null = null;
  const cg = floorShape(model);
  if (cg) {
    // Visible from below only.
    const c = new THREE.Mesh(cg, mat('#f1efe9', 1, 0, { side: THREE.BackSide }));
    c.rotation.x = -Math.PI / 2;
    c.position.y = model.ceilingHeight;
    c.name = 'ceiling';
    root.add(c);
    ceiling = c;
    geoms.push(cg);
  }
  const walls = new THREE.Group();
  walls.name = 'walls';
  const wallMat = mat('#e4e1da', 0.9, 0);
  for (const w of model.walls) {
    const m = box(w.size[0], w.size[1], w.size[2], wallMat);
    m.position.set(...w.center);
    m.rotation.y = w.yaw;
    walls.add(m);
  }
  for (const o of model.openings) {
    if (!o.fill) continue;
    const m = box(
      o.fill.size[0],
      o.fill.size[1],
      o.fill.size[2],
      o.fill.material === 'glass' ? mat('#9cc7e6', 0.1, 0.1, { transparent: true, opacity: 0.35 }) : mat('#d8d6d0', 0.7, 0),
      ...o.fill.center,
    );
    m.rotation.y = o.fill.yaw;
    walls.add(m);
  }
  root.add(walls);
  for (const f of model.features) root.add(buildFeature(f));
  for (const o of model.objects) root.add(buildObject(o));
  for (const v of model.vehicles) root.add(buildVehicle(v));
  const pointLights: THREE.PointLight[] = [];
  model.lights.forEach((l, i) => {
    const g = new THREE.Group();
    g.add(box(l.length, 0.05, l.width, mat('#fffbe8', 0.5, 0, { emissive: new THREE.Color('#fff3c4'), emissiveIntensity: 1.2 }), 0, -0.03, 0));
    if (i < (opts.pointLights ?? 6)) {
      const pl = new THREE.PointLight('#fff6e0', Math.min(3, l.lumens / 2500), 8, 1.4);
      pl.position.y = -0.2;
      g.add(pl);
      pointLights.push(pl);
    }
    g.position.set(...l.position);
    g.rotation.y = l.yaw;
    root.add(g);
  });
  return {
    root,
    walls,
    ceiling,
    pointLights,
    dispose() {
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.geometry.dispose();
      });
      for (const g of geoms) g.dispose();
    },
  };
}

/** Walk up from a hit mesh to the pickable group (object / vehicle). */
export function pickable(obj: THREE.Object3D | null): { kind: 'object' | 'vehicle'; id: string; name: string } | null {
  for (let o = obj; o; o = o.parent) {
    const u = o.userData as { kind?: string; id?: string; name?: string };
    if ((u.kind === 'object' || u.kind === 'vehicle') && u.id) return { kind: u.kind, id: u.id, name: u.name ?? '' };
  }
  return null;
}
