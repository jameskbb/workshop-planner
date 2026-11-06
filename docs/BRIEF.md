# Workshop Planner: Product Brief (verbatim from owner)

You are building a polished, production-quality web application called Workshop Planner.

This is not a simple room-layout toy and it is not a throwaway MVP.

The finished application should function as a hybrid of:

• a lightweight 2D CAD tool
• a garage/workshop layout planner
• a drag-and-drop furniture planner
• a woodworking shop workflow designer
• a vehicle clearance planner
• an intelligent space-optimization assistant

The primary use case is someone with an irregularly shaped residential garage who wants to accurately model the physical space and experiment with where tools, cabinets, workbenches, shelves, vehicles, storage, and work zones should go.

A user should eventually be able to model their actual garage closely enough that they can trust measurements and clearance warnings before physically moving a 300 lb tool cabinet.

Build the full product experience. You may structure development into phases internally, but do not artificially limit the implementation to a "V1."

## PRODUCT VISION

The user should be able to say:

"My garage is 21' 8" wide on this wall, 19' 4" on this wall, this corner jogs inward 28", there is a support pole here, my garage door is here, and this cabinet is 48" x 24"."

Then visually build the entire workshop.

They should be able to:

1. Draw the exact garage footprint.
2. Enter precise measurements.
3. Add architectural features.
4. Add tools, cabinets, benches, shelves, vehicles, carts, and miscellaneous objects.
5. Drag, rotate, resize, duplicate, align, and snap objects.
6. See whether items physically fit.
7. Visualize working clearances around tools.
8. Visualize walking paths.
9. Visualize whether the vehicle can enter, park, and open its doors.
10. Save multiple layout alternatives.
11. Ask the application to suggest better layouts.
12. Compare layouts quantitatively.
13. View the design in both 2D and 3D.
14. Export a useful plan that can be referenced while reorganizing the actual garage.

The result should feel like something between SketchUp, Floorplanner, Figma, and a purpose-built workshop planner.

## TECHNOLOGY

Use a modern TypeScript-first stack.

Preferred:

• React
• TypeScript
• Vite or Next.js if there is a compelling architectural reason
• Tailwind CSS
• shadcn/ui where appropriate
• Zustand for client state
• React Konva / Konva for the interactive 2D canvas
• Three.js / React Three Fiber for 3D visualization
• IndexedDB for local project persistence
• Zod for validation
• Vitest for unit tests
• Playwright for critical interaction tests

Keep dependencies reasonable.

Do not choose a giant CAD framework unless its value clearly outweighs the complexity.

Architect geometry calculations separately from rendering so the geometry engine is testable.

The application should work entirely locally without requiring an account or cloud backend.

Design the architecture so cloud synchronization could be added later.

## DESKTOP-FIRST UX

This is primarily a desktop application.

Optimize for: mouse, trackpad, keyboard, large screens.

Tablet functionality is desirable, but desktop usability matters most.

Use an application layout similar to professional design software:

LEFT SIDEBAR: project, room, architecture, tools, furniture/storage, vehicles, zones, saved custom objects

CENTER: interactive floor-plan canvas

RIGHT SIDEBAR: selected object properties, dimensions, exact location, rotation, clearances, metadata, visibility options

TOP TOOLBAR: select, pan, wall, dimension, measure, add object, zone, undo, redo, zoom, 2D / 3D toggle, layout scenarios, export

BOTTOM STATUS BAR: cursor coordinates, zoom, grid size, snapping state, units, selected object dimensions

The overall aesthetic should be clean, technical, modern, and slightly industrial.

Avoid cartoonish DIY-app aesthetics.

## PROJECT SYSTEM

Allow multiple projects.

Example:

Garage Workshop
20' 8" x irregular footprint
Last modified 2 minutes ago

Each project stores: room geometry, ceiling height, doors, windows, garage doors, outlets, lights, electrical circuits, wall-mounted objects, floor objects, vehicles, zones, measurements, layout scenarios, preferences, custom object library.

Autosave changes locally.

Provide: New Project, Duplicate Project, Rename, Delete, Export, Import

