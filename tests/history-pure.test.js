// Unit tests for the pure helper functions in history.js: escapeHTML and
// buildHistoryRows. No Foundry globals needed for the row-building logic
// itself (groupGrants is imported from finalizer.js, already pure).

import { describe, it, expect, beforeEach } from "vitest";
import { installShim } from "./foundry-shim.js";

let escapeHTML;
let buildHistoryRows;

beforeEach(async () => {
  installShim({ settings: { "tristons-loot-generator.contentPack": "dnd5e" } });
  ({ escapeHTML, buildHistoryRows } = await import("../scripts/apps/history.js?fresh=history-pure"));
});

function makeSession(overrides = {}) {
  return {
    id: "sess1",
    name: "Goblin ambush",
    created: 1000,
    status: "finalized",
    items: [],
    currencyAllocation: null,
    ...overrides
  };
}

describe("escapeHTML", () => {
  it("escapes the five HTML special characters", () => {
    expect(escapeHTML(`<b>"a" & 'b'</b>`)).toBe("&lt;b&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/b&gt;");
  });

  it("coerces non-string input", () => {
    expect(escapeHTML(7)).toBe("7");
  });
});

describe("buildHistoryRows", () => {
  const resolveName = (uuid) => (uuid === "Actor.abc" ? "Aria" : uuid);

  it("returns one row per session with basic fields", () => {
    const session = makeSession();
    const rows = buildHistoryRows([session], resolveName);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "sess1", name: "Goblin ambush", created: 1000, status: "finalized" });
  });

  it("falls back to session.id when name is empty", () => {
    const session = makeSession({ name: "" });
    const rows = buildHistoryRows([session], resolveName);
    expect(rows[0].name).toBe("sess1");
  });

  it("builds a per-actor grant summary from claimed items and currency allocation", () => {
    const session = makeSession({
      items: [
        { id: "i1", name: "Dagger", qty: 1, state: "claimed", claimedBy: "Actor.abc" },
        { id: "i2", name: "Rope", qty: 1, state: "unclaimed" }
      ],
      currencyAllocation: { "Actor.abc": { gp: 5 } }
    });
    const rows = buildHistoryRows([session], resolveName);
    expect(rows[0].actors).toEqual([
      { name: "Aria", items: [{ name: "Dagger", qty: 1 }], currency: [{ denom: "gp", amount: 5 }] }
    ]);
  });

  it("marks only the first (most recent) finalized session as revertible", () => {
    const sessions = [
      makeSession({ id: "s1", status: "finalized" }),
      makeSession({ id: "s2", status: "finalized" }),
      makeSession({ id: "s3", status: "discarded" })
    ];
    const rows = buildHistoryRows(sessions, resolveName);
    expect(rows.map((r) => r.canRevert)).toEqual([true, false, false]);
  });

  it("discarded sessions are never revertible", () => {
    const rows = buildHistoryRows([makeSession({ status: "discarded" })], resolveName);
    expect(rows[0].canRevert).toBe(false);
  });

  it("skips actors with no non-zero items or currency", () => {
    const session = makeSession({
      currencyAllocation: { "Actor.zero": { gp: 0 } }
    });
    const rows = buildHistoryRows([session], resolveName);
    expect(rows[0].actors).toEqual([]);
  });
});
