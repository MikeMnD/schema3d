# CLAUDE.md — notes for AI agents and maintainers

Read this before making changes. It captures decisions and invariants that
are easy to regress and hard to rediscover.

## What this repo is

Internal fork (MikeMnD/schema3d, branch `ilinov/upgrade`) of
shane-jacobeen/schema3d, repurposed as an internal tool to visualize the
**Cosher** production database (PostgreSQL, ~379 tables, ABP-framework
naming: `AbpUsers`, `Deals`, `Offers`, `ImotBg*`, ...). Public-site
trappings were deliberately removed: no PostHog, no Vercel analytics, no
SEO/OG/JSON-LD markup, no robots/sitemap. The Share button, CSV export and
the visitors/active stats panel are **commented out, not deleted**
(`schema-overlay.tsx`, `export-controls.tsx`) — restore by uncommenting.

## The Cosher schema dump

- Lives at `client/src/schemas/sample-schemas/cosher.sql` — **gitignored**
  (proprietary DB structure; never commit it or anything embedding it).
- Loaded via a tolerant `import.meta.glob` in
  `client/src/schemas/utils/load-schemas.ts`: when present it is the only
  preselected schema and the startup default; when absent (CI, fresh
  clones) the app falls back to the demo schemas. Keep it that way — CI
  must build without the file.
- Regenerate with pg_dump `--schema-only --no-owner --no-privileges` from
  the `crm_db_dev_instance` Docker container (ask the owner for
  credentials; don't store them in the repo).
- The SQL parser handles pg_dump format (`ALTER TABLE ONLY`, PK/FK/UNIQUE
  via `ADD CONSTRAINT`, truncated `~` constraint names) and Navicat/T-SQL
  variants. Tests: `tests/unit/parsers/sqlParser.test.ts`.

## Performance invariants (do not regress)

The app is tuned to hold 60fps with ~400 tables on an integrated GPU.
Baselines and history: commits `1fbf62e`..`be0fe1a`.

- `LARGE_SCHEMA_THRESHOLD` (=100, `visualizer/3d/constants.ts`) switches
  the scene to `InstancedTables` (one InstancedMesh per facet-count
  bucket, per-instance colors) + `BatchedRelationshipLines` (all FK lines
  in ONE LineSegments2; picking via segment `faceIndex`). Small schemas
  keep the per-mesh `Table3D`/`RelationshipLines` path. ~30 draw calls at
  379 tables — don't reintroduce per-table meshes/materials/labels.
- Per-frame animated positions flow through `animatedPositionsRef` (a
  ref-held Map) — **never through React state per frame**. Routing them
  through state once dropped layout animation to 9fps.
- **`useRef(expensiveFn())` is a trap**: useRef arguments evaluate on
  every render. `useRef(getInitialSchema())` used to re-run the full O(n²)
  force layout (~150ms) on every hover. Seed refs from lazily-initialized
  state instead.
- The force layout (`layout-algorithm.ts`) is degree-normalized with a
  cooling step clamp. Without this it numerically diverges on hub-heavy
  schemas (tenant/user tables with 200+ FK edges → positions overflow to
  1e32 → empty scene).
- Pointermove raycasts are throttled to ~30Hz via the custom Canvas
  `events` factory in `schema-scene.tsx`.
- Scene callbacks passed to tables must be identity-stable (useCallback on
  narrow deps); inline arrows/`.bind` there re-render all instances on
  every hover.
- Proximity labels only recompute when the camera is at rest
  (`TableLabels` in `instanced-tables.tsx`); mounting troika Text batches
  mid-gesture stalls the main thread 100-200ms.
- Every drei `<Text>` must get `font={LABEL_FONT}`
  (`visualizer/3d/label-font.ts`) **and** sit inside its own
  `<Suspense fallback={null}>`. drei Text suspends while preloading its
  font; with the default (network) font on an offline machine the promise
  never settles and React hides the ENTIRE sibling subtree of the shared
  Suspense boundary — the standalone build rendered an empty scene until
  this was fixed.
- WebGL context requests `powerPreference: "high-performance"` (hybrid
  Iris Xe + RTX laptops otherwise run on the integrated GPU).

## Builds and modes

- `npm run dev` — Express + Vite on :3000. On Windows, killing it can
  orphan the `tsx` child still holding port 3000 (EADDRINUSE) — find and
  kill the `node ... tsx ... server/index.ts` PID.
- `npm run build` — uses POSIX `NODE_ENV=...` syntax; fails under cmd.exe.
  Run it from Git Bash, or use `npx vite build` (production by default).
- `npm run build:standalone` — separate config
  (`vite.standalone.config.ts`): ONE self-contained `index.html` (~2.6MB,
  works offline from file://) plus `Schema3D-standalone.zip` next to it.
  `publicDir` is disabled; favicon is inlined as a data URI; when the
  Cosher dump is present the output embeds it → confidential.
  `App.tsx` picks `MemoryRouter` on `file://` (BrowserRouter would 404).

## Conventions and gotchas

- `guessCategory` (`schemas/parsers/parser-utils.ts`) is an ORDERED
  first-match-wins keyword list with precedence comments; the Cosher DB
  must end with **zero "General"** tables. After editing, re-check the
  category distribution against the real dump and keep the generic-schema
  expectations in `tests/unit/filtering/categoryFiltering.test.ts` green.
- ESLint runs with `--max-warnings 0`; new react-three-fiber JSX props
  must be added to the `react/no-unknown-property` ignore list in
  `eslint.config.js`. Husky + lint-staged prettify on commit.
- For browser automation/perf work: load any schema via the URL hash
  `#sql:<pako-deflate-base64url>` (see `shared/utils/url-encoding.ts`).
  On this dev machine Playwright's bundled Chromium is version-mismatched —
  launch with `channel: "chrome"`.
- The share-URL timing test scales its budget with schema size — keep it
  that way; level-9 deflate of an ~800KB dump legitimately exceeds 100ms.
