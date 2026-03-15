/**
 * Minimal "Playwright-Web style" in-browser harness.
 *
 * Provides a Playwright-flavored API for in-browser testing:
 *
 *   const { test, expect } = window.playwrightWeb;
 *
 *   test.describe('Suite', () => {
 *     test('example', async ({ page, authContext }) => {
 *       await page.goto('/home');
 *       await page.getByTestId('header').click();
 *       await expect(page.getByText('Hello')).toBeVisible();
 *     });
 *   });
 *
 * The harness:
 *  - Runs fully in the browser (no Node, no CDP, no browser binaries)
 *  - Targets a specific Document (e.g., an iframe's .contentDocument)
 *  - Handles async tests & simple assertions
 *
 * SELECTOR SYNTAX:
 *  - Standard CSS selectors: 'button', '#id', '.class', '[attr="value"]'
 *  - Playwright text selectors:
 *    - 'button:text("Click me")'  - Button containing "Click me"
 *    - 'div:has-text("Hello")'    - Div containing "Hello"
 *    - 'text="Submit"'            - Any element with text "Submit"
 *
 * PAGE API:
 *  - .locator(selector)           - Create a locator with CSS/text selector
 *  - .getByTestId(id)             - Find by data-testid attribute
 *  - .getByText(text, opts?)      - Find by text content (string or RegExp)
 *  - .getByRole(role, opts?)      - Find by ARIA role (with optional name filter)
 *  - .getByLabel(label)           - Find by associated label text
 *  - .goto(path)                  - Navigate (via onGoto callback)
 *  - .waitForLoadState(state?)    - Wait for load (via onWaitForLoadState callback)
 *  - .waitForTimeout(ms)          - Wait for specified milliseconds
 *  - .waitForURL(pattern)         - Wait briefly for URL change
 *
 * LOCATOR API (page.locator(selector)):
 *  - .locator(selector)    - Find nested elements within this locator
 *  - .getByTestId(id)      - Find nested by data-testid
 *  - .getByText(text,opts) - Find nested by text content
 *  - .getByRole(role,opts) - Find nested by ARIA role
 *  - .getByLabel(label)    - Find nested by label
 *  - .click()              - Click the element
 *  - .fill(value)          - Fill input with value
 *  - .textContent()        - Get text content
 *  - .innerText()          - Get inner text
 *  - .isVisible()          - Check visibility
 *  - .isChecked()          - Check if checkbox/radio is checked
 *  - .getAttribute(name)   - Get attribute value
 *  - .count()              - Count matching elements
 *  - .first()              - Get first matching element as locator
 *  - .last()               - Get last matching element as locator
 *  - .nth(index)           - Get nth matching element as locator
 *  - .all()                - Get all matching elements as array of locators
 *  - .filter({ hasText })  - Filter by text content
 *  - .blur()               - Blur the element
 *  - .press(key)           - Dispatch keyboard events
 *  - .selectOption(value)  - Select option in <select>
 *
 * EXPECT API (value matchers):
 *  - .toBe(expected)              - Strict equality
 *  - .toEqual(expected)           - Deep equality (JSON)
 *  - .toContain(substring)        - String contains
 *  - .toBeGreaterThan(n)          - Number comparison
 *  - .toBeLessThan(n)             - Number comparison
 *  - .toBeGreaterThanOrEqual(n)   - Number comparison
 *  - .toBeLessThanOrEqual(n)      - Number comparison
 *  - .toBeNull()                  - Check for null
 *  - .toBeTruthy()                - Check truthy
 *  - .toBeFalsy()                 - Check falsy
 *  - .toBeUndefined()             - Check undefined
 *  - .toBeDefined()               - Check defined
 *  - .toHaveLength(n)             - Check .length property
 *  - .not.toBe(...)               - Negate any matcher
 *
 * EXPECT API (locator matchers - poll with retry):
 *  - .toBeVisible(opts?)          - Poll until visible (timeout option)
 *  - .toContainText(text)         - Poll until text content includes text
 *  - .toHaveText(text)            - Poll until text content equals text
 *  - .toHaveCount(n)              - Poll until element count equals n
 *  - .toBeChecked(opts?)          - Poll until checked (timeout option)
 */

