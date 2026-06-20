/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import { GitbookEditor } from "../src/features/docstream"

const flushEditor = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe("gitbook editor interactions", () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  beforeAll(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    if (!document.elementFromPoint) {
      document.elementFromPoint = () => document.body
    }
  })

  afterEach(() => {
    root?.unmount()
    container?.remove()
    root = null
    container = null
  })

  it("switches GitBook tab bodies through the tab header", async () => {
    const markdown = [
      "{% tabs %}",
      "{% tab title=\"npm\" %}",
      "npm install",
      "{% endtab %}",
      "{% tab title=\"pnpm\" %}",
      "pnpm add",
      "{% endtab %}",
      "{% endtabs %}",
    ].join("\n")

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<GitbookEditor markdown={markdown} onChange={() => {}} />)
    })

    for (let tries = 0; tries < 5 && !container.querySelector(".gb-tabs-tab"); tries++) {
      await flushEditor()
    }

    let tabs = Array.from(container.querySelectorAll<HTMLElement>(".gb-tabs-tab"))
    expect(tabs).toHaveLength(2)
    expect(tabs[0].classList.contains("gb-tabs-tab-active")).toBe(true)

    const content = container.querySelector<HTMLElement>(".gb-tabs-content")
    expect(content?.dataset.active).toBe("0")
    expect(content?.textContent).toContain("npm install")

    await act(async () => {
      tabs[1].dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    await flushEditor()

    tabs = Array.from(container.querySelectorAll<HTMLElement>(".gb-tabs-tab"))
    expect(tabs[1].classList.contains("gb-tabs-tab-active")).toBe(true)
    expect(content?.dataset.active).toBe("1")
    expect(content?.textContent).toContain("pnpm add")
  })
})
