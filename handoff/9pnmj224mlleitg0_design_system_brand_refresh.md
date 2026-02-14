# 9pnmj224mlleitg0 - Design System Brand Refresh (Context Handoff)

## Task summary
User requested a design refresh with:
- New primary color: `#a9abd6` (Legacy Purple)
- New secondary color: `#0a3023` (Cedar Tree), including cedar-tinted neutral greys (especially dark mode)
- Replace current orange location/org visuals with `#fdd6c3` family
- Primary font swap to GT America, with layout/font-size impact assessment
- Replace logo with `public/icons/NE_Logos_Logomark_Prp.svg`

This handoff focuses on where the current theme tokens are defined and where they are consumed in map layers, chips, legend pills, top bar, and core UI.

## Repo state notes
- Worktree is already dirty from prior edits (not from this task):
  - `src/react/ReactMapApp.tsx`
  - `src/react/components/Sidebar.tsx`
  - `src/react/components/StatList.tsx`
  - `src/react/components/StatViz.tsx`
  - `src/react/hooks/useStats.ts`
- Relevant logo assets exist and are currently untracked in git:
  - `public/icons/NE_Logos_Logomark_Prp.svg`
  - `public/icons/NE_Logos_Logomark_Grn.svg`

## Highest-priority files

1) Tailwind design tokens and font stack
- `tailwind.config.js`
  - `theme.extend.colors.brand` is still legacy indigo scale.
  - `fontFamily.sans` is currently `Inter`.
  - `fontFamily.display` is currently `Space Grotesk`.

2) Global base neutrals and dark mode surfaces
- `src/style.css`
  - Root/body backgrounds are mostly `slate` utility-driven.
  - Scrollbar vars currently hardcoded to slate-based hex values.

3) Logo integration in top bar (currently “NE” text badge)
- `src/react/components/TopBar.tsx`
  - Desktop brand mark: around `:509`
  - Mobile brand mark: around `:952`
  - Mobile menu brand mark: around `:1085`
  - Current mark is not image-based; it is a `span` with `NE` and `bg-brand-500`.

4) Map org circles/clusters/highlights (orange family now)
- `src/react/imperative/layers/organizations.ts`
  - Cluster circle: `#fed7aa`
  - Cluster count text: `#9a3412`
  - Point color: `#f97316`
  - Highlight/cluster-highlight: `#fdba74`

5) Map org legend dot and map pills/chips
- `src/react/imperative/components/orgLegend.ts`
  - Legend dot: `#fb923c`
- `src/react/imperative/categoryChips.ts`
  - Orgs chip uses orange utilities (`bg-orange-200`, `text-orange-900`, dark orange variants)
  - Time chip also orange-themed (`border-orange-*`, `bg-orange-*`, `text-orange-*`)

## Additional theme/color files likely in planning scope

6) Boundary, hover, and selection map paint
- `src/react/imperative/styles/boundaryPalettes.ts`
  - Base boundary fill/line still slate-driven by theme
  - Selected/pinned/hovers use blue/indigo hex values (`#3755f0`, `#4f46e5`, etc.)
- `src/react/imperative/areas/registry.ts`
  - ZIP/COUNTY base paint, hover paint, highlight paint, pinned paint

7) Choropleth + secondary palettes
- `src/lib/choropleth.ts`
  - `CHOROPLETH_COLORS` is an indigo-ish ramp
  - `TEAL_COLORS` for secondary stat overlays
  - Diverging ramps include amber and indigo
- `src/react/imperative/overlays/stats.ts`
  - Uses `CHOROPLETH_COLORS`/`TEAL_COLORS`
- `src/react/imperative/components/choroplethLegend.ts`
  - Legend pill shell uses slate border/text
- `src/react/imperative/components/secondaryChoroplethLegend.ts`
  - Secondary pill border is teal

8) Map shell and top-of-map right controls using brand/slate
- `src/react/ReactMapApp.tsx`
  - My-location / legend-row injected buttons around `:2469+` and `:3543+`
  - Uses many `brand-*` and `slate-*` utilities

9) Other high-surface UI with heavy brand/slate usage
- `src/react/components/Sidebar.tsx`
- `src/react/components/BoundaryToolbar.tsx`
- `src/react/components/WelcomeModal.tsx`
- `src/react/components/AuthModal.tsx`
- `src/react/components/AddOrganizationScreen.tsx`
- `src/react/components/CustomSelect.tsx`

## Font migration context (GT America)

Current setup:
- Base app font is Tailwind `sans` = `Inter` (`tailwind.config.js`)
- Editorial headings use `font-display` = `Space Grotesk`
- `index.html` currently preconnects/loads Google `Space Grotesk` only

Observed typography usage patterns:
- Predominantly Tailwind semantic size utilities (`text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`)
- Also many explicit tiny sizes (`text-[9px]`, `text-[10px]`, `text-[11px]`, `text-[12px]`) in dense controls (`TopBar`, `Sidebar`, `StatViz`, map chips)

