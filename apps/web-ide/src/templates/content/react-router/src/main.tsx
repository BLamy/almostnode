import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={getAlmostnodeBasePath()}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

function getAlmostnodeBasePath(): string {
  if (typeof window === 'undefined') return '';
  const match = window.location.pathname.match(/^(.*\/__virtual__\/\d+)/);
  return match?.[1] || '';
}
