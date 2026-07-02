import { describe, it, expect } from "vitest";
import { matchTable, rollLoot, filterCarriedGear } from "../scripts/core/loot-engine.js";

const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const deps = (over = {}) => ({ rules: [], tableExists: (id) => id !== "custom:gone", creatureTypes: ["humanoid", "undead"], ...over });

describe("matchTable precedence", () => {
  const ctx = { name: "Bandit Cultist", biography: "", creatureType: "humanoid", cr: 1 };
  it("flag beats everything", () =>
    expect(matchTable({ ...ctx, flagTableId: "custom:boss" }, deps()).source).toBe("override"));
  it("dangling flag falls through", () => {
    // Adapted per brief: dangling flagTableId must fall through to the next
    // precedence tier. With deps.rules empty there is nothing to match, so a
    // matching keyword rule is added here to assert source "keyword".
    const d = deps({ rules: [{ id: "r", pattern: "cultist", matchType: "includes", tableId: "custom:cult", enabled: true }] });
    expect(matchTable({ ...ctx, flagTableId: "custom:gone" }, d).source).toBe("keyword");
  });
  it("keyword rule matches name case-insensitively", () => {
    const d = deps({ rules: [{ id: "r", pattern: "CULTIST", matchType: "includes", tableId: "custom:cult", enabled: true }] });
    expect(matchTable(ctx, d)).toEqual({ tableId: "custom:cult", source: "keyword" });
  });
  it("disabled and invalid-regex rules skipped", () => {
    const d = deps({ rules: [
      { id: "a", pattern: "cultist", matchType: "includes", tableId: "custom:x", enabled: false },
      { id: "b", pattern: "[", matchType: "regex", tableId: "custom:y", enabled: true }
    ] });
    expect(matchTable(ctx, d).source).toBe("type");
  });
  it("unknown creature type → fallback", () =>
    expect(matchTable({ ...ctx, creatureType: "slaad" }, deps()).tableId).toBe("fallback"));

  it("keyword rule matches biography when name doesn't match", () => {
    const d = deps({ rules: [{ id: "r", pattern: "necromancer", matchType: "includes", tableId: "custom:necro", enabled: true }] });
    const c = { name: "Old Man", biography: "A retired Necromancer.", creatureType: "humanoid", cr: 1 };
    expect(matchTable(c, d)).toEqual({ tableId: "custom:necro", source: "keyword" });
  });

  it("regex matchType uses case-insensitive RegExp", () => {
    const d = deps({ rules: [{ id: "r", pattern: "^bandit", matchType: "regex", tableId: "custom:bandit", enabled: true }] });
    expect(matchTable(ctx, d)).toEqual({ tableId: "custom:bandit", source: "keyword" });
  });

  it("first enabled matching rule wins over later matching rules", () => {
    const d = deps({ rules: [
      { id: "a", pattern: "cultist", matchType: "includes", tableId: "custom:first", enabled: true },
      { id: "b", pattern: "bandit", matchType: "includes", tableId: "custom:second", enabled: true }
    ] });
    expect(matchTable(ctx, d).tableId).toBe("custom:first");
  });

  it("type match requires tableExists to also be true", () => {
    const d = deps({ tableExists: (id) => id !== "type:humanoid" });
    expect(matchTable(ctx, d)).toEqual({ tableId: "fallback", source: "fallback" });
  });

  it("no flagTableId skips override tier entirely", () => {
    expect(matchTable(ctx, deps())).toEqual({ tableId: "type:humanoid", source: "type" });
  });
});

