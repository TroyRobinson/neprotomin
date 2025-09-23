Agent playbook (concise)

- Map markers
  - Prefer MapLibre-rendered layers over DOM markers to avoid zoom drift. Use a GeoJSON `source` + `circle` layers for pins and a separate highlight layer filtered by id. See `src/ui/mapView.ts:96`.
  - Avoid CSS transforms on marker containers; let the renderer position features. If needed, use layer paint props instead of DOM styling.
  - MapLibre `setStyle()` clears custom sources/layers. On theme/basemap swap, listen for `styledata`/`idle` and re-add sources/layers, then repopulate data and filters.

- Map config
  - Use a light street basemap (Carto Positron GL) and center on Tulsa. Disable rotation for predictable UX. See `src/ui/mapView.ts:17` and `src/ui/mapView.ts:111`.

- InstantDB data
  - Entity ids must be UUIDs. Generate with `id()`; do not write custom seed ids. See `src/lib/seed.ts:39`.
  - Make seeding idempotent by checking existing records (e.g., by name) before `transact`. See `src/lib/seed.ts:23`.
  - Keep schema minimal but indexed for lookups (e.g., `name`). See `src/instant.schema.ts:14`.

- UI architecture
  - Keep modules small and single‑purpose: `topbar` (theme + nav), `sidebar` (list + hover), `mapView` (render + hover), `state/organizations` (subscribe + normalize), `lib/seed` (seed once).
  - Cross‑component hover/selection flows through explicit setters (`setActiveOrganization`) rather than shared DOM.

- Theming
  - Tailwind `darkMode: "class"`; manage a root `dark` class and persist choice to `localStorage`. See `src/ui/theme.ts:31` and `tailwind.config.js:6`.

- Dev ergonomics
  - Node: Vite expects >=20.19 or >=22.12. Use `npm run dev` for local, `npm run build` for CI checks.
