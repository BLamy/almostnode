// @vitest-environment node
import { describe, expect, it } from "vitest"
import configFactory from "../vite.config"

describe("sdk-showcase vite config", () => {
  it("keeps opentui spinner on the same opentui solid module graph", async () => {
    const config =
      typeof configFactory === "function"
        ? await configFactory({
            command: "serve",
            isPreview: false,
            isSsrBuild: false,
            mode: "test",
          })
        : configFactory
    const aliases = Array.isArray(config.resolve?.alias) ? config.resolve.alias : []
    const spinnerAlias = aliases.find((entry) => typeof entry === "object" && "find" in entry && "replacement" in entry)

    expect(spinnerAlias).toBeDefined()
    expect(
      aliases.some(
        (entry) =>
          typeof entry === "object" &&
          "find" in entry &&
          "replacement" in entry &&
          entry.find instanceof RegExp &&
          entry.find.test("opentui-spinner/solid") &&
          typeof entry.replacement === "string" &&
          entry.replacement.endsWith("opentui-spinner/dist/solid.mjs"),
      ),
    ).toBe(true)
    expect(config.optimizeDeps?.exclude).toEqual(
      expect.arrayContaining(["opentui-spinner", "opentui-spinner/solid"]),
    )
  })
})
