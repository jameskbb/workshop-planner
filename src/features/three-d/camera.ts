/** Camera placement shared by the WebGL and software renderers. */
import * as THREE from 'three';
import { presetCamera, type SceneModel } from './model';
import type { View3dState } from './store';

export const FOV = 50;

/** Apply a preset / saved-view request to a camera and its orbit target. */
export function applyCameraRequest(camera: THREE.Camera, target: THREE.Vector3, req: NonNullable<View3dState['request']>, model: SceneModel, size: { width: number; height: number }) {
  const pose = req.pose ?? presetCamera(model.bounds, req.preset ?? 'perspective', FOV);
  camera.position.set(...pose.position);
  target.set(...pose.target);
  camera.lookAt(target);
  if (camera instanceof THREE.OrthographicCamera) fitOrtho(camera, model, size);
}

/** Zoom an orthographic camera (frustum in pixels, as R3F sets it up) so the room fits. */
export function fitOrtho(camera: THREE.OrthographicCamera, model: SceneModel, size: { width: number; height: number }) {
  const w = model.bounds.maxX - model.bounds.minX;
  const d = model.bounds.maxZ - model.bounds.minZ;
  const extent = Math.max(w, d, model.bounds.height) * 1.25;
  camera.zoom = Math.max(1, Math.min(size.width / extent, size.height / extent));
  camera.updateProjectionMatrix();
}
