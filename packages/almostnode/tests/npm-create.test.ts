import { describe, it, expect } from 'vitest';
import { initializerToCreatePackage } from '../src/shims/child_process';

// `npm create <initializer>` / `npm init <initializer>` runs the package npm
// derives from the initializer name. These are npm's own resolution rules.
describe('initializerToCreatePackage', () => {
  it('maps an unscoped initializer to create-<name>', () => {
    expect(initializerToCreatePackage('vite')).toBe('create-vite');
    expect(initializerToCreatePackage('react-app')).toBe('create-react-app');
  });

  it('maps a scoped initializer to <scope>/create-<name>', () => {
    expect(initializerToCreatePackage('@quick-start/electron')).toBe(
      '@quick-start/create-electron',
    );
    expect(initializerToCreatePackage('@vitejs/app')).toBe('@vitejs/create-app');
  });

  it('maps a bare scope to <scope>/create', () => {
    expect(initializerToCreatePackage('@my-org')).toBe('@my-org/create');
  });

  it('preserves a version/tag suffix', () => {
    expect(initializerToCreatePackage('vite@latest')).toBe('create-vite@latest');
    expect(initializerToCreatePackage('vite@5.0.0')).toBe('create-vite@5.0.0');
    expect(initializerToCreatePackage('@quick-start/electron@1.2.3')).toBe(
      '@quick-start/create-electron@1.2.3',
    );
    expect(initializerToCreatePackage('@my-org@beta')).toBe('@my-org/create@beta');
  });
});
