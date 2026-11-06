/**
 * The 3D view (lazy-loaded chunk): a scene generated from the 2D model with orbit/pan/zoom, walk
 * mode (WASD + mouse look at eye height), hide ceiling/walls, perspective/orthographic, camera
 * presets and saved cameras. Rendered with WebGL (React Three Fiber); when the browser has no
 * WebGL, a software (SVG) renderer shows the same scene with the same controls.
 */
import {
  Html,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
  PointerLockControls,
} from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Box, Eye, Footprints, Grid3x3, Home, Rotate3d, Square } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import * as THREE from 'three';
import { Button, Tip } from '@/components/ui';
import { containsPoint } from '@/geometry';
import { useProjectStore } from '@/stores/projectStore';
import { uiActions, useUiStore } from '@/stores/uiStore';
import { applyCameraRequest, FOV } from './camera';
import { buildSceneModel, CAMERA_PRESETS, type SceneModel } from './model';
import { SavedViewsMenu } from './SavedViews';
import { buildThreeScene, pickable } from './sceneBuilder';
import { cameraRef, useView3d, view3d } from './store';

const SoftwareView = lazy(() => import('./SoftwareView'));

export function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Dev/test hook: scene statistics, renderer and camera, exposed on window in dev builds. */
export function exposeDebug(model: SceneModel, renderer: 'webgl' | 'svg') {
  if (!import.meta.env.DEV) return;
  const w = window as unknown as { __wp3d?: Record<string, unknown> };
  w.__wp3d = {
    ...(w.__wp3d ?? {}),
    renderer,
    stats: {
      walls: model.walls.length,
      objects: model.objects.length,
      vehicles: model.vehicles.length,
      features: model.features.length,
      lights: model.lights.length,
      openings: model.openings.length,
    },
    camera: () => cameraRef.current,
    state: () => useView3d.getState(),
  };
}

// ───────────────────────────── shared walk helpers ─────────────────────────────

/** Keys held for walking (captured before the editor's single-key tool shortcuts). */
export function useWalkKeys(active: boolean, onKey?: (key: string) => void) {
  const keys = useRef(new Set<string>());
  useEffect(() => {
    if (!active) return;
    const held = keys.current;
    const MOVE = new Set([
      'w',
      'a',
      's',
      'd',
      'arrowup',
      'arrowdown',
      'arrowleft',
      'arrowright',
      'shift',
      'q',
      'e',
    ]);
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!MOVE.has(k) || e.metaKey || e.ctrlKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      held.add(k);
      onKey?.(k);
      e.stopPropagation();
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => held.delete(e.key.toLowerCase());
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      held.clear();
    };
  }, [active, onKey]);
  return keys;
}

/** Move a camera one walking step (dt seconds) inside the room; returns true if it moved. */
export function walkStep(
  camera: THREE.Camera,
  keys: Set<string>,
  dt: number,
  eye: number,
  floor: Array<{ x: number; y: number }>,
): boolean {
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
  const r =
    (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  const turn = (keys.has('q') ? 1 : 0) - (keys.has('e') ? 1 : 0);
  let moved = false;
  if (turn) {
    camera.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), turn * 1.5 * dt);
    moved = true;
  }
  const dx = fwd.x * f + right.x * r;
  const dz = fwd.z * f + right.z * r;
  const len = Math.hypot(dx, dz);
  if (len > 0) {
    const speed = (keys.has('shift') ? 3 : 1.4) * dt;
    const nx = camera.position.x + (dx / len) * speed;
    const nz = camera.position.z + (dz / len) * speed;
    const inside = (x: number, z: number) => floor.length < 3 || containsPoint(floor, { x, y: z });
    if (inside(nx, nz)) camera.position.set(nx, eye, nz);
    else if (inside(nx, camera.position.z)) camera.position.x = nx;
    else if (inside(camera.position.x, nz)) camera.position.z = nz;
    moved = true;
  }
  camera.position.y = eye;
  const d = new THREE.Vector3();
  camera.getWorldDirection(d);
  cameraRef.current = {
    position: [camera.position.x, eye, camera.position.z],
    target: [camera.position.x + d.x, eye + d.y, camera.position.z + d.z],
    fov: FOV,
    orthographic: false,
  };
  return moved;
}

/** Start pose for walk mode: inside the room at eye height, looking north. */
export function startWalk(camera: THREE.Camera, model: SceneModel, eye: number) {
  camera.position.set(model.center[0], eye, model.center[2] + (model.bounds.maxZ - model.bounds.minZ) * 0.25);
  camera.lookAt(model.center[0], eye, model.bounds.minZ);
}

// ───────────────────────────── WebGL rigs ─────────────────────────────

