import React from 'react';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <title>almostnode Next.js starter</title>
      </head>
      <body>
        <nav style={{ background: '#111', padding: '0.75rem 1.5rem', display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, color: '#fff' }}>almostnode</span>
          <a href="/" style={{ color: '#aaa', textDecoration: 'none', fontSize: '0.875rem' }}>Home</a>
          <a href="/about" style={{ color: '#aaa', textDecoration: 'none', fontSize: '0.875rem' }}>About</a>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
