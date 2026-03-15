import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';

// Auto-detect basepath when running inside almostnode's virtual server.
// The iframe URL may be /__virtual__/{port}/ (localhost) or /repo/__virtual__/{port}/ (GitHub Pages).
// React Router needs everything up to and including the port as its basename.
const basename = typeof window !== 'undefined'
  && window.location.pathname.includes('/__virtual__/')
  ? (window.location.pathname.match(/^(.*\/__virtual__\/\d+)/)?.[1] || '/')
  : '/';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing #root');
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