describe("rollLoot", () => {
  const pack = { rarityBudget: [{ maxCr: 4, allowed: ["common"] }, { maxCr: 99, allowed: ["common", "rare"] }] };
  const base = (tables, over = {}) => ({
    cr: 1, tableId: "t1", generosity: "standard", rng: seq(0),
    getTable: (id) => tables[id] ?? null, pack,
    drawRollTable: async () => [], getRarity: async () => null, ...over
  });
  it("weighted pick + qty roll + currency scaling", async () => {
    const tables = { t1: { id: "t1", rolls: "1", entries: [
      { id: "a", weight: 1, type: "item", ref: { name: "Dagger" }, qty: "2" },
      { id: "b", weight: 999, type: "currency", currency: { formula: "10", denom: "sp" } }
    ] } };
    const r = await rollLoot(base(tables, { rng: seq(0.99) })); // high roll → picks heavy entry
    expect(r.currency.sp).toBe(10);
  });
  it("generosity multiplies currency and shifts rolls", async () => {
    const tables = { t1: { id: "t1", rolls: "1", entries: [{ id: "c", weight: 1, type: "currency", currency: { formula: "10", denom: "sp" } }] } };
    const r = await rollLoot(base(tables, { generosity: "generous" }));
    expect(r.currency.sp).toBe(40); // 2 draws (1+1 shift) × 10 × 2.0
  });
  it("CR gates exclude entries", async () => {
    const tables = { t1: { id: "t1", rolls: "1", entries: [
      { id: "hi", weight: 1, type: "currency", currency: { formula: "100", denom: "gp" }, minCr: 5 },
      { id: "lo", weight: 1, type: "currency", currency: { formula: "1", denom: "sp" } }
    ] } };
    const r = await rollLoot(base(tables));
    expect(r.currency.gp).toBeUndefined();
  });
  it("rarity budget blocks rare items on pack tables but not gmAuthored", async () => {
    const entries = [{ id: "r", weight: 1, type: "item", ref: { name: "Flame Tongue" } }];
    const mk = (gmAuthored) => ({ t1: { id: "t1", rolls: "1", gmAuthored, entries } });
    const rare = { getRarity: async () => "rare" };
    expect((await rollLoot(base(mk(false), rare))).items).toHaveLength(0);
    expect((await rollLoot(base(mk(true), rare))).items).toHaveLength(1);
  });
  it("nested tables recurse with cycle guard", async () => {
    const tables = {
      t1: { id: "t1", rolls: "1", entries: [{ id: "n", weight: 1, type: "table", tableId: "t2", qty: "1" }] },
      t2: { id: "t2", rolls: "1", entries: [{ id: "loop", weight: 1, type: "table", tableId: "t1", qty: "1" }] }
    };
    const r = await rollLoot(base(tables)); // must terminate
    expect(r.items).toHaveLength(0);
  });
  it("merges duplicate item draws", async () => {
    const tables = { t1: { id: "t1", rolls: "3", entries: [{ id: "a", weight: 1, type: "item", ref: { name: "Dagger" }, qty: "1" }] } };
    const r = await rollLoot(base(tables, { rng: seq(0.5) }));
    expect(r.items).toHaveLength(1);
    expect(r.items[0].qty).toBe(3);
  });
  it("missing table returns empty result, no throw", async () => {
    const r = await rollLoot(base({}));
    expect(r).toEqual({ items: [], currency: {} });
  });

  it("rarity budget: null/undefined rarity is unrestricted even on pack tables", async () => {
    const tables = { t1: { id: "t1", rolls: "1", entries: [
      { id: "a", weight: 1, type: "item", ref: { name: "Torch" } }
    ] } };
    const r = await rollLoot(base(tables)); // default getRarity resolves null
    expect(r.items).toHaveLength(1);
  });

  it("rarity budget: band selection is by first band where cr <= maxCr (boundary)", async () => {
    // cr=4 should hit the first band (maxCr: 4), which only allows "common".
    const entries = [{ id: "r", weight: 1, type: "item", ref: { name: "Rare Thing" } }];
    const tables = { t1: { id: "t1", rolls: "1", entries } };
    const rare = { getRarity: async () => "rare" };
    const r = await rollLoot(base(tables, { cr: 4, ...rare }));
    expect(r.items).toHaveLength(0);
  });

  it("rarity budget: item rarity within allowed band passes", async () => {
    const entries = [{ id: "r", weight: 1, type: "item", ref: { name: "Common Thing" } }];
    const tables = { t1: { id: "t1", rolls: "1", entries } };
    const common = { getRarity: async () => "common" };
    const r = await rollLoot(base(tables, common));
    expect(r.items).toHaveLength(1);
  });

  it("rolltable entries draw via ctx.drawRollTable and append qty times", async () => {
    const drawn = [{ uuid: "Item.abc", qty: 1 }];
    const tables = { t1: { id: "t1", rolls: "1", entries: [
      { id: "rt", weight: 1, type: "rolltable", uuid: "RollTable.xyz", qty: "2" }
    ] } };
    const r = await rollLoot(base(tables, { drawRollTable: async () => drawn }));
    expect(r.items).toHaveLength(2);
  });

  it("nothing entries contribute nothing", async () => {
    const tables = { t1: { id: "t1", rolls: "1", entries: [
      { id: "n", weight: 1, type: "nothing" }
    ] } };
    const r = await rollLoot(base(tables));
    expect(r).toEqual({ items: [], currency: {} });
  });

  it("recursion depth cap stops infinite self-nesting without a revisit", async () => {
    // Each level references a distinct fresh table id so the visited-set cycle
    // guard alone (without a depth cap) would never trigger — this isolates
    // the depth cap behavior.
    const tables = {};
    for (let n = 0; n < 10; n++) {
      tables[`t${n}`] = { id: `t${n}`, rolls: "1", entries: [{ id: `e${n}`, weight: 1, type: "table", tableId: `t${n + 1}`, qty: "1" }] };
    }
    tables.t10 = { id: "t10", rolls: "1", entries: [{ id: "leaf", weight: 1, type: "item", ref: { name: "Leaf" }, qty: "1" }] };
    const r = await rollLoot(base(tables, { tableId: "t0" }));
    // Depth cap of 5 means the leaf item (10 levels deep) must never be reached.
    expect(r.items).toHaveLength(0);
  });

  it("merge key falls back to ref.name then itemData.name when uuid absent", async () => {
    const tables = { t1: { id: "t1", rolls: "2", entries: [
      { id: "a", weight: 1, type: "item", itemData: { name: "Potion" }, qty: "1" }
    ] } };
    const r = await rollLoot(base(tables, { rng: seq(0.1) }));
    expect(r.items).toHaveLength(1);
    expect(r.items[0].qty).toBe(2);
    expect(r.items[0].name).toBe("Potion");
  });
});