Create a portable JSON project format.

## UNITS

Support: imperial, metric

Imperial inputs should understand:

48"
4'
4' 6"
4 ft 6 in
54 in
4.5 ft

Internally use one normalized unit system.

Display dimensions intelligently. Example: 54 inches -> 4' 6"

Do not accumulate floating point measurement errors.

## GARAGE / ROOM GEOMETRY

The garage must not be limited to a rectangle. Support arbitrary polygons.

Users should be able to create a room through several methods.

Method 1 - Draw walls: Click points to create connected wall segments. Show live segment length and angle. Close the polygon to create the room.

Method 2 - Exact wall dimensions: After drawing a segment, allow exact length entry. Users can specify angles. Example: Wall A: 21' 6", Wall B: 24', Wall C: 3', Wall D: 22' etc.

Method 3 - Basic shape templates: rectangle, L-shaped garage, T-shape, two-car garage, three-car garage. Templates remain completely editable.

Wall properties: length, thickness, height, angle, name, color/material, notes

Provide draggable vertices. When geometry changes, connected walls should remain connected. Show interior measurements.

Provide an optional CAD-style constraint system. Examples: lock horizontal, lock vertical, lock angle, lock length, parallel, perpendicular

## ARCHITECTURAL FEATURES

Users should be able to add: standard doors, double doors, garage doors, windows, support poles, columns, stairs, steps, utility closets, water heaters, HVAC units, electrical panels, attic ladders, permanent shelving, sinks, hose bibs, wall protrusions, ceiling obstructions, cabinets, worktops

Doors should visualize their swing radius.

Garage doors should include: opening width, opening height, track position, overhead clearance area

Support poles should have exact diameter.

Objects can be locked so they cannot accidentally move.

## ELECTRICAL PLANNING

Allow users to place: 120V outlets, 240V outlets, ceiling outlets, extension cord connection points, electrical panels

Optional metadata: circuit, amperage, voltage, GFCI, dedicated circuit, notes

Tools can specify electrical requirements. Example: Planer 120V 15A; Dust Collector 240V 20A

The application should warn when a proposed layout places a stationary machine unusually far from an appropriate outlet.

Do not pretend to perform code-compliance verification. This is planning assistance only.

## LIGHTING

Allow placement of: ceiling fixtures, shop lights, task lights

Represent each fixture's approximate coverage.

Provide an optional lighting overlay showing approximate illumination coverage.

Users should be able to use this simply to decide: "Should my three shop lights be front-middle-back or left-middle-right?"

## OBJECT LIBRARY

Create a large built-in library of workshop objects.

Work surfaces: workbench, assembly table, mobile workbench, outfeed table, folding table, desk

Large stationary tools: table saw, cabinet saw, contractor saw, miter saw, miter saw station, planer, jointer, bandsaw, drill press, lathe, router table, spindle sander, belt/disc sander, CNC machine, laser cutter, dust collector, air compressor

Storage: base cabinet, wall cabinet, tall cabinet, rolling cabinet, shelving, metal shelving, lumber rack, sheet goods rack, mobile tool cart, drawer cabinet, pegboard, French cleat wall, tote rack

Miscellaneous: trash can, shop vacuum, ladder, bicycle, lawn mower, pressure washer, generator, rolling toolbox, refrigerator, freezer

Every object should have sensible default dimensions that the user can override.

Do not imply factory-default dimensions are exact for a user's tool.

## CUSTOM OBJECTS

The user must be able to create their own objects. Example: "My rolling cabinet" Width: 48" Depth: 24" Height: 72"

Metadata: name, category, width, depth, height, weight, mobile/static, notes, electrical requirements, dust collection port, required working clearances, wall mounted / floor standing, image, custom color

Save custom objects to the user's reusable library. Custom objects should be available across projects.

## DRAG AND DROP

Every floor object should support: drag, rotate, resize, duplicate, delete, lock, hide, group, ungroup

Keyboard:
Arrow keys - nudge
Shift + Arrow - larger nudge
Delete - remove
Ctrl/Cmd+D - duplicate
Ctrl/Cmd+Z - undo
Ctrl/Cmd+Shift+Z - redo
R - rotate
L - lock
G - group

