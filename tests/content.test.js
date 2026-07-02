import { describe, it, expect, beforeEach } from "vitest";
import { installShim } from "./foundry-shim.js";

let getActivePack, getPack, DND5E, SW5E;
beforeEach(async () => {
  installShim({ modules: { sw5e: { active: true } }, settings: { "tristons-loot-generator.contentPack": "auto" } });
  ({ getActivePack, getPack } = await import("../scripts/content/index.js"));
  DND5E = (await import("../scripts/content/dnd5e-pack.js")).default;
  SW5E = (await import("../scripts/content/sw5e-pack.js")).default;
});

describe("packs", () => {
  it("auto picks sw5e when module active", () => expect(getActivePack().id).toBe("sw5e"));
  it("forced setting wins", async () => {
    await game.settings.set("tristons-loot-generator", "contentPack", "dnd5e");
    expect(getActivePack().id).toBe("dnd5e");
  });
  it("every dnd5e creature type has a table", () => {
    for (const t of DND5E.creatureTypes) expect(DND5E.typeTables[t], t).toBeTruthy();
  });
  it("all pack table entries are schema-valid", () => {
    for (const pack of [DND5E, SW5E]) {
      const tables = [...Object.values(pack.typeTables), pack.fallbackTable, ...Object.values(pack.sharedTables ?? {})];
      for (const table of tables) for (const e of table.entries) {
        expect(e.weight).toBeGreaterThan(0);
        expect(["item", "currency", "table", "rolltable", "nothing"]).toContain(e.type);
        if (e.type === "item") expect(e.ref || e.uuid || e.itemData).toBeTruthy();
        if (e.type === "currency") expect(e.currency?.formula).toBeTruthy();
        if (e.type === "table") expect(e.tableId).toBeTruthy();
      }
    }
  });
  it("nested table refs point at real pack tables", () => {
    for (const pack of [DND5E, SW5E]) {
      const ids = new Set([...Object.keys(pack.typeTables).map((t) => `type:${t}`), "fallback", ...Object.keys(pack.sharedTables ?? {})]);
      const tables = [...Object.values(pack.typeTables), pack.fallbackTable, ...Object.values(pack.sharedTables ?? {})];
      for (const table of tables) for (const e of table.entries) {
        if (e.type === "table") expect(ids.has(e.tableId), `${table.id} -> ${e.tableId}`).toBe(true);
      }
    }
  });
});
