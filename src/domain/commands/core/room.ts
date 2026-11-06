import { z } from 'zod';
import { projectOntoWall, roomWalls } from '@/geometry';
import { RoomSchema, WallConstraintsSchema, WallSchema, type Project, type Room } from '../../schema';
import { formatLength, quantize } from '../../units';
import { roomGeometry, resolvePlacement } from '../../resolve';
import {
  constraintProblem,
  moveVerticesEdit,
  roomProblem,
  setCornerAngleEdit,
  setWallConstraintsEdit,
  setWallDirectionEdit,
  setWallLengthEdit,
  type LengthFormatter,
  type RoomEditResult,
} from '../../roomEdit';
import { CommandError, defineCommand } from '../registry';
import { applyPatch, findOrThrow, patchOf } from '../helpers';

export { roomProblem };

/** Length formatter for refusal messages, in the project's units. */
export function projectLengthFormatter(project: Project): LengthFormatter {
  const s = project.settings;
  return (mm) => formatLength(mm, { system: s.unitSystem, precision: s.imperialPrecision, metricUnit: s.metricUnit });
}

const plainRoom = (room: Room): Room => JSON.parse(JSON.stringify(room)) as Room;

/** Apply a pure room edit result to the draft, or refuse with its explanation. */
function applyEdit(project: Project, r: RoomEditResult): void {
  if (!r.ok) throw new CommandError(r.error);
  project.room.vertices = r.vertices;
  if (r.walls) project.room.walls = r.walls;
}

function assertValidRoom(room: Room): void {
  const problem = roomProblem(room.vertices);
  if (problem) throw new CommandError(problem);
}

/**
 * Re-anchor wall-hosted items after a topology change: each item keeps its world position, projected
 * onto the nearest surviving wall.
 */
function reanchorWallPlacements(project: Project, before: Room): void {
  const after = project.room;
  const afterIds = new Set(after.walls.map((w) => w.id));
  const geomAfter = roomWalls(after.vertices, { names: after.walls.map((w) => w.name) });
  const fix = (placement: { type: 'wall'; wallId: string; offset: number }, width: number, depth: number) => {
    if (afterIds.has(placement.wallId)) return;
    const { pose } = resolvePlacement(before, placement, width, depth);
    let best: { id: string; offset: number; d: number } | null = null;
    geomAfter.forEach((w, i) => {
      const pr = projectOntoWall(pose, w);
      const d = Math.abs(pr.inset - depth / 2) + (pr.within ? 0 : 1e6);
      if (!best || d < best.d) best = { id: after.walls[i]!.id, offset: quantize(Math.max(0, Math.min(w.length, pr.offset))), d };
    });
    if (best) {
      placement.wallId = (best as { id: string }).id;
      placement.offset = (best as { offset: number }).offset;
    }
  };
  for (const f of project.architecture) if (f.placement.type === 'wall') fix(f.placement, f.width, f.depth);
  for (const e of project.electrical) if (e.placement.type === 'wall') fix(e.placement, e.width, 20);
}

export const setRoom = defineCommand({
  type: 'room.set',
  label: (p) => p.label ?? 'Change room outline',
  payload: z.object({ room: RoomSchema, label: z.string().optional() }),
  execute(project, p) {
    const before = JSON.parse(JSON.stringify(project.room)) as Room;
    const room = { ...p.room, vertices: p.room.vertices.map((v) => ({ ...v, x: quantize(v.x), y: quantize(v.y) })) };
    assertValidRoom(room);
    project.room = room;
    reanchorWallPlacements(project, before);
  },
});

/** Move one corner. Wall constraints are enforced (other corners follow as the constraints require). */
export const moveVertex = defineCommand({
  type: 'room.moveVertex',
  label: 'Move corner',
  payload: z.object({ vertexId: z.string(), x: z.number().finite(), y: z.number().finite() }),
  execute(project, p) {
    findOrThrow(project.room.vertices, p.vertexId, 'corner');
    applyEdit(project, moveVerticesEdit(plainRoom(project.room), [{ vertexId: p.vertexId, x: p.x, y: p.y }], projectLengthFormatter(project)));
  },
});

/** Move several vertices at once (e.g. dragging a whole wall). Constraints are enforced. */
export const moveVertices = defineCommand({
  type: 'room.moveVertices',
  label: 'Move walls',
  payload: z.object({ moves: z.array(z.object({ vertexId: z.string(), x: z.number().finite(), y: z.number().finite() })).min(1) }),
  execute(project, p) {
    for (const m of p.moves) findOrThrow(project.room.vertices, m.vertexId, 'corner');
    applyEdit(project, moveVerticesEdit(plainRoom(project.room), p.moves, projectLengthFormatter(project)));
  },
});

/** Exact wall length. The start corner stays; the walls after it follow (see roomEdit.setWallLengthEdit). */
export const setWallLength = defineCommand({
  type: 'room.setWallLength',
  label: 'Set wall length',
  payload: z.object({ wallId: z.string(), length: z.number().positive() }),
  execute(project, p) {
    applyEdit(project, setWallLengthEdit(plainRoom(project.room), p.wallId, quantize(p.length), projectLengthFormatter(project)));
  },
});

/** Exact wall direction (degrees; 0 = east, 90 = south), rotating about the wall's start corner. */
export const setWallDirection = defineCommand({
  type: 'room.setWallDirection',
  label: 'Set wall angle',
  payload: z.object({ wallId: z.string(), direction: z.number().finite() }),
  execute(project, p) {
    applyEdit(project, setWallDirectionEdit(plainRoom(project.room), p.wallId, p.direction, projectLengthFormatter(project)));
  },
});