Allow exact numeric editing from the property panel. Example: X: 42", Y: 118", Rotation: 90 degrees

## SNAPPING

Implement excellent snapping. Snap to: grid, walls, corners, wall centers, object edges, object centers, alignment lines, dimensions, neighboring objects

Display intelligent alignment guides similar to Figma.

Allow snapping to be temporarily disabled with a modifier key.

Grid spacing options: 1", 2", 3", 6", 12"

## MEASUREMENT TOOL

Create a dedicated measurement tool. Click two locations to measure distance. Measurements can remain permanently on the canvas.

Support: point-to-point, wall-to-object, object-to-object, clearance measurement, angular measurement

Example: Cabinet -> car = 31"

## CLEARANCE ENGINE

This should be one of the application's strongest features.

Objects can contain multiple clearance zones.

Example for a TABLE SAW: Physical footprint: 44" x 27"; Operator zone: 36" around front; Infeed: 96"; Outfeed: 96"; Side clearance: 24"

The physical tool may fit in an area even if it cannot actually be used there. Represent these differently.

Allow users to toggle: Physical footprint, Operational clearance, Maintenance clearance

Use translucent overlays. Clearance zones should rotate with the object. Detect overlap between clearance zones and walls/objects.

Warnings should explain the actual issue. Example: "Table saw outfeed clearance intersects the east wall by 18 inches." Not: "Invalid placement."

## MOBILE TOOLS

Objects can be marked: STATIC, MOBILE

Mobile tools should have: parked location, working location

Example: A planer can normally sit against a wall but be rolled into the center aisle when used.

Allow users to define: Parked Position, Working Position. Show both.

This feature is extremely important for small garages.

## VEHICLE PLANNER

Vehicles should be first-class objects.

Provide generic templates: compact car, sedan, sports car, midsize SUV, full-size SUV, pickup truck, crew-cab pickup

Allow custom vehicle dimensions. Example custom vehicle: 2024 Subaru WRX. User enters or confirms: length, width, height, mirror width, wheelbase

Show vehicle footprint.

Additionally model: driver door swing, passenger door swing, rear door swing, trunk access zone, hood access zone, walking clearance around vehicle

Allow mirror-folding state.

Provide configurable desired clearance. Example: Driver side: 30"; Passenger side: 18"; Front: 24"; Rear: 30"

Color-code problematic areas.

## VEHICLE ENTRY PATH

Do more than simply test whether a parked rectangle fits.

Provide a simple garage-entry simulation. The user should be able to position: garage opening, driveway approach direction, vehicle

Then approximate whether the vehicle can travel from outside the garage into its parking location.

It does not need automotive-engineering precision. Use reasonable vehicle turning geometry.

Display the swept path. Warn if the vehicle body or clearance envelope collides with objects.

## WORKFLOW ZONES

Allow users to create semantic zones. Examples: parking, woodworking, assembly, lumber storage, finishing, automotive, lawn equipment, tool storage, walking aisle, staging, project storage

Zones are translucent polygons. Users can toggle them. Objects can optionally belong to zones.

## WALKABILITY ANALYSIS

Create a walkway analysis mode. Users can set desired minimum aisle width. Examples: 24", 30", 36", 42"

Analyze navigable floor area. Show: open paths, narrow paths, blocked areas, dead ends

Provide a simple heatmap.

Example warning: "Main path from garage entry to workbench narrows to 19 inches beside the cabinet."

## WORK TRIANGLE / WORKFLOW ANALYSIS

Workshop layout should consider workflow. Allow relationships between objects.

Examples: Lumber Storage -> Miter Saw -> Table Saw -> Assembly Table -> Finishing. Or: Car -> Tool Cabinet -> Work Bench

The user can define frequently used relationships. Visualize them as optional connection lines. Calculate approximate walking distance between workflow steps.

## DUST COLLECTION

Tools can specify a dust port.

Allow placement of: dust collector, fixed duct, flexible hose connection, blast gates

