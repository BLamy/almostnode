import { createContainer } from '../src/index';

const container = createContainer();

Object.assign(window as Window & { __almostnodeAwsSmoke?: unknown }, {
  __almostnodeAwsSmoke: {
    container,
  },
});

const status = document.getElementById('status');
if (status) {
  status.textContent = 'ready';
}