describe("filterCarriedGear", () => {
  const pack = { carriedGear: { includeTypes: ["weapon", "loot"], excludeNaturalWeapons: true } };
  it("filters by type, natural weapons, qty 0, noLoot flag", () => {
    const items = [
      { id: "1", name: "Scimitar", type: "weapon", system: { type: { value: "martialM" }, quantity: 1 }, flags: {} },
      { id: "2", name: "Bite", type: "weapon", system: { type: { value: "natural" }, quantity: 1 }, flags: {} },
      { id: "3", name: "Multiattack", type: "feat", system: {}, flags: {} },
      { id: "4", name: "Gem", type: "loot", system: { quantity: 0 }, flags: {} },
      { id: "5", name: "Key", type: "loot", system: { quantity: 1 }, flags: { "tristons-loot-generator": { noLoot: true } } }
    ];
    expect(filterCarriedGear(items, pack).map((i) => i.id)).toEqual(["1"]);
  });

  it("keeps items with undefined quantity", () => {
    const items = [{ id: "1", name: "Rock", type: "loot", system: {}, flags: {} }];
    expect(filterCarriedGear(items, pack).map((i) => i.id)).toEqual(["1"]);
  });

  it("does not exclude natural weapons when excludeNaturalWeapons is false", () => {
    const p2 = { carriedGear: { includeTypes: ["weapon"], excludeNaturalWeapons: false } };
    const items = [{ id: "2", name: "Bite", type: "weapon", system: { type: { value: "natural" }, quantity: 1 }, flags: {} }];
    expect(filterCarriedGear(items, p2).map((i) => i.id)).toEqual(["2"]);
  });
});
