import { describe, it, expect, beforeEach } from "vitest";
import { installShim } from "./foundry-shim.js";

let FIN;
let SS;

beforeEach(async () => {
  installShim();
  FIN = await import("../scripts/core/finalizer.js?fresh=" + Math.random());
  SS = await import("../scripts/core/session-store.js?fresh=" + Math.random());
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides = {}) {
  return {
    id: overrides.id ?? "item1",
    name: "Longsword",
    img: "icons/sword.svg",
    qty: 1,
    sourceNpc: "npc1",
    carried: false,
    state: "unclaimed",
    ...overrides
  };
}

function makeSession(overrides = {}) {
  return {
    id: "sess1",
    name: "Goblin ambush",
    created: Date.now(),
    status: "released",
    npcs: [],
    items: [],
    currency: {},
    currencyAllocation: null,
    createdItemIds: [],
    currencyGranted: {},
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// groupGrants
// ---------------------------------------------------------------------------

describe("groupGrants", () => {
  it("groups a mixed session: 2 claimed to A, 1 claimed to B, 1 abandoned, currency split", () => {
    const session = makeSession({
      items: [
        makeItem({ id: "i1", name: "Longsword", qty: 1, uuid: "Compendium.x.i1", state: "claimed", claimedBy: "Actor.a" }),
        makeItem({ id: "i2", name: "Shield", qty: 1, uuid: "Compendium.x.i2", state: "claimed", claimedBy: "Actor.a" }),
        makeItem({ id: "i3", name: "Dagger", qty: 2, uuid: "Compendium.x.i3", state: "claimed", claimedBy: "Actor.b" }),
        makeItem({ id: "i4", name: "Rusty Fork", qty: 1, uuid: "Compendium.x.i4", state: "abandoned" })
      ],
      currency: { gp: 10, sp: 4 },
      currencyAllocation: {
        "Actor.a": { gp: 5, sp: 2 },
        "Actor.b": { gp: 5, sp: 2 }
      }
    });

    const { itemGrants, currencyGrants } = FIN.groupGrants(session);

    expect(Object.keys(itemGrants).sort()).toEqual(["Actor.a", "Actor.b"]);
    expect(itemGrants["Actor.a"]).toHaveLength(2);
    expect(itemGrants["Actor.a"].map((g) => g.name)).toEqual(["Longsword", "Shield"]);
    expect(itemGrants["Actor.b"]).toHaveLength(1);
    expect(itemGrants["Actor.b"][0].name).toBe("Dagger");

    // abandoned/unclaimed excluded entirely
    const allNames = [...itemGrants["Actor.a"], ...itemGrants["Actor.b"]].map((g) => g.name);
    expect(allNames).not.toContain("Rusty Fork");

    expect(currencyGrants).toEqual({
      "Actor.a": { gp: 5, sp: 2 },
      "Actor.b": { gp: 5, sp: 2 }
    });
  });

  it("preserves item qty in the grant", () => {
    const session = makeSession({
      items: [makeItem({ id: "i1", name: "Arrow", qty: 20, uuid: "Compendium.x.arrow", state: "claimed", claimedBy: "Actor.a" })]
    });
    const { itemGrants } = FIN.groupGrants(session);
    expect(itemGrants["Actor.a"][0].qty).toBe(20);
  });

  it("includes sessionItemId on every grant for revert bookkeeping", () => {
    const session = makeSession({
      items: [makeItem({ id: "i1", name: "Arrow", qty: 20, uuid: "Compendium.x.arrow", state: "claimed", claimedBy: "Actor.a" })]
    });
    const { itemGrants } = FIN.groupGrants(session);
    expect(itemGrants["Actor.a"][0].sessionItemId).toBe("i1");
  });

  it("carries sourceTokenUuid and carried flag through for carried gear", () => {
    const session = makeSession({
      items: [
        makeItem({
          id: "i1",
          name: "Old Dagger",
          qty: 1,
          itemData: { name: "Old Dagger", type: "weapon", system: { quantity: 1 } },
          carried: true,
          sourceTokenUuid: "Scene.s1.Token.t1",
          state: "claimed",
          claimedBy: "Actor.a"
        })
      ]
    });
    const { itemGrants } = FIN.groupGrants(session);
    const grant = itemGrants["Actor.a"][0];
    expect(grant.carried).toBe(true);
    expect(grant.sourceTokenUuid).toBe("Scene.s1.Token.t1");
    expect(grant.itemData).toEqual({ name: "Old Dagger", type: "weapon", system: { quantity: 1 } });
  });

  it("excludes unclaimed items", () => {
    const session = makeSession({
      items: [makeItem({ id: "i1", name: "Unclaimed Thing", state: "unclaimed" })]
    });
    const { itemGrants } = FIN.groupGrants(session);
    expect(Object.keys(itemGrants)).toHaveLength(0);
  });

  it("excludes claimed items missing claimedBy (defensive)", () => {
    const session = makeSession({
      items: [makeItem({ id: "i1", name: "Weird", state: "claimed" })]
    });
    const { itemGrants } = FIN.groupGrants(session);
    expect(Object.keys(itemGrants)).toHaveLength(0);
  });

  it("returns no currency grants when currencyAllocation is null", () => {
    const session = makeSession({
      currency: { gp: 10 },
      currencyAllocation: null
    });
    const { currencyGrants } = FIN.groupGrants(session);
    expect(currencyGrants).toEqual({});
  });

  it("skips zero-only share objects in currencyAllocation", () => {
    const session = makeSession({
      currency: { gp: 10, sp: 0 },
      currencyAllocation: {
        "Actor.a": { gp: 10, sp: 0 },
        "Actor.b": { gp: 0, sp: 0 }
      }
    });
    const { currencyGrants } = FIN.groupGrants(session);
    expect(Object.keys(currencyGrants)).toEqual(["Actor.a"]);
    expect(currencyGrants["Actor.a"]).toEqual({ gp: 10, sp: 0 });
  });

  it("handles a session with no items and no currency", () => {
    const session = makeSession();
    const { itemGrants, currencyGrants } = FIN.groupGrants(session);
    expect(itemGrants).toEqual({});
    expect(currencyGrants).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// buildSummaryHTML
// ---------------------------------------------------------------------------

describe("buildSummaryHTML", () => {
  it("contains actor display names and their item names/qty", () => {
    const session = makeSession({
      items: [
        makeItem({ id: "i1", name: "Longsword", qty: 1, uuid: "x", state: "claimed", claimedBy: "Actor.a" }),
        makeItem({ id: "i2", name: "Dagger", qty: 3, uuid: "y", state: "claimed", claimedBy: "Actor.b" })
      ]
    });
    const grants = FIN.groupGrants(session);
    const actorNames = { "Actor.a": "Aria", "Actor.b": "Boros" };
    const html = FIN.buildSummaryHTML(session, grants, actorNames);

    expect(html).toContain("Aria");
    expect(html).toContain("Boros");
    expect(html).toContain("Longsword");
    expect(html).toMatch(/Longsword.*(x\s?1|×\s?1|1)/s);
    expect(html).toContain("Dagger");
    expect(html).toContain("3");
  });

  it("lists abandoned item names in an abandoned section", () => {
    const session = makeSession({
      items: [
        makeItem({ id: "i1", name: "Rusty Fork", state: "abandoned" }),
        makeItem({ id: "i2", name: "Broken Shield", state: "abandoned" })
      ]
    });
    const grants = FIN.groupGrants(session);
    const html = FIN.buildSummaryHTML(session, grants, {});

    expect(html).toContain("Rusty Fork");
    expect(html).toContain("Broken Shield");
  });

  it("wraps content in a tlg-summary div with a reopen-history button", () => {
    const session = makeSession();
    const grants = FIN.groupGrants(session);
    const html = FIN.buildSummaryHTML(session, grants, {});

    expect(html).toContain('class="tlg-summary"');
    expect(html).toContain('data-tlg-action="open-history"');
    expect(html).toMatch(/<button[^>]*data-tlg-action="open-history"[^>]*>/);
  });

  it("uses the injected i18n function for labels instead of a hardcoded default", () => {
    const session = makeSession({
      items: [makeItem({ id: "i1", name: "Longsword", qty: 1, uuid: "x", state: "claimed", claimedBy: "Actor.a" })]
    });
    const grants = FIN.groupGrants(session);
    const i18n = (key) => `TRANSLATED[${key}]`;
    const html = FIN.buildSummaryHTML(session, grants, { "Actor.a": "Aria" }, i18n);

    expect(html).toContain("TRANSLATED[");
  });

  it("defaults i18n to identity function (returns the key) when not provided", () => {
    const session = makeSession();
    const grants = FIN.groupGrants(session);
    // Should not throw when i18n is omitted.
    expect(() => FIN.buildSummaryHTML(session, grants, {})).not.toThrow();
  });

  it("includes currency lines per denom for each actor", () => {
    const session = makeSession({
      currency: { gp: 10, sp: 4 },
      currencyAllocation: { "Actor.a": { gp: 10, sp: 4 } }
    });
    const grants = FIN.groupGrants(session);
    const html = FIN.buildSummaryHTML(session, grants, { "Actor.a": "Aria" });

    expect(html).toContain("Aria");
    expect(html).toContain("gp");
    expect(html).toContain("10");
    expect(html).toContain("sp");
    expect(html).toContain("4");
  });
});

// ---------------------------------------------------------------------------
// buildRevertPlan
// ---------------------------------------------------------------------------

describe("buildRevertPlan", () => {
  it("builds deletions grouped by actor from createdItemIds", () => {
    const session = makeSession({
      status: "finalized",
      createdItemIds: [
        { actorUuid: "Actor.a", itemId: "newItem1", sessionItemId: "i1", carried: false },
        { actorUuid: "Actor.a", itemId: "newItem2", sessionItemId: "i2", carried: false },
        { actorUuid: "Actor.b", itemId: "newItem3", sessionItemId: "i3", carried: false }
      ],
      currencyGranted: {}
    });

    const plan = FIN.buildRevertPlan(session);
    expect(plan.deletions["Actor.a"]).toEqual(["newItem1", "newItem2"]);
    expect(plan.deletions["Actor.b"]).toEqual(["newItem3"]);
  });

  it("builds currencyDeductions from currencyGranted", () => {
    const session = makeSession({
      status: "finalized",
      createdItemIds: [],
      currencyGranted: {
        "Actor.a": { gp: 5, sp: 2 },
        "Actor.b": { gp: 5, sp: 2 }
      }
    });

    const plan = FIN.buildRevertPlan(session);
    expect(plan.currencyDeductions).toEqual({
      "Actor.a": { gp: 5, sp: 2 },
      "Actor.b": { gp: 5, sp: 2 }
    });
  });

  it("builds restorations for carried grants with stored itemData/sourceTokenUuid", () => {
    const session = makeSession({
      status: "finalized",
      createdItemIds: [
        {
          actorUuid: "Actor.a",
          itemId: "newItem1",
          sessionItemId: "i1",
          carried: true,
          sourceTokenUuid: "Scene.s1.Token.t1",
          itemData: { name: "Old Dagger", type: "weapon", system: { quantity: 1 } }
        },
        { actorUuid: "Actor.b", itemId: "newItem2", sessionItemId: "i2", carried: false }
      ],
      currencyGranted: {}
    });

    const plan = FIN.buildRevertPlan(session);
    expect(plan.restorations).toEqual([
      { sourceTokenUuid: "Scene.s1.Token.t1", itemData: { name: "Old Dagger", type: "weapon", system: { quantity: 1 } } }
    ]);
  });

  it("returns empty plan for a session with no createdItemIds/currencyGranted", () => {
    const session = makeSession({ status: "finalized" });
    const plan = FIN.buildRevertPlan(session);
    expect(plan.deletions).toEqual({});
    expect(plan.currencyDeductions).toEqual({});
    expect(plan.restorations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// validateTransition finalized -> released (already covered in session-store,
// re-asserted here since finalizer's revert flow depends on it)
// ---------------------------------------------------------------------------

describe("session-store transition supports finalizer's revert flow", () => {
  it("allows finalized -> released", () => {
    expect(SS.validateTransition("finalized", "released")).toBe(true);
  });
});