Optional dust collection overlay. Calculate approximate hose/duct distance between tools and collector. Highlight impractical routing.

Again, this is a planning tool, not an engineering certification tool.

## WALL STORAGE

Support wall-mounted objects separately from floor objects. Examples: cabinets, pegboards, French cleats, lumber racks, clamp racks, shelves, TVs, chargers, extension cord reels

Provide elevation view for each wall. This is important.

Users should be able to click a wall and switch from floor-plan view to a front-facing wall elevation.

Example:

East Wall

| cabinet | pegboard | cabinet |
|         workbench          |

Support accurate vertical dimensions.

## VERTICAL SPACE

Model height. Objects should have Z dimensions. Users should be able to identify stacking opportunities.

Example: Cabinet: 72" tall; Ceiling: 108"; Available vertical clearance: 36"; Wall cabinet can fit above workbench.

Provide warnings where tall objects collide with: garage door tracks, garage door open position, ceiling storage, lights, attic ladder, ceiling beams

## 2D VIEW

The 2D editor is the primary design environment. It should feel crisp and professional.

Provide: zoom, pan, grid, rulers, dimensions, alignment guides, selection rectangle, multi-select, layers, visibility toggles, object labels

Allow labels such as: 4' Tool Cabinet, Mobile Planer, Assembly Table

## 3D VIEW

Generate a simple but attractive 3D representation from the 2D model.

Users should be able to: orbit, pan, zoom, walk around, hide ceiling, hide walls, switch perspective / orthographic, view from saved cameras

Objects do not need photorealistic models. Use recognizable simplified geometry.

3D should help answer: "Does this feel crowded?" and: "How will this wall actually look?"

## MULTIPLE LAYOUT SCENARIOS

Users rarely know the correct arrangement immediately. Allow scenarios within the same project.

Examples: Layout A - Car Priority; Layout B - Woodworking Priority; Layout C - Maximum Storage; Layout D - No Car

Creating a scenario should duplicate the object arrangement while preserving room geometry.

Provide fast switching. Provide side-by-side comparisons.

## LAYOUT SCORECARD

Calculate descriptive metrics for each scenario. Do not present one universal magic score without explanation.

Show metrics such as: Usable open floor area, Walking-path minimum width, Vehicle clearance, Number of collisions, Number of operational-clearance conflicts, Workbench accessibility, Tool workflow travel distance, Wall-storage utilization, Parking usability, Number of electrical-distance warnings

Allow users to choose what matters most.

## SMART LAYOUT ASSISTANT

Build an optimization assistant. The assistant should not simply generate random arrangements. Use the geometry engine and user priorities.

User specifies priorities using sliders: Vehicle parking, Woodworking, Storage, Open floor space, Easy tool access, Assembly space, Minimal moving of mobile tools, Clear walkways

Then allow: "Suggest Layouts". Generate several valid layout candidates. Example: Option 1 Parking Priority; Option 2 Workshop Priority; Option 3 Balanced; Option 4 Maximum Open Space

Use heuristics / optimization rather than requiring an external AI API. Potential techniques: simulated annealing, genetic algorithms, hill climbing, constraint-solving heuristics

Object placement must respect physical boundaries and locked objects. Evaluate candidate layouts using transparent metrics.

Never silently rearrange the user's active layout. Suggested layouts become new scenarios.

## NATURAL LANGUAGE COMMAND SYSTEM

Create a command interface that converts simple instructions into deterministic application actions.

Examples:
"Move the workbench against the north wall."
"Give the WRX 30 inches of driver-side clearance."
"Rotate the cabinet 90 degrees."
"Put the planer next to the miter saw."
"Show me everything interfering with the garage door."
"Hide the vehicle."
"Duplicate this cabinet."

This does not initially need an external LLM. Implement a basic command grammar / intent parser where reasonable. Architect the command system so an LLM provider could later generate structured commands.

## DESIGN QUESTIONS

Create a panel called: "Ask the Layout". This should answer computational questions from the existing geometry.

