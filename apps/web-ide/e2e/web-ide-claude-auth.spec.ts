import { expect, test } from '@playwright/test';

const CLAUDE_AUTH_STORAGE_KEY = 'almostnode.webide.claudeAuth.v1';
const CLAUDE_AUTH_CREDENTIALS_PATH = '/home/user/.claude/.credentials.json';
const CLAUDE_AUTH_CONFIG_PATH = '/home/user/.claude/.config.json';
const CLAUDE_LEGACY_CONFIG_PATH = '/home/user/.claude.json';
const MOCK_PASSKEY_STORAGE_KEY = '__almostnode_test_passkey';

async function installWebAuthnPrfMock(page: import('@playwright/test').Page, prfSupported: boolean) {
  await page.addInitScript(({ mockPasskeyStorageKey, prfSupportedFlag }) => {
    function toBytes(value: ArrayBuffer | ArrayBufferView) {
      if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
      }
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }

    function cloneBytes(bytes: Uint8Array) {
      const copy = new Uint8Array(bytes.length);
      copy.set(bytes);
      return copy.buffer;
    }

    function toBase64Url(buffer: ArrayBuffer) {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }
      return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
    }

    async function derivePrf(secret: Uint8Array, input: ArrayBuffer | ArrayBufferView) {
      const inputBytes = toBytes(input);
      const combined = new Uint8Array(secret.length + inputBytes.length);
      combined.set(secret);
      combined.set(inputBytes, secret.length);
      return crypto.subtle.digest('SHA-256', combined);
    }

    class MockPublicKeyCredential {}

    Object.assign(MockPublicKeyCredential, {
      getClientCapabilities: async () => ({ prf: prfSupportedFlag }),
    });

    Object.defineProperty(window, 'PublicKeyCredential', {
      configurable: true,
      value: MockPublicKeyCredential,
    });
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    });

    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: {
        create: async ({ publicKey }: { publicKey: any }) => {
          const rawId = crypto.getRandomValues(new Uint8Array(16));
          const credentialId = toBase64Url(rawId.buffer);
          const secret = crypto.getRandomValues(new Uint8Array(32));
          localStorage.setItem(mockPasskeyStorageKey, JSON.stringify({
            credentialId,
            rawId: Array.from(rawId),
            secret: Array.from(secret),
          }));

          const prfResult = prfSupportedFlag
            ? await derivePrf(secret, publicKey.extensions.prf.eval.first)
            : undefined;

          return {
            id: credentialId,
            rawId: cloneBytes(rawId),
            type: 'public-key',
            response: {},
            getClientExtensionResults: () => prfResult
              ? { prf: { results: { first: prfResult } } }
              : {},
          };
        },
        get: async ({ publicKey }: { publicKey: any }) => {
          const raw = localStorage.getItem(mockPasskeyStorageKey);
          if (!raw) {
            throw new Error('No mock passkey was registered.');
          }

          const stored = JSON.parse(raw);
          const rawId = Uint8Array.from(stored.rawId);
          const secret = Uint8Array.from(stored.secret);
          const credentialId = stored.credentialId as string;
          const prfRequest = publicKey.extensions.prf.evalByCredential[credentialId];
          const prfResult = prfSupportedFlag
            ? await derivePrf(secret, prfRequest.first)
            : undefined;

          return {
            id: credentialId,
            rawId: cloneBytes(rawId),
            type: 'public-key',
            response: {},
            getClientExtensionResults: () => prfResult
              ? { prf: { results: { first: prfResult } } }
              : {},
          };
        },
      },
    });
  }, {
    mockPasskeyStorageKey: MOCK_PASSKEY_STORAGE_KEY,
    prfSupportedFlag: prfSupported,
  });
}

async function loadWebIDE(page: import('@playwright/test').Page) {
  await page.goto('/examples/web-ide-demo.html?marketplace=mock', {
    waitUntil: 'commit',
  });
  await page.waitForFunction(() => Boolean((window as any).__almostnodeWebIDE), {
    timeout: 45000,
  });
}

async function writeClaudeAuth(page: import('@playwright/test').Page, accessToken: string) {
  await page.evaluate(({ accessToken, path }) => {
    const host = (window as any).__almostnodeWebIDE;
    host.container.vfs.writeFileSync(path, JSON.stringify({
      claudeAiOauth: {
        accessToken,
        refreshToken: `refresh-${accessToken}`,
      },
    }));
  }, {
    accessToken,
    path: CLAUDE_AUTH_CREDENTIALS_PATH,
  });
}

async function writeClaudeConfig(page: import('@playwright/test').Page, theme: string) {
  await page.evaluate(({ theme, nestedPath, legacyPath }) => {
    const host = (window as any).__almostnodeWebIDE;
    host.container.vfs.writeFileSync(nestedPath, JSON.stringify({
      theme,
      hasCompletedOnboarding: true,
    }));
    host.container.vfs.writeFileSync(legacyPath, JSON.stringify({
      oauthAccount: {
        emailAddress: 'demo@example.com',
      },
      theme,
      hasCompletedOnboarding: true,
    }));
  }, {
    theme,
    nestedPath: CLAUDE_AUTH_CONFIG_PATH,
    legacyPath: CLAUDE_LEGACY_CONFIG_PATH,
  });
}

async function readVfsFile(page: import('@playwright/test').Page, path: string) {
  return page.evaluate((path) => {
    const host = (window as any).__almostnodeWebIDE;
    if (!host.container.vfs.existsSync(path)) {
      return null;
    }
    return host.container.vfs.readFileSync(path, 'utf8');
  }, path);
}

