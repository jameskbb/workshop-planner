/**
 * Software 3D renderer for browsers without WebGL: the same scene graph drawn as flat-shaded SVG
 * polygons in exact back-to-front order (a BSP tree, see painter.ts). Renders on demand (every camera change,
 * toggle or walk step re-renders once), so it needs no animation loop. Supports orbit/pan/zoom,
 * walk mode (keys + drag to look), projection switch, presets, saved views and click-to-select.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { uiActions, useUiStore } from '@/stores/uiStore';
import { applyCameraRequest, FOV } from './camera';
import type { SceneModel } from './model';
import { createPainter, projectSegment, toSvg, type V3 } from './painter';
import { buildThreeScene, pickable } from './sceneBuilder';
import { cameraRef, useView3d } from './store';
import { startWalk, walkStep } from './ThreeView';

export default function SoftwareView({ model }: { model: SceneModel }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current!;
    const size = () => ({ width: Math.max(1, el.clientWidth), height: Math.max(1, el.clientHeight) });
    const built = buildThreeScene(model, { pointLights: 0 });
    // Same sun direction as the WebGL view's directional light.
    const painter = createPainter(built.root, [6, model.bounds.height + 8, 4]);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-testid', 'three-svg');
    svg.style.display = 'block';
    svg.style.touchAction = 'none';
    el.appendChild(svg);
    const renderer = {
      domElement: svg as unknown as HTMLElement,
      width: 1,
      height: 1,
      setSize(w: number, h: number) {
        this.width = w;
        this.height = h;
        svg.setAttribute('width', String(w));
        svg.setAttribute('height', String(h));
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      },
    };
    /** Selected items: box edges drawn over the scene. */
    let selectionBoxes: Array<{ o: THREE.Object3D; size: [number, number, number] }> = [];

    const persp = new THREE.PerspectiveCamera(FOV, 1, 0.05, 500);
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 500);
    let camera: THREE.Camera = persp;
    const target = new THREE.Vector3(...model.center);
    const floor = model.floor.map(([x, z]) => ({ x, y: z }));

    const layout = () => {
      const s = size();
      renderer.setSize(s.width, s.height);
      persp.aspect = s.width / s.height;
      persp.updateProjectionMatrix();
      Object.assign(ortho, {
        left: -s.width / 2,
        right: s.width / 2,
        top: s.height / 2,
        bottom: -s.height / 2,
      });
      ortho.updateProjectionMatrix();
    };

    let controls = new OrbitControls(camera, renderer.domElement);
    const render = () => {
      const { width: w, height: h } = renderer;
      let lines = '';
      for (const { o, size } of selectionBoxes) {
        const [sx, sy, sz] = size.map((v) => v / 2 + 0.015) as V3;
        const c = (x: number, y: number, z: number): V3 => {
          const v = new THREE.Vector3(x * sx, (y + 1) * sy - 0.015, z * sz).applyMatrix4(o.matrixWorld);
          return [v.x, v.y, v.z];
        };
        const corners = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z] as V3)));
        for (const a of corners)
          for (const b of corners) {
            const diff = a.filter((v, i) => v !== b[i]).length;
            if (diff !== 1 || a.join() > b.join()) continue;
            const seg = projectSegment(c(...a), c(...b), camera, w, h);
            if (seg) lines += `<line x1="${seg[0].toFixed(1)}" y1="${seg[1].toFixed(1)}" x2="${seg[2].toFixed(1)}" y2="${seg[3].toFixed(1)}"/>`;
          }
      }
      svg.innerHTML =
        `<rect width="${w}" height="${h}" fill="#20252b"/>` +
        toSvg(painter.paint(camera, w, h)) +
        (lines ? `<g stroke="#2f7df6" stroke-width="2" data-testid="three-selection">${lines}</g>` : '');
      const p = camera.position;
      if (useView3d.getState().mode === 'orbit')
        cameraRef.current = {
          position: [p.x, p.y, p.z],
          target: [target.x, target.y, target.z],
          fov: FOV,
          orthographic: camera === ortho,
        };
      const win = window as unknown as { __wp3d?: Record<string, unknown> };
      if (import.meta.env.DEV)
        win.__wp3d = {
          ...(win.__wp3d ?? {}),
          frames: ((win.__wp3d?.frames as number) ?? 0) + 1,
          polygons: painter.polygonCount,
        };
    };
    const makeControls = () => {
      controls.dispose();
      controls = new OrbitControls(camera, renderer.domElement);
      controls.target.copy(target);
      controls.maxPolarAngle = Math.PI * 0.499;
      controls.screenSpacePanning = true;
      controls.addEventListener('change', () => {
        target.copy(controls.target);
        render();
      });
      controls.enabled = useView3d.getState().mode === 'orbit';
    };

    const applyState = (prev?: ReturnType<typeof useView3d.getState>) => {
      const st = useView3d.getState();
      const walking = st.mode === 'walk';
      const wantOrtho = st.orthographic && !walking;
      if ((camera === ortho) !== wantOrtho) {
        const from = camera;
        camera = wantOrtho ? ortho : persp;
        camera.position.copy(from.position);
        makeControls();
      }
      built.walls.visible = st.showWalls;
      if (built.ceiling) built.ceiling.visible = st.showCeiling || walking;
      if (walking && prev?.mode !== 'walk') {
        startWalk(camera, model, st.eyeHeight);
        walkStep(camera, new Set(), 0, st.eyeHeight, floor);
      }
      controls.enabled = !walking;
      if (st.request && st.request !== prev?.request && !walking) {
        applyCameraRequest(camera, target, st.request, model, size());
        controls.target.copy(target);
        controls.update();
      }
      render();
    };

    layout();
    makeControls();
    applyState();
    const unsub = useView3d.subscribe((_s, prev) => applyState(prev));

    // Selection outlines.
    const syncSelection = () => {
      selectionBoxes = [];
      for (const ref of useUiStore.getState().selection) {
        built.root.traverse((o) => {
          const u = o.userData as { kind?: string; id?: string; size?: [number, number, number] };
          if (u.kind === ref.kind && u.id === ref.id && u.size) selectionBoxes.push({ o, size: u.size });
        });
      }
      render();
    };
    syncSelection();
    const unsubSel = useUiStore.subscribe((s, p) => s.selection !== p.selection && syncSelection());

    // Click to select (ignored after a drag).
    let down: { x: number; y: number } | null = null;
    let look: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
      if (useView3d.getState().mode === 'walk') look = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (!look) return;
      const dx = e.clientX - look.x;
      const dy = e.clientY - look.y;
      look = { x: e.clientX, y: e.clientY };
      camera.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), -dx * 0.004);
      camera.rotateX(-dy * 0.004);
      walkStep(camera, new Set(), 0, useView3d.getState().eyeHeight, floor);
      render();
    };
    const onUp = (e: PointerEvent) => {
      look = null;
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const hits = ray
        .intersectObject(built.root, true)
        .filter((h) => h.object.visible && (built.walls.visible || !isIn(h.object, built.walls)));
      const hit = hits.map((h) => pickable(h.object)).find(Boolean);
      if (hit) uiActions.selectOne(hit.kind, hit.id, e.shiftKey);
      else uiActions.clearSelection();
    };
    svg.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    // Walk mode: each key press is a step (no animation loop needed).
    const MOVE = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q', 'e']);
    const onKey = (e: KeyboardEvent) => {
      if (useView3d.getState().mode !== 'walk') return;
      const k = e.key.toLowerCase();
      if (!MOVE.has(k) || e.metaKey || e.ctrlKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      e.stopPropagation();
      e.preventDefault();
      walkStep(
        camera,
        new Set([k, ...(e.shiftKey ? ['shift'] : [])]),
        0.25,
        useView3d.getState().eyeHeight,
        floor,
      );
      render();
    };
    window.addEventListener('keydown', onKey, true);

    const ro = new ResizeObserver(() => {
      layout();
      render();
    });
    ro.observe(el);

    return () => {
      unsub();
      unsubSel();
      ro.disconnect();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      svg.removeEventListener('pointerdown', onDown);
      controls.dispose();
      built.dispose();
      svg.remove();
    };
  }, [model]);

  return (
    <div className="absolute inset-0" ref={host} data-testid="three-software">
      <div className="pointer-events-none absolute bottom-3 right-3 z-10 rounded bg-panel/85 px-2 py-1 text-2xs text-ink-muted">
        Software preview: WebGL is unavailable in this browser
      </div>
    </div>
  );
}

function isIn(o: THREE.Object3D, parent: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === parent) return true;
  return false;
}
