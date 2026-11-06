# Changelog

All notable changes to Workshop Planner are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semantic versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`), where a breaking change to the
project file format is a MAJOR bump and is always accompanied by a migration in
`src/domain/serialization`.

## [Unreleased]

### Added

- MIT licence, package metadata and this changelog.
- Production-build smoke test (`e2e/preview-smoke.spec.ts`) that runs against `vite preview`.

### Fixed

- The New Project wizard no longer parks the vehicle on top of the support pole (or attic
  ladder): free-standing obstructions move sideways out of the car's lane, so a wizard project
  never opens with a critical overlap.
- "Add a garage door" re-spaces the doors on the front wall when it is wide enough for all of
  them, instead of sending the second door to the back wall; the door fields update when a door
  is re-spaced or its width changes.
- "Where is the water heater?" says which wall a wall-hosted fixture is on and how far along it,
  instead of a distance to the nearest wall.

### Changed

- The software 3D renderer (browsers without WebGL) now sorts faces with a BSP tree, so
  interpenetrating solids (a support pole through a car, walls meeting at a corner) draw
  correctly.
- Printed and exported sheets lay labels out so they no longer overlap each other or outlet
  symbols; labels that move get a leader line.
- The app is code-split: the project list loads ~110 kB; the editor, 3D view, PDF/PNG export and
  the solver workers are separate chunks loaded on demand.
- Autosave writes discrete changes after 300 ms (drags still coalesce at 800 ms) and also flushes
  on `beforeunload`.
- The demo project's car is parked so it can still be driven in and the entry door still opens.

## [0.1.0] (2026-09-19)

First working version: room modelling, object library, clearances, vehicles, walkability, layouts
and scorecard, layout assistant, natural-language commands, 2D/3D/elevation views, exports, print,
inventory and the physical move plan.
