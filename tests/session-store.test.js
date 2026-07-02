import { describe, it, expect, beforeEach } from "vitest";
import { installShim } from "./foundry-shim.js";

let SS;
beforeEach(async () => {
  installShim();
  SS = await import("../scripts/core/session-store.js?fresh=" + Math.random());
});

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

function makeNpc(overrides = {}) {
  return {
    tokenId: "npc1",
    actorName: "Goblin",
    img: "icons/goblin.svg",
    cr: 0.25,
    tableSource: "type:humanoid",
    included: true,
    defeated: true,
    ...overrides
  };
}

describe("createSession / getSession roundtrip", () => {
  it("fills id, created, status pending, and defaults", async () => {
    const s = await SS.createSession({ name: "Goblin ambush" });
    expect(s.id).toBeTruthy();
    expect(typeof s.created).toBe("number");
    expect(s.status).toBe("pending");
    expect(s.currencyAllocation).toBeNull();
    expect(s.npcs).toEqual([]);
    expect(s.items).toEqual([]);
    expect(s.currency).toEqual({});
    expect(s.createdItemIds).toEqual([]);
    expect(s.currencyGranted).toEqual({});

    const fetched = SS.getSession(s.id);
    expect(fetched).toEqual(s);
  });

  it("getSession returns null for unknown id", () => {
    expect(SS.getSession("nope")).toBeNull();
  });

  it("getSession returns a deep clone (mutation does not leak)", async () => {
    const s = await SS.createSession({ name: "A" });
    const a = SS.getSession(s.id);
    a.npcs.push(makeNpc());
    const b = SS.getSession(s.id);
    expect(b.npcs.length).toBe(0);
  });

  it("preserves caller-provided npcs/items/currency", async () => {
    const s = await SS.createSession({
      name: "B",
      npcs: [makeNpc()],
      items: [makeItem()],
      currency: { gp: 10 }
    });
    expect(s.npcs).toHaveLength(1);
    expect(s.items).toHaveLength(1);
    expect(s.currency).toEqual({ gp: 10 });
  });
});

describe("getSessions", () => {
  it("sorts newest first and can filter by status", async () => {
    const a = await SS.createSession({ name: "A" });
    await new Promise((r) => setTimeout(r, 2));
    const b = await SS.createSession({ name: "B" });
    await new Promise((r) => setTimeout(r, 2));
    const c = await SS.createSession({ name: "C" });

    const all = SS.getSessions();
    expect(all.map((s) => s.id)).toEqual([c.id, b.id, a.id]);

    await SS.updateSession(b.id, (s) => { s.status = "discarded"; });
    const pendingOnly = SS.getSessions(["pending"]);
    expect(pendingOnly.map((s) => s.id).sort()).toEqual([a.id, c.id].sort());
  });
});

describe("updateSession", () => {
  it("clones, mutates, validates transitions, writes, and returns updated session", async () => {
    const s = await SS.createSession({ name: "A", items: [makeItem({ id: "i1" })] });
    const updated = await SS.updateSession(s.id, (draft) => {
      draft.items[0].state = "claimed";
      draft.items[0].claimedBy = "Actor.abc";
    });
    expect(updated.items[0].state).toBe("claimed");
    expect(SS.getSession(s.id).items[0].state).toBe("claimed");
  });

  it("resolveCounts reflects claim: 2/3 items resolved + unallocated currency => {resolved:2, total:4}", async () => {
    const s = await SS.createSession({
      name: "A",
      items: [
        makeItem({ id: "i1", state: "claimed" }),
        makeItem({ id: "i2", state: "abandoned" }),
        makeItem({ id: "i3", state: "unclaimed" })
      ],
      currency: { gp: 5 }
    });
    expect(SS.resolveCounts(s)).toEqual({ resolved: 2, total: 4 });
  });

  it("throws on illegal transition and does not write", async () => {
    const s = await SS.createSession({ name: "A" });
    await expect(SS.updateSession(s.id, (draft) => { draft.status = "finalized"; })).rejects.toThrow();
    expect(SS.getSession(s.id).status).toBe("pending");
  });

  it("same-status writes are always allowed", async () => {
    const s = await SS.createSession({ name: "A" });
    const updated = await SS.updateSession(s.id, (draft) => { draft.status = "pending"; draft.name = "Renamed"; });
    expect(updated.name).toBe("Renamed");
  });

  it("throws for unknown session id", async () => {
    await expect(SS.updateSession("nope", () => {})).rejects.toThrow();
  });
});

