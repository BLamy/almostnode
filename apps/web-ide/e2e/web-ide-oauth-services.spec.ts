/**
 * E2E coverage for the user-configurable OAuth services flow in the keychain
 * sidebar.
 *
 * The OAuth flow has three browser-side phases:
 *
 *   1. Discovery — the host fetches `.well-known/*` documents from the URL the
 *      user pasted. We intercept these via `page.route()` so we don't hit the
 *      network.
 *   2. Dynamic client registration + popup-based authorization — opens a real
 *      window and waits for a `postMessage` callback. The popup half is hard
 *      to drive deterministically from Playwright (browsers gate `window.open`
 *      to user gestures and the callback page is a separate document), so the
 *      orchestrator-level coverage of that half lives in the unit tests
 *      (`tests/features/oauth-services/orchestrator.test.ts`).
 *   3. Token storage + slot registration — exercised by unit tests against the
 *      registry + token-store modules.
 *
 * What this E2E spec verifies end-to-end through real React + the workbench
 * host:
 *
 *   - The "+ Add OAuth service" button is rendered in the keychain sidebar
 *     and opens the modal on click.
 *   - The modal walks through prompt → discovering → preview when discovery
 *     succeeds, populating the summary and pre-filled display name.
 *   - The modal surfaces an error state when the input URL has an unsupported
 *     scheme.
 *   - The modal closes cleanly via both the Cancel button and the × close
 *     control.
 */

import { expect, test, type Page, type Route } from "@playwright/test";

async function loadWebIDE(page: Page): Promise<void> {
  await page.goto("/examples/web-ide-demo.html?marketplace=mock", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    () =>
      Boolean(
        (window as { __almostnodeWebIDE?: unknown }).__almostnodeWebIDE,
      ),
    {
      timeout: 90000,
    },
  );
}

async function openKeychainSidebar(page: Page): Promise<void> {
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
}

/**
 * Install a `page.route()` handler that mocks the well-known docs for a fake
 * authorization server hosted at `https://oauth-mock.test`. Both the direct
 * URL and the workbench's CORS-proxy URL pattern are matched, since
 * `oauthFetch` falls back from direct → proxy on failure.
 */
async function mockOAuthMockHost(page: Page): Promise<void> {
  const respondWithJson = async (route: Route, body: unknown): Promise<void> => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  };

  // Direct calls to the fake AS host.
  await page.route("**oauth-mock.test/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/.well-known/oauth-protected-resource")) {
      await respondWithJson(route, {
        resource: "https://oauth-mock.test",
        authorization_servers: ["https://oauth-mock.test"],
        scopes_supported: ["read", "write"],
      });
      return;
    }
    if (url.includes("/.well-known/oauth-authorization-server")) {
      await respondWithJson(route, {
        issuer: "https://oauth-mock.test",
        authorization_endpoint: "https://oauth-mock.test/authorize",
        token_endpoint: "https://oauth-mock.test/token",
        registration_endpoint: "https://oauth-mock.test/register",
        scopes_supported: ["read", "write"],
        code_challenge_methods_supported: ["S256"],
      });
      return;
    }
    await route.fallback();
  });

  // Catch the proxied form too. The workbench in dev hits its internal
  // `/__api/cors-proxy?url=...` proxy when direct fetches fail; tests should
  // be resilient if the direct hop is blocked by the test browser.
  await page.route("**/__api/cors-proxy**", async (route) => {
    const requestUrl = route.request().url();
    const decoded = (() => {
      try {
        const parsed = new URL(requestUrl);
        return parsed.searchParams.get("url") ?? "";
      } catch {
        return "";
      }
    })();
    if (decoded.includes("oauth-protected-resource")) {
      await respondWithJson(route, {
        resource: "https://oauth-mock.test",
        authorization_servers: ["https://oauth-mock.test"],
        scopes_supported: ["read", "write"],
      });
      return;
    }
    if (decoded.includes("oauth-authorization-server")) {
      await respondWithJson(route, {
        issuer: "https://oauth-mock.test",
        authorization_endpoint: "https://oauth-mock.test/authorize",
        token_endpoint: "https://oauth-mock.test/token",
        registration_endpoint: "https://oauth-mock.test/register",
        scopes_supported: ["read", "write"],
        code_challenge_methods_supported: ["S256"],
      });
      return;
    }
    await route.fallback();
  });
}

