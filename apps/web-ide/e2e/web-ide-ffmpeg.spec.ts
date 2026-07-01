import { expect, test, type Page } from "@playwright/test";

// ffmpeg.wasm is headless (file-in/file-out + logs), so — unlike vim — the
// `ffmpeg` command is a plain shell command. This drives it end-to-end: generate
// a clip with the lavfi `testsrc` virtual source (no input asset needed) and
// assert the encoded output lands back in almostnode's VirtualFS.

async function loadWebIDE(page: Page, query = "?marketplace=mock"): Promise<void> {
  await page.goto(`/examples/web-ide-demo.html${query}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => Boolean((window as any).__almostnodeWebIDE), {
    timeout: 90000,
  });
}

test.describe("Web IDE ffmpeg.wasm", () => {
  test("`ffmpeg` transcodes on the VFS from the terminal", async ({ page }) => {
    // First run downloads + instantiates the ~31 MB core.
    test.setTimeout(6 * 60 * 1000);

    const coreResponses: Array<{ url: string; status: number }> = [];
    page.on("response", (response) => {
      if (response.url().includes("/ffmpeg-core/")) {
        coreResponses.push({ url: response.url(), status: response.status() });
      }
    });

    await loadWebIDE(page);

    const exitCode = await page.evaluate(async () => {
      const host = (window as any).__almostnodeWebIDE;
      return host.executeHostCommand(
        "ffmpeg -f lavfi -i testsrc=duration=1:size=64x64:rate=5 -pix_fmt yuv420p /project/gen.mp4",
      );
    });

    // The core (js + wasm) was served locally and loaded.
    expect(
      coreResponses.some(
        (r) => r.url.endsWith("/ffmpeg-core/ffmpeg-core.wasm") && r.status === 200,
      ),
    ).toBe(true);

    // A non-empty MP4 was written back into the VirtualFS.
    const size = await page.evaluate(() => {
      const vfs = (window as any).__almostnodeWebIDE.container.vfs;
      return vfs.existsSync("/project/gen.mp4")
        ? vfs.readFileSync("/project/gen.mp4").length
        : 0;
    });
    expect(size).toBeGreaterThan(0);
    expect(typeof exitCode === "number" ? exitCode : 0).toBe(0);
  });
});
