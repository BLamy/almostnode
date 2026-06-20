import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

const basepath = typeof window !== 'undefined'
  && window.location.pathname.includes('/__virtual__/')
  ? (window.location.pathname.match(/^(.*\/__virtual__\/\d+)/)?.[1] || '')
  : '';

export function getRouter() {
  return createRouter({
    routeTree,
    basepath,
    defaultPreload: 'intent',
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
