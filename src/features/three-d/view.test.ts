// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createDemoProject } from '@/features/projects/demo';
import { applyCameraRequest, fitOrtho, FOV } from './camera';
import { buildSceneModel } from './model';
import { buildThreeScene, pickable } from './sceneBuilder';
import { cameraRef } from './store';
import { hasWebGL, startWalk, walkStep } from './ThreeView';

/**
 * The WebGL view's camera rig, walk rig and picking run the same functions as the software
 * renderer, and this machine has no GPU to render either with. These tests cover that shared
 * behaviour directly (the pixels are covered by the software renderer's painter tests and, on a
 * GPU machine, by `WP_E2E_WEBGL=1 pnpm test:e2e`).
 */
const model = buildSceneModel(createDemoProject());
const floor = model.floor.map(([x, z]) => ({ x, y: z }));

describe('3D view behaviour shared by the WebGL and software renderers', () => {
  it('detects that this environment has no WebGL, so the app falls back on purpose', () => {
    expect(hasWebGL()).toBe(false);
  });

  it('camera presets frame the room and orthographic zoom fits it', () => {
    const camera = new THREE.PerspectiveCamera(FOV, 1.6, 0.05, 500);
    const target = new THREE.Vector3();
    applyCameraRequest(camera, target, { seq: 1, preset: 'top' }, model, { width: 800, height: 500 });
    expect(camera.position.y).toBeGreaterThan(model.bounds.height);
    expect(target.x).toBeCloseTo((model.bounds.minX + model.bounds.maxX) / 2, 3);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    expect(dir.y).toBeLessThan(-0.9); // looking down

    const ortho = new THREE.OrthographicCamera(-400, 400, 250, -250, -100, 500);
    applyCameraRequest(ortho, target, { seq: 2, preset: 'perspective' }, model, { width: 800, height: 500 });
    fitOrtho(ortho, model, { width: 800, height: 500 });
    const extent = Math.max(model.bounds.maxX - model.bounds.minX, model.bounds.maxZ - model.bounds.minZ, model.bounds.height) * 1.25;
    expect(ortho.zoom).toBeCloseTo(Math.min(800 / extent, 500 / extent), 5);
  });

  it('walk mode starts inside the room at eye height, looking north', () => {
    const camera = new THREE.PerspectiveCamera(FOV, 1.6, 0.05, 500);
    startWalk(camera, model, 1.6);
    expect(camera.position.y).toBeCloseTo(1.6, 6);
    expect(camera.position.x).toBeGreaterThan(model.bounds.minX);
    expect(camera.position.x).toBeLessThan(model.bounds.maxX);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    expect(dir.z).toBeLessThan(-0.9); // −z is plan north
  });

  it('walking moves, turns, keeps eye height and never leaves the room', () => {
    const camera = new THREE.PerspectiveCamera(FOV, 1.6, 0.05, 500);
    startWalk(camera, model, 1.7);
    const start = camera.position.clone();
    expect(walkStep(camera, new Set(['w']), 0.5, 1.7, floor)).toBe(true);
    expect(camera.position.distanceTo(start)).toBeGreaterThan(0.1);
    expect(camera.position.y).toBeCloseTo(1.7, 6);
    // Shift hurries.
    const before = camera.position.clone();
    walkStep(camera, new Set(['w', 'shift']), 0.5, 1.7, floor);
    expect(camera.position.distanceTo(before)).toBeGreaterThan(0.6);
    // Walking north for a long time stops at the wall instead of leaving the room.
    for (let i = 0; i < 80; i++) walkStep(camera, new Set(['w']), 0.5, 1.7, floor);
    const p = camera.position;
    expect(model.floor.length).toBeGreaterThan(2);
    expect(p.x).toBeGreaterThan(model.bounds.minX - 0.01);
    expect(p.x).toBeLessThan(model.bounds.maxX + 0.01);
    expect(p.z).toBeGreaterThan(model.bounds.minZ - 0.01);
    expect(p.z).toBeLessThan(model.bounds.maxZ + 0.01);
    // Turning changes the heading and publishes the pose the saved-views menu reads.
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    walkStep(camera, new Set(['q']), 0.5, 1.7, floor);
    const turned = new THREE.Vector3();
    camera.getWorldDirection(turned);
    expect(turned.angleTo(dir)).toBeGreaterThan(0.5);
    expect(cameraRef.current).toMatchObject({ orthographic: false, fov: FOV });
    expect(cameraRef.current!.position[1]).toBeCloseTo(1.7, 6);
  });

  it('a ray through an item on screen picks that item (click-to-select, both renderers)', () => {
    const built = buildThreeScene(model, { pointLights: 0 });
    built.root.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(FOV, 1.6, 0.05, 500);
    applyCameraRequest(camera, new THREE.Vector3(), { seq: 1, preset: 'top' }, model, { width: 800, height: 500 });
    camera.updateMatrixWorld();
    const ray = new THREE.Raycaster();
    const pick = (world: [number, number, number]) => {
      const p = new THREE.Vector3(world[0], world[1], world[2]).project(camera);
      ray.setFromCamera(new THREE.Vector2(p.x, p.y), camera);
      return ray
        .intersectObject(built.root, true)
        .map((h) => pickable(h.object))
        .find(Boolean);
    };
    const car = model.vehicles[0]!;
    expect(pick([car.position[0], car.height / 2, car.position[2]])).toMatchObject({ kind: 'vehicle', id: car.id });
    const bench = model.objects.find((o) => /Workbench/.test(o.name))!;
    expect(pick([bench.position[0], bench.position[1] + bench.height / 2, bench.position[2]])).toMatchObject({ kind: 'object', id: bench.id });
    built.dispose();
  });

  it('every object and vehicle in the scene graph is pickable by its entity id', () => {
    const built = buildThreeScene(model, { pointLights: 0 });
    const hits = new Map<string, string>();
    built.root.traverse((o) => {
      const hit = pickable(o);
      if (hit) hits.set(hit.id, hit.kind);
    });
    for (const o of model.objects) expect(hits.get(o.id)).toBe('object');
    for (const v of model.vehicles) expect(hits.get(v.id)).toBe('vehicle');
    // Walls, floor, ceiling, features and lights are scenery, not selectable entities.
    expect(pickable(built.walls.children[0]!)).toBeNull();
    expect(pickable(built.ceiling)).toBeNull();
    built.dispose();
  });
});
