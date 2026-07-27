import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.WEB_IDE_BASE_URL ?? "http://127.0.0.1:5174";
const projectName = `codex-focus-smoke-${Date.now()}`;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.addInitScript(() => {
    const activeTerminalBody = () => {
      const activeTab = document.querySelector(
        ".almostnode-opencode-surface__tab.is-active",
      );
      const terminalId = activeTab?.getAttribute("data-terminal-id");
      if (!terminalId) return null;
      return document.querySelector(
        `.almostnode-opencode-surface__terminal[data-terminal-id="${CSS.escape(terminalId)}"]`,
      );
    };

    window.__codexFocusSmoke = {
      activeTerminalText() {
        return activeTerminalBody()?.textContent ?? "";
      },
      activeTabLabel() {
        return (
          document
            .querySelector(
              ".almostnode-opencode-surface__tab.is-active .almostnode-opencode-surface__tab-label",
            )
            ?.textContent?.trim() ?? ""
        );
      },
      activeTerminalContainsFocus() {
        const body = activeTerminalBody();
        return Boolean(
          body &&
          document.activeElement &&
          body.contains(document.activeElement),
        );
      },
    };
  });
  const response = await page.goto(
    `${baseUrl}/ide?template=vite&name=${encodeURIComponent(projectName)}`,
    { waitUntil: "domcontentloaded" },
  );
  assert.equal(response?.ok(), true);

  const workbenchToggle = page.getByTestId("workbench-drawer-toggle");
  await workbenchToggle.waitFor({
    state: "visible",
    timeout: 60_000,
  });
  if ((await workbenchToggle.getAttribute("aria-expanded")) !== "true") {
    await workbenchToggle.click();
  }

  const openAiPanel = page.getByRole("button", {
    name: "Open OpenCode",
    exact: true,
  });
  await openAiPanel.waitFor({
    state: "visible",
    timeout: 60_000,
  });
  await openAiPanel.click();

  await page.waitForSelector(".almostnode-opencode-surface__launcher-toggle", {
    state: "visible",
    timeout: 60_000,
  });
  await seedDisposableCodexAuth(page);

  await launchFromAiSidebar(page, "Codex");
  await page
    .locator(".almostnode-opencode-surface__tab-label")
    .filter({ hasText: "Codex 1" })
    .waitFor({ timeout: 60_000 });
  await page.waitForFunction(
    () =>
      window.__codexFocusSmoke.activeTerminalText().includes("OpenAI Codex"),
    null,
    { timeout: 60_000 },
  );

  await focusActiveXterm(page);
  await page.keyboard.type("focus-one");
  await waitForActiveText(page, "focus-one");

  await launchFromAiSidebar(page, "Empty Terminal");
  await page
    .locator(".almostnode-opencode-surface__tab-label")
    .filter({ hasText: "Terminal 1" })
    .waitFor({ timeout: 20_000 });

  await page
    .locator(".almostnode-opencode-surface__tab")
    .filter({ hasText: "Codex 1" })
    .click();
  await page.waitForFunction(
    () => window.__codexFocusSmoke.activeTabLabel() === "Codex 1",
    null,
    { timeout: 10_000 },
  );
  await page.waitForFunction(
    () => window.__codexFocusSmoke.activeTerminalContainsFocus(),
    null,
    { timeout: 10_000 },
  );

  await page.keyboard.type("-after-tab");
  await waitForActiveText(page, "focus-one-after-tab");
} finally {
  await browser.close();
}

async function launchFromAiSidebar(page, label) {
  await page.locator(".almostnode-opencode-surface__launcher-toggle").click();
  await page
    .locator(".almostnode-opencode-surface__menu-item")
    .filter({ hasText: label })
    .click();
}

async function seedDisposableCodexAuth(page) {
  await page.waitForFunction(
    () => {
      const host = window.__almostnodeWebIDE;
      return Boolean(host?.container?.vfs);
    },
    null,
    { timeout: 60_000 },
  );
  await page.evaluate(() => {
    const vfs = window.__almostnodeWebIDE.container.vfs;
    vfs.mkdirSync("/home/user/.codex", { recursive: true });
    vfs.writeFileSync(
      "/home/user/.codex/auth.json",
      `${JSON.stringify(
        {
          auth_mode: "apikey",
          OPENAI_API_KEY: "sk-codex-focus-smoke",
        },
        null,
        2,
      )}\n`,
    );
    window.__almostnodeWebIDE.keychain?.notifyExternalStateChanged?.();
  });
}

async function focusActiveXterm(page) {
  await page
    .locator(
      ".almostnode-opencode-surface__terminal:not([hidden]) .xterm-helper-textarea",
    )
    .click({ force: true });
  await page.waitForFunction(
    () => window.__codexFocusSmoke.activeTerminalContainsFocus(),
    null,
    { timeout: 10_000 },
  );
}

async function waitForActiveText(page, text) {
  try {
    await page.waitForFunction(
      (expected) =>
        window.__codexFocusSmoke.activeTerminalText().includes(expected),
      text,
      { timeout: 10_000 },
    );
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      activeTab: window.__codexFocusSmoke.activeTabLabel(),
      activeContainsFocus:
        window.__codexFocusSmoke.activeTerminalContainsFocus(),
      activeElement:
        document.activeElement instanceof HTMLElement
          ? {
              tagName: document.activeElement.tagName,
              className: document.activeElement.className,
              ariaLabel: document.activeElement.getAttribute("aria-label"),
            }
          : null,
      text: window.__codexFocusSmoke.activeTerminalText(),
    }));
    console.error(JSON.stringify(diagnostics, null, 2));
    throw error;
  }
}