(function (global) {
  const tests = [];

  let cursorAnimationCallback = null;
  let describePrefix = "";

  function test(name, optionsOrFn, fn) {
    let options = {};
    let testFn = optionsOrFn;

    if (typeof optionsOrFn === "object" && fn) {
      options = optionsOrFn;
      testFn = fn;
    }

    const fullName = describePrefix ? `${describePrefix} > ${name}` : name;
    tests.push({
      name: fullName,
      fn: testFn,
      device: options.device || "desktop",
    });
  }

  test.describe = function (name, fn) {
    const prev = describePrefix;
    describePrefix = prev ? `${prev} > ${name}` : name;
    fn();
    describePrefix = prev;
  };

  test.describe.configure = function () {};
  test.beforeEach = function () {};
  test.afterEach = function () {};

  function clearTests() {
    tests.length = 0;
  }

  function setCursorCallback(callback) {
    cursorAnimationCallback = callback;
  }

  function getElementPosition(el, doc) {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      width: rect.width,
      height: rect.height,
      rect: {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
      },
    };
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function parsePlaywrightSelector(selector) {
    let cssSelector = selector;
    let textFilter = null;

    const textMatch = selector.match(/:text\(["'](.+?)["']\)/);
    if (textMatch) {
      textFilter = textMatch[1];
      cssSelector = selector.replace(/:text\(["'].+?["']\)/, "").trim() || "*";
    }

    const hasTextMatch = selector.match(/:has-text\(["'](.+?)["']\)/);
    if (hasTextMatch) {
      textFilter = hasTextMatch[1];
      cssSelector =
        selector.replace(/:has-text\(["'].+?["']\)/, "").trim() || "*";
    }

    const textEqMatch = selector.match(/^text=["']?(.+?)["']?$/);
    if (textEqMatch) {
      textFilter = textEqMatch[1];
      cssSelector = "*";
    }

    return { cssSelector, textFilter };
  }

  function createLocator(doc, selector, stepTracker, options = {}) {
    const {
      nthIndex,
      filterText: optionFilterText,
      rootElement,
      customQueryFn,
    } = options;

    const { cssSelector, textFilter: parsedTextFilter } = customQueryFn
      ? { cssSelector: null, textFilter: null }
      : parsePlaywrightSelector(selector);

    const filterText =
      optionFilterText !== undefined ? optionFilterText : parsedTextFilter;

    function getLocatorDescription() {
      let desc = customQueryFn ? selector : `locator('${selector}')`;
      if (optionFilterText !== undefined) {
        desc += `.filter({ hasText: '${optionFilterText}' })`;
      }
      if (nthIndex !== undefined) {
        if (nthIndex === 0) desc += ".first()";
        else if (nthIndex === -1) desc += ".last()";
        else desc += `.nth(${nthIndex})`;
      }
      return desc;
    }

    function queryAll() {
      const queryRoot = rootElement || doc;
      if (options.rootElement === null) return [];
      let elements;
      if (customQueryFn) {
        elements = customQueryFn(queryRoot);
      } else {
        elements = Array.from(queryRoot.querySelectorAll(cssSelector));
      }
      if (filterText !== undefined && filterText !== null) {
        elements = elements.filter((el) => {
          const text = el.textContent || el.innerText || "";
          return text.includes(filterText);
        });
      }
      return elements;
    }

    function getTargetElement() {
      const elements = queryAll();
      if (nthIndex !== undefined) {
        if (nthIndex === -1) return elements[elements.length - 1] || null;
        return elements[nthIndex] || null;
      }
      return elements[0] || null;
    }

    const locator = {
      __isLocator: true,
      selector,

      locator(nestedSelector) {
        const targetEl = getTargetElement();
        if (!targetEl) {
          return createLocator(doc, nestedSelector, stepTracker, {
            ...options,
            rootElement: null,
          });
        }
        return createLocator(doc, nestedSelector, stepTracker, {
          rootElement: targetEl,
        });
      },

      first() {
        return createLocator(doc, selector, stepTracker, {
          ...options,
          nthIndex: 0,
        });
      },

      last() {
        return createLocator(doc, selector, stepTracker, {
          ...options,
          nthIndex: -1,
        });
      },

      nth(index) {
        return createLocator(doc, selector, stepTracker, {
          ...options,
          nthIndex: index,
        });
      },

      async all() {
        stepTracker?.checkStop?.();
        const elements = queryAll();
        return elements.map((_, index) =>
          createLocator(doc, selector, stepTracker, {
            ...options,
            nthIndex: index,
          }),
        );
      },

      filter(filterOptions) {
        const { hasText } = filterOptions || {};
        if (hasText !== undefined) {
          return createLocator(doc, selector, stepTracker, {
            ...options,
            filterText: hasText,
          });
        }
        return this;
      },

      click: async () => {
        stepTracker?.checkStop?.();
        let el = getTargetElement();
        const desc = getLocatorDescription();
        if (!el) {
          const error = new Error(`${desc}.click(): element not found`);
          try {
            stepTracker?.addStep({
              type: "action",
              action: "click",
              selector,
              status: "failed",
              error: error.message,
            });
          } catch (e) {
            if (e instanceof StopExecutionError) throw e;
          }
          throw error;
        }

        // Wait for disabled elements to become enabled (React async state)
        if (el.disabled === true) {
          const maxWait = 2000;
          const startTime = Date.now();
          while (Date.now() - startTime < maxWait) {
            await delay(50);
            const freshEl = getTargetElement();
            if (freshEl && !freshEl.disabled) {
              el = freshEl;
              break;
            }
            if (freshEl) el = freshEl;
          }
          const finalEl = getTargetElement();
          if (finalEl) el = finalEl;
          if (el.disabled === true) {
            const error = new Error(
              `${desc}.click(): element is still disabled after waiting`,
            );
            try {
              stepTracker?.addStep({
                type: "action",
                action: "click",
                selector,
                status: "failed",
                error: error.message,
              });
            } catch (e) {
              if (e instanceof StopExecutionError) throw e;
            }
            throw error;
          }
        }

        const position = getElementPosition(el, doc);

        if (cursorAnimationCallback && position) {
          try {
            await cursorAnimationCallback({
              action: "click",
              position,
              selector,
              description: `page.${desc}.click()`,
            });
          } catch (e) {
            console.warn("Cursor animation failed:", e);
          }
        }

        try {
          stepTracker?.addStep({
            type: "action",
            action: "click",
            selector,
            status: "passed",
            description: `page.${desc}.click()`,
            position,
          });
        } catch (e) {
          if (e instanceof StopExecutionError) throw e;
        }

        if (typeof el.click === "function") {
          el.click();
        } else {
          const localDocWindow = doc.defaultView || doc.parentWindow || window;
          const clickEvent = new (localDocWindow?.MouseEvent || MouseEvent)(
            "click",
            {
              bubbles: true,
              cancelable: true,
              view: localDocWindow,
            },
          );
          el.dispatchEvent(clickEvent);
        }
        await delay(0);
      },

      hover: async () => {
        stepTracker?.checkStop?.();
        const el = getTargetElement();
        const desc = getLocatorDescription();
        if (!el) {
          const error = new Error(`${desc}.hover(): element not found`);
          try {
            stepTracker?.addStep({
              type: "action",
              action: "hover",
              selector,
              status: "failed",
              error: error.message,
              description: `page.${desc}.hover()`,
            });
          } catch (e) {
            if (e instanceof StopExecutionError) throw e;
          }
          throw error;
        }

        const position = getElementPosition(el, doc);

        if (cursorAnimationCallback && position) {
          try {
            await cursorAnimationCallback({
              action: "hover",
              position,
              selector,
              description: `page.${desc}.hover()`,
            });
          } catch (e) {
            console.warn("Cursor animation failed:", e);
          }
        }

        try {
          stepTracker?.addStep({
            type: "action",
            action: "hover",
            selector,
            status: "passed",
            description: `page.${desc}.hover()`,
            position,
          });
        } catch (e) {
          if (e instanceof StopExecutionError) throw e;
        }

        const localDocWindow = doc.defaultView || doc.parentWindow || window;
        const ME = localDocWindow?.MouseEvent || MouseEvent;
        el.dispatchEvent(
          new ME("mouseover", {
            bubbles: true,
            cancelable: true,
            view: localDocWindow,
          }),
        );
        el.dispatchEvent(
          new ME("mouseenter", {
            bubbles: false,
            cancelable: false,
            view: localDocWindow,
          }),
        );
        await delay(0);
      },

      clear: async () => {
        stepTracker?.checkStop?.();
        const el = getTargetElement();
        const desc = getLocatorDescription();
        if (!el) {
          const error = new Error(`${desc}.clear(): element not found`);
          try {
            stepTracker?.addStep({
              type: "action",
              action: "clear",
              selector,
              status: "failed",
              error: error.message,
              description: `page.${desc}.clear()`,
            });
          } catch (e) {
            if (e instanceof StopExecutionError) throw e;
          }
          throw error;
        }
        try {
          stepTracker?.addStep({
            type: "action",
            action: "clear",
            selector,
            status: "passed",
            description: `page.${desc}.clear()`,
          });
        } catch (e) {
          if (e instanceof StopExecutionError) throw e;
        }
        if (typeof el.focus === "function") el.focus();
        const localDocWindow = doc.defaultView || doc.parentWindow || window;
        const nativeInputValueSetter = localDocWindow?.HTMLInputElement
          ?.prototype
          ? Object.getOwnPropertyDescriptor(
              localDocWindow.HTMLInputElement.prototype,
              "value",
            )?.set
          : null;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(el, "");
        } else {
          el.value = "";
        }
        const EventCtor = localDocWindow?.Event || Event;
        el.dispatchEvent(
          new EventCtor("input", { bubbles: true, cancelable: true }),
        );
        el.dispatchEvent(new EventCtor("change", { bubbles: true }));
        await delay(0);
      },

      fill: async (value) => {
        stepTracker?.checkStop?.();
        const el = getTargetElement();
        const desc = getLocatorDescription();
        if (!el) {
          const error = new Error(`${desc}.fill(): element not found`);
          try {
            stepTracker?.addStep({
              type: "action",
              action: "fill",
              selector,
              value,
              status: "failed",
              error: error.message,
            });
          } catch (e) {
            if (e instanceof StopExecutionError) throw e;
          }
          throw error;
        }
        if (!("value" in el)) {
          const error = new Error(
            `${desc}.fill(): element does not support .value`,
          );
          try {
            stepTracker?.addStep({
              type: "action",
              action: "fill",
              selector,
              value,
              status: "failed",
              error: error.message,
            });
          } catch (e) {
            if (e instanceof StopExecutionError) throw e;
          }
          throw error;
        }

        const position = getElementPosition(el, doc);

        if (cursorAnimationCallback && position) {
          try {
            await cursorAnimationCallback({
              action: "fill",
              position,
              selector,
              description: `page.${desc}.fill('${value}')`,
              value,
            });
          } catch (e) {
            console.warn("Cursor animation failed:", e);
          }
        }

        try {
          stepTracker?.addStep({
            type: "action",
            action: "fill",
            selector,
            value,
            status: "passed",
            description: `page.${desc}.fill('${value}')`,
            position,
          });
        } catch (e) {
          if (e instanceof StopExecutionError) throw e;
        }

        if (typeof el.focus === "function") el.focus();
        el.value = "";

        const localDocWindow = doc.defaultView || doc.parentWindow || window;
        const nativeInputValueSetter = localDocWindow?.HTMLInputElement
          ?.prototype
          ? Object.getOwnPropertyDescriptor(
              localDocWindow.HTMLInputElement.prototype,
              "value",
            )?.set
          : null;

        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(el, value);
        } else {
          el.value = value;
        }

        const InputEventCtor = localDocWindow?.InputEvent || InputEvent;
        const EventCtor = localDocWindow?.Event || Event;

        let inputEvent;
        try {
          inputEvent = new InputEventCtor("input", {
            bubbles: true,
            cancelable: true,
            inputType: "insertText",
            data: value,
          });
        } catch (e) {
          inputEvent = new EventCtor("input", {
            bubbles: true,
            cancelable: true,
          });
        }
        el.dispatchEvent(inputEvent);
        el.dispatchEvent(
          new EventCtor("change", { bubbles: true, cancelable: true }),
        );
        await delay(150);
      },

      textContent: async () => {
        stepTracker?.checkStop?.();
        const el = getTargetElement();
        const result = el ? el.textContent : null;
        const desc = getLocatorDescription();
        try {
          stepTracker?.addStep({
            type: "query",
            action: "textContent",
            selector,
            status: "passed",
            description: `page.${desc}.textContent()`,
            result,
          });
        } catch (e) {
          if (e instanceof StopExecutionError) throw e;
        }
        return result;
      },

      innerText: async () => {
        stepTracker?.checkStop?.();
        const el = getTargetElement();
        const result = el ? el.innerText : null;
        const desc = getLocatorDescription();
        try {
          stepTracker?.addStep({
            type: "query",
            action: "innerText",
            selector,
            status: "passed",
            description: `page.${desc}.innerText()`,
            result,
          });
        } catch (e) {
          if (e instanceof StopExecutionError) throw e;
        }
        return result;
      },

      isVisible: async () => {
        stepTracker?.checkStop?.();
        const el = getTargetElement();
        const desc = getLocatorDescription();
        if (!el) {
          try {
            stepTracker?.addStep({
              type: "query",
              action: "isVisible",
              selector,
              status: "passed",
              description: `page.${desc}.isVisible()`,
              result: false,
            });
          } catch (e) {
            if (e instanceof StopExecutionError) throw e;
          }
          return false;
        }
        const docView = doc.defaultView || doc.parentWindow;
        if (!docView) return false;
        const style = docView.getComputedStyle(el);
        const result =
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0";
        try {
          stepTracker?.addStep({
            type: "query",
            action: "isVisible",
            selector,
            status: "passed",
            description: `page.${desc}.isVisible()`,
            result,
          });
        } catch (e) {
          if (e instanceof StopExecutionError) throw e;
        }
        return result;
      },

      isChecked: async () => {
        stepTracker?.checkStop?.();
        const el = getTargetElement();
        const desc = getLocatorDescription();
        const result = el ? !!el.checked : false;
        try {
          stepTracker?.addStep({
            type: "query",
            action: "isChecked",
            selector,
            status: "passed",
            description: `page.${desc}.isChecked()`,
            result,
          });
        } catch (e) {
          if (e instanceof StopExecutionError) throw e;
        }
        return result;
      },

      getAttribute: async (attrName) => {
        stepTracker?.checkStop?.();
        const el = getTargetElement();
        const result = el ? el.getAttribute(attrName) : null;
        const desc = getLocatorDescription();
        try {
          stepTracker?.addStep({
            type: "query",
            action: "getAttribute",
            selector,
            status: "passed",
            description: `page.${desc}.getAttribute('${attrName}')`,
            result,
          });
        } catch (e) {
          if (e instanceof StopExecutionError) throw e;
        }
        return result;
      },

      count: async () => {
        stepTracker?.checkStop?.();
        const result = queryAll().length;
        const desc = getLocatorDescription();
        try {
          stepTracker?.addStep({
            type: "query",
            action: "count",
            selector,
            status: "passed",
            description: `page.${desc}.count()`,
            result,
          });
        } catch (e) {
          if (e instanceof StopExecutionError) throw e;
        }
        return result;
      },

      // Scoped getBy* methods
      getByTestId: (id) => {
        const targetEl = getTargetElement();
        return createLocator(doc, `[data-testid="${id}"]`, stepTracker, {
          rootElement: targetEl || null,
        });
      },

      getByText: (text, opts) => {
        const targetEl = getTargetElement();
        return createTextLocator(doc, text, opts, stepTracker, {
          rootElement: targetEl || null,
        });
      },

      getByRole: (role, opts) => {
        const targetEl = getTargetElement();
        return createRoleLocator(doc, role, opts, stepTracker, {
          rootElement: targetEl || null,
        });
      },

      getByLabel: (label) => {
        const targetEl = getTargetElement();
        return createLabelLocator(doc, label, stepTracker, {
          rootElement: targetEl || null,
        });
      },

      // Additional action methods
      blur: async () => {
        stepTracker?.checkStop?.();
        const el = getTargetElement();
        const desc = getLocatorDescription();
        if (el && typeof el.blur === "function") {
          el.blur();
        }
        try {
          stepTracker?.addStep({
            type: "action",
            action: "blur",
            selector,
            status: "passed",
            description: `page.${desc}.blur()`,
          });
        } catch (e) {
          if (e instanceof StopExecutionError) throw e;
        }
        await delay(0);
      },

      press: async (key) => {
        stepTracker?.checkStop?.();
        const el = getTargetElement();
        const desc = getLocatorDescription();
        if (!el) {
          const error = new Error(`${desc}.press(): element not found`);
          try {
            stepTracker?.addStep({
              type: "action",
              action: "press",
              selector,
              status: "failed",
              error: error.message,
            });
          } catch (e) {
            if (e instanceof StopExecutionError) throw e;
          }
          throw error;
        }
        if (typeof el.focus === "function") el.focus();
        const localDocWindow = doc.defaultView || doc.parentWindow || window;
        const KE = localDocWindow?.KeyboardEvent || KeyboardEvent;
        el.dispatchEvent(
          new KE("keydown", { key, bubbles: true, cancelable: true }),
        );
        el.dispatchEvent(
          new KE("keypress", { key, bubbles: true, cancelable: true }),
        );
        el.dispatchEvent(
          new KE("keyup", { key, bubbles: true, cancelable: true }),
        );
        try {
          stepTracker?.addStep({
            type: "action",
            action: "press",
            selector,
            status: "passed",
            description: `page.${desc}.press('${key}')`,
          });
        } catch (e) {
          if (e instanceof StopExecutionError) throw e;
        }
        await delay(0);
      },

      selectOption: async (value) => {
        stepTracker?.checkStop?.();
        const el = getTargetElement();
        const desc = getLocatorDescription();
        if (!el) {
          const error = new Error(`${desc}.selectOption(): element not found`);
          try {
            stepTracker?.addStep({
              type: "action",
              action: "selectOption",
              selector,
              status: "failed",
              error: error.message,
            });
          } catch (e) {
            if (e instanceof StopExecutionError) throw e;
          }
          throw error;
        }
        const values = Array.isArray(value) ? value : [value];
        if (el.tagName === "SELECT") {
          for (const opt of el.options) {
            opt.selected =
              values.includes(opt.value) ||
              values.includes(opt.textContent?.trim());
          }
        }
        const localDocWindow = doc.defaultView || doc.parentWindow || window;
        const EventCtor = localDocWindow?.Event || Event;
        el.dispatchEvent(new EventCtor("change", { bubbles: true }));
        try {
          stepTracker?.addStep({
            type: "action",
            action: "selectOption",
            selector,
            value,
            status: "passed",
            description: `page.${desc}.selectOption(${JSON.stringify(value)})`,
          });
        } catch (e) {
          if (e instanceof StopExecutionError) throw e;
        }
        await delay(50);
      },

      // Raw query methods for expect polling (no step tracking)
      _rawIsVisible: () => {
        const el = getTargetElement();
        if (!el) return false;
        const docView = doc.defaultView || doc.parentWindow;
        if (!docView) return false;
        const style = docView.getComputedStyle(el);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0"
        );
      },

      _rawTextContent: () => {
        const el = getTargetElement();
        return el ? el.textContent : null;
      },

      _rawCount: () => {
        return queryAll().length;
      },

      _rawIsChecked: () => {
        const el = getTargetElement();
        return el ? !!el.checked : false;
      },

      _rawGetTargetElement: () => {
        return getTargetElement();
      },
    };

    return locator;
  }

  // ── Locator factory: getByText ──

  function createTextLocator(doc, text, opts, stepTracker, parentOptions) {
    const exact = opts && opts.exact;
    const isRegex = text instanceof RegExp;
    const selectorDesc = isRegex
      ? `getByText(${text})`
      : `getByText('${text}'${exact ? ", { exact: true }" : ""})`;

    return createLocator(doc, selectorDesc, stepTracker, {
      ...parentOptions,
      customQueryFn: (root) => {
        const allElements = root.querySelectorAll("*");
        const matches = [];
        for (const el of allElements) {
          const content = el.textContent || "";
          let matched = false;
          if (isRegex) {
            matched = text.test(content);
          } else if (exact) {
            matched = content.trim() === text;
          } else {
            matched = content.includes(text);
          }
          if (matched) {
            // Prefer leaf-ish elements: only add if no child also matches
            let childMatches = false;
            for (const child of el.children) {
              const childContent = child.textContent || "";
              if (
                isRegex
                  ? text.test(childContent)
                  : exact
                    ? childContent.trim() === text
                    : childContent.includes(text)
              ) {
                childMatches = true;
                break;
              }
            }
            if (!childMatches) {
              matches.push(el);
            }
          }
        }
        return matches;
      },
    });
  }

  // ── Locator factory: getByRole ──

  function createRoleLocator(doc, role, opts, stepTracker, parentOptions) {
    const roleSelectors = {
      button:
        'button, [role="button"], input[type="button"], input[type="submit"]',
      listbox: '[role="listbox"], select',
      textbox:
        'input:not([type]), input[type="text"], input[type="email"], input[type="password"], input[type="search"], input[type="tel"], input[type="url"], textarea, [role="textbox"], [contenteditable="true"]',
      link: 'a[href], [role="link"]',
      heading: 'h1, h2, h3, h4, h5, h6, [role="heading"]',
      checkbox: 'input[type="checkbox"], [role="checkbox"]',
      radio: 'input[type="radio"], [role="radio"]',
      dialog: 'dialog, [role="dialog"]',
      option: 'option, [role="option"]',
      row: 'tr, [role="row"]',
      cell: 'td, th, [role="cell"], [role="gridcell"]',
      table: 'table, [role="table"], [role="grid"]',
      tab: '[role="tab"]',
      tabpanel: '[role="tabpanel"]',
      combobox: '[role="combobox"]',
      menu: '[role="menu"]',
      menuitem: '[role="menuitem"]',
      navigation: 'nav, [role="navigation"]',
      img: 'img, [role="img"]',
      list: 'ul, ol, [role="list"]',
      listitem: 'li, [role="listitem"]',
      progressbar: 'progress, [role="progressbar"]',
      spinbutton: 'input[type="number"], [role="spinbutton"]',
      switch: '[role="switch"]',
      separator: 'hr, [role="separator"]',
      alert: '[role="alert"]',
      status: '[role="status"]',
      tooltip: '[role="tooltip"]',
    };

    const cssSelectors = roleSelectors[role] || `[role="${role}"]`;
    const name = opts && opts.name;
    const selectorDesc = name
      ? `getByRole('${role}', { name: '${name}' })`
      : `getByRole('${role}')`;

    return createLocator(doc, selectorDesc, stepTracker, {
      ...parentOptions,
      customQueryFn: (root) => {
        let elements = Array.from(root.querySelectorAll(cssSelectors));
        if (name !== undefined && name !== null) {
          elements = elements.filter((el) => {
            const accessibleName =
              el.getAttribute("aria-label") ||
              el.getAttribute("title") ||
              el.textContent?.trim() ||
              "";
            if (name instanceof RegExp) return name.test(accessibleName);
            return accessibleName.includes(name);
          });
        }
        return elements;
      },
    });
  }

  // ── Locator factory: getByLabel ──

  function createLabelLocator(doc, label, stepTracker, parentOptions) {
    const selectorDesc = `getByLabel('${label}')`;

    return createLocator(doc, selectorDesc, stepTracker, {
      ...parentOptions,
      customQueryFn: (root) => {
        const results = [];

        // Match by aria-label
        try {
          const ariaLabeled = root.querySelectorAll("[aria-label]");
          for (const el of ariaLabeled) {
            if (el.getAttribute("aria-label").includes(label)) {
              results.push(el);
            }
          }
        } catch (e) {
          /* ignore */
        }

        // Match by associated label elements
        const labels = root.querySelectorAll("label");
        for (const labelEl of labels) {
          if (labelEl.textContent && labelEl.textContent.includes(label)) {
            const forAttr = labelEl.getAttribute("for");
            if (forAttr) {
              try {
                const input = root.querySelector("#" + CSS.escape(forAttr));
                if (input && !results.includes(input)) results.push(input);
              } catch (e) {
                /* ignore */
              }
            } else {
              const input = labelEl.querySelector("input, textarea, select");
              if (input && !results.includes(input)) results.push(input);
            }
          }
        }

        return results;
      },
    });
  }

  function normalizeActual(actual) {
    if (typeof actual === "function") return Promise.resolve(actual());
    return Promise.resolve(actual);
  }

  function expect(actual, stepTracker, negated = false) {
    const notPrefix = negated ? ".not" : "";

    function addStepSafe(step) {
      try {
        stepTracker?.addStep(step);
      } catch (e) {
        if (e instanceof StopExecutionError) throw e;
      }
    }

    const matchers = {
      async toBe(expected) {
        stepTracker?.checkStop?.();
        const value = await normalizeActual(actual);
        let passed = value === expected;
        if (negated) passed = !passed;
        const description = `expect(${JSON.stringify(value)})${notPrefix}.toBe(${JSON.stringify(expected)})`;
        const errorMsg = negated
          ? `expected ${JSON.stringify(value)} not to be ${JSON.stringify(expected)}`
          : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`;
        addStepSafe({
          type: "assertion",
          action: "toBe",
          expected,
          actual: value,
          status: passed ? "passed" : "failed",
          description,
          error: passed ? null : errorMsg,
        });
        if (!passed)
          throw new Error(`expect(...)${notPrefix}.toBe(): ${errorMsg}`);
      },

      async toMatch(pattern) {
        stepTracker?.checkStop?.();
        const value = await normalizeActual(actual);
        const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
        let passed = value != null && regex.test(String(value));
        if (negated) passed = !passed;
        const description = `expect(${JSON.stringify(value)})${notPrefix}.toMatch(${pattern})`;
        const errorMsg = negated
          ? `expected ${JSON.stringify(value)} not to match ${pattern}`
          : `expected ${JSON.stringify(value)} to match ${pattern}`;
        addStepSafe({
          type: "assertion",
          action: "toMatch",
          expected: String(pattern),
          actual: value,
          status: passed ? "passed" : "failed",
          description,
          error: passed ? null : errorMsg,
        });
        if (!passed)
          throw new Error(`expect(...)${notPrefix}.toMatch(): ${errorMsg}`);
      },

      async toContain(expectedSubstring) {
        stepTracker?.checkStop?.();
        const value = await normalizeActual(actual);
        let passed = value != null && String(value).includes(expectedSubstring);
        if (negated) passed = !passed;
        const description = `expect(${JSON.stringify(value)})${notPrefix}.toContain('${expectedSubstring}')`;
        const errorMsg = negated
          ? `expected ${JSON.stringify(value)} not to contain ${JSON.stringify(expectedSubstring)}`
          : `expected to find ${JSON.stringify(expectedSubstring)} in ${JSON.stringify(value)}`;
        addStepSafe({
          type: "assertion",
          action: "toContain",
          expected: expectedSubstring,
          actual: value,
          status: passed ? "passed" : "failed",
          description,
          error: passed ? null : errorMsg,
        });
        if (!passed)
          throw new Error(`expect(...)${notPrefix}.toContain(): ${errorMsg}`);
      },

      async toEqual(expected) {
        stepTracker?.checkStop?.();
        const value = await normalizeActual(actual);
        const actualStr = JSON.stringify(value);
        const expectedStr = JSON.stringify(expected);
        let passed = actualStr === expectedStr;
        if (negated) passed = !passed;
        const description = `expect(${actualStr})${notPrefix}.toEqual(${expectedStr})`;
        const errorMsg = negated
          ? `expected ${actualStr} not to equal ${expectedStr}`
          : `expected ${expectedStr}, got ${actualStr}`;
        addStepSafe({
          type: "assertion",
          action: "toEqual",
          expected,
          actual: value,
          status: passed ? "passed" : "failed",
          description,
          error: passed ? null : errorMsg,
        });
        if (!passed)
          throw new Error(`expect(...)${notPrefix}.toEqual(): ${errorMsg}`);
      },

      async toBeGreaterThan(expected) {
        stepTracker?.checkStop?.();
        const value = await normalizeActual(actual);
        let passed = value > expected;
        if (negated) passed = !passed;
        const description = `expect(${value})${notPrefix}.toBeGreaterThan(${expected})`;
        const errorMsg = negated
          ? `expected ${value} not to be greater than ${expected}`
          : `expected ${value} to be greater than ${expected}`;
        addStepSafe({
          type: "assertion",
          action: "toBeGreaterThan",
          expected,
          actual: value,
          status: passed ? "passed" : "failed",
          description,
          error: passed ? null : errorMsg,
        });
        if (!passed)
          throw new Error(
            `expect(...)${notPrefix}.toBeGreaterThan(): ${errorMsg}`,
          );
      },

      async toBeLessThan(expected) {
        stepTracker?.checkStop?.();
        const value = await normalizeActual(actual);
        let passed = value < expected;
        if (negated) passed = !passed;
        const description = `expect(${value})${notPrefix}.toBeLessThan(${expected})`;
        const errorMsg = negated
          ? `expected ${value} not to be less than ${expected}`
          : `expected ${value} to be less than ${expected}`;
        addStepSafe({
          type: "assertion",
          action: "toBeLessThan",
          expected,
          actual: value,
          status: passed ? "passed" : "failed",
          description,
          error: passed ? null : errorMsg,
        });
        if (!passed)
          throw new Error(
            `expect(...)${notPrefix}.toBeLessThan(): ${errorMsg}`,
          );
      },

      async toBeGreaterThanOrEqual(expected) {
        stepTracker?.checkStop?.();
        const value = await normalizeActual(actual);
        let passed = value >= expected;
        if (negated) passed = !passed;
        const description = `expect(${value})${notPrefix}.toBeGreaterThanOrEqual(${expected})`;
        const errorMsg = negated
          ? `expected ${value} not to be >= ${expected}`
          : `expected ${value} to be >= ${expected}`;
        addStepSafe({
          type: "assertion",
          action: "toBeGreaterThanOrEqual",
          expected,
          actual: value,
          status: passed ? "passed" : "failed",
          description,
          error: passed ? null : errorMsg,
        });
        if (!passed)
          throw new Error(
            `expect(...)${notPrefix}.toBeGreaterThanOrEqual(): ${errorMsg}`,
          );
      },

      async toBeLessThanOrEqual(expected) {
        stepTracker?.checkStop?.();
        const value = await normalizeActual(actual);
        let passed = value <= expected;
        if (negated) passed = !passed;
        const description = `expect(${value})${notPrefix}.toBeLessThanOrEqual(${expected})`;
        const errorMsg = negated
          ? `expected ${value} not to be <= ${expected}`
          : `expected ${value} to be <= ${expected}`;
        addStepSafe({
          type: "assertion",
          action: "toBeLessThanOrEqual",
          expected,
          actual: value,
          status: passed ? "passed" : "failed",
          description,
          error: passed ? null : errorMsg,
        });
        if (!passed)
          throw new Error(
            `expect(...)${notPrefix}.toBeLessThanOrEqual(): ${errorMsg}`,
          );
      },

      async toBeNull() {
        stepTracker?.checkStop?.();
        const value = await normalizeActual(actual);
        let passed = value === null;
        if (negated) passed = !passed;
        const description = `expect(${JSON.stringify(value)})${notPrefix}.toBeNull()`;
        const errorMsg = negated
          ? `expected ${JSON.stringify(value)} not to be null`
          : `expected null, got ${JSON.stringify(value)}`;
        addStepSafe({
          type: "assertion",
          action: "toBeNull",
          expected: null,
          actual: value,
          status: passed ? "passed" : "failed",
          description,
          error: passed ? null : errorMsg,
        });
        if (!passed)
          throw new Error(`expect(...)${notPrefix}.toBeNull(): ${errorMsg}`);
      },

      async toBeTruthy() {
        stepTracker?.checkStop?.();
        const value = await normalizeActual(actual);
        let passed = !!value;
        if (negated) passed = !passed;
        const description = `expect(${JSON.stringify(value)})${notPrefix}.toBeTruthy()`;
        const errorMsg = negated
          ? `expected ${JSON.stringify(value)} to be falsy`
          : `expected ${JSON.stringify(value)} to be truthy`;
        addStepSafe({
          type: "assertion",
          action: "toBeTruthy",
          expected: true,
          actual: value,
          status: passed ? "passed" : "failed",
          description,
          error: passed ? null : errorMsg,
        });
        if (!passed)
          throw new Error(`expect(...)${notPrefix}.toBeTruthy(): ${errorMsg}`);
      },

      async toBeFalsy() {
        stepTracker?.checkStop?.();
        const value = await normalizeActual(actual);
        let passed = !value;
        if (negated) passed = !passed;
        const description = `expect(${JSON.stringify(value)})${notPrefix}.toBeFalsy()`;
        const errorMsg = negated
          ? `expected ${JSON.stringify(value)} to be truthy`
          : `expected ${JSON.stringify(value)} to be falsy`;
        addStepSafe({
          type: "assertion",
          action: "toBeFalsy",
          expected: false,
          actual: value,
          status: passed ? "passed" : "failed",
          description,
          error: passed ? null : errorMsg,
        });
        if (!passed)
          throw new Error(`expect(...)${notPrefix}.toBeFalsy(): ${errorMsg}`);
      },

      async toBeUndefined() {
        stepTracker?.checkStop?.();
        const value = await normalizeActual(actual);
        let passed = value === undefined;
        if (negated) passed = !passed;
        const description = `expect(${JSON.stringify(value)})${notPrefix}.toBeUndefined()`;
        const errorMsg = negated
          ? `expected ${JSON.stringify(value)} not to be undefined`
          : `expected undefined, got ${JSON.stringify(value)}`;
        addStepSafe({
          type: "assertion",
          action: "toBeUndefined",
          expected: undefined,
          actual: value,
          status: passed ? "passed" : "failed",
          description,
          error: passed ? null : errorMsg,
        });
        if (!passed)
          throw new Error(
            `expect(...)${notPrefix}.toBeUndefined(): ${errorMsg}`,
          );
      },

      async toBeDefined() {
        stepTracker?.checkStop?.();
        const value = await normalizeActual(actual);
        let passed = value !== undefined;
        if (negated) passed = !passed;
        const description = `expect(${JSON.stringify(value)})${notPrefix}.toBeDefined()`;
        const errorMsg = negated
          ? `expected ${JSON.stringify(value)} to be undefined`
          : `expected value to be defined, got undefined`;
        addStepSafe({
          type: "assertion",
          action: "toBeDefined",
          expected: "defined",
          actual: value,
          status: passed ? "passed" : "failed",
          description,
          error: passed ? null : errorMsg,
        });
        if (!passed)
          throw new Error(`expect(...)${notPrefix}.toBeDefined(): ${errorMsg}`);
      },

      // ── Locator-aware matchers (poll with retry) ──

      async toBeVisible(opts) {
        stepTracker?.checkStop?.();
        if (!actual || !actual.__isLocator) {
          throw new Error("toBeVisible() can only be used with locators");
        }
        const timeout = (opts && opts.timeout) || 5000;
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const visible = actual._rawIsVisible();
          const passed = negated ? !visible : visible;
          if (passed) {
            addStepSafe({
              type: "assertion",
              action: "toBeVisible",
              status: "passed",
              description: `expect(${actual.selector})${notPrefix}.toBeVisible()`,
            });
            return;
          }
          await delay(100);
        }
        const errorMsg = negated
          ? `expected '${actual.selector}' not to be visible after ${timeout}ms`
          : `expected '${actual.selector}' to be visible after ${timeout}ms`;
        addStepSafe({
          type: "assertion",
          action: "toBeVisible",
          status: "failed",
          description: `expect(${actual.selector})${notPrefix}.toBeVisible()`,
          error: errorMsg,
        });
        throw new Error(`expect(...)${notPrefix}.toBeVisible(): ${errorMsg}`);
      },

      async toContainText(expected) {
        stepTracker?.checkStop?.();
        if (!actual || !actual.__isLocator) {
          throw new Error("toContainText() can only be used with locators");
        }
        const isRegex = expected instanceof RegExp;
        const timeout = 5000;
        const start = Date.now();
        let lastText = null;
        while (Date.now() - start < timeout) {
          lastText = actual._rawTextContent();
          const contained =
            lastText != null &&
            (isRegex ? expected.test(lastText) : lastText.includes(expected));
          const passed = negated ? !contained : contained;
          if (passed) {
            addStepSafe({
              type: "assertion",
              action: "toContainText",
              expected,
              actual: lastText,
              status: "passed",
              description: `expect(${actual.selector})${notPrefix}.toContainText(${isRegex ? expected : "'" + expected + "'"})`,
            });
            return;
          }
          await delay(100);
        }
        const errorMsg = negated
          ? `expected '${actual.selector}' not to contain ${isRegex ? expected : "'" + expected + "'"}, got '${lastText}'`
          : `expected '${actual.selector}' to contain ${isRegex ? expected : "'" + expected + "'"}, got '${lastText}'`;
        addStepSafe({
          type: "assertion",
          action: "toContainText",
          expected,
          actual: lastText,
          status: "failed",
          description: `expect(${actual.selector})${notPrefix}.toContainText(${isRegex ? expected : "'" + expected + "'"})`,
          error: errorMsg,
        });
        throw new Error(`expect(...)${notPrefix}.toContainText(): ${errorMsg}`);
      },

      async toHaveText(expected) {
        stepTracker?.checkStop?.();
        if (!actual || !actual.__isLocator) {
          throw new Error("toHaveText() can only be used with locators");
        }
        const timeout = 5000;
        const start = Date.now();
        let lastText = null;
        while (Date.now() - start < timeout) {
          lastText = actual._rawTextContent();
          const trimmed = lastText != null ? lastText.trim() : null;
          let matches;
          if (expected instanceof RegExp) {
            matches = trimmed != null && expected.test(trimmed);
          } else {
            matches = trimmed === expected;
          }
          const passed = negated ? !matches : matches;
          if (passed) {
            addStepSafe({
              type: "assertion",
              action: "toHaveText",
              expected,
              actual: lastText,
              status: "passed",
              description: `expect(${actual.selector})${notPrefix}.toHaveText('${expected}')`,
            });
            return;
          }
          await delay(100);
        }
        const errorMsg = negated
          ? `expected '${actual.selector}' text not to be '${expected}', got '${lastText?.trim()}'`
          : `expected '${actual.selector}' text to be '${expected}', got '${lastText?.trim()}'`;
        addStepSafe({
          type: "assertion",
          action: "toHaveText",
          expected,
          actual: lastText,
          status: "failed",
          description: `expect(${actual.selector})${notPrefix}.toHaveText('${expected}')`,
          error: errorMsg,
        });
        throw new Error(`expect(...)${notPrefix}.toHaveText(): ${errorMsg}`);
      },

      async toHaveCount(expected) {
        stepTracker?.checkStop?.();
        if (!actual || !actual.__isLocator) {
          throw new Error("toHaveCount() can only be used with locators");
        }
        const timeout = 5000;
        const start = Date.now();
        let lastCount = 0;
        while (Date.now() - start < timeout) {
          lastCount = actual._rawCount();
          const passed = negated
            ? lastCount !== expected
            : lastCount === expected;
          if (passed) {
            addStepSafe({
              type: "assertion",
              action: "toHaveCount",
              expected,
              actual: lastCount,
              status: "passed",
              description: `expect(${actual.selector})${notPrefix}.toHaveCount(${expected})`,
            });
            return;
          }
          await delay(100);
        }
        const errorMsg = negated
          ? `expected '${actual.selector}' not to have count ${expected}, but it does`
          : `expected '${actual.selector}' to have count ${expected}, got ${lastCount}`;
        addStepSafe({
          type: "assertion",
          action: "toHaveCount",
          expected,
          actual: lastCount,
          status: "failed",
          description: `expect(${actual.selector})${notPrefix}.toHaveCount(${expected})`,
          error: errorMsg,
        });
        throw new Error(`expect(...)${notPrefix}.toHaveCount(): ${errorMsg}`);
      },

      async toBeChecked(opts) {
        stepTracker?.checkStop?.();
        if (!actual || !actual.__isLocator) {
          throw new Error("toBeChecked() can only be used with locators");
        }
        const timeout = (opts && opts.timeout) || 5000;
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const checked = actual._rawIsChecked();
          const passed = negated ? !checked : checked;
          if (passed) {
            addStepSafe({
              type: "assertion",
              action: "toBeChecked",
              status: "passed",
              description: `expect(${actual.selector})${notPrefix}.toBeChecked()`,
            });
            return;
          }
          await delay(100);
        }
        const errorMsg = negated
          ? `expected element not to be checked after ${timeout}ms`
          : `expected element to be checked after ${timeout}ms`;
        addStepSafe({
          type: "assertion",
          action: "toBeChecked",
          status: "failed",
          description: `expect(${actual.selector})${notPrefix}.toBeChecked()`,
          error: errorMsg,
        });
        throw new Error(`expect(...)${notPrefix}.toBeChecked(): ${errorMsg}`);
      },

      async toHaveValue(expected) {
        stepTracker?.checkStop?.();
        if (!actual || !actual.__isLocator) {
          throw new Error("toHaveValue() can only be used with locators");
        }
        const timeout = 5000;
        const start = Date.now();
        let lastValue = undefined;
        while (Date.now() - start < timeout) {
          const el = actual._rawGetTargetElement
            ? actual._rawGetTargetElement()
            : null;
          lastValue = el ? el.value : undefined;
          const matches =
            expected instanceof RegExp
              ? expected.test(lastValue || "")
              : lastValue === expected;
          const passed = negated ? !matches : matches;
          if (passed) {
            addStepSafe({
              type: "assertion",
              action: "toHaveValue",
              expected,
              actual: lastValue,
              status: "passed",
              description: `expect(${actual.selector})${notPrefix}.toHaveValue('${expected}')`,
            });
            return;
          }
          await delay(100);
        }
        const errorMsg = negated
          ? `expected '${actual.selector}' value not to be '${expected}', got '${lastValue}'`
          : `expected '${actual.selector}' value to be '${expected}', got '${lastValue}'`;
        addStepSafe({
          type: "assertion",
          action: "toHaveValue",
          expected,
          actual: lastValue,
          status: "failed",
          description: `expect(${actual.selector})${notPrefix}.toHaveValue('${expected}')`,
          error: errorMsg,
        });
        throw new Error(`expect(...)${notPrefix}.toHaveValue(): ${errorMsg}`);
      },

      async toHaveAttribute(name, expected) {
        stepTracker?.checkStop?.();
        if (!actual || !actual.__isLocator) {
          throw new Error("toHaveAttribute() can only be used with locators");
        }
        const timeout = 5000;
        const start = Date.now();
        let lastAttr = null;
        while (Date.now() - start < timeout) {
          const el = actual._rawGetTargetElement
            ? actual._rawGetTargetElement()
            : null;
          lastAttr = el ? el.getAttribute(name) : null;
          let matches;
          if (expected === undefined) {
            matches = lastAttr !== null;
          } else if (expected instanceof RegExp) {
            matches = lastAttr != null && expected.test(lastAttr);
          } else {
            matches = lastAttr === expected;
          }
          const passed = negated ? !matches : matches;
          if (passed) {
            addStepSafe({
              type: "assertion",
              action: "toHaveAttribute",
              expected,
              actual: lastAttr,
              status: "passed",
              description: `expect(${actual.selector})${notPrefix}.toHaveAttribute('${name}', '${expected}')`,
            });
            return;
          }
          await delay(100);
        }
        const errorMsg = negated
          ? `expected '${actual.selector}' attribute '${name}' not to be '${expected}', got '${lastAttr}'`
          : `expected '${actual.selector}' attribute '${name}' to be '${expected}', got '${lastAttr}'`;
        addStepSafe({
          type: "assertion",
          action: "toHaveAttribute",
          expected,
          actual: lastAttr,
          status: "failed",
          description: `expect(${actual.selector})${notPrefix}.toHaveAttribute('${name}', '${expected}')`,
          error: errorMsg,
        });
        throw new Error(
          `expect(...)${notPrefix}.toHaveAttribute(): ${errorMsg}`,
        );
      },

      async toHaveURL(expected) {
        stepTracker?.checkStop?.();
        const timeout = 5000;
        const start = Date.now();
        let lastUrl = "";
        while (Date.now() - start < timeout) {
          lastUrl =
            actual && actual._getUrl
              ? actual._getUrl()
              : window.location.pathname + window.location.search;
          // Strip virtual proxy prefix and query params for matching
          var urlPath = lastUrl
            .replace(/^\/__(virtual|dev)__\/\d+/, "")
            .split("?")[0];
          let matches;
          if (expected instanceof RegExp) {
            matches = expected.test(urlPath) || expected.test(lastUrl);
          } else {
            matches =
              urlPath === expected ||
              lastUrl === expected ||
              urlPath.endsWith(expected);
          }
          const passed = negated ? !matches : matches;
          if (passed) {
            addStepSafe({
              type: "assertion",
              action: "toHaveURL",
              expected,
              actual: lastUrl,
              status: "passed",
              description: `expect(page)${notPrefix}.toHaveURL('${expected}')`,
            });
            return;
          }
          await delay(100);
        }
        const errorMsg = negated
          ? `expected URL not to match '${expected}', got '${lastUrl}'`
          : `expected URL to match '${expected}', got '${lastUrl}'`;
        addStepSafe({
          type: "assertion",
          action: "toHaveURL",
          expected,
          actual: lastUrl,
          status: "failed",
          description: `expect(page)${notPrefix}.toHaveURL('${expected}')`,
          error: errorMsg,
        });
        throw new Error(`expect(...)${notPrefix}.toHaveURL(): ${errorMsg}`);
      },

      async toHaveLength(expected) {
        stepTracker?.checkStop?.();
        const value = await normalizeActual(actual);
        const length = value != null ? value.length : undefined;
        let passed = length === expected;
        if (negated) passed = !passed;
        const description = `expect(...)${notPrefix}.toHaveLength(${expected})`;
        const errorMsg = negated
          ? `expected length not to be ${expected}, but it was`
          : `expected length ${expected}, got ${length}`;
        addStepSafe({
          type: "assertion",
          action: "toHaveLength",
          expected,
          actual: length,
          status: passed ? "passed" : "failed",
          description,
          error: passed ? null : errorMsg,
        });
        if (!passed)
          throw new Error(
            `expect(...)${notPrefix}.toHaveLength(): ${errorMsg}`,
          );
      },
    };

    if (!negated) {
      matchers.not = expect(actual, stepTracker, true);
    }

    return matchers;
  }

  // Special error to stop test execution cleanly
  class StopExecutionError extends Error {
    constructor() {
      super("Test execution stopped at requested step");
      this.name = "StopExecutionError";
    }
  }

  function buildPageObject(targetDocument, stepTracker, options) {
    return {
      __isPage: true,
      locator: (selector) =>
        createLocator(targetDocument, selector, stepTracker),
      getByTestId: (id) =>
        createLocator(targetDocument, `[data-testid="${id}"]`, stepTracker),
      getByText: (text, opts) =>
        createTextLocator(targetDocument, text, opts, stepTracker),
      getByRole: (role, opts) =>
        createRoleLocator(targetDocument, role, opts, stepTracker),
      getByLabel: (label) =>
        createLabelLocator(targetDocument, label, stepTracker),
      goto: options.onGoto || (async () => {}),
      waitForLoadState:
        options.onWaitForLoadState ||
        (async () => {
          await delay(1000);
        }),
      waitForTimeout: async (ms) => {
        stepTracker.addStep({
          type: "action",
          action: "waitForTimeout",
          ms,
          status: "passed",
          description: `page.waitForTimeout(${ms})`,
        });
        await delay(ms);
      },
      waitForURL: async () => {
        await delay(500);
      },
      evaluate: async (fn) => {
        try {
          const docWin =
            targetDocument.defaultView || targetDocument.parentWindow || window;
          return await fn.call(docWin);
        } catch (e) {
          console.warn("[pw-web] page.evaluate() error:", e);
          return undefined;
        }
      },
      _getUrl: () => {
        try {
          const docWin =
            targetDocument.defaultView || targetDocument.parentWindow;
          if (docWin && docWin.location)
            return docWin.location.pathname + docWin.location.search;
        } catch (e) {
          /* cross-origin */
        }
        return window.location.pathname + window.location.search;
      },
    };
  }

  async function runTests(options) {
    const {
      targetDocument,
      onTestBegin = () => {},
      onTestEnd = () => {},
      onStep = () => {},
      onGoto,
      onWaitForLoadState,
      fixtures = {},
    } = options || {};

    if (!targetDocument)
      throw new Error("runTests: targetDocument is required");

    const results = [];
    const originalExpect = global.playwrightWeb.expect;

    for (let testIndex = 0; testIndex < tests.length; testIndex++) {
      const { name, fn } = tests[testIndex];
      const steps = [];
      let currentStepIndex = 0;

      const stepTracker = {
        addStep: (step) => {
          const stepWithIndex = {
            ...step,
            timestamp: Date.now(),
            index: currentStepIndex,
          };
          steps.push(stepWithIndex);
          onStep(name, stepWithIndex, currentStepIndex);
          currentStepIndex++;
        },
        shouldStop: () => false,
        checkStop: () => {},
      };

      global.playwrightWeb.expect = (actual) => expect(actual, stepTracker);

      onTestBegin(name);
      const page = buildPageObject(targetDocument, stepTracker, {
        onGoto,
        onWaitForLoadState,
      });

      let status = "passed";
      let error = null;

      try {
        await Promise.resolve(fn({ page, ...fixtures }));
      } catch (err) {
        status = "failed";
        error = err instanceof Error ? err : new Error(String(err));
      } finally {
        global.playwrightWeb.expect = originalExpect;
      }

      onTestEnd(name, status, error, steps);
      results.push({ name, status, error, steps });
    }

    return results;
  }

  async function runSingleTest(testName, options) {
    const {
      targetDocument,
      onTestBegin = () => {},
      onTestEnd = () => {},
      onStep = () => {},
      onGoto,
      onWaitForLoadState,
      fixtures = {},
    } = options || {};

    if (!targetDocument)
      throw new Error("runSingleTest: targetDocument is required");

    const testObj = tests.find((t) => t.name === testName);
    if (!testObj) throw new Error(`Test "${testName}" not found`);

    const { name, fn } = testObj;
    const steps = [];
    let currentStepIndex = 0;

    const stepTracker = {
      addStep: (step) => {
        const stepWithIndex = {
          ...step,
          timestamp: Date.now(),
          index: currentStepIndex,
        };
        steps.push(stepWithIndex);
        onStep(name, stepWithIndex, currentStepIndex);
        currentStepIndex++;
      },
      shouldStop: () => false,
      checkStop: () => {},
    };

    const originalExpect = global.playwrightWeb.expect;
    global.playwrightWeb.expect = (actual) => expect(actual, stepTracker);

    onTestBegin(name);
    const page = buildPageObject(targetDocument, stepTracker, {
      onGoto,
      onWaitForLoadState,
    });

    let status = "passed";
    let error = null;

    try {
      await Promise.resolve(fn({ page, ...fixtures }));
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err : new Error(String(err));
    } finally {
      global.playwrightWeb.expect = originalExpect;
    }

    onTestEnd(name, status, error, steps);
    return { name, status, error, steps };
  }

  function getTestNames() {
    return tests.map((t) => t.name);
  }

  function getTestsWithMetadata() {
    return tests.map((t) => ({ name: t.name, device: t.device }));
  }

  // ── createContext: isolated pw-web instance for parallel test execution ──

  function createContext() {
    let _tests = [];
    let _describePrefix = "";
    let _cursorAnimationCallback = null;

    function _test(name, optionsOrFn, fn) {
      let options = {};
      let testFn = optionsOrFn;
      if (typeof optionsOrFn === "object" && fn) {
        options = optionsOrFn;
        testFn = fn;
      }
      const fullName = _describePrefix ? `${_describePrefix} > ${name}` : name;
      _tests.push({
        name: fullName,
        fn: testFn,
        device: options.device || "desktop",
      });
    }

    _test.describe = function (name, fn) {
      const prev = _describePrefix;
      _describePrefix = prev ? `${prev} > ${name}` : name;
      fn();
      _describePrefix = prev;
    };
    _test.describe.configure = function () {};
    _test.beforeEach = function () {};
    _test.afterEach = function () {};

    function _clearTests() {
      _tests.length = 0;
    }
    function _getTests() {
      return _tests;
    }
    function _getTestNames() {
      return _tests.map((t) => t.name);
    }
    function _getTestsWithMetadata() {
      return _tests.map((t) => ({ name: t.name, device: t.device }));
    }
    function _setCursorCallback(cb) {
      _cursorAnimationCallback = cb;
    }

    // Mutable stepTracker ref — gets bound during runSingleTest so that
    // the `expect` captured at registration time picks up the correct tracker.
    let _activeStepTracker = null;

    // The context's public expect: delegates to the shared `expect()` using
    // whatever stepTracker is currently active (set by _runSingleTest).
    function _ctxExpect(actual) {
      return expect(actual, _activeStepTracker);
    }

    async function _runSingleTest(testName, options) {
      const {
        targetDocument,
        onTestBegin = () => {},
        onTestEnd = () => {},
        onStep = () => {},
        onGoto,
        onWaitForLoadState,
        fixtures = {},
      } = options || {};

      if (!targetDocument)
        throw new Error("runSingleTest: targetDocument is required");

      const testObj = _tests.find((t) => t.name === testName);
      if (!testObj) throw new Error(`Test "${testName}" not found`);

      const { name, fn } = testObj;
      const steps = [];
      let currentStepIndex = 0;

      const stepTracker = {
        addStep: (step) => {
          const stepWithIndex = {
            ...step,
            timestamp: Date.now(),
            index: currentStepIndex,
          };
          steps.push(stepWithIndex);
          onStep(name, stepWithIndex, currentStepIndex);
          currentStepIndex++;
        },
        shouldStop: () => false,
        checkStop: () => {},
      };

      // Bind the active stepTracker so _ctxExpect picks it up
      _activeStepTracker = stepTracker;

      onTestBegin(name);
      const page = buildPageObject(targetDocument, stepTracker, {
        onGoto,
        onWaitForLoadState,
      });

      let status = "passed";
      let error = null;

      try {
        await Promise.resolve(fn({ page, ...fixtures }));
      } catch (err) {
        status = "failed";
        error = err instanceof Error ? err : new Error(String(err));
      } finally {
        _activeStepTracker = null;
      }

      onTestEnd(name, status, error, steps);
      return { name, status, error, steps };
    }

    return {
      test: _test,
      expect: _ctxExpect,
      runSingleTest: _runSingleTest,
      clearTests: _clearTests,
      getTests: _getTests,
      getTestNames: _getTestNames,
      getTestsWithMetadata: _getTestsWithMetadata,
      setCursorCallback: _setCursorCallback,
    };
  }

  global.playwrightWeb = {
    test,
    expect: (actual) => expect(actual, null),
    runTests,
    runSingleTest,
    clearTests,
    getTests: () => tests,
    getTestNames,
    getTestsWithMetadata,
    setCursorCallback,
    createContext,
  };
})(window);