function CameraRig({ model }: { model: SceneModel }) {
  const controls = useRef<ComponentRef<typeof OrbitControls> | null>(null);
  const { camera, size } = useThree();
  const request = useView3d((s) => s.request);
  const ortho = useView3d((s) => s.orthographic);

  useEffect(() => {
    if (!request || !controls.current) return;
    applyCameraRequest(camera, controls.current.target, request, model, size);
    controls.current.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, ortho, camera]);

  useFrame(() => {
    const c = controls.current;
    if (!c) return;
    const p = camera.position;
    const t = c.target;
    cameraRef.current = { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z], fov: FOV, orthographic: ortho };
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      maxPolarAngle={Math.PI * 0.499}
      screenSpacePanning
    />
  );
}

function WalkRig({ model }: { model: SceneModel }) {
  const { camera } = useThree();
  const eye = useView3d((s) => s.eyeHeight);
  const keys = useWalkKeys(true);
  const floor = useMemo(() => model.floor.map(([x, z]) => ({ x, y: z })), [model.floor]);
  useEffect(() => {
    startWalk(camera, model, eye);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFrame((_, dt) => {
    walkStep(camera, keys.current, Math.min(dt, 0.1), eye, floor);
  });
  return <PointerLockControls selector="[data-testid='three-walk-start']" />;
}

// ───────────────────────────── WebGL scene ─────────────────────────────

function SelectionBoxes({ model }: { model: SceneModel }) {
  const selection = useUiStore((s) => s.selection);
  return (
    <>
      {selection.map((ref) => {
        const o = ref.kind === 'object' ? model.objects.find((x) => x.id === ref.id) : undefined;
        const v = ref.kind === 'vehicle' ? model.vehicles.find((x) => x.id === ref.id) : undefined;
        const it = o
          ? { p: o.position, yaw: o.yaw, s: [o.width, o.height, o.depth] as const }
          : v
            ? { p: v.position, yaw: v.yaw, s: [v.width, v.height, v.length] as const }
            : null;
        if (!it) return null;
        return (
          <mesh
            key={`${ref.kind}:${ref.id}`}
            position={[it.p[0], it.p[1] + it.s[1] / 2, it.p[2]]}
            rotation={[0, it.yaw, 0]}
          >
            <boxGeometry args={[it.s[0] + 0.03, it.s[1] + 0.03, it.s[2] + 0.03]} />
            <meshBasicMaterial color="#2f7df6" wireframe />
          </mesh>
        );
      })}
    </>
  );
}

function Scene({ model }: { model: SceneModel }) {
  const { showCeiling, showWalls, mode, orthographic } = useView3d();
  const walking = mode === 'walk';
  const built = useMemo(() => buildThreeScene(model), [model]);
  const [hover, setHover] = useState<{ name: string; point: THREE.Vector3 } | null>(null);
  useEffect(() => () => built.dispose(), [built]);
  useEffect(() => {
    built.walls.visible = showWalls;
    if (built.ceiling) built.ceiling.visible = showCeiling || walking;
  }, [built, showWalls, showCeiling, walking]);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    const hit = pickable(e.object);
    if (!hit) return;
    e.stopPropagation();
    uiActions.selectOne(hit.kind, hit.id, e.shiftKey);
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const hit = pickable(e.object);
    setHover(hit ? { name: hit.name, point: e.point.clone() } : null);
  };

  return (
    <>
      {orthographic && !walking ? (
        <OrthographicCamera makeDefault position={[0, 30, 0]} near={-100} far={500} />
      ) : (
        <PerspectiveCamera makeDefault fov={FOV} near={0.05} far={500} position={[10, 10, 10]} />
      )}
      <color attach="background" args={['#20252b']} />
      <hemisphereLight args={['#f4f1ea', '#5b5750', 0.9]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[model.center[0] + 6, model.bounds.height + 8, model.center[2] + 4]}
        intensity={1.1}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />
      <primitive
        object={built.root}
        onClick={onClick}
        onPointerMove={onMove}
        onPointerOut={() => setHover(null)}
      />
      <SelectionBoxes model={model} />
      {hover && (
        <Html position={hover.point} center style={{ pointerEvents: 'none' }}>
          <div className="-translate-y-5 whitespace-nowrap rounded bg-panel/90 px-1.5 py-0.5 text-2xs text-ink shadow">
            {hover.name}
          </div>
        </Html>
      )}
      {walking ? <WalkRig model={model} /> : <CameraRig model={model} />}
    </>
  );
}

// ───────────────────────────── toolbar ─────────────────────────────

function ToolbarToggle({
  on,
  onClick,
  icon: Icon,
  label,
  testId,
}: {
  on: boolean;
  onClick(): void;
  icon: typeof Eye;
  label: string;
  testId: string;
}) {
  return (
    <Button
      size="sm"
      variant={on ? 'default' : 'ghost'}
      aria-pressed={on}
      onClick={onClick}
      data-testid={testId}
    >
      <Icon /> {label}
    </Button>
  );
}

export function ViewToolbar() {
  const { mode, orthographic, showCeiling, showWalls } = useView3d();
  return (
    <div
      className="absolute left-1/2 top-3 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-lg border border-line-strong bg-panel/95 p-1 shadow-lg"
      data-testid="three-toolbar"
    >
      <div className="flex rounded-md border border-line p-0.5" role="group" aria-label="Navigation">
        <ToolbarToggle
          on={mode === 'orbit'}
          onClick={() => view3d.set({ mode: 'orbit' })}
          icon={Rotate3d}
          label="Orbit"
          testId="three-mode-orbit"
        />
        <ToolbarToggle
          on={mode === 'walk'}
          onClick={() => view3d.set({ mode: 'walk', orthographic: false })}
          icon={Footprints}
          label="Walk"
          testId="three-mode-walk"
        />
      </div>
      <ToolbarToggle
        on={orthographic}
        onClick={() =>
          view3d.set({
            orthographic: !orthographic,
            mode: 'orbit',
            request: { seq: Date.now(), pose: cameraRef.current ?? undefined },
          })
        }
        icon={orthographic ? Square : Box}
        label={orthographic ? 'Orthographic' : 'Perspective'}
        testId="three-projection"
      />
      <ToolbarToggle on={showCeiling} onClick={() => view3d.set({ showCeiling: !showCeiling })} icon={Home} label="Ceiling" testId="three-ceiling" />
      <ToolbarToggle on={showWalls} onClick={() => view3d.set({ showWalls: !showWalls })} icon={Grid3x3} label="Walls" testId="three-walls" />
      <span className="mx-1 h-5 w-px bg-line" />
      <div className="flex" role="group" aria-label="Camera presets">
        {CAMERA_PRESETS.map((p) => (
          <Tip key={p.id} content={p.hint}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => view3d.preset(p.id)}
              data-testid={`three-preset-${p.id}`}
            >
              {p.label}
            </Button>
          </Tip>
        ))}
      </div>
      <span className="mx-1 h-5 w-px bg-line" />
      <SavedViewsMenu />
    </div>
  );
}

