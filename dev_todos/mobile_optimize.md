# Mobile Optimization Guide

**Goal:** Make the mobile website behave as app-like as possible in Mobile Safari (iOS) and Chrome (Android).

**Effort:** Medium (1–3 hours for core changes)

---

## Executive Summary

### What You Can't Control (in a normal browser tab)

- **URL bars** (top/bottom) – Browsers control when they expand/collapse. You cannot force them to stay hidden in a regular tab.
- **Pull-to-refresh / rubber-band bounce** – Browser-level gestures. You can mitigate but not fully override in all scenarios.

### What Works: The App-Like Checklist

1. **Lock body scroll, use inner scroll container** – Highest impact change
2. **Use `dvh` + `min-height: svh`** – Stable viewport that expands when URL bars collapse
3. **Add `overscroll-behavior-y: contain`** – Prevents pull-to-refresh (Android) and reduces bounce (iOS)
4. **Apply safe-area insets** – Respects notches and home indicator areas
5. **Auto-scroll nudge on load** – `scrollTo(0,1)` encourages URL bars to minimize
6. **Ship a PWA** – For users who install, removes browser chrome entirely (standalone mode)

---

## Technical Accuracy Check

### Original Conversation Assessment: 85% Accurate

**Correct:**
- ✅ URL bars can't be programmatically hidden in tabs
- ✅ PWA standalone mode removes browser chrome
- ✅ `overscroll-behavior-y` helps prevent pull-to-refresh
- ✅ Dynamic viewport units (`dvh`, `svh`) are essential
- ✅ Safe-area insets for notches/home indicators

**Missing/Clarifications:**
- ⚠️ **iOS pull-to-refresh prevention** requires body lock + inner scroll container, not just `overscroll-behavior` on body
- ⚠️ Use `dvh` + `min-height: svh` **together**, not `dvh` alone
- ⚠️ Apply `env(safe-area-inset-*)` to the **app container**, not body (since body will be fixed)
- ⚠️ URL-bar collapse "hack": `scrollTo(0,1)` on load nudges bars to minimize
- ⚠️ VisualViewport API stabilizes height during keyboard/URL-bar changes

---

## Implementation Plan (Priority Order)

### Phase 1: Core Changes (HIGH Priority)

These provide 80% of the app-like behavior.

#### 1. Update HTML Meta Tags

**File:** `index.html`

```html
<!-- Viewport with safe-area support -->
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />

<!-- PWA manifest -->
<link rel="manifest" href="/manifest.webmanifest" />

<!-- Theme colors (matches browser chrome to app) -->
<meta name="theme-color" content="#0b0b0b" />
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0b0b0b" />
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />

<!-- iOS PWA support -->
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />

<!-- Fallback icons -->
<link rel="icon" href="/icons/icon-192.png" sizes="192x192" />
<link rel="icon" href="/icons/icon-512.png" sizes="512x512" />
```

**Notes:**
- `viewport-fit=cover` extends content into safe areas (required for `env(safe-area-inset-*)`)
- `black-translucent` status bar on iOS makes status bar blend with app
- Update `theme-color` to match your actual app background

#### 2. Create PWA Manifest

**File:** `public/manifest.webmanifest`

```json
{
  "name": "Your App Name",
  "short_name": "App",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#0b0b0b",
  "theme_color": "#0b0b0b",
  "icons": [
    {
      "src": "/icons/icon-192-maskable.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "maskable any"
    },
    {
      "src": "/icons/icon-512-maskable.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable any"
    }
  ],
  "screenshots": [
    {
      "src": "/screenshots/phone-dark.png",
      "sizes": "1179x2556",
      "type": "image/png",
      "form_factor": "narrow"
    }
  ]
}
```