Implication for planning:
- Swapping `fontFamily.sans` to GT America should not change nominal Tailwind font-size tokens.
- Layout risk is from glyph metrics/x-height differences at tiny sizes; dense controls are most sensitive.
- Planner should include targeted visual QA for:
  - `TopBar` nav and badges
  - Sidebar list chips/meta rows
  - Map pills/legend labels
  - `StatViz` and small numeric labels

## Logo swap context
- New requested logo file exists: `public/icons/NE_Logos_Logomark_Prp.svg`
- Current UI brand mark in `TopBar` is generated from styled text (`NE`) in 3 places.
- Planning should decide:
  - direct `<img src="/icons/NE_Logos_Logomark_Prp.svg" ...>` replacement vs reusable icon component
  - sizing and padding parity with existing 40px/44px badge containers to avoid topbar layout shifts

## Neutral/secondary tint strategy context
- Current UI is heavily slate-based:
  - Approx counts from scan:
    - `brand-*` utility references: ~722
    - `slate-*` utility references: ~2399
- Global neutral defaults currently come from Tailwind slate classes and a few hardcoded hex values in `src/style.css`.
- Planner likely needs a phased strategy:
  1. Tokenize cedar-tinted neutral palette (light + dark)
  2. Map old slate references to new semantic tokens or adjusted utility usage
  3. Keep contrast/compliance checks for text-heavy dense UI

## Suggested planning checkpoints
1. Define token model first: primary, secondary, neutrals, org-location accent, and dark variants.
2. Update Tailwind config and global CSS base variables before component-level edits.
3. Update map organization layers + legend + chips together so map visual language stays coherent.
4. Swap topbar logo in desktop/mobile/menu variants in one pass.
5. Run targeted UI QA on small typography/dense controls after GT America swap.

---

## Planner Update (2026-02-13)

### Re-validated current state
- `tailwind.config.js` still uses:
  - `brand` indigo-like palette (not `#a9abd6`-aligned yet)
  - `fontFamily.sans = Inter`
  - `fontFamily.display = Space Grotesk`
- `index.html` only loads Google `Space Grotesk`; GT America is not wired yet.
- `src/style.css` still uses slate-based body backgrounds and scrollbar hex values.
- Logo is still text badge (`NE`) in `src/react/components/TopBar.tsx` at desktop/mobile/menu variants (`:509`, `:952`, `:1085`).
- Org/location orange is still hardcoded in:
  - `src/react/imperative/layers/organizations.ts`
  - `src/react/imperative/components/orgLegend.ts`
  - `src/react/imperative/categoryChips.ts`
  - `src/react/components/TimeSelectorModal.tsx`
  - `src/react/imperative/mapView.ts` (`DEFAULT_GLOW_COLOR`)
  - `src/react/ReactMapApp.tsx` (`mobilePeekDotStyle`)
- Font migration touchpoints are known (dense `9-12px` UI text and `src/react/components/StatViz.tsx:480` canvas font), but per user clarification this scope is deferred and no font changes are planned in this task.

### Implementation assumptions (unless user says otherwise)
1. Keep class names (`brand-*`, `slate-*`) and retune underlying token values in Tailwind for minimal churn.
2. Cedar DNA in greys means redefining neutral ramp (especially dark grays/blacks) to cedar-tinted values while preserving contrast.
3. Orange refresh scope is location/org-specific UI (map circles/clusters/highlights, org legend, org/time chips, map pills tied to orgs), not all orange usage in unrelated chart palettes.
4. Logo replacement should use the provided asset at `public/icons/NE_Logos_Logomark_Prp.svg` with existing badge footprint preserved to avoid topbar reflow.
5. Font stack remains unchanged for this task (`Inter` + existing `Space Grotesk` usage); GT America migration is explicitly deferred.

### User clarifications (resolved, 2026-02-14)
1. Font changes are out of scope for this task (skip GT America for now).
2. Keep current display/body font behavior as-is.
3. Orange-to-`#fdd6c3` changes apply only to semantic location/org surfaces (not unrelated chart/orange usages).

## High-Level Plan For Implementation Agent

### Slice 1: Theme Tokens Foundation (user-verifiable) — COMPLETED

Goal: ship new core color system with minimal class churn.

Files modified:
- `tailwind.config.js` — replaced `brand` ramp (anchored at `#a9abd6`/400), added `cedar` ramp (anchored at `#0a3023`/950), overrode `slate` ramp with cedar-tinted neutrals
- `src/style.css` — updated 4 scrollbar hex variables (light: slate-200/300, dark: slate-700/800) to match new cedar-tinted slate values