/** Exact interior corner angle (degrees). */
export const setCornerAngle = defineCommand({
  type: 'room.setCornerAngle',
  label: 'Set corner angle',
  payload: z.object({ vertexId: z.string(), angle: z.number().gt(0).lt(360) }),
  execute(project, p) {
    applyEdit(project, setCornerAngleEdit(plainRoom(project.room), p.vertexId, p.angle, projectLengthFormatter(project)));
  },
});

/** Set a wall's CAD constraints; the outline is reshaped to satisfy them (or the change is refused). */
export const setWallConstraints = defineCommand({
  type: 'room.setWallConstraints',
  label: 'Change wall constraints',
  payload: z.object({ wallId: z.string(), constraints: WallConstraintsSchema }),
  execute(project, p) {
    applyEdit(project, setWallConstraintsEdit(plainRoom(project.room), p.wallId, p.constraints, projectLengthFormatter(project)));
  },
});

/** Split a wall by inserting a corner at `offset` along it. The new wall takes the second half. */
export const insertVertex = defineCommand({
  type: 'room.insertVertex',
  label: 'Add corner',
  payload: z.object({ wallId: z.string(), offset: z.number().positive(), vertexId: z.string().optional(), newWallId: z.string().optional() }),
  execute(project, p, ctx) {
    const room = project.room;
    const i = room.walls.findIndex((w) => w.id === p.wallId);
    if (i < 0) throw new CommandError('That wall no longer exists.');
    const g = roomGeometry(JSON.parse(JSON.stringify(room)) as Room).walls[i];
    if (!g || p.offset >= g.length) throw new CommandError('The new corner must be inside the wall.');
    const pt = { x: quantize(g.a.x + g.dir.x * p.offset), y: quantize(g.a.y + g.dir.y * p.offset) };
    const wall = room.walls[i]!;
    const vId = p.vertexId ?? ctx.newId();
    const wId = p.newWallId ?? ctx.newId();
    // Both halves keep direction constraints (they are collinear); a length lock no longer applies.
    const { lockLength: _dropped, ...direction } = JSON.parse(JSON.stringify(wall.constraints ?? {})) as Room['walls'][number]['constraints'];
    void _dropped;
    wall.constraints = { ...direction };
    room.vertices.splice(i + 1, 0, { id: vId, ...pt });
    room.walls.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(wall)), id: wId, name: undefined, constraints: { ...direction } });
    // Items on the split wall beyond the split point move to the new wall.
    for (const f of [...project.architecture, ...project.electrical]) {
      if (f.placement.type === 'wall' && f.placement.wallId === wall.id && f.placement.offset > p.offset) {
        f.placement.wallId = wId;
        f.placement.offset = quantize(f.placement.offset - p.offset);
      }
    }
    assertValidRoom(room);
  },
});

export const deleteVertex = defineCommand({
  type: 'room.deleteVertex',
  label: 'Remove corner',
  payload: z.object({ vertexId: z.string() }),
  execute(project, p) {
    const room = project.room;
    if (room.vertices.length <= 3) throw new CommandError('A room needs at least 3 corners.');
    const i = room.vertices.findIndex((v) => v.id === p.vertexId);
    if (i < 0) throw new CommandError('That corner no longer exists.');
    const before = JSON.parse(JSON.stringify(room)) as Room;
    // Wall i (starting at this vertex) is removed; wall i-1 now runs to vertex i+1.
    const removedWall = room.walls[i]!.id;
    room.vertices.splice(i, 1);
    room.walls.splice(i, 1);
    assertValidRoom(room);
    // Constraints that referred to the removed wall no longer have anything to refer to.
    for (const w of room.walls) {
      if (w.constraints?.parallelTo === removedWall) delete w.constraints.parallelTo;
      if (w.constraints?.perpendicularTo === removedWall) delete w.constraints.perpendicularTo;
    }
    const problem = constraintProblem(plainRoom(room), before, projectLengthFormatter(project));
    if (problem) throw new CommandError(`Removing this corner would break a wall constraint. ${problem}`);
    reanchorWallPlacements(project, before);
  },
});

const WallPatch = patchOf(WallSchema);

export const updateWall = defineCommand({
  type: 'room.updateWall',
  label: 'Edit wall',
  payload: z.object({ wallId: z.string(), patch: WallPatch.optional(), unset: z.array(z.string()).default([]) }),
  execute(project, p) {
    const w = findOrThrow(project.room.walls, p.wallId, 'wall');
    applyPatch(w, p.patch ?? {});
    for (const k of p.unset) delete (w as Record<string, unknown>)[k];
    const check = WallSchema.safeParse(JSON.parse(JSON.stringify(w)));
    if (!check.success) throw new CommandError(check.error.issues[0]?.message ?? 'Invalid wall.');
  },
});

export const setCeilingHeight = defineCommand({
  type: 'room.setCeilingHeight',
  label: 'Change ceiling height',
  payload: z.object({ height: z.number().positive() }),
  execute(project, p) {
    project.room.ceilingHeight = quantize(p.height);
  },
});

declare module '../registry' {
  interface CommandPayloads {
    'room.set': z.input<typeof setRoom.payload>;
    'room.moveVertex': z.input<typeof moveVertex.payload>;
    'room.moveVertices': z.input<typeof moveVertices.payload>;
    'room.insertVertex': z.input<typeof insertVertex.payload>;
    'room.deleteVertex': z.input<typeof deleteVertex.payload>;
    'room.updateWall': z.input<typeof updateWall.payload>;
    'room.setCeilingHeight': z.input<typeof setCeilingHeight.payload>;
    'room.setWallLength': z.input<typeof setWallLength.payload>;
    'room.setWallDirection': z.input<typeof setWallDirection.payload>;
    'room.setCornerAngle': z.input<typeof setCornerAngle.payload>;
    'room.setWallConstraints': z.input<typeof setWallConstraints.payload>;
  }
}
