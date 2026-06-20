import { describe, expect, it } from "vitest";
import {
  SESSION_POOL_CAP,
  selectSessionsToEvict,
  type SessionPoolEntry,
} from "../src/workbench/session-pool";

function entry(
  id: string,
  lastActiveAt: number,
  pinned = false,
): SessionPoolEntry {
  return { id, lastActiveAt, pinned };
}

describe("selectSessionsToEvict", () => {
  it("exports a cap of 3 live sessions", () => {
    expect(SESSION_POOL_CAP).toBe(3);
  });

  it("evicts nothing for an empty pool", () => {
    expect(selectSessionsToEvict([], 3)).toEqual([]);
  });

  it("evicts nothing under the cap", () => {
    expect(
      selectSessionsToEvict([entry("a", 1), entry("b", 2)], 3),
    ).toEqual([]);
  });

  it("evicts nothing exactly at the cap", () => {
    expect(
      selectSessionsToEvict([entry("a", 1), entry("b", 2), entry("c", 3)], 3),
    ).toEqual([]);
  });

  it("evicts the least-recently-active unpinned entry beyond the cap", () => {
    expect(
      selectSessionsToEvict(
        [entry("newest", 40), entry("oldest", 10), entry("mid", 20), entry("late", 30)],
        3,
      ),
    ).toEqual(["oldest"]);
  });

  it("evicts multiple entries oldest-first when far over the cap", () => {
    expect(
      selectSessionsToEvict(
        [entry("d", 4), entry("b", 2), entry("e", 5), entry("a", 1), entry("c", 3)],
        2,
      ),
    ).toEqual(["a", "b", "c"]);
  });

  it("uses the default cap when none is given", () => {
    expect(
      selectSessionsToEvict([
        entry("a", 1),
        entry("b", 2),
        entry("c", 3),
        entry("d", 4),
      ]),
    ).toEqual(["a"]);
  });

  it("never evicts pinned entries, even when they are the oldest", () => {
    expect(
      selectSessionsToEvict(
        [entry("a", 1, true), entry("b", 2), entry("c", 3), entry("d", 4)],
        3,
      ),
    ).toEqual(["b"]);
  });

  it("returns nothing when every entry is pinned, even over the cap", () => {
    expect(
      selectSessionsToEvict(
        [
          entry("a", 1, true),
          entry("b", 2, true),
          entry("c", 3, true),
          entry("d", 4, true),
        ],
        3,
      ),
    ).toEqual([]);
  });

  it("evicts every unpinned entry when pinned entries meet the cap", () => {
    expect(
      selectSessionsToEvict(
        [
          entry("p1", 10, true),
          entry("p2", 20, true),
          entry("p3", 30, true),
          entry("u1", 99),
          entry("u2", 1),
        ],
        3,
      ),
    ).toEqual(["u2", "u1"]);
  });

  it("lets pinned entries alone exceed the cap without touching them", () => {
    expect(
      selectSessionsToEvict(
        [
          entry("p1", 1, true),
          entry("p2", 2, true),
          entry("p3", 3, true),
          entry("p4", 4, true),
          entry("u1", 5),
        ],
        3,
      ),
    ).toEqual(["u1"]);
  });

  it("breaks lastActiveAt ties by input order", () => {
    expect(
      selectSessionsToEvict(
        [entry("first", 5), entry("second", 5), entry("third", 5), entry("fourth", 5)],
        3,
      ),
    ).toEqual(["first"]);
  });

  it("evicts all unpinned entries at cap 0", () => {
    expect(
      selectSessionsToEvict([entry("a", 1), entry("b", 2, true), entry("c", 3)], 0),
    ).toEqual(["a", "c"]);
  });

  it("treats a negative cap as 0", () => {
    expect(selectSessionsToEvict([entry("a", 1)], -2)).toEqual(["a"]);
  });

  it("does not mutate the input", () => {
    const entries = [entry("b", 2), entry("a", 1), entry("c", 3), entry("d", 4)];
    const snapshot = entries.map((e) => ({ ...e }));

    selectSessionsToEvict(entries, 1);

    expect(entries).toEqual(snapshot);
  });
});
