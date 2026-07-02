import { describe, expect, it } from "vitest";
import {
  APPROVAL_MODES,
  getApprovalMode,
  setApprovalMode,
} from "./approval-store";

describe("approval-store", () => {
  it("defaults to full access", () => {
    expect(getApprovalMode()).toBe("full");
  });

  it("switches to an enabled mode", () => {
    setApprovalMode("ask");
    expect(getApprovalMode()).toBe("ask");
    setApprovalMode("full");
    expect(getApprovalMode()).toBe("full");
  });

  it("ignores the disabled 'Approve for me' mode", () => {
    setApprovalMode("full");
    setApprovalMode("auto");
    expect(getApprovalMode()).toBe("full");
  });

  it("marks exactly one mode disabled (auto) as Coming soon", () => {
    const disabled = APPROVAL_MODES.filter((m) => m.disabled).map((m) => m.id);
    expect(disabled).toEqual(["auto"]);
  });
});
