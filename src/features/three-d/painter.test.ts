import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createDemoProject } from '@/features/projects/demo';
import { applyCameraRequest } from './camera';
import { buildSceneModel, type CameraPreset } from './model';
import { backToFront, buildBsp, collectPolygons, createPainter, type Poly, type ScreenPoly, type V3 } from './painter';
import { buildThreeScene } from './sceneBuilder';

const W = 320;
const H = 200;

function inside(pts: Array<[number, number]>, x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/**
 * Compare the painter's result with a z-buffer at sample pixels: at every pixel the last opaque
 * polygon painted there must be (one of) the nearest opaque polygons covering it.
 */
function zbufferMismatches(list: ScreenPoly[], camera: THREE.Camera, step = 4): number {
  const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera;
  let bad = 0;
  for (let y = 0.37; y < H; y += step) {
    for (let x = 0.61; x < W; x += step) {
      const near = new THREE.Vector3((x / W) * 2 - 1, 1 - (y / H) * 2, -1).unproject(camera);
      const far = new THREE.Vector3((x / W) * 2 - 1, 1 - (y / H) * 2, 1).unproject(camera);
      const origin = ortho ? near : eye;
      const dir = far.clone().sub(origin).normalize();
      const depth = (p: Poly) => {
        const denom = p.n[0] * dir.x + p.n[1] * dir.y + p.n[2] * dir.z;
        if (Math.abs(denom) < 1e-9) return Infinity;
        return -(p.n[0] * origin.x + p.n[1] * origin.y + p.n[2] * origin.z + p.d) / denom;
      };
      let top: ScreenPoly | null = null;
      let best = Infinity;
      for (const s of list) {
        if (s.poly.opacity < 1 || !inside(s.pts, x, y)) continue;
        top = s;
        best = Math.min(best, depth(s.poly));
      }
      if (top && depth(top.poly) > best + 0.005) bad++;
    }
  }
  return bad;
}

function scene(opts: { walls?: boolean } = {}) {
  const model = buildSceneModel(createDemoProject());
  const built = buildThreeScene(model, { pointLights: 0 });
  built.walls.visible = opts.walls ?? true;
  if (built.ceiling) built.ceiling.visible = false;
  return { model, built };
}

function cameraFor(model: ReturnType<typeof buildSceneModel>, preset: CameraPreset, orthographic = false): THREE.Camera {
  const camera = orthographic ? new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, -100, 500) : new THREE.PerspectiveCamera(50, W / H, 0.05, 500);
  applyCameraRequest(camera, new THREE.Vector3(), { seq: 1, preset }, model, { width: W, height: H });
  camera.updateMatrixWorld();
  return camera;
}

describe('software painter (BSP back-to-front)', () => {
  it('orders two overlapping quads by depth from either side', () => {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color: '#ff0000', side: THREE.DoubleSide });
    const a = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
    a.position.z = 1;
    b.position.z = -1;
    g.add(a, b);
    const tree = buildBsp(collectPolygons(g, [0, 1, 0]));
    const order = (eye: V3) => {
      const seen: THREE.Object3D[] = [];
      backToFront(tree, { eye }, (p) => {
        if (seen.at(-1) !== p.owner) seen.push(p.owner);
      });
      return seen;
    };
    expect(order([0, 0, 10])).toEqual([b, a]);
    expect(order([0, 0, -10])).toEqual([a, b]);
  });

  it('splits interpenetrating solids (a pole through a box) so each half sorts correctly', () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), new THREE.MeshStandardMaterial({ color: '#3366aa' })));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3, 12), new THREE.MeshStandardMaterial({ color: '#888888' })));
    const painter = createPainter(g, [0.3, 1, 0.2]);
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.05, 100);
    camera.position.set(3, 2, 4);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    expect(zbufferMismatches(painter.paint(camera, W, H), camera, 2)).toBe(0);
  });

  it('draws the demo garage exactly like a depth buffer from every preset', () => {
    const { model, built } = scene();
    const painter = createPainter(built.root, [0.4, 1, 0.3]);
    expect(painter.polygonCount).toBeGreaterThan(200);
    for (const preset of ['perspective', 'front', 'left', 'rear', 'top'] as CameraPreset[]) {
      const camera = cameraFor(model, preset);
      const list = painter.paint(camera, W, H);
      expect(list.length).toBeGreaterThan(50);
      expect(zbufferMismatches(list, camera), preset).toBe(0);
    }
  });

  it('is exact with the walls hidden and in orthographic projection', () => {
    const { model, built } = scene({ walls: false });
    const painter = createPainter(built.root, [0.4, 1, 0.3]);
    const persp = cameraFor(model, 'perspective');
    expect(zbufferMismatches(painter.paint(persp, W, H), persp)).toBe(0);
    const ortho = cameraFor(model, 'perspective', true);
    expect(zbufferMismatches(painter.paint(ortho, W, H), ortho)).toBe(0);
  });

  it('skips hidden groups (walls toggle) and back faces', () => {
    const { model, built } = scene({ walls: true });
    const painter = createPainter(built.root, [0.4, 1, 0.3]);
    const camera = cameraFor(model, 'perspective');
    const withWalls = painter.paint(camera, W, H).length;
    built.walls.visible = false;
    const without = painter.paint(camera, W, H);
    expect(without.length).toBeLessThan(withWalls);
    const wallMeshes = new Set<THREE.Object3D>();
    built.walls.traverse((o) => wallMeshes.add(o));
    expect(without.some((s) => wallMeshes.has(s.poly.owner))).toBe(false);
  });
});