test.describe('web-ide Claude auth vault', () => {
  test.describe.configure({ mode: 'serial' });

  test('saves detected Claude auth and restores it after refresh', async ({ page }) => {
    await installWebAuthnPrfMock(page, true);
    await loadWebIDE(page);

    await writeClaudeAuth(page, 'alpha');
    await writeClaudeConfig(page, 'dark');
    await page.waitForFunction(() => {
      return (window as any).__almostnodeWebIDE.getClaudeAuthState().bannerMode === 'save';
    });

    await expect(page.locator('#almostnodeClaudeAuthBanner')).toContainText('Claude auth detected');
    await page.locator('#almostnodeClaudeAuthSaveButton').click();

    await page.waitForFunction((storageKey) => {
      return Boolean(localStorage.getItem(storageKey));
    }, CLAUDE_AUTH_STORAGE_KEY);

    const stored = await page.evaluate((storageKey) => {
      return JSON.parse(localStorage.getItem(storageKey) || 'null');
    }, CLAUDE_AUTH_STORAGE_KEY);
    expect(stored.path).toBe(CLAUDE_AUTH_CREDENTIALS_PATH);
    expect(stored.ciphertext).toBeTruthy();
    expect(stored.ciphertext).not.toContain('alpha');

    await loadWebIDE(page);
    await page.waitForFunction(() => {
      return (window as any).__almostnodeWebIDE.getClaudeAuthState().bannerMode === 'unlock';
    });

    await expect(page.locator('#almostnodeClaudeAuthBanner')).toContainText('Saved Claude auth is available');
    await page.locator('#almostnodeClaudeAuthUnlockButton').click();

    await page.waitForFunction((path) => {
      const host = (window as any).__almostnodeWebIDE;
      return host.container.vfs.existsSync(path);
    }, CLAUDE_AUTH_CREDENTIALS_PATH);

    expect(await readVfsFile(page, CLAUDE_AUTH_CREDENTIALS_PATH)).toContain('claudeAiOauth');
    expect(await readVfsFile(page, CLAUDE_AUTH_CREDENTIALS_PATH)).toContain('alpha');
    expect(await readVfsFile(page, CLAUDE_AUTH_CONFIG_PATH)).toContain('"theme":"dark"');
    expect(await readVfsFile(page, CLAUDE_LEGACY_CONFIG_PATH)).toContain('"theme":"dark"');
  });

  test('restores saved auth before Claude launch commands and clears the vault on logout deletion', async ({ page }) => {
    await installWebAuthnPrfMock(page, true);
    await loadWebIDE(page);

    await writeClaudeAuth(page, 'beta');
    await writeClaudeConfig(page, 'light');
    await page.waitForFunction(() => {
      return (window as any).__almostnodeWebIDE.getClaudeAuthState().bannerMode === 'save';
    });
    await page.locator('#almostnodeClaudeAuthSaveButton').click();
    await page.waitForFunction((storageKey) => Boolean(localStorage.getItem(storageKey)), CLAUDE_AUTH_STORAGE_KEY);

    await loadWebIDE(page);
    await page.waitForFunction(() => {
      return (window as any).__almostnodeWebIDE.getClaudeAuthState().bannerMode === 'unlock';
    });
    await page.locator('#almostnodeClaudeAuthDismissButton').click();

    const result = await page.evaluate(async ({ path, configPath }) => {
      const host = (window as any).__almostnodeWebIDE;
      const originalRun = host.container.run.bind(host.container);
      let commandSeen = '';

      host.container.run = async (command: string) => {
        commandSeen = command;
        return { exitCode: 0 };
      };

      try {
        await host.executeHostCommand('npx @anthropic-ai/claude-code');
        return {
          commandSeen,
          restored: host.container.vfs.readFileSync(path, 'utf8'),
          restoredConfig: host.container.vfs.readFileSync(configPath, 'utf8'),
        };
      } finally {
        host.container.run = originalRun;
      }
    }, {
      path: CLAUDE_AUTH_CREDENTIALS_PATH,
      configPath: CLAUDE_LEGACY_CONFIG_PATH,
    });

    expect(result.commandSeen).toBe('npx @anthropic-ai/claude-code');
    expect(result.restored).toContain('claudeAiOauth');
    expect(result.restored).toContain('beta');
    expect(result.restoredConfig).toContain('"theme":"light"');

    await page.evaluate((path) => {
      const host = (window as any).__almostnodeWebIDE;
      host.container.vfs.unlinkSync(path);
    }, CLAUDE_AUTH_CREDENTIALS_PATH);

    await page.waitForFunction((storageKey) => !localStorage.getItem(storageKey), CLAUDE_AUTH_STORAGE_KEY);
  });

  test('leaves Claude login manual when WebAuthn PRF is unsupported', async ({ page }) => {
    await installWebAuthnPrfMock(page, false);
    await loadWebIDE(page);

    await writeClaudeAuth(page, 'gamma');

    await page.waitForTimeout(400);

    const state = await page.evaluate(() => {
      return (window as any).__almostnodeWebIDE.getClaudeAuthState();
    });

    expect(state.supported).toBe(false);
    expect(state.bannerMode).toBe(null);
    expect(await page.locator('#almostnodeClaudeAuthBanner').isVisible()).toBe(false);
    expect(await page.evaluate((storageKey) => localStorage.getItem(storageKey), CLAUDE_AUTH_STORAGE_KEY)).toBeNull();
  });
});
