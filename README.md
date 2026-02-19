# NE Proto Min 
NE Minimal Prototype for testing UX/UI and as a dev guide.


--

This is a Vite project scaffolded with create-instant-app.

To run the development server:
`npm run dev`

To push schema changes:
`npx instant-cli push`

To pull schema changes:
`npx instant-cli pull`

## InstantDB seeding

- Run `npm run admin:seed:areas` after cloning or when ZCTA geometry changes to (re)populate the `areas` table with ZIP + COUNTY metadata used by Census imports. This script uses the Instant admin SDK and expects `VITE_INSTANT_APP_ID` and `INSTANT_APP_ADMIN_TOKEN` to be set.

## Census imports

- Census imports always fetch margin-of-error (MOE) values alongside estimates; the admin UI no longer exposes a separate "include MOE" toggle.

## Geometry preprocessing

- Install dev dependencies (`npm install`) to ensure `mapshaper` is available.
- The build script expects each ZCTA feature to include county identifiers (e.g., `COUNTYFP`) and names. If your raw file lacks those, join against county boundaries or supply a crosswalk before running the script; otherwise all ZIPs will collapse into a single chunk.
- Run `npm run geo:build:ok-zctas -- --input <path-to-raw-oklahoma-zcta-geojson>` to regenerate county chunks and the ZCTA manifest once the statewide dataset is ready.
- The command outputs TypeScript bundles under `src/data/zcta/oklahoma/` that the map loader consumes at runtime.

## Dev note

- During hot reloads/tab lifecycle events you may see IndexedDB `InvalidStateError` messages about a closing connection (InstantDB local cache). These are expected and are filtered in `src/react/main.tsx`.
