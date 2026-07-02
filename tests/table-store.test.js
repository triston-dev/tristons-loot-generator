import { describe, it, expect, beforeEach } from "vitest";
import { installShim } from "./foundry-shim.js";

let TS;
beforeEach(async () => {
  installShim({ settings: { "tristons-loot-generator.contentPack": "dnd5e" } });
  TS = await import("../scripts/core/table-store.js");
});

it("pack table passes through untouched", () => {
  const t = TS.getEffectiveTable("type:humanoid");
  expect(t.name).toBe("Humanoid");
});
it("override wins and is flagged modified", async () => {
  const t = TS.getEffectiveTable("type:humanoid");
  t.name = "House humanoid";
  await TS.saveTable(t);
  expect(TS.getEffectiveTable("type:humanoid").name).toBe("House humanoid");
  expect(TS.listTables().modifiedIds).toContain("type:humanoid");
});
it("revert restores pack default", async () => {
  const t = TS.getEffectiveTable("type:humanoid");
  t.name = "X"; await TS.saveTable(t); await TS.revertOverride("type:humanoid");
  expect(TS.getEffectiveTable("type:humanoid").name).toBe("Humanoid");
});
it("custom table lifecycle", async () => {
  const t = await TS.createCustomTable("Klarg's hoard");
  expect(t.id).toMatch(/^custom:/);
  t.entries.push({ id: "e1", weight: 1, type: "nothing" });
  await TS.saveTable(t);
  expect(TS.getEffectiveTable(t.id).entries).toHaveLength(1);
  await TS.deleteCustomTable(t.id);
  expect(TS.getEffectiveTable(t.id)).toBeNull();
});
it("import/export roundtrip; bad import atomic", async () => {
  const t = await TS.createCustomTable("A");
  await TS.saveKeywordRules([{ id: "r1", pattern: "cultist", matchType: "includes", tableId: t.id, enabled: true }]);
  const dump = TS.exportData();
  installShim({ settings: { "tristons-loot-generator.contentPack": "dnd5e" } });
  TS = await import("../scripts/core/table-store.js?fresh");
  await TS.importData(dump);
  expect(TS.getKeywordRules()).toHaveLength(1);
  await expect(TS.importData("{\"nope\":1}")).rejects.toThrow();
});
it("validateTable reports problems", () => {
  const bad = { id: "custom:x", name: "X", rolls: "banana", entries: [{ id: "e", weight: 0, type: "table", tableId: "type:nope" }] };
  expect(TS.validateTable(bad).length).toBeGreaterThanOrEqual(3);
});

