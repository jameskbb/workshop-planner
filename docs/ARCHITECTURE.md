# Workshop Planner: Architecture

This is the guide for everyone building on the Phase 1 foundation. Read it before you add a feature.
`docs/BRIEF.md` is the product source of truth.

## 1. Module map

```
src/
  main.tsx                  entry: styles → shell registrations → feature registrations → <App/>
  app/
    App.tsx                 hash router: #/ (project list) and #/project/<id> (editor)
    services.ts             repository / project service / autosave singletons, navigation, custom library
    registry/               UI extension registries (see §6) + loadFeatures.ts (auto-imports features)
    shell/                  EditorShell, TopToolbar, LeftSidebar, RightInspector, StatusBar,
                            CommandPalette, keyboard.ts, coreRegistrations.tsx (undo/redo/palette/tools)
    canvas/                 PlanCanvas (Konva Stage, pointer routing, zoom/pan), viewport math, context menu
    home/                   project list, New Project, Rename, Backups dialogs
  components/
    ui/                     shadcn-style Radix primitives (Button, Input, Dialog, ConfirmDialog, menus, Tip,
                            Tabs, Slider, Switch, Select, Popover, ScrollArea, Kbd, Badge, EmptyState)
    shell.tsx               ToolbarButton, PanelHeader, Section, PropRow; use these in panels
    LengthInput.tsx         exact length / angle entry (any unit syntax, Enter/blur commit, Esc revert)
  domain/                   PURE: no React/Konva/stores
    units/                  canonical mm, parseLength / formatLength / parseAngle / formatArea
    schema/                 Zod schemas = the source of every domain type
    commands/               command registry + core commands (the ONLY way to mutate a project)
    factories.ts            createProject / createRoom / createScenario / placeObject / duplicateScenario
    resolve.ts              memoized domain→geometry helpers (roomGeometry, resolveObject, featureFootprint…)
    roomEdit.ts             pure room-outline edits + CAD constraints (moveVerticesEdit, setWallLengthEdit…)
    roomTemplates.ts        rectangle / L / T / two-car / three-car templates, outlineFromWalls
    measure.ts              anchored measurement resolution, entityShape / entityName, face clearance
    serialization.ts        portable file format, migrations, friendly import errors
    extensions.ts           typed per-feature data bags (defineExtension)
  geometry/                 PURE geometry engine (no domain imports either); see §5
  analysis/                 PURE: analyzeLayout, analyzer + metric registries, core analyzers/metrics
  persistence/              Repository interfaces, IndexedDB implementation, autosave, ProjectService
  stores/                   projectStore (project + command bus + history), uiStore (view state),
                            editorStore (live drag previews, guides, marquee, HUD, clipboard, dialogs)
  hooks/                    selector hooks (useProject, useSelectionContext, useFormatters, …)
  features/<name>/          one folder per feature; see §6 for the files each may contain. Phase 2:
    editor/                 selectTool, adapters (EntityAdapter per kind), ops (nudge/duplicate/clipboard/
                            align/group…), selection helpers, canvasLayers (guides, HUD), viewChrome (rulers,
                            compass, minimap, empty state), viewMenu (View/Overlays/Add/layout menus),
                            dialogs, prefs (view prefs + category colors), inspectorParts (shared fields)
    plan/                   the 2D view: layers (room, architecture, objects, vehicles, fixtures, selection)
    room/                   Wall tool, room panel, wall/corner inspectors, template & wall-length dialogs
    architecture/           Place tool (click-to-place with wall snapping), Fixed features panel, feature inspector
    electrical/ lighting/ vehicles/   inspectors (+ Vehicles panel)
    measurements/ zones/    Measure + Dimension tools, Zone tool, panels, inspectors
    onboarding/             guided tour, help menu, shortcut reference
    projects/               project UI + wizardBuild.ts (New Project wizard → Project)
  styles/                   index.css (Tailwind tokens), tokens.ts (canvas colors)
  utils/                    ids, time, cn, download
e2e/                        Playwright tests
```

