import { expect, test, type Page } from "@playwright/test";

async function seedStoredWorkbenchExtensions(
  page: Page,
  entries: unknown[],
) {
  await page.goto("/", {
    waitUntil: "domcontentloaded",
  });

  await page.evaluate(async (storedEntries) => {
    const request = indexedDB.open("vscode-web-db", 3);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onupgradeneeded = () => {
        const database = request.result;
        for (const store of [
          "vscode-userdata-store",
          "vscode-logs-store",
          "vscode-filehandles-store",
        ]) {
          if (!database.objectStoreNames.contains(store)) {
            database.createObjectStore(store);
          }
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("vscode-userdata-store", "readwrite");
      transaction
        .objectStore("vscode-userdata-store")
        .put(JSON.stringify(storedEntries), "/User/extensions.json");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });

    db.close();
  }, entries);
}

async function loadWebIDE(page: Page) {
  await page.goto("/examples/web-ide-demo.html?marketplace=mock", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    () =>
      Boolean((window as { __almostnodeWebIDE?: unknown }).__almostnodeWebIDE),
    {
      timeout: 90000,
    },
  );
}

async function expectPreviewApp(page: Page) {
  await expect(page.locator("#webidePreviewStatus")).toContainText(
    "/__virtual__/3000/",
    {
      timeout: 30000,
    },
  );
  await expect(page.locator("#webidePreview")).toBeVisible();
  await expect(page.locator(".almostnode-preview-surface__empty")).toBeHidden();

  const previewFrame = page.frameLocator("#webidePreview");
  await expect(
    previewFrame.getByRole("heading", { name: "Project ready!" }),
  ).toBeVisible({
    timeout: 30000,
  });

  return previewFrame;
}

async function waitForWorkbenchTheme(page: Page, theme: "light" | "dark") {
  await page.waitForFunction(
    (expectedTheme) => {
      return document.documentElement.dataset.almostnodeTheme === expectedTheme;
    },
    theme,
    { timeout: 30000 },
  );
}

async function readWorkbenchThemeSnapshot(page: Page) {
  return page.evaluate(() => {
    const host = (
      window as {
        __almostnodeWebIDE?: {
          terminal?: { options?: { theme?: { background?: string } } };
        };
      }
    ).__almostnodeWebIDE;
    const parseLuminance = (value: string) => {
      const channels = value.match(/\d+/g)?.slice(0, 3).map(Number) ?? [];
      return channels.reduce((sum, channel) => sum + channel, 0);
    };
    const previewToolbar = document.querySelector(
      ".almostnode-preview-surface__toolbar",
    ) as HTMLElement | null;
    const keychain = document.querySelector(
      ".almostnode-keychain-sidebar",
    ) as HTMLElement | null;

    return {
      rootTheme: document.documentElement.dataset.almostnodeTheme ?? "",
      colorScheme: document.documentElement.style.colorScheme,
      previewToolbarBackground: previewToolbar
        ? getComputedStyle(previewToolbar).backgroundColor
        : "",
      previewToolbarLuminance: previewToolbar
        ? parseLuminance(getComputedStyle(previewToolbar).backgroundColor)
        : -1,
      keychainBackground: keychain
        ? getComputedStyle(keychain).backgroundColor
        : "",
      keychainLuminance: keychain
        ? parseLuminance(getComputedStyle(keychain).backgroundColor)
        : -1,
      terminalThemeBackground: host?.terminal?.options?.theme?.background ?? "",
    };
  });
}

async function showSidebarTab(page: Page, name: "OpenCode") {
  await page.getByRole("tab", { name, exact: true }).click();
}

async function openOpenCodeSidebar(page: Page) {
  await showSidebarTab(page, "OpenCode");
  await expect(page.locator(".almostnode-opencode-panel-host")).toBeVisible();
  await page.waitForFunction(
    () =>
      Boolean(
        (window as { __OPENCODE_BROWSER_TUI__?: unknown })
          .__OPENCODE_BROWSER_TUI__,
      ),
    {
      timeout: 3 * 60 * 1000,
    },
  );
  await expect(page.locator(".almostnode-opencode-host")).toBeVisible({
    timeout: 120000,
  });
  await page.waitForTimeout(500);
}

