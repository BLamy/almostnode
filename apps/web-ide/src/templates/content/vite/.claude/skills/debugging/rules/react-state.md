# React State & Effects

## useEffect Data Fetching Race Condition

The most common async bug. If a component unmounts before a fetch completes, it tries to setState on an unmounted component — or worse, sets stale data.

**Fix: Use an `ignore` flag in the cleanup function.**

```tsx
useEffect(() => {
  let ignore = false;

  async function fetchData() {
    const result = await db.select().from(todos);
    if (!ignore) {
      setTodos(result);
    }
  }

  fetchData();
  return () => { ignore = true; };
}, []);
```

**Why this works:** The cleanup runs when the component unmounts OR when deps change. Setting `ignore = true` prevents the stale callback from updating state.

## Stale Closures

When a callback references a state variable, it captures the value at render time. If the callback runs later, it uses the old value.

**Symptom:** Click handler or timer uses outdated state.

**Fix: Use functional updaters.**

```tsx
// BAD — captures stale `count`
const increment = () => setCount(count + 1);

// GOOD — always uses latest value
const increment = () => setCount(prev => prev + 1);
```

This applies to **any** setter called from an async context, timer, or event listener registered in useEffect.

## Dirty Flag Pattern (Forms with Autosave)

When a form autosaves on a timer, you need to track whether the user has made changes since the last save. Without this, you get infinite save loops.

```tsx
const [formData, setFormData] = useState(initialData);
const [isDirty, setIsDirty] = useState(false);

const handleChange = (field: string, value: string) => {
  setFormData(prev => ({ ...prev, [field]: value }));
  setIsDirty(true);
};

useEffect(() => {
  if (!isDirty) return;

  const timer = setTimeout(async () => {
    await saveToDatabase(formData);
    setIsDirty(false);
  }, 1000);

  return () => clearTimeout(timer);
}, [formData, isDirty]);
```

**Key:** The `isDirty` flag prevents the save from re-triggering when `setIsDirty(false)` causes a re-render.

## useEffect Feedback Loops

**Symptom:** Component re-renders endlessly, browser freezes, or infinite network requests.

**Cause:** useEffect updates state that's in its own dependency array.

```tsx
// BAD — infinite loop
useEffect(() => {
  setItems(items.filter(i => i.active));
}, [items]); // items changes → effect runs → items changes → ...

// GOOD — compute during render, no effect needed
const activeItems = useMemo(() => items.filter(i => i.active), [items]);
```

**Rule:** If you can compute a value from existing state/props, use `useMemo` — don't put it in useEffect + useState.

## Key Props in Lists

**Symptom:** List items show wrong data after reorder/delete, or inputs lose focus.

```tsx
// BAD — index keys break on reorder/delete
{items.map((item, i) => <Item key={i} data={item} />)}

// GOOD — stable unique keys
{items.map(item => <Item key={item.id} data={item} />)}
```

## Diagnosis Checklist

When debugging a React state bug, ask these in order:

1. **Is the component re-rendering?** Add a `console.log` at the top of the component. If it's not re-rendering, the state update isn't triggering a render (wrong state variable, or mutating instead of replacing).
2. **Is the effect running?** Add a `console.log` inside the useEffect. If it's not running, check the dependency array.
3. **Is the closure stale?** If the effect runs but uses old values, you have a stale closure. Use functional updaters or add the dependency.
4. **Is there a feedback loop?** If the component re-renders infinitely, an effect is updating its own dependencies.
5. **Are keys stable?** If list items misbehave, check the `key` prop.
