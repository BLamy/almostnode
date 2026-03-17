# Forms & Input Issues

## Controlled vs Uncontrolled Components

Mixing controlled and uncontrolled patterns is the most common form bug.

**Symptom:** Warning in console: "A component is changing an uncontrolled input to be controlled."

```tsx
// BAD — starts as uncontrolled (undefined), becomes controlled
const [name, setName] = useState();
<input value={name} onChange={e => setName(e.target.value)} />

// GOOD — starts as controlled (empty string)
const [name, setName] = useState('');
<input value={name} onChange={e => setName(e.target.value)} />
```

**Rule:** If you use `value`, always initialize state with a string (or appropriate type), never `undefined`.

## Form Submission Not Working

### Missing `type="submit"` on button
```tsx
// BAD — button doesn't submit the form
<form onSubmit={handleSubmit}>
  <button>Submit</button>  {/* type defaults to "submit" in HTML, but... */}
</form>

// Some UI libraries override the default. Be explicit:
<button type="submit">Submit</button>
```

### Missing `preventDefault`
```tsx
// BAD — form submits, page reloads, state is lost
const handleSubmit = () => {
  saveData(formData);
};

// GOOD — prevent default form behavior
const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault();
  saveData(formData);
};
```

### onClick vs onSubmit
```tsx
// BAD — bypasses form validation
<form>
  <input required />
  <button onClick={handleSubmit}>Save</button>
</form>

// GOOD — triggers HTML validation, then calls handler
<form onSubmit={handleSubmit}>
  <input required />
  <button type="submit">Save</button>
</form>
```

## Input Value Not Updating

**Symptom:** Typing in input field does nothing. Characters don't appear.

```tsx
// BAD — value is set but never updated
<input value={name} />

// GOOD — include onChange handler
<input value={name} onChange={e => setName(e.target.value)} />
```

## Validation Timing

- **On submit:** Validate all fields when the form is submitted. Best for simple forms.
- **On blur:** Validate a field when the user leaves it. Good for complex forms.
- **On change:** Validate as the user types. Only use for real-time feedback (e.g., password strength).

```tsx
// On-blur validation
const [error, setError] = useState('');
<input
  value={email}
  onChange={e => setEmail(e.target.value)}
  onBlur={() => {
    if (!email.includes('@')) setError('Invalid email');
    else setError('');
  }}
/>
{error && <p className="text-red-500">{error}</p>}
```

## Diagnosis Checklist

1. **Console warnings** — "Changing uncontrolled to controlled" = initialization bug
2. **Is onChange wired up?** — No onChange = input won't update
3. **Is the form using onSubmit?** — onClick bypasses HTML validation
4. **Is preventDefault called?** — Without it, the page reloads
5. **Is state initialized correctly?** — `useState()` vs `useState('')`