async function readSidebarLayoutSnapshot(page: Page) {
  return page.evaluate(() => {
    const measure = (selector: string) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        return null;
      }

      const rect = element.getBoundingClientRect();
      return {
        selector,
        rect: {
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        },
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight,
      };
    };

    return {
      sidebarPane: measure(".part.sidebar .pane-body"),
      sidebarScrollable: measure(
        ".part.sidebar .pane-body > .monaco-scrollable-element",
      ),
      openCodePanelHost: measure(".almostnode-opencode-panel-host"),
      openCodeSurface: measure(".almostnode-opencode-surface"),
      openCodeStatusRow: measure(".almostnode-opencode-surface__status-row"),
      openCodeBody: measure(".almostnode-opencode-surface__body"),
      openCodeTerminal: measure(
        '.almostnode-opencode-surface__terminal:not([hidden])',
      ),
      openCodeHost: measure(".almostnode-opencode-host"),
    };
  });
}

test.describe("web-ide workbench", () => {
  test("loads without missing Monaco extension assets or language-service errors", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const failingResponses: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    page.on("response", (response) => {
      if (response.status() >= 400) {
        failingResponses.push(
          `${response.status()} ${new URL(response.url()).pathname}`,
        );
      }
    });

    await loadWebIDE(page);
    await page.waitForTimeout(1000);

    const tokenizationState = await page.evaluate(() => {
      const tokenClasses = Array.from(
        document.querySelectorAll(".monaco-editor .view-line span"),
      )
        .map((node) => node.className)
        .filter((value) => value.includes("mtk"));

      return {
        tokenClassCount: tokenClasses.length,
      };
    });

    expect(
      failingResponses.filter((entry) => {
        return (
          entry.endsWith("/favicon.ico") ||
          entry.endsWith("/resources/package.nls.json") ||
          entry.endsWith("/resources/dark_modern.json")
        );
      }),
    ).toEqual([]);

    expect(
      consoleErrors.filter((entry) => {
        return (
          entry.includes(
            "Unknown language in `contributes.grammars.language`",
          ) ||
          entry.includes(
            "LanguageStatusService.getLanguageStatus is not supported",
          ) ||
          entry.includes("WebAssembly.instantiate(): expected magic word") ||
          entry.includes(
            "Unable to load extension-file://vscode.theme-defaults/extension/themes/dark_modern.json",
          )
        );
      }),
    ).toEqual([]);
    expect(tokenizationState.tokenClassCount).toBeGreaterThan(0);
  });

  test("drops persisted JS/TS language overrides before booting the workbench", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    await seedStoredWorkbenchExtensions(page, [
      {
        identifier: { id: "ms-vscode.vscode-typescript-next" },
        version: "5.3.20230808",
        location: {
          $mid: 1,
          external:
            "file:///.almostnode-vscode/extensions/ms-vscode.vscode-typescript-next-5.3.20230808",
          path: "/.almostnode-vscode/extensions/ms-vscode.vscode-typescript-next-5.3.20230808",
          scheme: "file",
        },
        manifest: {
          name: "vscode-typescript-next",
          publisher: "ms-vscode",
          version: "5.3.20230808",
          engines: { vscode: "*" },
          contributes: {
            languages: [{ id: "javascript" }, { id: "typescript" }],
            grammars: [
              {
                language: "javascript",
                path: "./syntaxes/JavaScript.tmLanguage.json",
                scopeName: "source.js",
              },
              {
                language: "typescript",
                path: "./syntaxes/TypeScript.tmLanguage.json",
                scopeName: "source.ts",
              },
            ],
          },
        },
      },
    ]);

    await loadWebIDE(page);
    await page.waitForTimeout(1000);

    const state = await page.evaluate(async () => {
      const host = (
        window as {
          __almostnodeWebIDE: {
            listInstalledExtensions(): Promise<
              Array<{ id: string; enabled: boolean }>
            >;
          };
        }
      ).__almostnodeWebIDE;

      const tokenClassCount = Array.from(
        document.querySelectorAll(".monaco-editor .view-line span"),
      )
        .map((node) => node.className)
        .filter((value) => value.includes("mtk")).length;

      return {
        installed: await host.listInstalledExtensions(),
        tokenClassCount,
      };
    });

    expect(
      consoleErrors.filter((entry) => {
        return (
          entry.includes("TypeScript.tmLanguage.json") ||
          entry.includes("JavaScript.tmLanguage.json") ||
          entry.includes("WebAssembly.instantiate(): expected magic word")
        );
      }),
    ).toEqual([]);
    expect(state.installed).toEqual([]);
    expect(state.tokenClassCount).toBeGreaterThan(0);
  });

  test("boots the workbench and searches live VirtualFS content", async ({
    page,
  }) => {
    await loadWebIDE(page);

    await expect(page.locator(".monaco-workbench")).toBeVisible();
    await expect(page.locator("#webideTerminal")).toBeVisible();
    await expect(page.locator(".almostnode-preview-surface")).toBeVisible();
    await expect(page.locator("#webideFilesTree")).toBeVisible();

    const placement = await page.evaluate(() => {
      const preview = document.querySelector(".almostnode-preview-surface");
      const terminal = document.getElementById("webideTerminal");
      const filesTree = document.getElementById("webideFilesTree");
      return {
        previewInEditorGroup: Boolean(
          preview?.closest(".editor-group-container"),
        ),
        terminalInPanel: Boolean(terminal?.closest(".panel")),
        filesTreeInSidebar: Boolean(filesTree?.closest(".sidebar")),
      };
    });

    expect(placement.previewInEditorGroup).toBe(true);
    expect(placement.terminalInPanel).toBe(true);
    expect(placement.filesTreeInSidebar).toBe(true);

    const state = await page.evaluate(async () => {
      const host = (
        window as {
          __almostnodeWebIDE: {
            container: {
              vfs: {
                writeFileSync(path: string, value: string): void;
                readdirSync(path: string): string[];
              };
            };
            searchWorkspaceText(pattern: string): Promise<string[]>;
          };
        }
      ).__almostnodeWebIDE;

      host.container.vfs.writeFileSync(
        "/project/src/search-fixture.ts",
        'export const marker = "signal-search";\n',
      );

      return {
        entries: host.container.vfs.readdirSync("/project/src"),
        matches: await host.searchWorkspaceText("signal-search"),
      };
    });

    expect(state.entries).toContain("search-fixture.ts");
    expect(state.matches).toContain("/project/src/search-fixture.ts");
  });

  test("keeps the OpenCode sidebar surface edge-to-edge without overflow", async ({
    page,
  }) => {
    test.setTimeout(6 * 60 * 1000);
    await loadWebIDE(page);

    await openOpenCodeSidebar(page);
    const layout = await readSidebarLayoutSnapshot(page);

    expect(layout.sidebarScrollable).not.toBeNull();
    expect(layout.openCodePanelHost).not.toBeNull();
    expect(layout.openCodeSurface).not.toBeNull();
    expect(layout.openCodeStatusRow).not.toBeNull();
    expect(layout.openCodeBody).not.toBeNull();
    expect(layout.openCodeTerminal).not.toBeNull();
    expect(layout.openCodeHost).not.toBeNull();

    expect(layout.openCodePanelHost!.rect.right).toBeLessThanOrEqual(
      layout.sidebarScrollable!.rect.right + 1,
    );
    expect(layout.openCodeSurface!.rect.right).toBeLessThanOrEqual(
      layout.openCodePanelHost!.rect.right + 1,
    );
    expect(layout.openCodeStatusRow!.rect.right).toBeLessThanOrEqual(
      layout.openCodeSurface!.rect.right + 1,
    );
    expect(layout.openCodeBody!.rect.right).toBeLessThanOrEqual(
      layout.openCodeSurface!.rect.right + 1,
    );
    expect(layout.openCodeTerminal!.rect.right).toBeLessThanOrEqual(
      layout.openCodeBody!.rect.right + 1,
    );
    expect(layout.openCodeHost!.rect.right).toBeLessThanOrEqual(
      layout.openCodeTerminal!.rect.right + 1,
    );

    expect(
      Math.abs(
        layout.openCodeSurface!.rect.bottom -
          layout.sidebarScrollable!.rect.bottom,
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        layout.openCodePanelHost!.rect.bottom -
          layout.sidebarScrollable!.rect.bottom,
      ),
    ).toBeLessThanOrEqual(1);

    expect(layout.openCodeBody!.scrollWidth).toBeLessThanOrEqual(
      layout.openCodeBody!.clientWidth + 1,
    );
    expect(layout.openCodeTerminal!.scrollWidth).toBeLessThanOrEqual(
      layout.openCodeTerminal!.clientWidth + 1,
    );
    expect(layout.openCodeHost!.scrollWidth).toBeLessThanOrEqual(
      layout.openCodeHost!.clientWidth + 1,
    );
  });

  test("starts the seeded workspace app and renders it in the preview iframe", async ({
    page,
  }) => {
    await loadWebIDE(page);

    const previewFrame = await expectPreviewApp(page);
    await expect(
      previewFrame.getByRole("button", { name: "Toggle theme" }),
    ).toBeVisible();
  });

  test("uses the workspace theme instead of the OS theme for IDE chrome", async ({
    page,
  }) => {
    test.setTimeout(2 * 60 * 1000);
    await page.emulateMedia({ colorScheme: "light" });
    await loadWebIDE(page);
    await expect(
      page.locator(".almostnode-preview-surface__toolbar"),
    ).toBeVisible();

    await page.evaluate(async () => {
      const host = (
        window as {
          __almostnodeWebIDE: {
            executeWorkbenchCommand(command: string): Promise<unknown>;
          };
        }
      ).__almostnodeWebIDE;
      await host.executeWorkbenchCommand("almostnode.keychain.primary");
    });

    await expect(page.locator(".almostnode-keychain-sidebar")).toBeVisible();

    const snapshot = await readWorkbenchThemeSnapshot(page);
    expect(snapshot.rootTheme).toBe("dark");
    expect(snapshot.colorScheme).toBe("dark");
    expect(snapshot.terminalThemeBackground).toBe("#0e1218");
    expect(snapshot.previewToolbarLuminance).toBeLessThan(220);
    expect(snapshot.keychainLuminance).toBeLessThan(260);
  });

  test("updates preview, terminal, and custom panels when the workbench theme changes", async ({
    page,
  }) => {
    test.setTimeout(2 * 60 * 1000);
    await loadWebIDE(page);
    await expect(
      page.locator(".almostnode-preview-surface__toolbar"),
    ).toBeVisible();

    await page.evaluate(async () => {
      await (
        window as {
          __almostnodeWebIDE: {
            setWorkbenchColorTheme(themeId: string): Promise<void>;
          };
        }
      ).__almostnodeWebIDE.setWorkbenchColorTheme("Islands Light");
    });
    await waitForWorkbenchTheme(page, "light");

    await page.evaluate(async () => {
      const host = (
        window as {
          __almostnodeWebIDE: {
            executeWorkbenchCommand(command: string): Promise<unknown>;
          };
        }
      ).__almostnodeWebIDE;
      await host.executeWorkbenchCommand("almostnode.keychain.primary");
    });
    await expect(page.locator(".almostnode-keychain-sidebar")).toBeVisible();

    const lightSnapshot = await readWorkbenchThemeSnapshot(page);
    expect(lightSnapshot.rootTheme).toBe("light");
    expect(lightSnapshot.colorScheme).toBe("light");
    expect(lightSnapshot.terminalThemeBackground).toBe("#ffffff");
    expect(lightSnapshot.previewToolbarLuminance).toBeGreaterThan(500);
    expect(lightSnapshot.keychainLuminance).toBeGreaterThan(500);
    await expect(
      page.locator(".almostnode-preview-surface__toolbar"),
    ).toBeVisible();

    await page.evaluate(async () => {
      await (
        window as {
          __almostnodeWebIDE: {
            setWorkbenchColorTheme(themeId: string): Promise<void>;
          };
        }
      ).__almostnodeWebIDE.setWorkbenchColorTheme("Islands Dark");
    });
    await waitForWorkbenchTheme(page, "dark");

    const darkSnapshot = await readWorkbenchThemeSnapshot(page);
    expect(darkSnapshot.rootTheme).toBe("dark");
    expect(darkSnapshot.colorScheme).toBe("dark");
    expect(darkSnapshot.terminalThemeBackground).toBe("#0e1218");
    expect(darkSnapshot.previewToolbarLuminance).toBeLessThan(220);
    expect(darkSnapshot.keychainLuminance).toBeLessThan(260);
    await expect(
      page.locator(".almostnode-preview-surface__toolbar"),
    ).toBeVisible();
  });

  test("executes workbench commands and manages mock marketplace extensions", async ({
    page,
  }) => {
    await loadWebIDE(page);

    await page.evaluate(async () => {
      const host = (
        window as {
          __almostnodeWebIDE: {
            executeWorkbenchCommand(
              command: string,
              ...args: unknown[]
            ): Promise<unknown>;
          };
        }
      ).__almostnodeWebIDE;

      await host.executeWorkbenchCommand("almostnode.preview.open");
    });

    await expectPreviewApp(page);

    const result = await page.evaluate(async () => {
      const host = (
        window as {
          __almostnodeWebIDE: {
            executeWorkbenchCommand(
              command: string,
              ...args: unknown[]
            ): Promise<unknown>;
            searchMarketplace(query: string): Promise<string[]>;
            installExtension(extensionId: string): Promise<void>;
            setExtensionEnabled(
              extensionId: string,
              enabled: boolean,
            ): Promise<void>;
            uninstallExtension(extensionId: string): Promise<void>;
            listInstalledExtensions(): Promise<
              Array<{ id: string; enabled: boolean }>
            >;
            container: {
              vfs: {
                writeFileSync(path: string, value: string): void;
                existsSync(path: string): boolean;
                readFileSync(path: string, encoding: string): string;
              };
            };
          };
        }
      ).__almostnodeWebIDE;

      const search = await host.searchMarketplace("almostnode-fixtures");
      host.container.vfs.writeFileSync(
        "/project/command-smoke.js",
        "require('fs').writeFileSync('/project/command-smoke.txt', String(40 + 2));\n",
      );

      await host.executeWorkbenchCommand(
        "almostnode.run",
        "node /project/command-smoke.js",
      );

      await host.installExtension("almostnode-fixtures.sunburst-paper");
      const installed = await host.listInstalledExtensions();

      await host.setExtensionEnabled(
        "almostnode-fixtures.sunburst-paper",
        false,
      );
      const afterDisable = await host.listInstalledExtensions();

      await host.setExtensionEnabled(
        "almostnode-fixtures.sunburst-paper",
        true,
      );
      const afterEnable = await host.listInstalledExtensions();

      await host.uninstallExtension("almostnode-fixtures.sunburst-paper");
      const afterUninstall = await host.listInstalledExtensions();

      return {
        search,
        installed,
        afterDisable,
        afterEnable,
        afterUninstall,
        commandOutput: host.container.vfs.existsSync(
          "/project/command-smoke.txt",
        )
          ? host.container.vfs.readFileSync(
              "/project/command-smoke.txt",
              "utf8",
            )
          : "",
        previewSrc:
          (document.getElementById("webidePreview") as HTMLIFrameElement | null)
            ?.src || "",
        previewBody:
          (document.getElementById("webidePreview") as HTMLIFrameElement | null)
            ?.contentDocument?.body?.innerText || "",
      };
    });

    expect(result.search).toEqual(
      expect.arrayContaining([
        "almostnode-fixtures.browser-hello",
        "almostnode-fixtures.sunburst-paper",
      ]),
    );
    expect(result.commandOutput).toBe("42");
    expect(result.previewSrc).toContain("/__virtual__/");
    expect(result.previewBody).toContain("Project ready!");
    expect(result.installed).toContainEqual({
      id: "almostnode-fixtures.sunburst-paper",
      enabled: true,
    });
    expect(result.afterDisable).toContainEqual({
      id: "almostnode-fixtures.sunburst-paper",
      enabled: false,
    });
    expect(result.afterEnable).toContainEqual({
      id: "almostnode-fixtures.sunburst-paper",
      enabled: true,
    });
    expect(
      result.afterUninstall.find(
        (extension) => extension.id === "almostnode-fixtures.sunburst-paper",
      ),
    ).toBeUndefined();
  });
});
