import { expect, test, type Page } from "@playwright/test";

// vim.wasm renders to a canvas driven by a Web Worker + SharedArrayBuffer, so
// these tests exercise the real cross-origin-isolated path (COOP/COEP headers,
// the vim-wasm asset plugin, the overlay lifecycle, and save-back to the VFS).

async function loadWebIDE(page: Page, query = "?marketplace=mock"): Promise<void> {
  await page.goto(`/examples/web-ide-demo.html${query}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => Boolean((window as any).__almostnodeWebIDE), {
    timeout: 90000,
  });
  await page.evaluate(() => {
    window.dispatchEvent(new Event("webide:open-workbench-drawer"));
  });
}

/** Fire a host terminal command without awaiting it (vi blocks until `:q`). */
async function fireHostCommand(page: Page, command: string): Promise<void> {
  await page.evaluate((cmd) => {
    void (window as any).__almostnodeWebIDE.executeHostCommand(cmd);
  }, command);
}

async function runHostCommand(page: Page, command: string): Promise<void> {
  await page.evaluate(async (cmd) => {
    await (window as any).__almostnodeWebIDE.executeHostCommand(cmd);
  }, command);
}

/** Resolves once the Vim canvas has actually painted (not a blank frame). */
async function waitForVimPainted(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector(
        ".almostnode-vim-overlay__canvas",
      ) as HTMLCanvasElement | null;
      if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // Any non-zero pixel means Vim has drawn its screen.
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] || data[i + 1] || data[i + 2]) return true;
      }
      return false;
    },
    { timeout: 60000 },
  );
}

test.describe("Web IDE vim.wasm editor", () => {
  test("`vi` mounts a real Vim over the terminal and persists edits to the VFS", async ({
    page,
  }) => {
    // Cold IDE boot + downloading/instantiating the vim.wasm runtime is slow.
    test.setTimeout(6 * 60 * 1000);

    const assetResponses: Array<{ url: string; status: number }> = [];
    page.on("response", (response) => {
      const url = response.url();
      if (url.includes("/vim-wasm/")) {
        assetResponses.push({ url, status: response.status() });
      }
    });

    await loadWebIDE(page);

    // Launch vi on a new file. Don't await — vi blocks until the user quits.
    await fireHostCommand(page, "vi /project/vimnote.txt");

    // The overlay canvas mounts over the terminal, and Vim boots and paints.
    await expect(page.locator(".almostnode-vim-overlay__canvas")).toBeVisible({
      timeout: 60000,
    });
    await waitForVimPainted(page);

    // The small build's worker + wasm + data were served and loaded.
    expect(
      assetResponses.some(
        (r) => r.url.includes("/vim-wasm/small/vim.js") && r.status === 200,
      ),
    ).toBe(true);
    expect(
      assetResponses.some(
        (r) => r.url.includes("/vim-wasm/small/vim.wasm") && r.status === 200,
      ),
    ).toBe(true);

    // Edit → save → quit. Keystrokes land on the auto-focused overlay input.
    await page.keyboard.type("ihello from vim");
    await page.keyboard.press("Escape");
    await page.keyboard.type(":wq");
    await page.keyboard.press("Enter");

    // Overlay tears down and focus returns to the shell.
    await expect(page.locator(".almostnode-vim-overlay")).toHaveCount(0, {
      timeout: 30000,
    });

    // The buffer was written back to almostnode's VirtualFS.
    const saved = await page.evaluate(() =>
      (window as any).__almostnodeWebIDE.container.vfs.readFileSync(
        "/project/vimnote.txt",
        "utf8",
      ),
    );
    expect(saved).toContain("hello from vim");

    // And the same file is visible to the rest of the runtime via `cat`.
    await runHostCommand(page, "cat /project/vimnote.txt");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.querySelector("#webideTerminal .xterm-rows")?.textContent ??
            "",
        ),
      )
      .toContain("hello from vim");
  });
});
