'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

export default function AboutPage() {
  const pathname = usePathname();

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
      <div style={{ background: '#1a1a2e', borderRadius: '1rem', padding: '2rem' }}>
        <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.2em', color: '#888' }}>
          {pathname}
        </span>
        <h1 style={{ fontSize: '2rem', fontWeight: 600, margin: '1rem 0', color: '#fff' }}>About</h1>
        <p style={{ color: '#999', lineHeight: 1.7 }}>
          This is a Next.js App Router project running entirely in the browser using almostnode.
          Navigate between pages using the nav bar above to see client-side routing in action.
        </p>
      </div>
    </div>
  );
}
