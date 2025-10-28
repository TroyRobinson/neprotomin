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

## Geometry preprocessing

- Install dev dependencies (`npm install`) to ensure `mapshaper` is available.
- The build script expects each ZCTA feature to include county identifiers (e.g., `COUNTYFP`) and names. If your raw file lacks those, join against county boundaries or supply a crosswalk before running the script; otherwise all ZIPs will collapse into a single chunk.
- Run `npm run geo:build:ok-zctas -- --input <path-to-raw-oklahoma-zcta-geojson>` to regenerate county chunks and the ZCTA manifest once the statewide dataset is ready.
- The command outputs TypeScript bundles under `src/data/zcta/oklahoma/` that the map loader consumes at runtime.