test.describe("OAuth services — keychain sidebar", () => {
  test("renders the '+ Add OAuth service' button in the keychain sidebar", async ({
    page,
  }) => {
    test.setTimeout(2 * 60 * 1000);
    await loadWebIDE(page);
    await openKeychainSidebar(page);

    const sidebar = page.locator(".almostnode-keychain-sidebar");
    await expect(
      sidebar.getByRole("button", { name: "+ Add OAuth service" }),
    ).toBeVisible();
  });

  test("clicking '+ Add OAuth service' opens the modal in prompt state", async ({
    page,
  }) => {
    test.setTimeout(2 * 60 * 1000);
    await loadWebIDE(page);
    await openKeychainSidebar(page);

    await page
      .locator(".almostnode-keychain-sidebar")
      .getByRole("button", { name: "+ Add OAuth service" })
      .click();

    const dialog = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Add OAuth service")).toBeVisible();
    await expect(dialog.locator("#add-oauth-url")).toBeFocused();
    await expect(
      dialog.getByRole("button", { name: "Discover" }),
    ).toBeDisabled();
  });

  test("walks through prompt → preview when discovery succeeds", async ({
    page,
  }) => {
    test.setTimeout(2 * 60 * 1000);
    await mockOAuthMockHost(page);
    await loadWebIDE(page);
    await openKeychainSidebar(page);

    await page
      .locator(".almostnode-keychain-sidebar")
      .getByRole("button", { name: "+ Add OAuth service" })
      .click();

    const dialog = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(dialog).toBeVisible();

    await dialog.locator("#add-oauth-url").fill("https://oauth-mock.test");
    await dialog.getByRole("button", { name: "Discover" }).click();

    // Discovery succeeds → "Confirm details" headline replaces the prompt one.
    await expect(dialog.getByText("Confirm details")).toBeVisible({
      timeout: 15000,
    });

    // Discovered metadata is summarised in the modal.
    await expect(
      dialog.getByText("https://oauth-mock.test/authorize"),
    ).toBeVisible();
    await expect(
      dialog.getByText("https://oauth-mock.test/token"),
    ).toBeVisible();
    await expect(
      dialog.getByText("https://oauth-mock.test/register"),
    ).toBeVisible();

    // Display name is pre-filled with the AS hostname.
    await expect(dialog.locator("#add-oauth-display")).toHaveValue(
      "oauth-mock.test",
    );

    // Scopes are pre-filled from the AS metadata.
    await expect(dialog.locator("#add-oauth-scopes")).toHaveValue("read write");

    // Connect button is enabled (DCR is advertised, so we're in 'preview' mode
    // not 'manual-client').
    await expect(
      dialog.getByRole("button", { name: "Connect" }),
    ).toBeEnabled();
  });

  test("surfaces an error when the URL has an unsupported scheme", async ({
    page,
  }) => {
    test.setTimeout(2 * 60 * 1000);
    await loadWebIDE(page);
    await openKeychainSidebar(page);

    await page
      .locator(".almostnode-keychain-sidebar")
      .getByRole("button", { name: "+ Add OAuth service" })
      .click();

    const dialog = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(dialog).toBeVisible();

    await dialog.locator("#add-oauth-url").fill("ftp://not-allowed.example.com");
    await dialog.getByRole("button", { name: "Discover" }).click();

    await expect(dialog.getByText("Something went wrong")).toBeVisible({
      timeout: 15000,
    });
    // The discovery error message contains the rejected scheme.
    await expect(dialog.getByText(/ftp/i)).toBeVisible();

    // The error step offers "Try a different URL" since we never reached preview.
    await expect(
      dialog.getByRole("button", { name: "Try a different URL" }),
    ).toBeVisible();
  });

  test("Cancel button closes the modal", async ({ page }) => {
    test.setTimeout(2 * 60 * 1000);
    await loadWebIDE(page);
    await openKeychainSidebar(page);

    await page
      .locator(".almostnode-keychain-sidebar")
      .getByRole("button", { name: "+ Add OAuth service" })
      .click();

    const dialog = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("× close button closes the modal", async ({ page }) => {
    test.setTimeout(2 * 60 * 1000);
    await loadWebIDE(page);
    await openKeychainSidebar(page);

    await page
      .locator(".almostnode-keychain-sidebar")
      .getByRole("button", { name: "+ Add OAuth service" })
      .click();

    const dialog = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
  });
});
