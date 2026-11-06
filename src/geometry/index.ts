/**
 * Geometry engine public API. Pure functions only: no React, Konva or store imports
 * (enforced by ESLint). All lengths are millimeters; see docs/ARCHITECTURE.md for the
 * coordinate system (+x east, +y south, rotations clockwise-on-screen in degrees).
 */
export * from './vec';
export * from './segment';
export * from './polygon';
export * from './obb';
export * from './clip';
export * from './sat';
export * from './walls';
export * from './snapping';
export * from './align';
export * from './clearance';
export * from './wallspace';
export * from './grid';
export * from './walkability';
export * from './dubins';
export * from './vehicle';
export * from './utilization';
export * from './workflow';
export * from './constraints';
export * from './raycast';