ESLint enforces purity: `src/geometry`, `src/domain`, `src/analysis` may not import React, Konva,
three, stores, components, features or app code (tests excepted).

## 2. Units convention

* **Every stored length is millimeters, quantized to 0.000001 mm** (`quantize`). Commands quantize
  positions; parsers quantize results. Never store inches. The lattice is fine enough to hold
  1/16", 1/32" and 1/64" exactly (1/16" = 1.5875 mm), so repeated fractional-inch edits do not
  drift; the older 0.01 mm lattice rounded 1/16" to 1.59 mm (schema v3 migration re-snaps files).
* Areas are mm², angles are degrees, weights are kg (`lb()` converts).
* Parse user input with `parseLength(text, { defaultUnit })` (or `useFormatters().parse`), display
  with `formatLength` (or `useFormatters().length`). Imperial display defaults to 1/16", inches only
  below 24" (`18"`), feet-inches above (`4' 6"`). All spellings of a value parse to the identical number.
* UI: use `<LengthInput value onCommit>` for every editable dimension (exact entry must always exist).

## 3. Coordinate system

* Plan coordinates: **+x = east, +y = south (screen-down), north is up**. Origin is arbitrary
  (templates put the NW interior corner at 0,0).
* Rotations: **degrees, clockwise on screen** (Konva's convention; mathematically positive in a y-down frame).
* Placed objects: `(x, y)` is the **footprint center**. Local frame: width along local x, depth along
  local y; **local +y is the FRONT** (operator side), −y the back, −x the LEFT and +x the RIGHT as seen
  by someone standing at the front facing the object. At rotation 0 an object's front faces south.
  `rotationFacingAwayFromWall(wall)` gives the rotation that puts an object's back against a wall.
* Vehicles: body center + rotation, **+y = front of the vehicle**. Facing +y the vehicle's LEFT is
  local +x, so for left-hand drive the driver side is +x (`sideSign`). Rotation 180 = nose north.
* Room: `room.vertices` trace the **interior face** of the walls (tape-measure dimensions); wall *i*
  runs from vertex *i* to *i+1*; thickness grows outward (`wallQuads`, `exteriorCorners`).
  Either winding is accepted everywhere.
* Walls are named by the compass direction they face from inside ("North wall", "East wall (south)",
  "North wall 2"); user names override (`roomGeometry(room).walls[i].name`).
* Wall-hosted features/outlets use `placement: { type:'wall', wallId, offset }` (offset = distance
  along the wall from its start vertex to the item's center) so they follow wall edits.

## 4. Data model (src/domain/schema: Zod is the source of types)

```
Project { schemaVersion: 3, id, name, settings, room, architecture[], electrical[], definitions[],
          scenarios[], activeScenarioId, layers, savedViews[], reorganization, inventoryNotes,
          notes, extensions, revision, createdAt, updatedAt }
Room    { vertices[], walls[] (1:1 with vertices), ceilingHeight }
Scenario { objects[] (PlacedObject), groups[], vehicles[], lights[], zones[], measurements[],
           relationships[], dust{runs,fittings}, acknowledgedWarnings{}, extensions }
```

* **Shared vs per-scenario**: room, architecture, electrical (installed infrastructure) and object
  definitions are project-wide. Everything a user *arranges* (objects, vehicles, **lights** (so light
  layouts can be compared), zones, measurements, relationships, dust runs, warning acks) is per scenario.
* **Identity across scenarios**: duplicating a scenario keeps entity ids. The same `PlacedObject.id`
  in two scenarios is the same physical item (compare view, move plan rely on this).
* **ObjectDefinition vs PlacedObject**: definitions (built-in or custom) are embedded in
  `project.definitions` when used, so files are self-contained. A placed object copies width/depth/height
  (user overrides per instance) and references the definition for clearances, states, electrical, dust port.
  `clearances` on the instance overrides the definition.
* **States** (`definition.states`, `placed.stateId`): may override footprint (with center offset),
  height and clearance zones. `resolveObject()` returns the state-resolved footprint/clearances.
* **Mobile items**: `mobility:'mobile'`, `(x,y,rotation)` = parked pose, `working` = working pose,
  `activePosition` selects which is in effect. Analysis checks clearance zones at the working pose.
* **Mounting**: `mount: floor | wall | ceiling`, `elevation` = bottom height. Collisions are 3D-aware
  (`verticalOverlap`).
* **ClearanceZone** `{ kind: operator|infeed|outfeed|side|operational|maintenance|access, shape }`
  where shape is `side` (band on front/back/left/right with depth/extend/offset), `around` (margin),
  `rect` or `polygon`, all in the object's local frame. Overlay group: maintenance vs operational.
* **Extensions**: features that need persistent data not in the core schema use
  `defineExtension('feature.key', zodSchema, default)` and write via the `extension.set` command.
  Do **not** edit the core schema for feature-local data (it is a merge hotspot for parallel phases).
* **Migrations**: bump `CURRENT_SCHEMA_VERSION` in schema/project.ts and add a `Migration` to
  `MIGRATIONS` in serialization.ts. (v1 = the pre-scenario draft format; kept to exercise the pipeline.)

## 5. Geometry engine (src/geometry)

Pure functions, mm, exhaustively tested (`*.test.ts` next to the code). Highlights:
`polygon.ts` (area, centroid, locatePoint, polygonContainsPolygon, findSelfIntersections, offsetPolygon),
`obb.ts` (poses, local↔world), `sat.ts` (satConvex, polygonCollision with depth), `clip.ts`
(intersect/union/difference via polygon-clipping), `walls.ts` (roomWalls, projectOntoWall,
distancesToWalls, wallQuads), `snapping.ts` (snapPoint, snapBox → guides, snapObjectToWall, snapAngle),
`align.ts`, `clearance.ts` (zoneWorldPolygon, zoneWallIntrusions, zoneObstruction), `wallspace.ts`
(freeWallSegments, findFitLocations, largestFreeRectAt), `grid.ts` + `walkability.ts` (occupancy grid,
exact EDT, reachability, dead ends, narrowestAlongRoute, walkingDistance), `vehicle.ts` + `dubins.ts`
(footprint, mirrors, door swings/opening check, envelopes, planVehicleEntry with staging poses and swept
polygon), `utilization.ts`, `workflow.ts`, `constraints.ts` (iterative wall-constraint solver:
`solveConstraints`, `solveWithTiers`, `checkConstraints`), `raycast.ts` (`rayCast`, `faceClearance`,
`closestPointsBetweenPolygons`). Import from `@/geometry`.

## 6. Extension registries: how to add a feature without editing shared files

Every folder `src/features/<name>/` may contain (all **auto-loaded** by glob, nothing central to edit):

| file | loaded by | purpose |
|---|---|---|
| `register.ts(x)` | `app/registry/loadFeatures.ts` | UI contributions (below) |
| `commands.ts` | `domain/commands/index.ts` | `defineCommand(...)`, must be pure |
| `analysis.ts` | `analysis/index.ts` | `registerAnalyzer(...)`, must be pure |
| `metrics.ts` | `analysis/index.ts` | `registerMetric(...)`, must be pure |

Every feature folder's `register.ts(x)` is picked up by the glob automatically; a feature that has
no UI simply has no register module (pure `commands.ts` / `analysis.ts` / `metrics.ts` are enough).
Registered UI must be real: never register a control that does nothing.

UI registries (`@/app/registry`), all `{ id, order, … }`, `register()` returns an unregister fn,
re-registering an id replaces it (feature modules load in alphabetical folder order, so to change
another feature's item, edit that feature's file rather than racing it with the same id):

* `sidebarSections` `{ title, icon, component, badge? }`: order: 10 project, 20 room, 30 architecture,
  40 library, 60 vehicles, 70 zones, 80 layers, 90 warnings.
* `inspectorSections` `{ title, appliesTo(ctx: SelectionContext), component({ctx}), collapsed? }`:
  order: 10 identity, 20 geometry, 30 appearance, 40–79 feature sections, 80 warnings, 90 notes.
  `appliesTo` with `ctx.refs.length === 0` = the "nothing selected" state.
* `toolbarItems` `{ group: 'left'|'tools'|'edit'|'view'|'right', component }`: use `<ToolbarButton>`.
* `canvasTools` `{ label, icon, shortcut, cursor, onPointerDown/Move/Up, onDoubleClick, onKeyDown,
  onActivate/Deactivate, overlay? }`: the toolbar tool picker and single-key shortcuts are automatic.
  Pointer events carry `world` (mm), `screen`, modifiers and the hit `target` entity.
* `canvasLayers` `{ slot: 'background'|'content'|'overlay'|'ui', component, overlay? }`: components
  render react-konva nodes in **world mm**; use `strokeScaleEnabled={false}` for constant-width strokes
  and `useScale()` to size text in px (`fontSize={11 / scale}`). Give pickable nodes
  `{...entityAttrs(kind, id)}`. Set `overlay: { key, label, defaultOn }` to make it a user-toggleable
  overlay (renders only when `uiStore.overlays[key]` is on).
* `paletteCommands` `{ title, section, keywords, shortcut, icon, when(ctx), run(ctx) }` (Ctrl/Cmd+K).
* `shortcuts` `{ keys: 'mod+d' | [...], description, run(e), when?, allowInInputs? }` (`mod` = ⌘/Ctrl).
* `contextMenuActions` `{ group, label, icon, shortcut, destructive, appliesTo(ctx), disabled?, run }`.
* `exportFormats` `{ label, description, extension, icon, export(ctx) → {blob, fileName}, customUi? }`:
  appears in the toolbar Export menu. order: 10 JSON, 20 PNG, 30 SVG, 40 PDF, 50 CSV, 60 DXF.
* `appViews` `{ label, icon, component }`: center-area modes. order: 10 2D, 20 3D, 30 elevation,
  40 compare. Switch with `uiActions.setView(id)`; the view switcher in the toolbar lists them
  (2D, 3D, Elevation, Compare); `ToolbarItem.views` hides 2D-only controls in the other views.
* `statusBarItems` `{ align: 'left'|'right', component }`, `homePanels` `{ component }`.
* Phase 2 additions:
  * `canvasOverlays` `{ component }`: HTML over the canvas (rulers 10, compass 20, minimap 30, HUD 50,
    empty state 90). World→screen: `toScreen(useUiStore(s => s.viewport), p)` (rotation-aware).
  * `canvasDropHandlers` `{ type: mime, drop(data, world) }`: HTML5 drag-and-drop onto the plan.
  * `entityAdapters` `{ kind, ids, exists, name, outline, layer?, locked?, hidden?, marquee?, translate?,
    rotate?, commit?, remove?, setFlag?, copy?, paste? }`; see §14.
  * `shellExtras` `{ component }`: mounted once in the editor (dialog hosts, tour, shortcut sheet).
  * `CanvasTool.optionsBar` (floating HTML bar at the top of the canvas) and `CanvasTool.htmlOverlay`
    (HTML over the canvas while active); `CanvasPointerEvent.handle` (see `handleAttrs`).
  * Toolbar/overlay: every `canvasLayers` item with `overlay` shows up in the toolbar **Overlays** menu.

Example (`src/features/vehicles/register.tsx`):

```tsx
import { Car } from 'lucide-react';
import { sidebarSections, canvasLayers } from '@/app/registry';
sidebarSections.register({ id: 'vehicles', title: 'Vehicles', icon: Car, order: 60, component: VehiclesPanel });
canvasLayers.register({ id: 'vehicle-clearance', slot: 'overlay', order: 30, component: VehicleClearanceLayer,
  overlay: { key: 'vehicle-clearance', label: 'Vehicle clearance', defaultOn: true } });
```

## 7. Command bus (src/domain/commands + src/stores/projectStore.ts)

**All** project mutations are typed, serializable `AppCommand`s `{ type, payload }`:

```ts
import { dispatch, transact, beginGesture, endGesture, undo, redo } from '@/stores/projectStore';
dispatch({ type: 'object.move', payload: { moves: [{ id, x, y }] } });                // one undo step
transact('Align left', [cmdA, cmdB]);                                                 // atomic, one step
transact('Nudge', (tx) => { tx.dispatch(a); /* read tx.project */ tx.dispatch(b); });
beginGesture(key); dispatch(cmd, { coalesceKey: key }) …; endGesture();               // drag = one step
dispatch(cmd, { coalesceKey: 'nudge:'+id });  // consecutive same-key commands within 1 s merge
```

A failing command throws `CommandError('human explanation')` → nothing is applied, `dispatch` returns
`{ ok:false, error }` and the status bar shows it. Commands with `history: false` (layer visibility,
active scenario) persist but are not undoable. Undo returns to the scenario where the change happened.

Adding a command (in `src/features/<f>/commands.ts`):

```ts
import { z } from 'zod';
import { defineCommand, CommandError } from '@/domain/commands/registry';
import { scenarioOf } from '@/domain/commands/helpers';
export const setMirrors = defineCommand({
  type: 'vehicle.setMirrors',
  label: (p) => (p.folded ? 'Fold mirrors' : 'Unfold mirrors'),
  payload: z.object({ id: z.string(), folded: z.boolean(), scenarioId: z.string().optional() }),
  execute(project, p) {                                  // project is an immer draft: mutate it
    const v = scenarioOf(project, p.scenarioId).vehicles.find((x) => x.id === p.id);
    if (!v) throw new CommandError('That vehicle no longer exists.');
    v.mirrorsFolded = p.folded;
  },
});
declare module '@/domain/commands/registry' {
  interface CommandPayloads { 'vehicle.setMirrors': z.input<typeof setMirrors.payload> }
}
```

Rules: generate ids **before** dispatching (put them in the payload) so commands are replayable;
use `patchOf(schema)` for update payloads (it strips `.default()`s so patches never reset fields);
never call memoized `resolve.ts` helpers expecting caching inside `execute` (drafts are not cached).
`validateCommand(unknown)` and `commandJsonSchemas()` exist for the NL parser / future LLM provider.

Core commands: `project.*`, `layer.*`, `scenario.{setActive,create,duplicate,rename,delete,reorder}`,
`definition.upsert`, `object.{add,update,move,delete,duplicate,reorder,group,ungroup,copyToScenario,
setWorkingPosition}`, `room.{set,moveVertex,moveVertices,insertVertex,deleteVertex,updateWall,
setCeilingHeight,setWallLength,setWallDirection,setCornerAngle,setWallConstraints}` (all corner moves
enforce wall constraints via `domain/roomEdit.ts` and refuse with a plain explanation), `{feature,electrical,vehicle,light,zone,measurement,relationship,duct,fitting}.
{add,update,delete}`, `warning.{acknowledge,unacknowledge}`, `extension.set`, `view.{save,delete}`,
`inventory.setNote`, `reorganization.{setScenarios,setStepStatus}`.

## 8. Analysis: analyzers and metrics (src/analysis)

`analyzeLayout(project, scenarioId?, options?) → Warning[]` and `computeMetrics(...)`. Both build one
memoized `AnalysisContext` (resolved objects with world footprints and clearance polygons, floor
architecture, vehicles, room geometry, unit formatters, `ctx.memo(key, fn)` for shared heavy work such
as a walkability grid).

```ts
registerAnalyzer({
  id: 'vehicle-doors', label: 'Vehicle doors', description: 'Doors that cannot fully open.',
  category: 'vehicle', order: 50,
  run(ctx) {
    return [{ id: `vehicle-doors:${v.id}:${door.id}`,     // STABLE id (entity ids, not positions)
      category: 'vehicle', severity: 'warning', title: '…',
      message: `The driver door opens only ${ctx.fmtLength(gap)} before hitting the ${name}.`,
      involved: [{ kind: 'vehicle', id }, { kind: 'object', id: other }],
      highlight: { polygons: [...], regions: [...] }, quantities: [{ name: 'gap', value: gap, kind: 'length' }] }];
  },
});
```

Warnings must explain the actual problem with formatted quantities and names, never "Invalid
placement". Severity: `critical` = physically impossible (overlap, outside room); `warning` = usability;
`info` = worth knowing. Acknowledgment status is merged in automatically from the scenario.
Core analyzers: `overlap`, `bounds`, `clearance`. Metrics `{ id, label, unit, better, compute(ctx) →
{ value, display, explanation } }`; core: `open-floor-area`, `collisions`, `clearance-conflicts`.
Analyzers run synchronously on each project change in the Warnings panel (memoized per project); if you
add something expensive, memoize it via `ctx.memo` or move it to a worker.

## 9. State

* `useProjectStore`: `{ project, past, future, changeCounter, lastError, gesture }`. Read with narrow
  selectors (`useProjectStore(s => …)`, `useObject(id)`, `useObjectIds()`); never mutate directly.
* `useUiStore` + `uiActions`: tool, selection (`EntityRef[]`), hovered, viewport `{x,y,scale px/mm}`,
  canvas size, overlays, cursor, snapSuppressed (Alt held), sidebar section, palette, status flash,
  fit requests. Never persisted, never in history.
* Selectors that build arrays must use `useShallow` (see hooks/useProject.ts).

## 10. Persistence

`Repository` = `ProjectRepository & LibraryRepository & SettingsRepository` (sync-ready seam).
`IdbRepository` stores projects, project summaries, snapshots (≤ 25 per project, pruned), custom
object definitions (global), settings. Loads go through the same validation + migration as imports.
`AutosaveController` debounces saves (300 ms for a discrete command, 800 ms while a drag gesture is
open), flushes on `visibilitychange`/`pagehide`/`beforeunload`, exposes `usePersistenceStore().status`
(`saved | saving | unsaved | error`), snapshots every 10 min / 150 changes. `ProjectService` does
create/duplicate/rename/delete (with a before-delete snapshot)/import/export/restore.
Take a snapshot before destructive operations: `services.repo.createSnapshot(project, 'before-destructive', label)`.

## 11. Adding dependencies while others work in parallel

1. `pnpm add <pkg>` (or `-D`), then **immediately** commit `package.json` + `pnpm-lock.yaml` alone:
   `git add package.json pnpm-lock.yaml && git commit -m "chore(deps): add <pkg>"`.
2. If the lockfile conflicts: keep both sides' `package.json` entries, then run `pnpm install` to
   regenerate the lockfile and commit it. Never hand-edit the lockfile.
3. React is pinned to 19.2.x (react-three-fiber peer range), TypeScript to 5.9.x (typescript-eslint).
   `three`, `@react-three/fiber`, `@react-three/drei` are already installed.

## 12. Testing conventions

* Vitest: `pnpm test`. Tests sit next to code as `*.test.ts(x)`. Default environment is node;
  add `// @vitest-environment jsdom` for DOM tests. `fake-indexeddb/auto` is preloaded.
* Geometry/domain/analysis: assert exact numbers (`toBeCloseTo`) including rotated cases and the
  L-shaped room fixtures. Use `setIdGenerator(sequentialIds())` / `setClock` for determinism.
* Store tests: `loadProject(fixture)` in `beforeEach`, then drive with `dispatch`/`undo`.
* Playwright: `pnpm test:e2e` (dev server on :4179). Chromium runs with
  `--disable-gpu --disable-software-rasterizer` because SwiftShader GL stalls requestAnimationFrame on
  the build machine; WebGL (3D) e2e tests may need a different launch config. Stable test ids:
  `home-screen`, `project-row`, `new-project`, `open-demo`, `import-input`, `editor-shell`,
  `plan-canvas`, `sidebar-<id>`, `panel-<id>`, `library-item`, `library-search`, `inspector`,
  `inspector-{x,y,rotation,width,depth,height}`, `undo`, `redo`, `save-status`, `layout-item`,
  `duplicate-layout`, `export-menu`, `export-<format>`, `warning-item`, `tool-<id>`, `go-home`.
  Phase 2: `new-project-wizard`, `wizard-{name,next,create,start-blank,ceiling}`, `wizard-units-<u>`,
  `wizard-shape-<m>`, `template-<id>`, `template-param-<key>`, `wizard-obstruction-<id>`,
  `wizard-vehicle-<id>`, `canvas-empty`, `empty-draw`, `wall-tool-hint`, `wall-typed-entry`,
  `wall-length-input`, `wall-bearing-input`, `wall-table-length-<i>`, `wall-length`, `wall-constraint-<k>`,
  `vertex-{x,y}`, `inspector-z`, `feature-width`, `measure-mode-<m>`, `measure-result`,
  `keep-measurement`, `arrange-menu`, `view-menu`, `overlays-menu`, `overlay-<key>`, `add-menu`,
  `layout-switcher`, `help-menu`, `minimap`, `compass`, `canvas-hud`, `place-<kind>`, `tour-card`.
  In dev builds `window.__wp = { useProjectStore, useUiStore, dispatch, transact, undo }`.
  `e2e/helpers.ts` has `worldToPage`, `project(page, expr)`, `drag`, `prepare` (dismisses the tour invite).

## 13. Styling tokens

Tailwind v4 tokens in `src/styles/index.css`: `bg-app | bg-panel | bg-panel-2 | bg-panel-3`,
`border-line | border-line-strong`, `text-ink | text-ink-muted | text-ink-faint`, `accent`
(safety orange, primary actions only), `select` (blue, selection/focus), `warn`, `danger`, `ok`,
`info`; `text-2xs`; `.num` for tabular monospace numbers; `.panel-heading`. Canvas colors are in
`src/styles/tokens.ts` (`canvasColors`, `categoryColors`, `layerColors`, `zoneKindColors`,
`monochrome`). Fonts: Inter (UI), JetBrains Mono (numbers/dimensions). Status is never conveyed by
color alone; pair it with an icon or text.

## 14. The 2D editor (Phase 2): what later phases must know

### Selection model
* `uiStore.selection: EntityRef[]`; `useSelectionContext()` drops refs to deleted entities.
* Clicking a grouped object selects the whole group (`expandGroups`); double-click picks one member.
* Entities on **hidden or locked layers are not pickable** (`pickBlocker`); hidden entities are
  selectable from panels (Layers → Hidden items) and render at 40 % opacity while selected.
* Marquee: left→right = fully inside, right→left = touching (CAD convention). Adapter `marquee:
  'contain'` (zones, measurements) always requires full containment.

### Entity adapters (`entityAdapters`, `features/editor/adapters.ts`)
One adapter per selectable kind (`id === kind`). Drag, rotate, nudge, marquee, duplicate, copy/paste
(also into another layout), delete, lock/hide, align/distribute, fit-to-selection and the multi-selection
inspector all go through them. A new selectable kind (e.g. a dust `duct`) needs only: an adapter,
nodes drawn with `{...entityAttrs(kind, id)}`, and `usePreview(kind, id)` merged into the node.

### Live previews (no store churn while dragging)
Gestures write **patches** to `editorStore.previews[previewKey(kind, id)]` every frame and commit ONE
command on release (`commitPatches`). Nodes render `withPreview(entity, usePreview<T>(kind, id))`.
Room corner/wall drags write `editorStore.roomPreview`; draw wall-relative things with `useLiveRoom()`.
**If your layer draws geometry derived from an entity (clearance zones, door swings, labels), merge
the preview too**, or it will lag behind during drags (see `features/clearances/register.tsx`).

### Tools API
`CanvasTool` handlers receive `CanvasPointerEvent { world, screen, target, handle, … }` and `ToolApi`.
Keyboard: the active tool's `onKeyDown` gets first refusal (return `true` to consume) before global
shortcuts, except while typing in an input. Use `optionsBar` / `htmlOverlay` for mode buttons and
typed entry, `overlay` for Konva previews. Hidden tools (`hidden: true`, e.g. `place`) are entered
programmatically: `startPlacing({ kind, templateId, label })` from `features/architecture/place.tsx`.
Handles: draw with `{...handleAttrs('resize:1:-1')}`; the Select tool reads `e.handle`.
Snapping helpers: `snapConfig()`, `snapThreshold(px)`, `buildSnapTargets(ctx, excludeKeys)`; publish
guides with `editorActions.setGuides` and cursor text with `editorActions.setHud`.

### Inspector sections for a selection type
Register `inspectorSections` with `appliesTo: (c) => c.single?.kind === 'vehicle'` (or a predicate on
`c.refs`). Orders: 10 identity/main, 20 geometry, 25–35 editor sections, **40–79 feature sections
(Phase 3–5: clearances 40s, electrical 50s, states 60s, relationships 70s)**, 90 options/notes.
Reuse `features/editor/inspectorParts.tsx` (`NameField`, `NotesField`, `ColorField`, `SwitchRow`,
`PlacementFields`) and `LengthInput`/`AngleInput`. Multi-selection: section `multi.objects`
(`c.refs.length > 1`); add your own section with a higher order to extend it.
Existing sections: object.{identity,geometry,mobility,organize,flags}, wall.{identity,geometry,
constraints,appearance}, vertex.position, feature.{main,door,garage,flags}, electrical.{main,circuit},
light.{main,output}, vehicle.main, zone.{main,members}, measurement.main, multi.objects, none.summary.

### Overlays and world → screen
Konva layers draw in **world mm**; the Stage applies zoom, pan AND view rotation (N/E/S/W up via
`uiStore.viewport.rotation`, multiples of 90°). Keep text readable with `rotation={-useViewRotation()}`
for screen-aligned labels or `uprightAngle(dirDeg, viewRot)` for labels along a direction. HTML overlays
convert with `toScreen/toWorld(viewport, …)` from `@/app/canvas/viewport` (rotation-aware); size things
in px via `useScale()`. `fitBoxToView(bbox)` / `fitRoomToView()` keep the current orientation.
Clearance overlay key is `clearances` (id `clearances`, `features/clearances/register.tsx`, a basic
version drawing every object's zones; Phase 3 replaces it in that same file). Context menu "View
clearances" and the palette turn `uiStore.overlays.clearances` on.

### Room editing
Use the room commands (never write vertices directly). `domain/roomEdit.ts` exposes the same edits as
pure functions for previews. Constraint lock targets are measured on the room *before* an edit.
Wall-hosted items (`placement.type === 'wall'`) follow wall edits automatically.

### Measurements
`Measurement.anchorA/B` make a dimension follow entities (`resolveMeasurement`); `kind: 'clearance'`
+ `side` measures clear floor in front of an object face (schema field `side` added in Phase 2).
Temporary results (Measure tool without "Keep") live in the tool store, not the project.

### Other shared pieces
* `editorActions.openDialog('confirm', { title, description, confirmLabel, onConfirm })`: reusable
  confirmation; room dialogs `room-template`, `room-lengths`; `save-custom`, `copy-to-layout`.
* Per-browser view prefs (`features/editor/prefs.ts`: rulers, minimap, live distances, tour dismissed).
  Per-project category color overrides: extension `editor.category-colors` (`useCategoryPalette()`).
* Saved groups: `ObjectDefinition.components`: `addDefinitionCommands` expands them into grouped parts.
* Shortcuts: V select, H pan, W walls, M measure, D dimension, Z zone, arrows / Shift+arrows nudge,
  Del delete, ⌘/Ctrl D duplicate, C / X / V clipboard, R / Shift+R rotate 90°, L lock, ⌘⇧H hide,
  G / Shift+G group, ⌘[ ⌘] order, Shift+1 fit room, Shift+2 fit selection, ⌘K palette, ? shortcut sheet,
  Alt (held) disables snapping, Shift constrains angles/axes and snaps rotation to the project step.
