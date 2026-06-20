import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ServerBridge, resetServerBridge, getServerBridge } from '../src/server-bridge';
import type { IVirtualServer, InitServiceWorkerOptions, ServerRegistrationMetadata } from '../src/server-bridge';
import { createServer, setServerListenCallback, setServerCloseCallback } from '../src/shims/http';
import { Buffer } from '../src/shims/stream';

function createVirtualServer(body: string): IVirtualServer {
  return {
    listening: true,
    address: () => ({ port: 0, address: '0.0.0.0', family: 'IPv4' }),
    handleRequest: async () => ({
      statusCode: 200,
      statusMessage: 'OK',
      headers: { 'Content-Type': 'text/plain' },
      body: Buffer.from(body),
    }),
  };
}

describe('ServerBridge', () => {
  beforeEach(() => {
    resetServerBridge();
    setServerListenCallback(null);
    setServerCloseCallback(null);
  });

  afterEach(() => {
    resetServerBridge();
  });

  describe('initServiceWorker', () => {
    const originalNavigator = globalThis.navigator;

    afterEach(() => {
      // Restore original navigator
      if (originalNavigator !== undefined) {
        Object.defineProperty(globalThis, 'navigator', {
          value: originalNavigator,
          writable: true,
          configurable: true,
        });
      } else {
        delete (globalThis as any).navigator;
      }
    });

    it('should throw error when Service Workers not supported', async () => {
      // Mock navigator without serviceWorker property
      Object.defineProperty(globalThis, 'navigator', {
        value: {},
        writable: true,
        configurable: true,
      });

      const bridge = new ServerBridge();
      await expect(bridge.initServiceWorker()).rejects.toThrow('Service Workers not supported');
    });

    it('should accept options parameter', async () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {},
        writable: true,
        configurable: true,
      });

      const bridge = new ServerBridge();
      const options: InitServiceWorkerOptions = {
        swUrl: '/custom/sw.js',
      };

      // Will throw because serviceWorker is not in navigator
      await expect(bridge.initServiceWorker(options)).rejects.toThrow('Service Workers not supported');
    });

    it('should accept undefined options', async () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {},
        writable: true,
        configurable: true,
      });

      const bridge = new ServerBridge();
      await expect(bridge.initServiceWorker(undefined)).rejects.toThrow('Service Workers not supported');
    });

    it('should accept empty options object', async () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {},
        writable: true,
        configurable: true,
      });

      const bridge = new ServerBridge();
      await expect(bridge.initServiceWorker({})).rejects.toThrow('Service Workers not supported');
    });
  });

  describe('initServiceWorker with mocked navigator', () => {
    const originalNavigator = globalThis.navigator;

    afterEach(() => {
      // Restore original navigator
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    });

    it('should use default swUrl when not specified', async () => {
      let registeredUrl: string | undefined;

      const mockServiceWorker = {
        controller: true, // SW already controls page
        addEventListener: vi.fn(),
        register: vi.fn().mockImplementation((url: string) => {
          registeredUrl = url;
          return Promise.resolve({
            active: { state: 'activated', addEventListener: vi.fn(), postMessage: vi.fn() },
            waiting: null,
            installing: null,
          });
        }),
      };

      Object.defineProperty(globalThis, 'navigator', {
        value: { serviceWorker: mockServiceWorker },
        writable: true,
        configurable: true,
      });

      // Mock MessageChannel
      const originalMessageChannel = globalThis.MessageChannel;
      globalThis.MessageChannel = vi.fn().mockImplementation(() => ({
        port1: { onmessage: null },
        port2: {},
      })) as any;

      const bridge = new ServerBridge();

      try {
        await bridge.initServiceWorker();
      } catch {
        // Ignore errors from incomplete mock
      }

      expect(mockServiceWorker.register).toHaveBeenCalledWith('/__sw__.js', { scope: '/' });
      expect(registeredUrl).toBe('/__sw__.js');

      globalThis.MessageChannel = originalMessageChannel;
    });

    it('should use custom swUrl when specified', async () => {
      let registeredUrl: string | undefined;

      const mockServiceWorker = {
        controller: true, // SW already controls page
        addEventListener: vi.fn(),
        register: vi.fn().mockImplementation((url: string) => {
          registeredUrl = url;
          return Promise.resolve({
            active: { state: 'activated', addEventListener: vi.fn(), postMessage: vi.fn() },
            waiting: null,
            installing: null,
          });
        }),
      };

      Object.defineProperty(globalThis, 'navigator', {
        value: { serviceWorker: mockServiceWorker },
        writable: true,
        configurable: true,
      });

      // Mock MessageChannel
      const originalMessageChannel = globalThis.MessageChannel;
      globalThis.MessageChannel = vi.fn().mockImplementation(() => ({
        port1: { onmessage: null },
        port2: {},
      })) as any;

      const bridge = new ServerBridge();

      try {
        await bridge.initServiceWorker({ swUrl: '/custom/path/__sw__.js' });
      } catch {
        // Ignore errors from incomplete mock
      }

      expect(mockServiceWorker.register).toHaveBeenCalledWith('/custom/path/__sw__.js', { scope: '/' });
      expect(registeredUrl).toBe('/custom/path/__sw__.js');

      globalThis.MessageChannel = originalMessageChannel;
    });
  });

  describe('getServerBridge', () => {
    it('should return singleton instance', () => {
      const bridge1 = getServerBridge();
      const bridge2 = getServerBridge();
      expect(bridge1).toBe(bridge2);
    });

    it('should accept options on first call', () => {
      const bridge = getServerBridge({ baseUrl: 'http://example.com' });
      expect(bridge.getServerUrl(3000)).toBe('http://example.com/__virtual__/3000');
    });
  });

  describe('server registration', () => {
    it('should register and unregister servers', () => {
      const bridge = new ServerBridge();
      const server = createServer((req, res) => res.end('OK'));

      bridge.registerServer(server, 3000);
      expect(bridge.getServerPorts()).toContain(3000);

      bridge.unregisterServer(3000);
      expect(bridge.getServerPorts()).not.toContain(3000);
    });

    it('should store ownerId metadata and expose it via getServerMetadata', () => {
      const bridge = new ServerBridge();
      bridge.registerServer(createVirtualServer('a'), 3000, '0.0.0.0', {
        framework: 'vite',
        ownerId: 'container-a',
      });

      expect(bridge.getServerMetadata(3000)?.ownerId).toBe('container-a');
      expect(bridge.getServerMetadata(3000)?.framework).toBe('vite');
      expect(bridge.getServerMetadata(9999)).toBeUndefined();
    });

    it('should pass ownerId metadata to server-ready listeners', () => {
      const bridge = new ServerBridge();
      const seen: Array<[number, string, ServerRegistrationMetadata | undefined]> = [];
      bridge.on('server-ready', (...args: unknown[]) => {
        seen.push(args as [number, string, ServerRegistrationMetadata | undefined]);
      });

      bridge.registerServer(createVirtualServer('a'), 3000, '0.0.0.0', { ownerId: 'container-a' });
      bridge.registerServer(createVirtualServer('b'), 3001);

      expect(seen).toHaveLength(2);
      expect(seen[0][0]).toBe(3000);
      expect(seen[0][2]?.ownerId).toBe('container-a');
      expect(seen[1][0]).toBe(3001);
      expect(seen[1][2]).toBeUndefined();
    });

    it('should unregister only servers owned by the given owner', () => {
      const bridge = new ServerBridge();
      bridge.registerServer(createVirtualServer('a1'), 3000, '0.0.0.0', { ownerId: 'container-a' });
      bridge.registerServer(createVirtualServer('a2'), 3001, '0.0.0.0', { ownerId: 'container-a' });
      bridge.registerServer(createVirtualServer('b1'), 3002, '0.0.0.0', { ownerId: 'container-b' });
      bridge.registerServer(createVirtualServer('unowned'), 3003);

      bridge.unregisterServersByOwner('container-a');

      expect(bridge.getServerPorts().sort()).toEqual([3002, 3003]);
    });
  });

  describe('findFreePort', () => {
    it('should return the preferred port when free', () => {
      const bridge = new ServerBridge();
      expect(bridge.findFreePort(3000)).toBe(3000);
    });

    it('should skip past registered ports', () => {
      const bridge = new ServerBridge();
      bridge.registerServer(createVirtualServer('a'), 3000);
      bridge.registerServer(createVirtualServer('b'), 3001);
      bridge.registerServer(createVirtualServer('c'), 3003);

      expect(bridge.findFreePort(3000)).toBe(3002);
      expect(bridge.findFreePort(3003)).toBe(3004);
    });
  });
});