Implementation notes:
- `brand` ramp: 50→950 scale centered on `#a9abd6` at the 400 stop, progressively deeper purples through 950 (`#2a2b48`)
- `cedar` ramp: full 50→950 green scale from light mint (`#f0f7f4`) down to the original cedar `#0a3023` at 950. Available via `cedar-*` utilities for future use.
- `slate` override: every stop (50–950) replaced with cedar-tinted values — subtle warm-green undertone in lights, noticeable forest-dark tint in darks. All ~2400 existing `slate-*` utility references now automatically inherit the cedar DNA with zero class-name changes.
- Body backgrounds (`bg-slate-50` / `dark:bg-slate-950`), dividers (`.divider` uses `bg-slate-200` / `dark:bg-slate-700`), and scrollbars all pick up the new palette automatically.
- `npm run build` passes cleanly.

Acceptance checks:
1. ✅ Light mode backgrounds/greys are warmer/cedar-tinted.
2. ✅ Dark mode blacks/greys show cedar tint.
3. ✅ `npm run build` passes.

### Slice 2: Org/Location Accent Refresh To `#fdd6c3` Family (user-verifiable) — NEXT UP

Goal: replace location/org orange language with peach family consistently.

Status: **Not started**

Context from Slice 1 for the next dev:
- The `slate-*` palette is now cedar-tinted (warm green undertone). All existing `slate-*` class references automatically use the new values — no class renames needed.
- The `brand-*` palette is now Legacy Purple (lavender). `brand-500` = `#8e90c4`, `brand-400` = `#a9abd6`.
- A new `cedar-*` palette is available (50–950) for secondary accents if needed, but Slice 2 focuses on the org/location peach accent, not cedar.
- Tailwind config and style.css are the only files changed so far. No component files have been touched.

Suggested peach ramp (anchored at `#fdd6c3`) for the next dev to use when replacing orange hex values:
- Cluster fill (was `#fed7aa`): `#fdd6c3` (the anchor peach)
- Point/dot color (was `#f97316`): `#e8a990` or similar (darker peach for visibility)
- Highlight fill (was `#fdba74`): `#f5c4ae` (mid peach)
- Cluster count text (was `#9a3412`): `#7a4030` or similar (dark peach-brown for legibility)
- Stroke: keep `#ffffff` for contrast

For Tailwind chip classes (categoryChips, TimeSelectorModal), the orange-* utilities will need to be swapped to custom peach hex or to new utility classes. Consider whether to add a `peach` color ramp to `tailwind.config.js` or use inline `bg-[#fdd6c3]`-style arbitrary values — either approach works, but a named ramp would be more maintainable if there are many stops needed.

Files:
- `src/react/imperative/layers/organizations.ts` — hardcoded hex in MapLibre paint props
- `src/react/imperative/components/orgLegend.ts` — legend dot `backgroundColor`
- `src/react/imperative/categoryChips.ts` — orgs chip + time chip Tailwind classes (orange-*)
- `src/react/components/TimeSelectorModal.tsx` — "Now" button uses orange-* Tailwind classes
- `src/react/imperative/mapView.ts` — `DEFAULT_GLOW_COLOR` hex
- `src/react/ReactMapApp.tsx` — `mobilePeekDotStyle` hex

Tasks:
1. Replace map org cluster/point/highlight colors from orange to a coherent peach ramp anchored at `#fdd6c3`.
2. Update legend dot and org/time chips to matching peach tones in light and dark modes.
3. Update top-of-map org-adjacent pills/dots (glow + mobile peek dot) to same accent family.
4. Preserve map contrast (stroke/text) for visibility at low zoom and clustered states.

Acceptance checks:
1. Org markers and clusters are visually distinct from basemap in both themes.
2. Legend dot/chips/pills match map marker color family.
3. Hover/highlight states remain clear and accessible.

### Slice 3: Logo Swap (user-verifiable)
Goal: replace text badge logo with provided purple logomark.

Files:
- `src/react/components/TopBar.tsx`

Tasks:
1. Replace all three `NE` text badges with image-based mark from `/icons/NE_Logos_Logomark_Prp.svg`.
2. Keep existing container dimensions (`h-10/w-10`, `h-11/w-11`) or equivalent to avoid layout shift.
3. Ensure accessible `alt`/`aria-label` semantics remain intact.

Acceptance checks:
1. Desktop topbar, mobile topbar, and mobile menu all show new logo.
2. No clipping, blurriness, or nav alignment regressions.

## QA Checklist (for implementation PR)
1. Verify light/dark screenshots for:
   - Home map view with orgs visible
   - Sidebar open with dense chips/metadata
   - Topbar desktop + mobile menu
2. Verify map interaction states:
   - Clustered orgs
   - Single org points
   - Highlighted org/cluster
3. Verify semantic scope guardrails:
   - Location/org surfaces use `#fdd6c3` family updates
   - Unrelated orange usages (e.g., non-org chart palettes) remain unchanged
4. Verify no regression in accessibility:
   - Focus rings still visible
   - Text contrast on brand/peach/cedar surfaces remains acceptable
