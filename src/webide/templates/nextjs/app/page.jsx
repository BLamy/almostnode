'use client';

import React, { useState } from 'react';

export default function HomePage() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
      <div style={{ background: '#1a1a2e', borderRadius: '1rem', padding: '2rem', marginBottom: '1.5rem' }}>
        <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.2em', color: '#888' }}>
          Next.js App Router
        </span>
        <h1 style={{ fontSize: '2.5rem', fontWeight: 600, margin: '1rem 0', color: '#fff' }}>
          Next.js running natively in the browser.
        </h1>
        <p style={{ color: '#999', lineHeight: 1.7 }}>
          Full App Router support with file-based routing, layouts, and client components.
          Edit the files and see changes reflected instantly.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
          <button
            onClick={() => setCount(c => c + 1)}
            style={{ padding: '0.6rem 1.2rem', borderRadius: '0.5rem', border: 'none', background: '#f97316', color: '#fff', cursor: 'pointer', fontWeight: 500 }}
          >
            Count: {count}
          </button>
          <button
            onClick={() => setCount(0)}
            style={{ padding: '0.6rem 1.2rem', borderRadius: '0.5rem', border: '1px solid #333', background: 'transparent', color: '#ccc', cursor: 'pointer' }}
          >
            Reset
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
        {[
          { title: 'App Router', detail: 'File-based routing with layouts and nested routes.' },
          { title: 'Client Components', detail: 'Interactive components with useState and event handlers.' },
          { title: 'Hot Reload', detail: 'Edit files and see changes reflected without losing state.' },
        ].map(item => (
          <div key={item.title} style={{ background: '#1a1a2e', borderRadius: '0.75rem', padding: '1.25rem' }}>
            <p style={{ fontWeight: 600, color: '#fff', margin: 0 }}>{item.title}</p>
            <p style={{ color: '#888', fontSize: '0.875rem', marginTop: '0.5rem', lineHeight: 1.5 }}>{item.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