describe("isFullyResolved", () => {
  it("flips true when last item abandoned AND currency allocated", () => {
    const session = {
      items: [
        makeItem({ id: "i1", state: "claimed" }),
        makeItem({ id: "i2", state: "abandoned" })
      ],
      currency: { gp: 5 },
      currencyAllocation: null
    };
    expect(SS.isFullyResolved(session)).toBe(false);

    session.currencyAllocation = { "Actor.a": { gp: 5 } };
    expect(SS.isFullyResolved(session)).toBe(true);
  });

  it("is true for a session with no items and no currency", () => {
    const session = { items: [], currency: {}, currencyAllocation: null };
    expect(SS.isFullyResolved(session)).toBe(true);
  });

  it("currency pot with all-zero denoms does not count toward total", () => {
    const session = { items: [], currency: { gp: 0, sp: 0 }, currencyAllocation: null };
    expect(SS.isFullyResolved(session)).toBe(true);
    expect(SS.resolveCounts(session)).toEqual({ resolved: 0, total: 0 });
  });
});

describe("recomputeCurrency", () => {
  it("sums npcCurrency only from INCLUDED npc rows", () => {
    const session = {
      npcs: [
        makeNpc({ tokenId: "npc1", included: true, npcCurrency: { gp: 5 } }),
        makeNpc({ tokenId: "npc2", included: false, npcCurrency: { gp: 100 } })
      ]
    };
    expect(SS.recomputeCurrency(session)).toEqual({ gp: 5 });
  });

  it("sums per-denom across multiple included rows", () => {
    const session = {
      npcs: [
        makeNpc({ tokenId: "npc1", included: true, npcCurrency: { gp: 5, sp: 2 } }),
        makeNpc({ tokenId: "npc2", included: true, npcCurrency: { gp: 3 } })
      ]
    };
    expect(SS.recomputeCurrency(session)).toEqual({ gp: 8, sp: 2 });
  });

  it("npc rows without npcCurrency are treated as contributing nothing", () => {
    const session = { npcs: [makeNpc({ tokenId: "npc1", included: true, npcCurrency: undefined })] };
    expect(SS.recomputeCurrency(session)).toEqual({});
  });

  it("no npcs -> empty currency", () => {
    expect(SS.recomputeCurrency({ npcs: [] })).toEqual({});
  });
});

describe("releaseSession", () => {
  it("drops items whose sourceNpc is excluded, sets status released", async () => {
    const s = await SS.createSession({
      name: "A",
      npcs: [makeNpc({ tokenId: "npc1", included: true }), makeNpc({ tokenId: "npc2", included: false })],
      items: [
        makeItem({ id: "i1", sourceNpc: "npc1" }),
        makeItem({ id: "i2", sourceNpc: "npc2" })
      ]
    });
    const released = await SS.releaseSession(s.id);
    expect(released.status).toBe("released");
    expect(released.items.map((i) => i.id)).toEqual(["i1"]);
  });

  it("drops carried items when session.carriedEnabled is false", async () => {
    const s = await SS.createSession({
      name: "A",
      carriedEnabled: false,
      npcs: [makeNpc({ tokenId: "npc1", included: true })],
      items: [
        makeItem({ id: "i1", sourceNpc: "npc1", carried: false }),
        makeItem({ id: "i2", sourceNpc: "npc1", carried: true })
      ]
    });
    const released = await SS.releaseSession(s.id);
    expect(released.items.map((i) => i.id)).toEqual(["i1"]);
  });

  it("keeps carried items when carriedEnabled is true or unset", async () => {
    const s = await SS.createSession({
      name: "A",
      npcs: [makeNpc({ tokenId: "npc1", included: true })],
      items: [makeItem({ id: "i1", sourceNpc: "npc1", carried: true })]
    });
    const released = await SS.releaseSession(s.id);
    expect(released.items.map((i) => i.id)).toEqual(["i1"]);
  });

  it("rejects release from a non-pending session", async () => {
    const s = await SS.createSession({ name: "A" });
    await SS.releaseSession(s.id);
    await expect(SS.releaseSession(s.id)).rejects.toThrow();
  });

  it("rejects release for unknown session id", async () => {
    await expect(SS.releaseSession("nope")).rejects.toThrow();
  });
});

