import { describe, expect, it } from 'vitest';
import { createDemoProject } from '@/features/projects/demo';
import { resolveObject } from '@/domain/resolve';
import { archetypeOf, buildSceneModel, presetCamera } from './model';

const project = createDemoProject();

describe('3D scene model', () => {
  const m = buildSceneModel(project);

  it('builds walls with openings cut out (lintels above doors, sills under windows)', () => {
    const wallCount = project.room.walls.length;
    // 3 openings (garage door, entry door, window) add pieces: > one piece per wall.
    expect(m.walls.length).toBeGreaterThan(wallCount);
    const garage = project.architecture.find((f) => f.kind === 'garage-door')!;
    const southIdx = project.room.walls.findIndex((w) => garage.placement.type === 'wall' && w.id === garage.placement.wallId);
    const south = m.walls.filter((w) => w.wallIndex === southIdx);
    // left pier, lintel, right pier
    expect(south.length).toBe(3);
    const lintel = south.find((w) => w.center[1] > 2.2)!;
    expect(lintel.size[1]).toBeCloseTo(m.ceilingHeight - (garage.garageDoor!.openingHeight / 1000), 3);
    expect(m.openings.map((o) => o.kind).sort()).toEqual(['door', 'garage-door', 'window']);
    expect(m.openings.find((o) => o.kind === 'window')!.fill!.material).toBe('glass');
    // Window: a sill piece below it.
    const win = project.architecture.find((f) => f.kind === 'window')!;
    const eastIdx = project.room.walls.findIndex((w) => win.placement.type === 'wall' && w.id === win.placement.wallId);
    expect(m.walls.filter((w) => w.wallIndex === eastIdx).some((w) => w.center[1] < win.elevation / 1000)).toBe(true);
  });

  it('places objects, wall-mounted items at their elevation, vehicles, features and lights', () => {
    expect(m.objects).toHaveLength(10);
    const cab = m.objects.find((o) => /Wall cabinet \(north\)/.test(o.name))!;
    expect(cab.wallMounted).toBe(true);
    expect(cab.position[1]).toBeGreaterThan(1);
    const saw = m.objects.find((o) => /Table saw/.test(o.name))!;
    expect(saw.archetype).toBe('tool');
    expect(saw.position[0]).toBeCloseTo((170 * 25.4) / 1000, 2);
    expect(saw.position[2]).toBeCloseTo((190 * 25.4) / 1000, 2);
    expect(saw.yaw).toBeCloseTo(-Math.PI / 2);
    expect(m.objects.find((o) => /Workbench/.test(o.name))!.archetype).toBe('bench');
    expect(m.objects.find((o) => /shelving/i.test(o.name))!.archetype).toBe('shelving');
    expect(m.objects.find((o) => /vacuum/i.test(o.name))!.archetype).toBe('cylinder');
    expect(m.vehicles).toHaveLength(1);
    expect(m.features.find((f) => /pole/i.test(f.name))!.shape).toBe('cylinder');
    expect(m.features.find((f) => /pole/i.test(f.name))!.height).toBeCloseTo(m.ceilingHeight, 3);
    expect(m.lights).toHaveLength(4);
    expect(m.floor.length).toBe(project.room.vertices.length);
  });

  it('follows the layout (workshop mode has no car)', () => {
    expect(buildSceneModel(project, project.scenarios[1]!.id).vehicles).toHaveLength(0);
  });

  it('archetypes come from the library data', () => {
    const s = project.scenarios[0]!;
    const cart = s.objects.find((o) => /cart/i.test(o.name))!;
    expect(archetypeOf(resolveObject(project, cart))).toBe('cabinet');
  });

  it('camera presets look at the room from the named side', () => {
    const b = m.bounds;
    const top = presetCamera(b, 'top');
    expect(top.position[1]).toBeGreaterThan(b.height * 2);
    expect(presetCamera(b, 'front').position[2]).toBeGreaterThan(b.maxZ);
    expect(presetCamera(b, 'rear').position[2]).toBeLessThan(b.minZ);
    expect(presetCamera(b, 'left').position[0]).toBeLessThan(b.minX);
    expect(presetCamera(b, 'right').position[0]).toBeGreaterThan(b.maxX);
  });
});