**Icon Requirements:**
- **Maskable icons** – Adapt to Android device shapes (circle, rounded square, etc.)
- Generate at [maskable.app](https://maskable.app)
- Sizes: 192×192, 512×512 minimum
- Optional: Add screenshots for install prompts (enhances Android/Chrome install UI)

#### 3. Body Lock + App Scroll Container (CSS)

**File:** `src/index.css` or your global CSS

```css
/* Lock the body, prevent it from scrolling */
html, body {
  height: 100%;
}

body {
  position: fixed;
  inset: 0;
  overflow: hidden;
  -webkit-text-size-adjust: 100%; /* Prevents iOS zoom on orientation change */
  background: #0b0b0b; /* Match theme-color */
}

/* Make #app the scroll container */
#app {
  height: 100dvh;               /* Expands when URL bars collapse */
  min-height: 100svh;           /* Doesn't shrink below initial viewport */
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
  overflow: auto;
  overscroll-behavior-y: contain;   /* Android: prevents pull-to-refresh */
  -webkit-overflow-scrolling: touch; /* iOS: smooth momentum scrolling */
}
```

**Why This Works:**
- `position: fixed` on body prevents all body-level scrolling and bounce
- `#app` becomes the only scrollable container
- `overscroll-behavior-y: contain` on the scroll container prevents chaining to parent (Android PTR, iOS bounce reduction)
- `dvh` = dynamic viewport height (changes when URL bars show/hide)
- `svh` = small viewport height (stable, doesn't change)

#### 4. Map Container Touch Optimizations

**File:** `src/index.css`

```css
/* MapLibre container gets full gesture control */
.maplibre-container,
.mapboxgl-map {
  height: 100%;
  width: 100%;
  touch-action: none; /* or: pan-x pan-y pinch-zoom if needed */
  -webkit-tap-highlight-color: transparent;
  -webkit-touch-callout: none;
}

/* Scrollable panels (like org list) */
.panel-scroll {
  overflow: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

/* Reduce accidental double-tap zoom on buttons */
button,
[role="button"] {
  touch-action: manipulation;
}
```

**Key Properties:**
- `touch-action: none` – Hands all gestures to MapLibre (no browser pan/zoom interference)
- `-webkit-tap-highlight-color: transparent` – Removes iOS tap highlight flash
- `touch-action: manipulation` on buttons – Prevents 300ms click delay and double-tap zoom

---

### Phase 2: JavaScript Utilities (MEDIUM Priority)

#### 5. Create Viewport Stabilization Hook

**File:** `src/react/hooks/useViewportStabilize.ts`

```typescript
import { useEffect } from "react";

/**
 * Stabilizes mobile viewport by:
 * 1. Nudging URL bars to collapse on load
 * 2. Tracking VisualViewport height for keyboard/URL-bar changes
 */
export function useViewportStabilize() {
  // Track VisualViewport height and expose as CSS var
  useEffect(() => {
    const vv = (window as any).visualViewport;
    
    const updateHeight = () => {
      const h = vv?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--vvh", `${h}px`);
    };
    
    updateHeight();
    vv?.addEventListener("resize", updateHeight);
    window.addEventListener("resize", updateHeight);
    
    return () => {
      vv?.removeEventListener("resize", updateHeight);
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  // One-time nudge to collapse URL bars on load
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (window.scrollY < 1) {
          window.scrollTo(0, 1);
        }
      } catch (err) {
        // Ignore errors
      }
    }, 50);
    
    return () => clearTimeout(timer);
  }, []);
}
```

**Usage in App:**

```typescript
// src/react/ReactMapApp.tsx
import { useViewportStabilize } from './hooks/useViewportStabilize';

function ReactMapApp() {
  useViewportStabilize();
  
  // ... rest of app
}
```

**What This Does:**
- `scrollTo(0, 1)` – Small scroll nudges URL bars to collapse (only needs 1px)
- `--vvh` CSS var – Tracks actual visible height, useful for keyboard-aware layouts
- Use `var(--vvh)` instead of `100dvh` for critical UI that must stay above keyboard

---

### Phase 3: Optional Enhancements (LOW Priority)

#### 6. Hard-Block iOS Bounce (Only If Needed)

**When to use:** If you still see rubber-band bounce at scroll boundaries despite Phase 1.

**File:** `src/react/hooks/usePreventBounce.ts`

```typescript
import { useEffect } from "react";

/**
 * Prevents iOS rubber-band bounce at scroll boundaries.
 * CAUTION: Can interfere with native gestures. Use sparingly.
 */
export function usePreventBounce(containerId: string = "app") {
  useEffect(() => {
    const el = document.getElementById(containerId);
    if (!el) return;

    let startY = 0;
    
    const onTouchStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
    };
    
    const onTouchMove = (e: TouchEvent) => {
      const atTop = el.scrollTop === 0;
      const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop <= 0;
      const currentY = e.touches[0].clientY;
      const deltaY = currentY - startY;
      const goingDown = deltaY > 0;
      const goingUp = deltaY < 0;

      // Prevent bounce when at scroll boundaries
      if ((atTop && goingDown) || (atBottom && goingUp)) {
        e.preventDefault();
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, [containerId]);
}
```

**Risks:**
- Can interfere with iOS edge-swipe-back gesture
- May feel "unnatural" to iOS users
- Only apply to your app container, not the whole page

#### 7. PWA Install Prompts

**Android (beforeinstallprompt):**

```typescript
// src/lib/pwa.ts
let deferredPrompt: any = null;

window.addEventListener("beforeinstallprompt", (e: any) => {
  e.preventDefault();
  deferredPrompt = e;
  // Show your custom "Install App" button/banner here
});

export async function triggerInstall() {
  if (!deferredPrompt) return false;
  
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  
  return outcome === "accepted";
}
```

**iOS (instructional banner):**

```typescript
// Detect if already installed
const isStandalone = 
  window.matchMedia?.("(display-mode: standalone)")?.matches || 
  (window as any).navigator?.standalone === true;

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

if (!isStandalone && isIOS) {
  // Show banner: "Tap Share → Add to Home Screen"
  // Dismiss after first view or user closes
}
```

**UI Guidance:**
- Show install prompt after user engagement (not immediately on load)
- Use localStorage to track dismissals
- Show iOS banner with visual cue (share icon + arrow)
- Android: native prompt via `beforeinstallprompt`

#### 8. Advanced: Keyboard-Aware Layouts

**For forms with sticky footers that need to stay above the keyboard:**

```typescript
useEffect(() => {
  const vv = (window as any).visualViewport;
  if (!vv) return;
  
  const updateKeyboardHeight = () => {
    const offset = window.innerHeight - vv.height;
    document.documentElement.style.setProperty("--keyboard", `${offset}px`);
  };
  
  vv.addEventListener("resize", updateKeyboardHeight);
  return () => vv.removeEventListener("resize", updateKeyboardHeight);
}, []);
```

**CSS:**

```css
.sticky-footer {
  position: fixed;
  bottom: 0;
  padding-bottom: calc(env(safe-area-inset-bottom) + var(--keyboard, 0px));
}
```

---

## Tailwind Integration

**Recommended utility classes:**

```javascript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      minHeight: {
        'screen-svh': '100svh',
      },
      height: {
        'screen-dvh': '100dvh',
        'screen-svh': '100svh',
      },
      padding: {
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
        'safe-left': 'env(safe-area-inset-left)',
        'safe-right': 'env(safe-area-inset-right)',
      },
    },
  },
};
```

**Usage:**

```jsx
<div className="h-screen-dvh min-h-screen-svh pt-safe-top pb-safe-bottom">
  {/* App content */}
</div>
```

---

## Testing Checklist

### Mobile Safari (iOS)

- [ ] URL bar collapses when scrolling down
- [ ] No rubber-band bounce at top of app
- [ ] No pull-to-refresh gesture
- [ ] Content respects safe areas (notch, home indicator)
- [ ] Keyboard doesn't push footer off-screen
- [ ] Map gestures work smoothly (pan, zoom, rotate)
- [ ] "Add to Home Screen" shows app icon and name
- [ ] Installed app opens without URL bar (standalone mode)

### Chrome Android

- [ ] Bottom URL bar minimizes on scroll
- [ ] No pull-to-refresh gesture
- [ ] Theme color matches app background
- [ ] Install prompt appears after engagement
- [ ] Installed app opens in standalone mode
- [ ] Map gestures work smoothly

### Cross-Platform

- [ ] No horizontal scroll/overflow
- [ ] No layout jump when URL bars show/hide
- [ ] Buttons don't have 300ms delay
- [ ] No blue tap highlights on interactive elements
- [ ] Back button works correctly
- [ ] Orientation change doesn't break layout

---

## Common Pitfalls

### 1. Using `100vh` Instead of `dvh`/`svh`

❌ **Bad:**
```css
.app { height: 100vh; } /* Doesn't adjust for URL bars */
```

✅ **Good:**
```css
.app { 
  height: 100dvh;       /* Dynamic - changes with URL bars */
  min-height: 100svh;   /* Stable - doesn't shrink below initial */
}
```

### 2. Applying Safe Areas to Body Instead of App Container

❌ **Bad:**
```css
body {
  position: fixed;
  padding-top: env(safe-area-inset-top); /* Won't work when body is fixed */
}
```

✅ **Good:**
```css
body { position: fixed; }
#app { padding-top: env(safe-area-inset-top); }
```

### 3. Letting the Body Scroll

❌ **Bad:**
```css
body { overflow: auto; } /* Causes bounce, PTR, URL bar instability */
```

✅ **Good:**
```css
body { position: fixed; overflow: hidden; }
#app { overflow: auto; }
```

### 4. Not Using Passive Event Listeners

❌ **Bad:**
```typescript
element.addEventListener('scroll', handler); // Blocks scrolling performance
```

✅ **Good:**
```typescript
element.addEventListener('scroll', handler, { passive: true });
```

Only use `passive: false` when you **must** call `preventDefault()`.

### 5. Disabling User Zoom

❌ **Bad:**
```html
<meta name="viewport" content="user-scalable=no"> <!-- Accessibility violation -->
```

✅ **Good:**
```css
/* Target specific elements instead */
.map-container { touch-action: none; }
```

---

## Performance Considerations

### Minimize Reflows

- Use `transform` and `opacity` for animations (GPU-accelerated)
- Avoid layout thrashing (read then write DOM in batches)
- Use `will-change` sparingly (only for actively animating elements)

### Optimize Touch Handlers

- Use passive listeners by default
- Debounce/throttle scroll handlers if needed
- Avoid heavy computations in touch events

### Lazy Load Off-Screen Content

- Use React `Suspense` and `lazy()` for code splitting
- Defer loading of markers until viewport is stable
- Use `IntersectionObserver` for infinite scroll/lists

---

## Browser Support

| Feature | iOS Safari | Chrome Android | Notes |
|---------|-----------|----------------|-------|
| `dvh`/`svh` | ✅ 15.4+ | ✅ 108+ | Fallback: use `100vh` |
| `overscroll-behavior` | ✅ 16.0+ | ✅ 63+ | iOS: partial support |
| `env(safe-area-inset-*)` | ✅ 11.0+ | ✅ 69+ | Requires `viewport-fit=cover` |
| VisualViewport API | ✅ 13.0+ | ✅ 61+ | |
| PWA manifest | ⚠️ Partial | ✅ Full | iOS: needs Apple meta tags |
| `beforeinstallprompt` | ❌ | ✅ | iOS: manual instructions only |

**Fallback Strategy:**
```css
.app {
  height: 100vh;           /* Fallback */
  height: 100dvh;          /* Modern */
  min-height: 100vh;       /* Fallback */
  min-height: 100svh;      /* Modern */
}
```

---

## Debugging Tips

### Inspect URL Bar Behavior

```typescript
// Log viewport changes
window.visualViewport?.addEventListener('resize', () => {
  console.log({
    visualHeight: window.visualViewport.height,
    innerHeight: window.innerHeight,
    scrollY: window.scrollY,
  });
});
```

### Detect Standalone Mode

```typescript
const isStandalone = 
  window.matchMedia('(display-mode: standalone)').matches ||
  (window.navigator as any).standalone;

console.log('Running in standalone:', isStandalone);
```

### Test Safe Areas

```css
/* Visualize safe areas with colored borders */
#app {
  border-top: env(safe-area-inset-top, 0px) solid red;
  border-bottom: env(safe-area-inset-bottom, 0px) solid blue;
}
```

### Remote Debugging

- **iOS:** Safari > Develop > [Your iPhone]
- **Android:** Chrome DevTools > Remote Devices (`chrome://inspect`)

---

## Resources

### Documentation
- [MDN: safe-area-inset](https://developer.mozilla.org/en-US/docs/Web/CSS/env)
- [MDN: overscroll-behavior](https://developer.mozilla.org/en-US/docs/Web/CSS/overscroll-behavior)
- [Web.dev: Viewport units](https://web.dev/viewport-units/)
- [Apple: Configuring Web Applications](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)

### Tools
- [Maskable.app](https://maskable.app/) – Generate maskable icons
- [PWA Builder](https://www.pwabuilder.com/) – Generate manifest + icons
- [Viewport Simulator](https://viewport-resizer.com/) – Test different viewports

### Testing
- [BrowserStack](https://www.browserstack.com/) – Real device testing
- [LambdaTest](https://www.lambdatest.com/) – Cross-browser testing

---

## Summary: The Winning Pattern

```
┌─────────────────────────────────┐
│ HTML (viewport-fit=cover)       │
├─────────────────────────────────┤
│ <body> (position: fixed)        │
│  ├─ #app (100dvh + safe areas)  │
│  │   ├─ Map (touch-action: none)│
│  │   └─ Panel (overflow: auto)  │
└─────────────────────────────────┘
```

**Key principles:**
1. Lock body → scroll in `#app`
2. Use `dvh` + `min-height: svh`
3. Apply `overscroll-behavior: contain` to scroll container
4. Safe-area insets on app container, not body
5. Nudge URL bars with `scrollTo(0,1)` on load
6. Ship PWA for best experience, but optimize in-tab too

**Effort:** ~1–3 hours for core changes (Phase 1–2).

**Impact:** 📱 Feels 80%+ like a native app without installing.

---

## Next Steps

1. ✅ Add meta tags to `index.html`
2. ✅ Create `manifest.webmanifest`
3. ✅ Update CSS (body lock + app scroll)
4. ✅ Add `useViewportStabilize` hook
5. ✅ Test on real iOS and Android devices
6. 🔄 Iterate based on user feedback
7. 📊 Monitor bounce rate and engagement metrics

**Questions?** Check AGENTS.md or ask in dev chat.