describe("discardSession", () => {
  it("discards from pending", async () => {
    const s = await SS.createSession({ name: "A" });
    const discarded = await SS.discardSession(s.id);
    expect(discarded.status).toBe("discarded");
  });

  it("discards from released", async () => {
    const s = await SS.createSession({ name: "A" });
    await SS.releaseSession(s.id);
    const discarded = await SS.discardSession(s.id);
    expect(discarded.status).toBe("discarded");
  });

  it("rejects discard from finalized", async () => {
    const s = await SS.createSession({ name: "A" });
    await SS.releaseSession(s.id);
    await SS.updateSession(s.id, (draft) => { draft.status = "finalized"; });
    await expect(SS.discardSession(s.id)).rejects.toThrow();
  });
});

describe("finalize transition", () => {
  it("only allowed from released, not from pending", async () => {
    const s = await SS.createSession({ name: "A" });
    await expect(SS.updateSession(s.id, (draft) => { draft.status = "finalized"; })).rejects.toThrow();

    await SS.releaseSession(s.id);
    const finalized = await SS.updateSession(s.id, (draft) => { draft.status = "finalized"; });
    expect(finalized.status).toBe("finalized");
  });

  it("finalized can revert to released", async () => {
    const s = await SS.createSession({ name: "A" });
    await SS.releaseSession(s.id);
    await SS.updateSession(s.id, (draft) => { draft.status = "finalized"; });
    const reverted = await SS.updateSession(s.id, (draft) => { draft.status = "released"; });
    expect(reverted.status).toBe("released");
  });
});

describe("validateTransition", () => {
  it("covers the legal and illegal edges", () => {
    expect(SS.validateTransition("pending", "released")).toBe(true);
    expect(SS.validateTransition("pending", "discarded")).toBe(true);
    expect(SS.validateTransition("pending", "finalized")).toBe(false);
    expect(SS.validateTransition("released", "finalized")).toBe(true);
    expect(SS.validateTransition("released", "discarded")).toBe(true);
    expect(SS.validateTransition("released", "pending")).toBe(false);
    expect(SS.validateTransition("finalized", "released")).toBe(true);
    expect(SS.validateTransition("finalized", "pending")).toBe(false);
    expect(SS.validateTransition("finalized", "discarded")).toBe(false);
    expect(SS.validateTransition("discarded", "pending")).toBe(false);
    expect(SS.validateTransition("discarded", "released")).toBe(false);
    // same -> same always ok
    expect(SS.validateTransition("pending", "pending")).toBe(true);
    expect(SS.validateTransition("released", "released")).toBe(true);
    expect(SS.validateTransition("finalized", "finalized")).toBe(true);
    expect(SS.validateTransition("discarded", "discarded")).toBe(true);
  });
});

