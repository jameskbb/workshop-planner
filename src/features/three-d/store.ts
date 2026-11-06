/** 3D view UI state (per session; saved cameras live in the project as SavedView). */
import { create } from 'zustand';
import type { CameraPreset } from './model';

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
  orthographic?: boolean;
}

export interface View3dState {
  mode: 'orbit' | 'walk';
  orthographic: boolean;
  showCeiling: boolean;
  showWalls: boolean;
  /** Pending camera move (preset or saved view); consumed by the camera rig. */
  request: { seq: number; preset?: CameraPreset; pose?: CameraPose } | null;
  /** Eye height in walk mode (m). */
  eyeHeight: number;
}

export const useView3d = create<View3dState>(() => ({
  mode: 'orbit',
  orthographic: false,
  showCeiling: false,
  showWalls: true,
  request: { seq: 0, preset: 'perspective' },
  eyeHeight: 1.6,
}));

let seq = 1;
export const view3d = {
  preset(preset: CameraPreset) {
    useView3d.setState({ request: { seq: seq++, preset }, mode: 'orbit' });
  },
  recall(pose: CameraPose) {
    useView3d.setState({ request: { seq: seq++, pose }, orthographic: pose.orthographic ?? false, mode: 'orbit' });
  },
  set(patch: Partial<View3dState>) {
    useView3d.setState(patch);
  },
};

/** Live camera readout, written by the rig each frame it changes (for "Save view"). */
export const cameraRef: { current: CameraPose | null } = { current: null };
