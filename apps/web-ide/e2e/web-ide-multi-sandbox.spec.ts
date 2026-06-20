import { expect, test, type Page } from "@playwright/test";

/**
 * Multi-sandbox lifecycle: Repo > Sandbox rows in the sidebar, background
 * sessions that keep running across switches, and terminal scrollback intact
 * on re-attach. Boot lands in the repo's auto-created first sandbox (main
 * never opens writable; selecting a repo opens its latest sandbox).
 *
 * Servers started inside a sandbox register with the shared server bridge,
 * so the page can probe them through the service worker at
 * `/__virtual__/{port}/` even while their session is parked in the
 * background — that is the core "no teardown on switch" assertion.
 */

const SERVER_PORT = 5599;
const SERVER_COMMAND = "node /project/sandbox-server.js";
const SERVER_READY_MARKER = "sandbox-one-server-ready";
const SERVER_RESPONSE_MARKER = "hello-from-sandbox-one";

async function loadIDE(page: Page) {
  // The template param is a project-creation intent — without it a fresh
  // profile lands on the "No project selected" empty state.
  await page.goto("/ide?template=vite", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => Boolean((window as any).__almostnodeWebIDE),
    undefined,
    { timeout: 180000 },
  );
}

async function getHostTerminalText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const term = (window as any).__almostnodeWebIDE?.terminal;
    if (!term) return "";

    const buffer = term.buffer.active;
    const lastLine = buffer.baseY + buffer.cursorY;
    let text = "";

    for (let i = 0; i <= lastLine; i++) {
      const line = buffer.getLine(i);
      if (line) text += line.translateToString(true) + "\n";
    }

    return text;
  });
}

/** Read-only state of the workspace the editor stack is attached to. */
async function readWorkspaceReadOnly(page: Page): Promise<boolean | null> {
  return page.evaluate(() => {
    const host = (window as any).__almostnodeWebIDE;
    return host?.vfsProvider?.isReadOnly?.() ?? null;
  });
}

async function getActiveSessionId(page: Page): Promise<string | null> {
  return page.evaluate(
    () => (window as any).__almostnodeWebIDE?.getActiveSessionId?.() ?? null,
  );
}

async function getLiveSessionIds(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as any).__almostnodeWebIDE?.getLiveSessionIds?.() ?? [],
  );
}

/**
 * Fetch a virtual port from the page context — the service worker routes
 * the request to whichever container owns the port, foreground or not.
 */
async function fetchVirtualPort(page: Page, port: number): Promise<string> {
  return page.evaluate(async (virtualPort) => {
    try {
      const response = await fetch(`/__virtual__/${virtualPort}/`, {
        cache: "no-store",
      });
      const text = await response.text();
      return response.ok
        ? text
        : `status:${response.status} ${text.slice(0, 200)}`;
    } catch (error) {
      return `error:${String(error)}`;
    }
  }, port);
}

async function expectSwitchSettled(page: Page) {
  await expect(
    page.locator(".almostnode-sidebar__switching-overlay"),
  ).toHaveCount(0, { timeout: 180000 });
}