function WalkHint({ pointerLock }: { pointerLock: boolean }) {
  const mode = useView3d((s) => s.mode);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const onChange = () => setLocked(!!document.pointerLockElement);
    document.addEventListener('pointerlockchange', onChange);
    return () => document.removeEventListener('pointerlockchange', onChange);
  }, []);
  if (mode !== 'walk') return null;
  return (
    <div
      className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-md border border-line-strong bg-panel/95 px-3 py-2 text-xs text-ink shadow-lg"
      data-testid="three-walk-hint"
    >
      {!pointerLock ? (
        'W A S D / arrows to walk · Q / E to turn · Shift to hurry · drag to look around'
      ) : locked ? (
        'W A S D to walk · mouse to look · Shift to hurry · Esc to release the mouse'
      ) : (
        <span className="flex items-center gap-2">
          W A S D / arrows to walk, Q / E to turn.
          <Button size="sm" variant="outline" data-testid="three-walk-start">
            <Eye /> Click to look around with the mouse
          </Button>
        </span>
      )}
    </div>
  );
}

// ───────────────────────────── view ─────────────────────────────

export default function ThreeView() {
  const project = useProjectStore((s) => s.project);
  const model = useMemo(() => (project ? buildSceneModel(project) : null), [project]);
  const [gl] = useState(hasWebGL);
  useEffect(() => {
    if (model) exposeDebug(model, gl ? 'webgl' : 'svg');
  }, [model, gl]);
  if (!model) return null;
  return (
    <div
      className="relative size-full overflow-hidden bg-[#20252b]"
      data-testid="three-view"
      data-renderer={gl ? 'webgl' : 'svg'}
      data-objects={model.objects.length}
      data-walls={model.walls.length}
    >
      {gl ? (
        <Canvas
          shadows
          dpr={[1, 2]}
          gl={{ antialias: true, preserveDrawingBuffer: true }}
          onCreated={({ gl: r }) => void (r.toneMapping = THREE.ACESFilmicToneMapping)}
          data-testid="three-canvas"
        >
          <Scene model={model} />
        </Canvas>
      ) : (
        <Suspense fallback={null}>
          <SoftwareView model={model} />
        </Suspense>
      )}
      <ViewToolbar />
      <WalkHint pointerLock={gl} />
    </div>
  );
}
