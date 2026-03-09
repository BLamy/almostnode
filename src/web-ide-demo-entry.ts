import { WebIDEHost } from './webide/workbench-host';

const workbench = document.getElementById('webideWorkbench');

if (!(workbench instanceof HTMLElement)) {
  throw new Error('Missing #webideWorkbench');
}

const params = new URLSearchParams(window.location.search);
const marketplaceMode = params.get('marketplace') === 'mock' ? 'fixtures' : 'open-vsx';

void WebIDEHost.bootstrap({
  elements: {
    workbench,
  },
  marketplaceMode,
});
