# 2026-02-18 Handoff: Home Toggle Redirect Sync (Server + Client)

## Context

The `Home: Map` / `Home: Original` toggle in the map app can become out of sync with actual `neighborhoodexplorer.org` redirect behavior.

Current client implementation in `src/react/components/TopBar.tsx`:
- Reads toggle state from localStorage key `ne.homeRedirectDisabled`.
- Writes localStorage immediately on click.
- Navigates to `https://www.neighborhoodexplorer.org/?dwft_disable_homepage_redirect=0|1`.

Observed issue:
- Toggle label can show `Home: Original` while `neighborhoodexplorer.org` still lands on map, or vice versa.
- Re-toggling sometimes "fixes" it temporarily.

Root cause:
- Two sources of truth exist:
  - Client localStorage on `map.neighborhoodexplorer.org`.
  - Server/cookie redirect logic on `www`/apex host.
- These can drift.

## Server Changes Required

### 1) Define One Canonical Preference

Use `dwft_disable_homepage_redirect` as the canonical value everywhere.
- `"0"` => Home is map (redirect enabled to map).
- `"1"` => Home is original site (redirect disabled).

### 2) Persist as Shared Cookie

Whenever preference is set, write cookie with:
- Name: `dwft_disable_homepage_redirect`
- Domain: `.neighborhoodexplorer.org`
- Path: `/`
- Secure: `true`
- SameSite: `Lax`
- Max-Age: 31536000 (or similar long duration)

Note:
- If cookie is `HttpOnly`, client must use API to read state.
- If non-`HttpOnly`, client could read cookie directly, but API read is still preferred.

### 3) Make Redirect Logic Read Only Canonical Cookie

For `https://neighborhoodexplorer.org` request flow:
- Read only `dwft_disable_homepage_redirect`.
- If missing, apply agreed default (recommended default: `"0"` / map home).
- Do not combine with separate host-specific storage.

### 4) Provide Read API for Client Sync

Expose an endpoint accessible from map app origin:
- `GET /api/home-preference`
- Response JSON:
```json
{ "dwft_disable_homepage_redirect": "0" }
```
or
```json
{ "dwft_disable_homepage_redirect": "1" }
```

Requirements:
- Include proper CORS/credentials behavior for `map.neighborhoodexplorer.org` if endpoint is on `www`.
- Return canonical server value derived from cookie/store.

### 5) Provide Write API (Recommended)

Expose:
- `POST /api/home-preference`
- Body:
```json
{ "dwft_disable_homepage_redirect": "0" }
```
or
```json
{ "dwft_disable_homepage_redirect": "1" }
```

Behavior:
- Validate `"0"` or `"1"` only.
- Set canonical shared-domain cookie.
- Return saved value JSON.

## Client Changes After Server Is Ready

### Goal

Remove localStorage as source of truth. Use server preference as source of truth.

### 1) Update State Bootstrapping in `TopBar.tsx`

Current:
- `getNeHomeRedirectState()` reads localStorage.

Target:
- On mount, fetch `GET /api/home-preference`.
- Derive `neHomeRedirectDisabled` from server value:
  - `"1"` => `true` (`Home: Original`)
  - `"0"` => `false` (`Home: Map`)
- Until loaded, keep control disabled or show loading state to avoid showing stale label.

### 2) Update Toggle Click Flow

Current:
- Optimistically writes localStorage, then navigates.

Target:
- On click, call `POST /api/home-preference` with next value.
- Only after success:
  - update React state.
  - navigate/open tab as needed.
- On failure:
  - do not flip label permanently.
  - show non-blocking error toast/message.

### 3) Remove or Deprioritize localStorage

Recommended:
- Remove `NE_HOME_REDIRECT_STORAGE_KEY` usage for this feature.
- Optional short-lived fallback cache is acceptable only as non-authoritative.

### 4) Keep Existing Navigation Behavior

Desired UX can remain:
- Switching to `Home: Original`: open original site in new tab, keep current tab on map host.
- Switching to `Home: Map`: navigate in current tab to URL that enforces map-home preference.

## QA / Acceptance Tests

Run after both server and client updates:

1. Fresh browser session with no cookies/storage:
- Toggle should reflect server default.
- Visiting `neighborhoodexplorer.org` should match default.

2. Set `Home: Original` from map app:
- Toggle label updates correctly.
- Visiting `neighborhoodexplorer.org` lands on original site.
- Hard refresh on map app still shows `Home: Original`.

3. Set `Home: Map` from map app:
- Toggle label updates correctly.
- Visiting `neighborhoodexplorer.org` lands on map app.
- Hard refresh still shows `Home: Map`.

4. Cross-tab consistency:
- Change preference in one tab, refresh another tab, both match server value.

5. Cross-subdomain consistency:
- Behavior is consistent whether user starts on apex, `www`, or `map`.

6. Private window repeat:
- Same deterministic behavior with no stale localStorage dependence.

## Suggested Rollout Order

1. Server ships canonical cookie + read/write endpoints.
2. Client updates to server-authoritative toggle state.
3. QA against checklist above in staging and production.