describe("additional coverage", () => {
  it("getEffectiveTable resolves shared: and fallback ids from pack", () => {
    expect(TS.getEffectiveTable("shared:trinkets").name).toBe("Trinkets & valuables");
    expect(TS.getEffectiveTable("fallback").name).toBe("Fallback");
  });
  it("getEffectiveTable returns null for unknown id", () => {
    expect(TS.getEffectiveTable("type:nope")).toBeNull();
    expect(TS.getEffectiveTable("custom:missing")).toBeNull();
  });
  it("getEffectiveTable returns deep clones (mutation does not leak)", () => {
    const a = TS.getEffectiveTable("type:humanoid");
    a.entries.push({ id: "hack", weight: 1, type: "nothing" });
    const b = TS.getEffectiveTable("type:humanoid");
    expect(b.entries.length).not.toBe(a.entries.length);
  });
  it("saved override/custom tables are stamped gmAuthored; pack originals are not", async () => {
    const t = TS.getEffectiveTable("type:humanoid");
    expect(t.gmAuthored).toBeFalsy();
    t.name = "Y";
    await TS.saveTable(t);
    expect(TS.getEffectiveTable("type:humanoid").gmAuthored).toBe(true);

    const c = await TS.createCustomTable("B");
    expect(c.gmAuthored).toBe(true);
  });
  it("listTables reports pack tables, custom tables, and modifiedIds", async () => {
    const custom = await TS.createCustomTable("Custom loot");
    const before = TS.listTables();
    expect(before.pack).toEqual({ id: "dnd5e", label: "D&D 5e" });
    expect(before.packTables.find((m) => m.id === "type:humanoid")).toBeTruthy();
    expect(before.customTables.find((m) => m.id === custom.id)).toBeTruthy();
    expect(before.modifiedIds).not.toContain("type:humanoid");

    const t = TS.getEffectiveTable("type:humanoid");
    t.name = "Z"; await TS.saveTable(t);
    expect(TS.listTables().modifiedIds).toContain("type:humanoid");
  });
  it("revertOverride on a non-overridden table is a harmless no-op", async () => {
    await expect(TS.revertOverride("type:humanoid")).resolves.not.toThrow();
    expect(TS.getEffectiveTable("type:humanoid").name).toBe("Humanoid");
  });
  it("createCustomTable defaults to rolls '1' and empty entries", async () => {
    const t = await TS.createCustomTable("Empty");
    expect(t.rolls).toBe("1");
    expect(t.entries).toEqual([]);
  });
  it("keyword rules save/load preserves order", async () => {
    const rules = [
      { id: "r1", pattern: "a", matchType: "includes", tableId: "type:humanoid", enabled: true },
      { id: "r2", pattern: "b", matchType: "regex", tableId: "type:beast", enabled: false }
    ];
    await TS.saveKeywordRules(rules);
    expect(TS.getKeywordRules()).toEqual(rules);
  });
  it("getKeywordRules returns a deep clone", async () => {
    await TS.saveKeywordRules([{ id: "r1", pattern: "a", matchType: "includes", tableId: "type:humanoid", enabled: true }]);
    const rules = TS.getKeywordRules();
    rules[0].pattern = "mutated";
    expect(TS.getKeywordRules()[0].pattern).toBe("a");
  });
  it("validateTable accepts a valid pack table with nested and currency entries", () => {
    const good = TS.getEffectiveTable("type:humanoid");
    expect(TS.validateTable(good)).toEqual([]);
  });
  it("validateTable flags invalid currency formula and unknown entry type", () => {
    const bad = {
      id: "custom:y", name: "Y", rolls: "1",
      entries: [
        { id: "e1", weight: 1, type: "currency", currency: { formula: "banana", denom: "gp" } },
        { id: "e2", weight: 1, type: "not-a-type" }
      ]
    };
    const problems = TS.validateTable(bad);
    expect(problems.length).toBeGreaterThanOrEqual(2);
  });
  it("exportData round-trips overrides alongside customs and rules", async () => {
    const t = TS.getEffectiveTable("type:humanoid");
    t.name = "Overridden"; await TS.saveTable(t);
    const dump = JSON.parse(TS.exportData());
    expect(dump.format).toBe(1);
    expect(dump.packId).toBe("dnd5e");
    expect(dump.overrides["type:humanoid"].name).toBe("Overridden");
  });

  it("import accepts payload-internal nested references", async () => {
    const payload = {
      format: 1,
      packId: "dnd5e",
      overrides: {},
      customs: {
        "custom:a": {
          id: "custom:a", name: "A", rolls: "1",
          entries: [{ id: "e1", weight: 1, type: "table", tableId: "custom:b" }]
        },
        "custom:b": {
          id: "custom:b", name: "B", rolls: "1",
          entries: [{ id: "e1", weight: 1, type: "nothing" }]
        }
      },
      rules: []
    };
    await expect(TS.importData(JSON.stringify(payload))).resolves.not.toThrow();
    expect(TS.getEffectiveTable("custom:a")).toBeTruthy();
    expect(TS.getEffectiveTable("custom:b")).toBeTruthy();
  });

  it("import rejects references that would dangle after import", async () => {
    const c = await TS.createCustomTable("C");
    await TS.saveTable(c);

    const payload = {
      format: 1,
      packId: "dnd5e",
      overrides: {},
      customs: {
        "custom:d": {
          id: "custom:d", name: "D", rolls: "1",
          entries: [{ id: "e1", weight: 1, type: "table", tableId: c.id }]
        }
      },
      rules: []
    };
    await expect(TS.importData(JSON.stringify(payload))).rejects.toThrow();
    expect(TS.getEffectiveTable(c.id)).toBeTruthy();
    expect(TS.getEffectiveTable("custom:d")).toBeNull();
  });
});
