# Component Rendering Issues

## Blank Page / Nothing Renders

The most common cause of a blank page is an unhandled error in a parent component. React stops rendering the entire tree when any component throws.

### Diagnosis Steps

```bash
playwright-cli console error     # This will almost always reveal the cause
playwright-cli snapshot          # Is the DOM actually empty, or just invisible?
```

### Common Causes

**1. Route not registered**
```tsx
// Forgot to add the route in App.tsx
<Route path="/users" element={<Users />} />
```

**2. Wrong import path**
```tsx
// Case-sensitive on Linux/Vite — works locally, breaks in build
import { Users } from './pages/users';  // BAD — file is Users.tsx
import { Users } from './pages/Users';  // GOOD
```

**3. Wrong export type**
```tsx
// Page uses named export but route expects default
export function Users() { ... }        // named export
// but App.tsx does:
import Users from './pages/Users';      // expects default export
```

**4. Error in parent component**
If a parent component throws during render, none of its children render. The console error will show which component and line.

## Conditional Rendering Bugs

**Empty array is truthy — but renders nothing.**

```tsx
// BAD — shows "items" header even when list is empty
{items && <h2>Items</h2>}
{items.map(item => <Item key={item.id} {...item} />)}

// GOOD — check length
{items.length > 0 && <h2>Items</h2>}
{items.map(item => <Item key={item.id} {...item} />)}
```

**Number 0 renders as text.**

```tsx
// BAD — renders "0" on screen when count is 0
{count && <Badge>{count}</Badge>}

// GOOD — explicit boolean
{count > 0 && <Badge>{count}</Badge>}
```

## Component Mounts but Shows Wrong Content

**Symptom:** Component renders but shows stale or wrong data.

1. **Check the data source** — Is the query correct? Is it filtering properly?
2. **Check the props** — Is the parent passing the right data?
3. **Check the key** — If using a list, are keys stable? (See [react-state.md](react-state.md))

```bash
# Verify what data the component is receiving
playwright-cli eval "JSON.stringify(document.querySelector('[data-testid=user-list]')?.textContent)"
```

## CSS Rendering Issues (Component Exists but Invisible)

If `playwright-cli snapshot` shows the component in the accessibility tree but `playwright-cli screenshot` shows nothing:

- Check for `display: none`, `visibility: hidden`, `opacity: 0`
- Check for `height: 0` or `overflow: hidden` on a parent
- Check for `position: absolute` with off-screen coordinates
- Check for z-index issues (element behind another)

## Diagnosis Checklist

1. **Console errors first** — 90% of rendering issues show up here
2. **Snapshot** — Is the element in the DOM at all?
3. **Screenshot** — Is it visible? Could it be behind something?
4. **Check the route** — Is the URL correct? Is the route registered?
5. **Check imports** — Case-sensitive? Default vs named export?
