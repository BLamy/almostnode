import { expect, test, type Page } from "@playwright/test";

/**
 * Chat-first IDE layout: verifies the bidirectional conversation sync loop
 * without requiring real agent credentials by registering a fake claude
 * session in the agent session registry and writing transcript JSONL into
 * the VirtualFS — the exact channels the real CLI uses.
 */

interface WebIDEHostHandle {
  getAgentSessionRegistry(): {
    setActive(session: unknown): void;
    clearActive(tabId: string): void;
  };
  getVfs(): {
    mkdirSync(path: string, options?: { recursive?: boolean }): void;
    writeFileSync(path: string, content: string): void;
    readFileSync(path: string, encoding: string): string;
  };
}

declare global {
  interface Window {
    __almostnodeWebIDE?: WebIDEHostHandle;
    __chatTestInputs?: string[];
  }
}

async function loadChatIDE(page: Page) {
  // The template param is a project-creation intent — without it a fresh
  // profile lands on the "No project selected" empty state.
  await page.goto("/ide?template=vite", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__almostnodeWebIDE), null, {
    timeout: 120000,
  });
  await expect(page.getByTestId("chat-composer-input")).toBeVisible({
    timeout: 120000,
  });
}

async function registerFakeClaudeSession(page: Page) {
  await page.evaluate(() => {
    const host = window.__almostnodeWebIDE!;
    window.__chatTestInputs = [];
    host.getAgentSessionRegistry().setActive({
      harness: "claude",
      tabId: "e2e-claude-tab",
      startedAt: Date.now(),
      resumeToken: null,
      sendInput: (data: string) => window.__chatTestInputs!.push(data),
      isRunning: () => true,
    });
  });
}

const TRANSCRIPT_DIR = "/home/user/.claude/projects/-project";

function transcriptLine(entry: Record<string, unknown>): string {
  return `${JSON.stringify(entry)}\n`;
}

// Each test boots the full workbench in a fresh profile (pglite + monaco +
// workspace seed), which dominates the runtime.
test.describe.configure({ timeout: 240000 });

test.describe("web ide chat", () => {
  test("layout: drawer hosts the workbench and the page does not scroll", async ({
    page,
  }) => {
    await loadChatIDE(page);

    await expect(page.getByTestId("workbench-drawer-toggle")).toBeVisible();
    await expect(page.locator("#webideWorkbench")).toBeAttached();

    const metrics = await page.evaluate(() => ({
      pageScrollable:
        document.documentElement.scrollHeight >
        document.documentElement.clientHeight,
    }));
    expect(metrics.pageScrollable).toBe(false);

    // Collapsing the drawer must keep the workbench mounted.
    await page.getByTestId("workbench-drawer-toggle").click();
    await expect(page.locator("#webideWorkbench")).toBeAttached();
    await page.getByTestId("workbench-drawer-toggle").click();
  });

  test("chat sends through the shared session and renders transcript updates", async ({
    page,
  }) => {
    await loadChatIDE(page);
    await registerFakeClaudeSession(page);

    // Send from chat: the message is injected into the session stdin as a
    // bracketed paste followed by Enter, and shows as a pending bubble.
    await page.getByTestId("chat-composer-input").fill("fix the bug");
    await page.getByTestId("chat-composer-input").press("Enter");

    await expect
      .poll(async () =>
        page.evaluate(() => window.__chatTestInputs ?? []),
      )
      .toEqual(["[200~fix the bug[201~", "\r"]);
    await expect(page.getByTestId("chat-timeline")).toContainText("fix the bug");

    // The CLI echoes the user message and replies via its transcript file.
    await page.evaluate(
      ({ dir, lines }) => {
        const vfs = window.__almostnodeWebIDE!.getVfs();
        vfs.mkdirSync(dir, { recursive: true });
        vfs.writeFileSync(`${dir}/e2e-session.jsonl`, lines);
      },
      {
        dir: TRANSCRIPT_DIR,
        lines:
          transcriptLine({
            type: "user",
            uuid: "u1",
            sessionId: "e2e-session",
            timestamp: new Date().toISOString(),
            message: { role: "user", content: "fix the bug" },
          }) +
          transcriptLine({
            type: "assistant",
            uuid: "a1",
            sessionId: "e2e-session",
            timestamp: new Date().toISOString(),
            message: {
              role: "assistant",
              content: [
                { type: "text", text: "Found it — fixed in app.ts." },
                {
                  type: "tool_use",
                  id: "toolu_1",
                  name: "Bash",
                  input: { command: "pnpm test", description: "Run tests" },
                },
              ],
            },
          }),
      },
    );

    await expect(page.getByTestId("chat-timeline")).toContainText(
      "Found it — fixed in app.ts.",
    );
    // Tool calls render as cards with the command.
    await expect(page.getByTestId("chat-tool-card")).toContainText("pnpm test");
    // The optimistic bubble reconciled — the message appears exactly once.
    await expect(
      page.getByTestId("chat-timeline").getByText("fix the bug"),
    ).toHaveCount(1);

    // Messages typed directly in the terminal TUI (transcript-only) show up.
    await page.evaluate(
      ({ dir, line }) => {
        const vfs = window.__almostnodeWebIDE!.getVfs();
        const path = `${dir}/e2e-session.jsonl`;
        vfs.writeFileSync(path, vfs.readFileSync(path, "utf8") + line);
      },
      {
        dir: TRANSCRIPT_DIR,
        line: transcriptLine({
          type: "user",
          uuid: "u2",
          sessionId: "e2e-session",
          timestamp: new Date().toISOString(),
          message: { role: "user", content: "typed in terminal" },
        }),
      },
    );
    await expect(page.getByTestId("chat-timeline")).toContainText(
      "typed in terminal",
    );
  });

  test("sidebar shows GitHub and No source control sections", async ({ page }) => {
    await loadChatIDE(page);
    await expect(page.getByTestId("github-section")).toBeVisible();
    await expect(page.getByTestId("no-source-control-section")).toBeVisible();
    // Un-imported GitHub repositories are added via the New Project dialog,
    // never listed in the sidebar.
    await expect(page.getByTestId("github-connect-card")).toHaveCount(0);
    await expect(page.getByTestId("github-repo-row")).toHaveCount(0);
  });
});
