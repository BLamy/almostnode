---
name: web-animation-design
description: "Design and implement web animations that feel natural and purposeful. Use this skill proactively whenever the user asks questions about animations, motion, easing, timing, duration, springs, transitions, or animation performance. This includes questions about how to animate specific UI elements, which easing to use, animation best practices, or accessibility considerations for motion. Triggers on: easing, ease-out, ease-in, ease-in-out, cubic-bezier, bounce, spring physics, keyframes, transform, opacity, fade, slide, scale, hover effects, microinteractions, Framer Motion, React Spring, GSAP, CSS transitions, entrance/exit animations, page transitions, stagger, will-change, GPU acceleration, prefers-reduced-motion, modal/dropdown/tooltip/popover/drawer animations, gesture animations, drag interactions, button press feel, feels janky, make it smooth."
---

# Web Animation Design

Create animations that feel natural, purposeful, and performant. Based on Emil Kowalski's animations.dev principles adapted to this project's Tailwind token system.

## This Project's Animation Tokens

All tokens are defined in `tailwind.config.ts` and backed by CSS custom properties in `src/index.css`.

### Easing Classes

| Tailwind class | CSS variable | Curve |
|----------------|-------------|-------|
| `ease-out-quad` | `--ease-out-quad` | Gentle deceleration |
| `ease-out-cubic` | `--ease-out-cubic` | Medium deceleration |
| `ease-out-quart` | `--ease-out-quart` | **Default** — sharp deceleration, feels snappy |
| `ease-out-quint` | `--ease-out-quint` | Very sharp deceleration |
| `ease-out-expo` | `--ease-out-expo` | Extreme — use for dramatic entrances |
| `ease-out-circ` | `--ease-out-circ` | Circular — smooth, slightly different feel |
| `ease-in-out-quad` | `--ease-in-out-quad` | Gentle symmetric |
| `ease-in-out-cubic` | `--ease-in-out-cubic` | **Default for movement** — balanced |
| `ease-in-out-quart` | `--ease-in-out-quart` | Snappier symmetric |
| `ease-in-out-quint` | `--ease-in-out-quint` | Very snappy symmetric |
| `ease-in-out-expo` | `--ease-in-out-expo` | Dramatic symmetric |
| `ease-in-out-circ` | `--ease-in-out-circ` | Circular symmetric |

### Duration Classes

| Tailwind class | Value | When to use |
|----------------|-------|-------------|
| `duration-micro` | 100ms | Hover color, focus ring, opacity toggle |
| `duration-fast` | 150ms | Small feedback, icon swap, checkbox |
| `duration-standard` | 200ms | Default entrance — modal content, dropdown |
| `duration-modal` | 250ms | Modal/drawer backdrop and container |
| `duration-slow` | 300ms | Page transitions, complex stagger sequences |
| `duration-exit` | 150ms | All exits — 20% faster than entrance |

### Animation Shorthand Classes

Entrance (200ms, ease-out-quart):
- `animate-fade-in` — Opacity 0→1
- `animate-scale-in` — Scale 0.95→1 + fade
- `animate-slide-in-up` — TranslateY 8px→0 + fade
- `animate-slide-in-down` — TranslateY -8px→0 + fade
- `animate-slide-in-left` — TranslateX -8px→0 + fade
- `animate-slide-in-right` — TranslateX 8px→0 + fade

Exit (150ms, ease-out-quart):
- `animate-fade-out` — Opacity 1→0
- `animate-scale-out` — Scale 1→0.95 + fade
- `animate-slide-out-down` — TranslateY 0→8px + fade
- `animate-slide-out-up` — TranslateY 0→-8px + fade

## Easing Decision Flowchart

```
What is the element doing?
├─ Entering the screen (appearing)
│  └─ Use ease-out-* (element decelerates into resting position)
│     ├─ Default: ease-out-quart
│     ├─ Subtle: ease-out-cubic
│     └─ Dramatic: ease-out-expo
├─ Leaving the screen (disappearing)
│  └─ Use ease-out-* + duration-exit (same family, shorter duration)
├─ Moving on screen (repositioning, resizing)
│  └─ Use ease-in-out-* (accelerate then decelerate)
│     ├─ Default: ease-in-out-cubic
│     └─ Snappy: ease-in-out-quart
├─ Hover / focus micro-interaction
│  └─ Use CSS ease (built-in) + duration-micro
└─ Spring / bouncy feel
   └─ Use Framer Motion or React Spring (CSS can't do real springs)
```

## Duration Guidelines

| Frequency | Guideline |
|-----------|-----------|
| 100+ times/day (button click, toggle) | ≤100ms or no animation |
| 10-100 times/day (open modal, nav) | 150-250ms |
| 1-10 times/day (page transition) | 200-300ms |
| Once per session (onboarding) | 300-500ms |

**Exit rule**: Exits should be ~20% faster than entrances. The `duration-exit` token (150ms) pairs with `duration-standard` (200ms).

**Distance rule**: Larger movement distance = slightly longer duration. A full-screen slide needs more time than an 8px nudge.

## Common Recipes

### Dropdown / Popover
```html
<div class="animate-scale-in origin-top">
  <!-- dropdown content -->
</div>
```

### Toast Notification
```html
<div class="animate-slide-in-right">
  <!-- toast content -->
</div>
```

### Modal
```html
<!-- Backdrop -->
<div class="animate-fade-in duration-modal">
<!-- Panel -->
<div class="animate-scale-in duration-modal">
```

### Tooltip
```html
<div class="animate-fade-in duration-fast">
```

### Card Hover (use inline transition)
```html
<div class="transition-transform duration-micro ease-out-quad hover:-translate-y-0.5">
```

### Button Press Feel
```html
<button class="transition-transform duration-micro ease-out-quad active:scale-[0.97]">
```

### Staggered List (use inline style for delay)
```tsx
{items.map((item, i) => (
  <div
    key={item.id}
    className="animate-slide-in-up"
    style={{ animationDelay: `${i * 50}ms`, animationFillMode: 'backwards' }}
  />
))}
```

### Hover Flicker Fix
When an animated element moves out from under the cursor during hover, it can cause flicker. Fix by wrapping:
```html
<div class="group">  <!-- hover target (stays still) -->
  <div class="transition-transform group-hover:-translate-y-1">
    <!-- moving content -->
  </div>
</div>
```

### Transform Origin for Popovers
Set `origin-*` to match where the popover opens from:
- Dropdown from top: `origin-top`
- Context menu from click: `origin-top-left`
- Tooltip above: `origin-bottom`

## Performance Rules

1. **Only animate `transform` and `opacity`** — these are GPU-composited, skip layout and paint
2. **Never animate** `width`, `height`, `top`, `left`, `margin`, `padding`, `border-width`, or `box-shadow` (use `filter: drop-shadow` or scale tricks instead)
3. **`will-change`** — Add `will-change-transform` only on elements about to animate. Remove after animation ends. Don't blanket-apply.
4. **Composite layers** — Each `will-change` or `transform: translateZ(0)` creates a GPU layer. Too many = memory issues on mobile.
5. **Test on low-end** — Use Chrome DevTools → Performance panel → CPU 4x slowdown to catch jank.

## Accessibility

**Global kill switch**: `prefers-reduced-motion: reduce` is handled in `src/index.css` — all animation/transition durations collapse to `0.01ms`. This means:
- `animationend` / `transitionend` events still fire (so JS logic doesn't break)
- No per-component `@media` queries needed
- Users who prefer reduced motion see instant state changes

**Content that conveys meaning through motion** (progress indicators, loading spinners) should still be visible — the reduced-motion rule handles timing, but ensure the static state is still informative.