// One sequential journey: each step depends on the state of the previous
// one (running server, scrollback, session ids), so this is a single test.
test.describe("web-ide multi-sandbox", () => {
  test("boots into an auto-created sandbox, keeps background sessions running, and re-attaches with scrollback", async ({
    page,
  }) => {
    test.setTimeout(10 * 60 * 1000);

    await loadIDE(page);

    const repoRow = page.locator(".almostnode-project-item").first();
    const sandboxRows = page.locator(".almostnode-sandbox-item");
    const newSandboxButton = page.getByRole("button", {
      name: /^New sandbox in /,
    });

    // ── Step 1: boot lands in the repo's auto-created first sandbox,
    // writable — main never opens as a workspace.
    await expect(repoRow).toBeVisible({ timeout: 120000 });
    await expect(sandboxRows).toHaveCount(1, { timeout: 180000 });
    const sandbox1Row = sandboxRows.filter({ hasText: "sandbox/sandbox-1" });
    await expect(
      sandbox1Row.locator(".almostnode-sandbox-item__badge"),
    ).toHaveText("sandbox/sandbox-1");
    await expect(sandbox1Row).toHaveClass(/is-active/, { timeout: 180000 });
    await expectSwitchSettled(page);
    await expect
      .poll(() => readWorkspaceReadOnly(page), { timeout: 120000 })
      .toBe(false);
    const sandbox1SessionId = await getActiveSessionId(page);
    expect(sandbox1SessionId).toBeTruthy();

    // Bring the workbench drawer on screen and reveal the terminal panel —
    // workbench panels materialize lazily, so #webideTerminal only exists
    // once the panel has been shown.
    await page.getByTestId("workbench-drawer-toggle").click();
    await page.evaluate(async () => {
      await (window as any).__almostnodeWebIDE.focusTerminal();
    });
    await expect(page.locator("#webideTerminal")).toBeVisible({
      timeout: 60000,
    });

    // ── Step 2: long-lived http server in sandbox 1's terminal.
    await page.evaluate(
      ({ port, readyMarker, responseMarker, command }) => {
        const host = (window as any).__almostnodeWebIDE;
        host.container.vfs.writeFileSync(
          "/project/sandbox-server.js",
          [
            "const http = require('http');",
            "const server = http.createServer((req, res) => {",
            "  res.writeHead(200, { 'Content-Type': 'text/plain' });",
            `  res.end('${responseMarker}');`,
            "});",
            `server.listen(${port}, () => {`,
            `  console.log('${readyMarker}');`,
            "});",
          ].join("\n") + "\n",
        );
        void host.executeHostCommand(command);
      },
      {
        port: SERVER_PORT,
        readyMarker: SERVER_READY_MARKER,
        responseMarker: SERVER_RESPONSE_MARKER,
        command: SERVER_COMMAND,
      },
    );

    await expect(page.locator("#webideTerminalStatus")).toHaveText(
      `Running: ${SERVER_COMMAND}`,
      { timeout: 30000 },
    );
    await expect
      .poll(() => getHostTerminalText(page), { timeout: 90000 })
      .toContain(SERVER_READY_MARKER);
    await expect
      .poll(() => fetchVirtualPort(page, SERVER_PORT), { timeout: 90000 })
      .toContain(SERVER_RESPONSE_MARKER);

    // ── Step 3: a second sandbox switches in; sandbox 1 keeps running in
    // the background (sidebar spinners track agent sessions, not terminal
    // commands — running state is asserted via the live port + scrollback).
    await newSandboxButton.click();
    await expect(sandboxRows).toHaveCount(2, { timeout: 180000 });
    const sandbox2Row = sandboxRows.filter({ hasText: "sandbox/sandbox-2" });
    await expect(sandbox2Row).toHaveClass(/is-active/, { timeout: 180000 });
    await expectSwitchSettled(page);

    const sandbox2SessionId = await getActiveSessionId(page);
    expect(sandbox2SessionId).toBeTruthy();
    expect(sandbox2SessionId).not.toBe(sandbox1SessionId);

    // No teardown of the first sandbox: its session is still live...
    const liveSessions = await getLiveSessionIds(page);
    expect(liveSessions).toContain(sandbox1SessionId);
    expect(liveSessions).toContain(sandbox2SessionId);

    // ...and its server still answers from the background container.
    await expect
      .poll(() => fetchVirtualPort(page, SERVER_PORT), { timeout: 60000 })
      .toContain(SERVER_RESPONSE_MARKER);

    // Sandbox 2's terminal is its own: no scrollback bleed from sandbox 1.
    expect(await getHostTerminalText(page)).not.toContain(SERVER_READY_MARKER);
    await page.evaluate(() => {
      void (window as any).__almostnodeWebIDE.executeHostCommand(
        'printf "sandbox-two-terminal\\n"',
      );
    });
    await expect
      .poll(() => getHostTerminalText(page), { timeout: 30000 })
      .toContain("sandbox-two-terminal");

    // ── Step 4: switch back to sandbox 1 — scrollback intact, command
    // still running, port still served.
    await sandbox1Row.locator(".almostnode-sandbox-item__name").click();
    await expect(sandbox1Row).toHaveClass(/is-active/, { timeout: 180000 });
    await expectSwitchSettled(page);
    await expect.poll(() => getActiveSessionId(page), { timeout: 60000 }).toBe(
      sandbox1SessionId,
    );

    await expect
      .poll(() => getHostTerminalText(page), { timeout: 60000 })
      .toContain(SERVER_READY_MARKER);
    const reattachedText = await getHostTerminalText(page);
    expect(reattachedText).toContain(`$ ${SERVER_COMMAND}`);
    expect(reattachedText).not.toContain("sandbox-two-terminal");
    await expect(page.locator("#webideTerminalStatus")).toHaveText(
      `Running: ${SERVER_COMMAND}`,
      { timeout: 30000 },
    );
    await expect
      .poll(() => fetchVirtualPort(page, SERVER_PORT), { timeout: 60000 })
      .toContain(SERVER_RESPONSE_MARKER);

    // ── Step 5: clicking the repo row opens its most recently active
    // sandbox (sandbox 1 — step 4 touched it last) writable; no read-only
    // workspace and no extra sandbox is created.
    await sandbox2Row.locator(".almostnode-sandbox-item__name").click();
    await expect(sandbox2Row).toHaveClass(/is-active/, { timeout: 180000 });
    await expectSwitchSettled(page);

    await repoRow.locator(".almostnode-project-item__name").click();
    await expect(sandbox2Row).toHaveClass(/is-active/, { timeout: 180000 });
    await expectSwitchSettled(page);
    await expect(sandboxRows).toHaveCount(2);
    await expect
      .poll(() => readWorkspaceReadOnly(page), { timeout: 60000 })
      .toBe(false);

    // The pinned (still running) sandbox 1 survived the whole journey.
    await expect
      .poll(() => fetchVirtualPort(page, SERVER_PORT), { timeout: 60000 })
      .toContain(SERVER_RESPONSE_MARKER);
    expect(await getLiveSessionIds(page)).toContain(sandbox1SessionId);
  });

  test("restores each sandbox's own files across repeated switches", async ({
    page,
  }) => {
    await loadIDE(page);

    const sandboxRows = page.locator(".almostnode-sandbox-item");
    const sandbox1Row = sandboxRows.filter({ hasText: "sandbox/sandbox-1" });
    await expect(sandbox1Row).toHaveClass(/is-active/, { timeout: 180000 });
    await expectSwitchSettled(page);

    const MARKER_PATH = "/project/sandbox-marker.txt";

    /** The file as the EDITOR stack sees it (the provider's bound VFS). */
    const readMarkerViaEditor = () =>
      page.evaluate((path) => {
        const host = (window as any).__almostnodeWebIDE;
        const vfs = host?.vfsProvider?.vfs;
        try {
          return vfs?.readFileSync(path, "utf8") ?? null;
        } catch {
          return null;
        }
      }, MARKER_PATH);

    /** The file as the SESSION's container sees it (terminal layer). */
    const readMarkerViaSession = () =>
      page.evaluate(async (path) => {
        const host = (window as any).__almostnodeWebIDE;
        const sessionId = host?.getActiveSessionId?.();
        const vfs = sessionId ? host?.getVfsForSession?.(sessionId) : null;
        try {
          return vfs?.readFileSync(path, "utf8") ?? null;
        } catch {
          return null;
        }
      }, MARKER_PATH);

    const writeMarker = (text: string) =>
      page.evaluate(
        ({ path, content }) => {
          const host = (window as any).__almostnodeWebIDE;
          const sessionId = host?.getActiveSessionId?.();
          const vfs = sessionId ? host?.getVfsForSession?.(sessionId) : null;
          vfs?.writeFileSync(path, content);
        },
        { path: MARKER_PATH, content: text },
      );

    // Mark sandbox 1.
    await writeMarker("from-sandbox-one");
    expect(await readMarkerViaEditor()).toBe("from-sandbox-one");

    // Fork sandbox 2 — fresh from the repo base, so no marker.
    await page
      .getByRole("button", { name: /^New sandbox in / })
      .first()
      .click();
    const sandbox2Row = sandboxRows.filter({ hasText: "sandbox/sandbox-2" });
    await expect(sandbox2Row).toHaveClass(/is-active/, { timeout: 180000 });
    await expectSwitchSettled(page);
    expect(await readMarkerViaSession()).toBeNull();
    expect(await readMarkerViaEditor()).toBeNull();
    await writeMarker("from-sandbox-two");

    // Switch 2 (back to sandbox 1): both layers show sandbox 1's file.
    await sandbox1Row.locator(".almostnode-sandbox-item__name").click();
    await expect(sandbox1Row).toHaveClass(/is-active/, { timeout: 180000 });
    await expectSwitchSettled(page);
    expect(await readMarkerViaSession()).toBe("from-sandbox-one");
    expect(await readMarkerViaEditor()).toBe("from-sandbox-one");

    // Switch 3 (to sandbox 2 again): the user-reported failure mode is
    // "after the first switch every sandbox shows the same code" — assert
    // the third and fourth switches still swap content.
    await sandbox2Row.locator(".almostnode-sandbox-item__name").click();
    await expect(sandbox2Row).toHaveClass(/is-active/, { timeout: 180000 });
    await expectSwitchSettled(page);
    expect(await readMarkerViaSession()).toBe("from-sandbox-two");
    expect(await readMarkerViaEditor()).toBe("from-sandbox-two");

    // Switch 4 (back to sandbox 1 once more).
    await sandbox1Row.locator(".almostnode-sandbox-item__name").click();
    await expect(sandbox1Row).toHaveClass(/is-active/, { timeout: 180000 });
    await expectSwitchSettled(page);
    expect(await readMarkerViaSession()).toBe("from-sandbox-one");
    expect(await readMarkerViaEditor()).toBe("from-sandbox-one");
  });

  test("lists recorded codex threads under their sandbox", async ({
    page,
  }) => {
    await loadIDE(page);

    const sandboxRows = page.locator(".almostnode-sandbox-item");
    const sandbox1Row = sandboxRows.filter({ hasText: "sandbox/sandbox-1" });
    await expect(sandbox1Row).toHaveClass(/is-active/, { timeout: 180000 });
    await expectSwitchSettled(page);

    // Feed the host's codex thread store directly (the bus tee fills this
    // in real usage — codex itself needs auth, which e2e doesn't have) and
    // fire the thread-updated event. Everything DOWNSTREAM is real: the
    // manager's discovery via the ProjectManagerHost adapter — the seam
    // that silently dropped codex threads — the IndexedDB record, and the
    // sidebar render.
    await page.evaluate(() => {
      const host = (window as any).__almostnodeWebIDE;
      const sessionId = host.getActiveSessionId();
      let threads = host.codexThreadsBySandbox.get(sessionId);
      if (!threads) {
        threads = new Map();
        host.codexThreadsBySandbox.set(sessionId, threads);
      }
      threads.set("thread-e2e", {
        title: "fix the homepage",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        events: [
          {
            kind: "request",
            method: "thread/start",
            params: {},
            result: { thread: { id: "thread-e2e" } },
          },
        ],
      });
      window.dispatchEvent(
        new CustomEvent("almostnode:agent-thread-updated"),
      );
    });

    // Expand the sandbox row and expect the codex chat listed.
    await sandbox1Row.locator(".almostnode-project-item__chevron").click();
    await expect(
      page.locator(".almostnode-thread-item", { hasText: "fix the homepage" }),
    ).toBeVisible({ timeout: 30000 });
  });

  test("restores evicted sandboxes from their own snapshots", async ({
    page,
  }) => {
    test.setTimeout(10 * 60 * 1000);
    await loadIDE(page);

    const sandboxRows = page.locator(".almostnode-sandbox-item");
    const rowFor = (n: number) =>
      sandboxRows.filter({ hasText: `sandbox/sandbox-${n}` });
    await expect(rowFor(1)).toHaveClass(/is-active/, { timeout: 180000 });
    await expectSwitchSettled(page);

    const MARKER_PATH = "/project/sandbox-marker.txt";
    const readMarker = () =>
      page.evaluate((path) => {
        const host = (window as any).__almostnodeWebIDE;
        const sessionId = host?.getActiveSessionId?.();
        const vfs = sessionId ? host?.getVfsForSession?.(sessionId) : null;
        try {
          return vfs?.readFileSync(path, "utf8") ?? null;
        } catch {
          return null;
        }
      }, MARKER_PATH);
    const readMarkerViaEditor = () =>
      page.evaluate((path) => {
        const host = (window as any).__almostnodeWebIDE;
        const vfs = host?.vfsProvider?.vfs;
        try {
          return vfs?.readFileSync(path, "utf8") ?? null;
        } catch {
          return null;
        }
      }, MARKER_PATH);
    const writeMarker = (text: string) =>
      page.evaluate(
        ({ path, content }) => {
          const host = (window as any).__almostnodeWebIDE;
          const sessionId = host?.getActiveSessionId?.();
          const vfs = sessionId ? host?.getVfsForSession?.(sessionId) : null;
          vfs?.writeFileSync(path, content);
        },
        { path: MARKER_PATH, content: text },
      );

    const newSandboxButton = page.getByRole("button", {
      name: /^New sandbox in /,
    });
    const marker = (n: number) => `marker-sandbox-${n}`;

    // Sandbox 1 exists from boot; create 2..4 and stamp each.
    await writeMarker(marker(1));
    for (let n = 2; n <= 4; n += 1) {
      await newSandboxButton.click();
      await expect(rowFor(n)).toHaveClass(/is-active/, { timeout: 180000 });
      await expectSwitchSettled(page);
      await writeMarker(marker(n));
    }

    // Four sandboxes against a pool cap of three: something idle was
    // snapshotted and disposed. The test is only meaningful if eviction
    // actually happened.
    await expect
      .poll(
        async () =>
          (await page.evaluate(
            () =>
              (window as any).__almostnodeWebIDE?.getLiveSessionIds?.() ?? [],
          )).length,
        { timeout: 60000 },
      )
      .toBeLessThanOrEqual(3);

    // Walk the sandboxes — including ones that must now be revived from
    // their persisted snapshots — and assert each shows ITS OWN marker at
    // both the session layer and the editor layer.
    for (const n of [1, 2, 3, 4, 1, 3, 2]) {
      await rowFor(n).locator(".almostnode-sandbox-item__name").click();
      await expect(rowFor(n)).toHaveClass(/is-active/, { timeout: 180000 });
      await expectSwitchSettled(page);
      expect
        .soft(await readMarker(), `session layer after switching to sandbox-${n}`)
        .toBe(marker(n));
      expect
        .soft(
          await readMarkerViaEditor(),
          `editor layer after switching to sandbox-${n}`,
        )
        .toBe(marker(n));
    }

    // ── Reload: nothing is live anymore; every sandbox must revive from
    // its OWN persisted snapshot, not the repo base (a sandbox falling back
    // to base files shows "the same code" as every other fallen-back one —
    // the user-visible failure this guards against).
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => Boolean((window as any).__almostnodeWebIDE),
      undefined,
      { timeout: 180000 },
    );
    await expectSwitchSettled(page);

    for (const n of [4, 2, 1, 3]) {
      await rowFor(n).locator(".almostnode-sandbox-item__name").click();
      await expect(rowFor(n)).toHaveClass(/is-active/, { timeout: 180000 });
      await expectSwitchSettled(page);
      expect
        .soft(
          await readMarker(),
          `session layer after reload, switching to sandbox-${n}`,
        )
        .toBe(marker(n));
      expect
        .soft(
          await readMarkerViaEditor(),
          `editor layer after reload, switching to sandbox-${n}`,
        )
        .toBe(marker(n));
    }
  });
});
