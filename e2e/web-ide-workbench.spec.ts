import { expect, test } from "@playwright/test";

async function seedStoredWorkbenchExtensions(
  page: import("@playwright/test").Page,
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

async function loadWebIDE(page: import("@playwright/test").Page) {
  await page.goto("/examples/web-ide-demo.html?marketplace=mock", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    () =>
      Boolean((window as { __almostnodeWebIDE?: unknown }).__almostnodeWebIDE),
    {
      timeout: 30000,
    },
  );
}

async function expectPreviewApp(page: import("@playwright/test").Page) {
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

  test("starts the seeded workspace app and renders it in the preview iframe", async ({
    page,
  }) => {
    await loadWebIDE(page);

    const previewFrame = await expectPreviewApp(page);
    await expect(
      previewFrame.getByRole("button", { name: "Toggle theme" }),
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
