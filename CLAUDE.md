# Workshop Planner: agent rules

`CLAUDE.md` and `AGENTS.md` are the same document under two names so Claude Code
and Codex follow identical rules. Change both together.

## Purpose

A local-first, desktop-first web application for modeling an irregular
residential garage or workshop precisely and planning where tools, cabinets,
benches, storage, vehicles and work zones go. It combines a lightweight 2D CAD
tool, a drag-and-drop layout planner, a woodworking workflow designer, a vehicle
clearance planner and a heuristic space-optimization assistant, with 2D editing,
3D visualization, scenario comparison and a physical move plan. Full brief:
`docs/BRIEF.md` (authoritative). Architecture: `docs/ARCHITECTURE.md`.

Core value: a user can model their actual garage accurately enough to trust
measurements and clearance warnings before physically moving a 300 lb tool
cabinet.

## Constraints

- Stack: React + TypeScript + Vite, Tailwind, shadcn/ui-style primitives (Radix),
  Zustand, react-konva, three / @react-three/fiber / drei, IndexedDB (idb), Zod,
  Vitest, Playwright.
- Units: one canonical internal unit, millimeters, quantized to 0.000001 mm at
  every parse and commit boundary (a lattice that holds 1/16", 1/32" and 1/64"
  exactly) to avoid float drift. Imperial and metric are display and input
  formats only.
- Geometry: pure functions in `src/geometry`, no React or Konva imports,
  exhaustively unit-tested. ESLint enforces purity for the geometry, domain and
  analysis layers.
- Persistence: IndexedDB with a versioned, Zod-validated JSON schema, migrations
  and snapshots. Project data never leaves the browser.
- Performance: hundreds of objects stay responsive; per-object memoized Konva
  nodes and selector-based store subscriptions.
- No fake buttons: every visible control must work.

## Install, run, test

Node.js 22+ (`.node-version` pins 24, which CI uses) and pnpm 10+.

```bash
pnpm install
pnpm dev                    # http://localhost:5173
bash scripts/check.sh       # the gate: repo hygiene, then typecheck, lint and unit tests
pnpm test:e2e               # Playwright end-to-end tests
```

`scripts/check.sh` is the single gate and what CI runs. Enable the hooks once per
clone with `git config core.hooksPath .githooks`: pre-commit scans staged changes,
pre-push runs `scripts/check.sh --fast`.

## Branch model and landing

`main` only; commit directly on `main` and push. Every push to `main` runs
`.github/workflows/ci.yml` (the gate) and `.github/workflows/deploy.yml`, which
builds with `BASE_PATH=/<repo>/` and publishes the site to GitHub Pages, so
pushing `main` is a deploy. Commits carry no AI attribution trailers.

## README images

This repo has a UI. A change to the interface updates the README screenshots in
`docs/screenshots/`, and any sentence or caption that describes them, in the
same change. When the app's look or tagline changes, the title card in
`docs/images/` changes with it.

## Never

- Never write an em dash in any file, comment, UI text or commit message. Reword
  with a colon, semicolon, comma, parentheses or a new sentence.
- Never add a control that does nothing, or store lengths in anything but the
  canonical millimeter unit.
- Never commit `.env*`, `.planning/`, `.gsd/` or `.claude/settings.local.json`.
- Never add a `Co-Authored-By` or other AI attribution trailer to a commit.
- Never force-push or rewrite history on `main`.