Examples:
"What is the narrowest walkway?"
"How much space is behind the car?"
"Can I open the driver door?"
"Which tools have clearance conflicts?"
"How much open floor area do I have?"
"Which tool is farthest from an outlet?"
"How many feet of wall are unused?"
"Could a 48 x 24 cabinet fit anywhere along the west wall?"

Answers should come from actual project geometry.

## FIT CHECK

Create a dedicated feature: "Will It Fit?"

User enters: Width, Depth, Height. Optionally required surrounding clearance.

The app identifies locations where the item could physically fit.

Example: 48" x 24" cabinet. Possible locations: East wall: 62" available; North wall: 51" available; Southwest corner: fits with 3" remaining

Allow clicking a suggestion to preview placement.

## MOVE SOMETHING HERE

Provide a reverse workflow. The user selects an empty region and chooses: "What could fit here?" The app searches the current object library.

Example: Available: 42" x 28". Could fit: rolling tool cabinet, planer, small workbench, shelving unit

## SAFETY / INTERFERENCE ANALYSIS

Provide visual checks for: physical overlap, doorway obstruction, garage-door interference, vehicle clearance, tool working clearance, walkway narrowing, electrical panel access, hot appliance / finishing-area conflicts if tagged, overhead interference

Keep warnings practical rather than alarmist. Allow warnings to be acknowledged/ignored.

## OBJECT STATES

Some workshop objects physically change during use. Support alternate states.

Examples: Miter Saw Station (wings folded / wings open); Table (folded / deployed); Mobile cart (parked / working); Garage Door (closed / open); Vehicle (parked / doors open)

Allow state switching. Clearance analysis should respect the selected state.

## GROUPS

Allow objects to be grouped. Example: Miter Saw Station contains cabinet, saw, left support, right support. Moving the station moves everything together. Allow groups to become reusable custom objects.

## OBJECT LAYERS

Implement layers / visibility categories: Architecture, Electrical, Lighting, Storage, Woodworking, Vehicle, Clearances, Measurements, Zones, Dust Collection. Allow users to hide/show each layer.

## COLORS

Assign subtle default category colors. Do not overwhelm the plan. The user may override colors. Provide a monochrome technical-drawing mode for printing.

## HISTORY

Implement robust undo/redo. Every meaningful canvas operation should be reversible. Use a command or transaction architecture rather than brittle ad hoc state history.

## COPY / PASTE

Support object copy/paste. Preserve attributes. Allow copying groups between scenarios.

## ALIGNMENT TOOLS

align left, align right, align top, align bottom, align center horizontal, align center vertical, distribute horizontally, distribute vertically

## ROTATION

free rotation, exact degrees, snap to 15 degrees, snap to 45 degrees, snap to 90 degrees

## CONTEXT MENUS

Right-click an object: duplicate, rotate, lock, hide, group, bring forward, send backward, set parked position, set working position, view clearances, edit dimensions, save to library, delete

## OBJECT INSPECTOR

The property panel should show: Name, Category, Width, Depth, Height, X, Y, Z, Rotation, Locked, Mobile, Color, Notes

Additional sections: Clearances, Electrical, Dust collection, States, Relationships

Changes should update the canvas immediately.

## MINI MAP

For large spaces, provide an optional minimap.

## CAMERA / VIEW PRESETS

2D: Fit to room, Fit to selection, North, South, East, West
3D: Top, Front, Rear, Left, Right, Perspective

## EXPORTING

PNG: Export current plan at high resolution.
SVG: Export vector floor plan.
PDF: Create printable floor plan with project name, scale, measurements, legend, date, optional notes
JSON: Full editable project backup.
CSV: Object inventory. Example columns: Object, Category, Width, Depth, Height, X, Y, Rotation, Mobile, Notes
DXF: If practical, implement a basic DXF export for walls, object footprints, dimensions. Keep DXF implementation isolated. Do not allow DXF complexity to compromise the main application.

## PRINT MODE

Provide a clean print mode. Options: grid, measurements, object labels, clearances, zones, vehicle, electrical, lighting. Support common paper sizes.

## INVENTORY

Automatically generate an inventory from the floor plan.