describe("computeEvenSplit", () => {
  it("109 sp across 4 actors: three get 27, one gets 28, remainder recorded", () => {
    const actorUuids = ["a1", "a2", "a3", "a4"];
    const rng = () => 0; // picks first actor deterministically
    const { allocation, remainders } = SS.computeEvenSplit({ sp: 109 }, actorUuids, rng);
    const amounts = actorUuids.map((id) => allocation[id].sp).sort((x, y) => x - y);
    expect(amounts).toEqual([27, 27, 27, 28]);
    expect(actorUuids).toContain(remainders.sp);
    // the lucky uuid is exactly the one with 28
    const lucky = actorUuids.find((id) => allocation[id].sp === 28);
    expect(remainders.sp).toBe(lucky);
  });

  it("multi-denom split across 3 actors works per-denomination", () => {
    const actorUuids = ["a1", "a2", "a3"];
    const rng = () => 0.999; // picks last actor deterministically
    const { allocation, remainders } = SS.computeEvenSplit({ gp: 8, sp: 3 }, actorUuids, rng);
    // gp: 8 / 3 = 2 each, remainder 2 (not 1) -- but spec is "whole remainder to one uuid"
    // per-denom floor: gp floor(8/3)=2 each -> remainder 2 total but assigned whole to ONE uuid
    const gpTotal = actorUuids.reduce((sum, id) => sum + allocation[id].gp, 0);
    expect(gpTotal).toBe(8);
    const spTotal = actorUuids.reduce((sum, id) => sum + allocation[id].sp, 0);
    expect(spTotal).toBe(3);
    expect(Object.keys(remainders)).toEqual(expect.arrayContaining(["gp", "sp"]));
  });

  it("exact division leaves zero remainder but still records a recipient", () => {
    const actorUuids = ["a1", "a2"];
    const rng = () => 0;
    const { allocation, remainders } = SS.computeEvenSplit({ gp: 10 }, actorUuids, rng);
    expect(allocation.a1.gp).toBe(5);
    expect(allocation.a2.gp).toBe(5);
    expect(actorUuids).toContain(remainders.gp);
  });

  it("empty actor list returns empty allocation without throwing", () => {
    expect(() => SS.computeEvenSplit({ gp: 10 }, [], () => 0)).not.toThrow();
    const { allocation, remainders } = SS.computeEvenSplit({ gp: 10 }, [], () => 0);
    expect(allocation).toEqual({});
    expect(remainders).toEqual({});
  });

  it("zero-amount denominations produce zero allocations", () => {
    const actorUuids = ["a1", "a2"];
    const { allocation } = SS.computeEvenSplit({ gp: 0 }, actorUuids, () => 0);
    expect(allocation.a1.gp).toBe(0);
    expect(allocation.a2.gp).toBe(0);
  });
});

describe("pruneHistory", () => {
  it("keeps the 50 newest finalized/discarded sessions and deletes older ones", async () => {
    const ids = [];
    for (let i = 0; i < 55; i++) {
      const s = await SS.createSession({ name: `S${i}` });
      await SS.updateSession(s.id, (draft) => { draft.created = i; draft.status = i % 2 === 0 ? "released" : "pending"; });
      // move to a terminal status directly via draft to control 'created' ordering precisely
      await SS.updateSession(s.id, (draft) => {
        draft.status = draft.status === "released" ? "discarded" : "discarded";
      });
      ids.push(s.id);
    }
    await SS.pruneHistory();
    const remaining = SS.getSessions();
    expect(remaining).toHaveLength(50);
    // newest 50 by `created` (5..54) should remain; oldest 5 (created 0..4) pruned
    const remainingCreated = remaining.map((s) => s.created).sort((a, b) => a - b);
    expect(remainingCreated[0]).toBe(5);
    expect(remainingCreated[remainingCreated.length - 1]).toBe(54);
  });

  it("never prunes active (pending/released) sessions even if there are 50+ terminal ones", async () => {
    const active = await SS.createSession({ name: "Active" });
    await SS.updateSession(active.id, (draft) => { draft.created = -1; });

    for (let i = 0; i < 51; i++) {
      const s = await SS.createSession({ name: `S${i}` });
      await SS.updateSession(s.id, (draft) => { draft.created = i; draft.status = "discarded"; });
    }
    await SS.pruneHistory();
    const remaining = SS.getSessions();
    expect(remaining.find((s) => s.id === active.id)).toBeTruthy();
    expect(remaining).toHaveLength(51); // 1 active + 50 kept terminal
  });

  it("is a no-op when 50 or fewer terminal sessions exist", async () => {
    for (let i = 0; i < 10; i++) {
      const s = await SS.createSession({ name: `S${i}` });
      await SS.updateSession(s.id, (draft) => { draft.status = "discarded"; });
    }
    await SS.pruneHistory();
    expect(SS.getSessions()).toHaveLength(10);
  });
});