Example:
Garage Workshop Inventory
STORAGE: 2 x 48" cabinets, 1 x rolling cabinet, 2 x shelving units
TOOLS: 1 x table saw, 1 x planer, 1 x miter saw

Allow inventory-specific notes.

## REORGANIZATION MODE

This is an important real-world feature.

Once a user has created the desired layout, generate a recommended physical move sequence.

Example:
Step 1 Clear the southwest corner.
Step 2 Move the rolling cabinet to the north wall.
Step 3 Move the planer into the cabinet's previous position.
Step 4 Move the assembly table.

Try to avoid instructions that require moving the same heavy object repeatedly.

Allow user to mark: Already moved, Skip, Cannot move yet

This turns the design into an actionable garage-reorganization plan.

## BEFORE / AFTER

Allow the user to designate: Current Layout, Target Layout. Overlay them. Current positions use dashed outlines. Target positions use solid outlines. Display movement arrows. This should make physical rearrangement easy.

## SPACE UTILIZATION

Calculate: Total room area, Permanent obstruction area, Object footprint area, Open floor area, Zone area. Provide percentages. Do not treat clearance overlays as physical footprint.

## WALL UTILIZATION

For each wall: Total wall length, Occupied wall length, Available wall length. With vertical mode: Total wall surface, Storage coverage, Unused area

## COMMAND PALETTE

Ctrl/Cmd+K opens a command palette. Commands: Add Workbench, Add Cabinet, Toggle Grid, Show Clearances, Show Vehicle Clearance, Fit Room, Duplicate Scenario, Export Plan, Open 3D View, etc.

## PROJECT SETUP WIZARD

New Project wizard: 1. Project name 2. Units 3. Room shape 4. Ceiling height 5. Garage doors 6. Permanent obstructions 7. Vehicle 8. Begin layout

Provide: Start Blank for experienced users.

## DEMO PROJECT

Include a high-quality demo project. Create an irregular two-car residential garage containing: garage door, entry door, support pole, electrical panel, outlets, overhead lights, wall cabinets, mobile shelving, workbench, miter saw, planer, table saw, shop vacuum, tool cart, vehicle. Make the demo rich enough to show the application's capabilities.

## PERSISTENCE

Projects must survive browser refreshes. Use IndexedDB rather than relying solely on localStorage. Provide automatic backups / snapshots. Allow the user to restore a recent local snapshot.

## DATA MODEL

Design strong TypeScript domain models. Likely concepts include: Project, Room, Wall, Vertex, ArchitecturalFeature, PlacedObject, ObjectDefinition, ObjectState, ClearanceZone, Vehicle, VehicleClearance, ElectricalPoint, LightingFixture, WorkflowZone, Measurement, Scenario, Relationship, Layer, SavedView, ProjectSettings

Use stable UUIDs. Separate object definitions from placed instances.

## GEOMETRY ENGINE

Create a dedicated /geometry domain. It should contain pure functions wherever possible.

Capabilities: polygon containment, polygon intersection, rotated rectangles, arbitrary polygon collision, point-to-line distance, object-to-wall distance, nearest point, clearance overlap, bounding boxes, wall projection, snapping, alignment, path width approximation, vehicle clearance, room area, free wall segments, placement candidates

Write extensive tests for geometry. Geometry correctness matters more than fancy animation.

## PERFORMANCE

The editor should remain responsive with: hundreds of objects, dozens of measurements, multiple clearance overlays, complex room geometry. Avoid rerendering the entire scene for minor edits. Use memoization/selectors where appropriate.

## ACCESSIBILITY

Use semantic UI outside the canvas. Provide keyboard shortcuts. Use tooltips. Do not make color the only indicator of status.

## EMPTY STATES

Do not leave generic empty cards. Example: No tools added yet. [Add a Tool] "You can choose from the library or create a custom tool."

## ONBOARDING

Provide a lightweight guided tour. Teach: 1. Draw the garage 2. Add fixed features 3. Add tools 4. Add vehicle 5. Turn on clearances 6. Save layout alternatives. Do not force the tutorial.

## ERROR HANDLING

Prevent invalid project geometry where possible. Give clear explanations. Example: "This wall would cause the room boundary to intersect itself." Provide recovery instead of destroying the user's work.

## AUTOSAVE STATUS

Display: Saved, Saving…, Unsaved changes. Avoid intrusive save notifications.

## POLISH

hover states, selected states, resize handles, rotate handle, cursor changes, subtle transitions, tooltips, keyboard shortcuts, context menus, confirmation for destructive actions, sensible defaults, skeleton loading where appropriate, clean empty states. Do not add animation simply for decoration.

## DESIGN PRINCIPLES

1. Measurements must feel trustworthy.
2. Dragging should feel precise.
3. Complex capabilities should remain discoverable.
4. Common actions should be fast.
5. Exact numeric entry must always be available.
6. Visual overlays should be optional.
7. The application should never silently modify a user's layout.
8. Mobile workshop equipment must be modeled differently from fixed equipment.
9. Physical fit and practical usability are different concepts.
10. Users should be able to plan both the final layout and the process of getting there.

## SAMPLE EXPERIENCE

A user creates "Home Garage". They draw an irregular garage. They add two garage doors, support pole, entry door, wall cabinets, outlets, three shop lights.

Then they create custom objects: Heavy Mobile Workbench 72" x 30"; Rolling Tool Shelf 48" x 20"; Planer Stand 30" x 24"

They add a vehicle. They enable Vehicle Clearances, Operational Clearances, Walkways.

The canvas immediately reveals:
• the driver's door is too close to a cabinet
• the planer fits while parked but needs to move before use
• the main walking path gets narrow near a shelf
• the workbench blocks part of the table saw's outfeed zone

They duplicate the layout. Scenario 1: Car + Workshop. Scenario 2: Workshop Mode. They move mobile equipment into working positions in Scenario 2.

They then ask: "Could I put a 48 x 24 cabinet anywhere else?" The system highlights three valid wall sections. They choose one.

Finally they designate Current Layout, Target Layout. The application creates a move plan for reorganizing the actual garage.

That level of usefulness is the goal.

## CODE ORGANIZATION

Use a maintainable feature/domain structure rather than one giant component. For example:

src/ app/ components/ features/ (editor/ projects/ objects/ architecture/ vehicles/ measurements/ scenarios/ clearances/ optimization/ exports/ inventory/ reorganization/ three-d/) geometry/ domain/ persistence/ hooks/ stores/ utils/ tests/

Keep rendering logic separate from domain calculations.

## TESTING

Create strong automated coverage. Especially test: measurement parsing, unit conversion, polygon containment, collisions, rotated objects, clearance zones, snapping, wall-distance calculations, scenario duplication, undo/redo, project serialization/deserialization

Create Playwright tests for:
1. New project creation
2. Drawing a room
3. Adding an object
4. Dragging an object
5. Entering exact dimensions
6. Creating a scenario
7. Saving/reloading project
8. Exporting/importing JSON

## README

Create an excellent README. Explain: what the project does, architecture, technology stack, setup, development, testing, major capabilities, project file structure. Include screenshots once the interface exists.

## DEVELOPMENT APPROACH

Before coding: inspect the existing repository, determine what already exists, create an implementation plan, design the domain model, design the geometry architecture, build the application incrementally without sacrificing the end-state design.

Do not create huge monolithic components. Do not fill the project with fake buttons. If a feature appears in the interface, implement it. If something is genuinely too isolated or specialized to complete immediately, establish the real underlying architecture rather than using misleading placeholders.

Prioritize in this order when tradeoffs are necessary:
1. Geometry correctness
2. Reliable project persistence
3. Excellent 2D editor
4. Object/clearance system
5. Vehicle planning
6. Scenario system
7. Workshop-specific intelligence
8. Layout analysis
9. Reorganization workflow
10. 3D visualization
11. Advanced export

But continue through the full product rather than stopping after the early items.

Make reasonable product and engineering decisions autonomously. When there are multiple viable approaches, choose the one that creates the most maintainable and genuinely useful application.

The final product should make someone think: "I can model my actual garage in this and know whether my layout will work before I start moving things."
