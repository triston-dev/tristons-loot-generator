import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installShim } from "./foundry-shim.js";
import { buildSessionData, applyReroll, rerollNpc } from "../scripts/core/encounter-service.js";
import { createSession, getSession, updateSession } from "../scripts/core/session-store.js";
import { createCustomTable, saveTable, saveKeywordRules } from "../scripts/core/table-store.js";

const opts = (over = {}) => ({ hostileDisposition: -1, name: "Goblin ambush", carriedEnabled: true, ...over });

function snap(over = {}) {
  return {
    combatantId: "c1",
    tokenId: "t1",
    actorName: "Goblin",
    img: "icons/goblin.svg",
    cr: 0.25,
    disposition: -1,
    hp: 0,
    defeatedStatus: false,
    rolled: null,
    carriedItems: [],
    ...over
  };
}

describe("buildSessionData", () => {
  it("hostile + dead (hp<=0) is included", () => {
    const data = buildSessionData([snap({ hp: 0 })], opts());
    expect(data.npcs).toHaveLength(1);
    expect(data.npcs[0]).toMatchObject({ tokenId: "t1", actorName: "Goblin", included: true, defeated: true });
  });

  it("hostile + defeatedStatus (hp > 0) is included", () => {
    const data = buildSessionData([snap({ hp: 5, defeatedStatus: true })], opts());
    expect(data.npcs[0]).toMatchObject({ included: true, defeated: true });
  });

  it("hostile + alive is listed but not included", () => {
    const data = buildSessionData([snap({ hp: 5, defeatedStatus: false })], opts());
    expect(data.npcs).toHaveLength(1);
    expect(data.npcs[0]).toMatchObject({ included: false, defeated: false });
  });

  it("friendly + dead is excluded (not hostile disposition)", () => {
    const data = buildSessionData([snap({ disposition: 1, hp: 0 })], opts());
    expect(data.npcs[0]).toMatchObject({ included: false });
  });

  it("neutral + dead is excluded", () => {
    const data = buildSessionData([snap({ disposition: 0, hp: 0 })], opts());
    expect(data.npcs[0]).toMatchObject({ included: false });
  });

  it("every NPC combatant becomes an npcs[] row regardless of included", () => {
    const data = buildSessionData(
      [snap({ tokenId: "t1", disposition: -1, hp: 0 }), snap({ tokenId: "t2", disposition: 1, hp: 0 })],
      opts()
    );
    expect(data.npcs).toHaveLength(2);
  });

  it("npc row shape: tokenId, actorName, img, cr, tableSource, tableId, included, defeated, npcCurrency", () => {
    const data = buildSessionData(
      [snap({ rolled: { items: [], currency: {}, tableSource: "type:humanoid", tableId: "type:humanoid" } })],
      opts()
    );
    expect(data.npcs[0]).toEqual({
      tokenId: "t1",
      actorName: "Goblin",
      img: "icons/goblin.svg",
      cr: 0.25,
      tableSource: "type:humanoid",
      tableId: "type:humanoid",
      included: true,
      defeated: true,
      npcCurrency: {}
    });
  });

  it("npc row tableSource/tableId are null when rolled is null", () => {
    const data = buildSessionData([snap({ rolled: null })], opts());
    expect(data.npcs[0].tableSource).toBeNull();
    expect(data.npcs[0].tableId).toBeNull();
  });

  it("generated rolled items land in items[] carried through from any snapshot, included or not", () => {
    const data = buildSessionData(
      [
        snap({
          tokenId: "t1",
          disposition: -1,
          hp: 5,
          defeatedStatus: false, // NOT included
          rolled: { items: [{ uuid: "Compendium.x.Item.1", name: "Dagger", img: "i.svg", qty: 2 }], currency: {}, tableSource: "type:humanoid", tableId: "type:humanoid" }
        })
      ],
      opts()
    );
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({ name: "Dagger", img: "i.svg", qty: 2, sourceNpc: "t1", state: "unclaimed", uuid: "Compendium.x.Item.1" });
    expect(data.items[0].id).toBeTruthy();
  });

  it("carried gear lands as itemData items with carried: true and sourceTokenUuid", () => {
    const data = buildSessionData(
      [
        snap({
          tokenId: "t1",
          carriedItems: [{ itemData: { name: "Rusty Sword", type: "weapon" }, sourceTokenUuid: "Scene.s.Token.t1" }]
        })
      ],
      opts()
    );
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      itemData: { name: "Rusty Sword", type: "weapon" },
      carried: true,
      sourceTokenUuid: "Scene.s.Token.t1",
      sourceNpc: "t1",
      state: "unclaimed"
    });
    expect(data.items[0].name).toBe("Rusty Sword");
  });

  it("currency sums only INCLUDED snapshots", () => {
    const data = buildSessionData(
      [
        snap({ tokenId: "t1", disposition: -1, hp: 0, rolled: { items: [], currency: { gp: 5 }, tableSource: "type:humanoid", tableId: "type:humanoid" } }), // included
        snap({ tokenId: "t2", disposition: -1, hp: 5, defeatedStatus: false, rolled: { items: [], currency: { gp: 100 }, tableSource: "type:humanoid", tableId: "type:humanoid" } }), // not included (alive)
        snap({ tokenId: "t3", disposition: 1, hp: 0, rolled: { items: [], currency: { sp: 50 }, tableSource: "type:humanoid", tableId: "type:humanoid" } }) // not included (friendly)
      ],
      opts()
    );
    expect(data.currency).toEqual({ gp: 5 });
  });

  it("currency from multiple included snapshots sums per-denom", () => {
    const data = buildSessionData(
      [
        snap({ tokenId: "t1", disposition: -1, hp: 0, rolled: { items: [], currency: { gp: 5, sp: 2 }, tableSource: "type:humanoid", tableId: "type:humanoid" } }),
        snap({ tokenId: "t2", disposition: -1, hp: 0, rolled: { items: [], currency: { gp: 3 }, tableSource: "type:humanoid", tableId: "type:humanoid" } })
      ],
      opts()
    );
    expect(data.currency).toEqual({ gp: 8, sp: 2 });
  });

  it("npc row stores its own npcCurrency regardless of included", () => {
    const data = buildSessionData(
      [
        snap({ tokenId: "t1", disposition: -1, hp: 0, rolled: { items: [], currency: { gp: 5 }, tableSource: "type:humanoid", tableId: "type:humanoid" } }), // included
        snap({ tokenId: "t2", disposition: -1, hp: 5, defeatedStatus: false, rolled: { items: [], currency: { gp: 100 }, tableSource: "type:humanoid", tableId: "type:humanoid" } }) // not included (alive)
      ],
      opts()
    );
    expect(data.npcs.find((n) => n.tokenId === "t1").npcCurrency).toEqual({ gp: 5 });
    // npcCurrency is recorded even though this npc row is not included in session.currency
    expect(data.npcs.find((n) => n.tokenId === "t2").npcCurrency).toEqual({ gp: 100 });
    // session.currency (summed) still only reflects INCLUDED rows
    expect(data.currency).toEqual({ gp: 5 });
  });

  it("npc row npcCurrency defaults to {} when rolled has no currency", () => {
    const data = buildSessionData([snap({ rolled: null })], opts());
    expect(data.npcs[0].npcCurrency).toEqual({});
  });

  it("unlinked tokens: two snapshots sharing actorName but different tokenId produce separate npc rows and separate items", () => {
    const data = buildSessionData(
      [
        snap({
          combatantId: "c1", tokenId: "t1", actorName: "Goblin", disposition: -1, hp: 0,
          rolled: { items: [{ uuid: "u1", name: "Dagger", qty: 1 }], currency: {}, tableSource: "type:humanoid", tableId: "type:humanoid" }
        }),
        snap({
          combatantId: "c2", tokenId: "t2", actorName: "Goblin", disposition: -1, hp: 0,
          rolled: { items: [{ uuid: "u1", name: "Dagger", qty: 1 }], currency: {}, tableSource: "type:humanoid", tableId: "type:humanoid" }
        })
      ],
      opts()
    );
    expect(data.npcs).toHaveLength(2);
    expect(data.npcs.map((n) => n.tokenId)).toEqual(["t1", "t2"]);
    expect(data.items).toHaveLength(2);
    expect(data.items.map((i) => i.sourceNpc)).toEqual(["t1", "t2"]);
    // distinct row ids even though item content is identical
    expect(data.items[0].id).not.toBe(data.items[1].id);
  });

  it("zero included, zero items, zero currency -> npcs listed but items/currency empty", () => {
    const data = buildSessionData([snap({ hp: 5, defeatedStatus: false })], opts());
    expect(data.npcs).toHaveLength(1);
    expect(data.items).toEqual([]);
    expect(data.currency).toEqual({});
  });

  it("carriedEnabled passes through to returned data", () => {
    const data = buildSessionData([snap()], opts({ carriedEnabled: false }));
    expect(data.carriedEnabled).toBe(false);
  });

  it("name passes through to returned data", () => {
    const data = buildSessionData([snap()], opts({ name: "Bandit raid" }));
    expect(data.name).toBe("Bandit raid");
  });

  it("no snapshots -> empty npcs/items/currency", () => {
    const data = buildSessionData([], opts());
    expect(data).toEqual({ name: "Goblin ambush", npcs: [], items: [], currency: {}, carriedEnabled: true });
  });

  it("multiple carried items on one snapshot each become their own item row", () => {
    const data = buildSessionData(
      [
        snap({
          tokenId: "t1",
          carriedItems: [
            { itemData: { name: "Dagger", type: "weapon" }, sourceTokenUuid: "Scene.s.Token.t1" },
            { itemData: { name: "Rope", type: "loot" }, sourceTokenUuid: "Scene.s.Token.t1" }
          ]
        })
      ],
      opts()
    );
    expect(data.items).toHaveLength(2);
    expect(data.items.map((i) => i.name)).toEqual(["Dagger", "Rope"]);
  });

  it("item rows default qty to 1 when rolled entry omits qty", () => {
    const data = buildSessionData(
      [snap({ rolled: { items: [{ uuid: "u1", name: "Torch" }], currency: {}, tableSource: "fallback", tableId: "fallback" } })],
      opts()
    );
    expect(data.items[0].qty).toBe(1);
  });

  it("carried item rows default qty to 1", () => {
    const data = buildSessionData(
      [snap({ carriedItems: [{ itemData: { name: "Rope" }, sourceTokenUuid: "u" }] })],
      opts()
    );
    expect(data.items[0].qty).toBe(1);
  });
});

describe("applyReroll", () => {
  function makeSession(over = {}) {
    return {
      npcs: [
        { tokenId: "t1", actorName: "Goblin", img: "i.svg", cr: 0.25, tableSource: "type:humanoid", tableId: "type:humanoid", included: true, defeated: true, npcCurrency: { gp: 5 } },
        { tokenId: "t2", actorName: "Orc", img: "o.svg", cr: 1, tableSource: "type:humanoid", tableId: "type:humanoid", included: true, defeated: true, npcCurrency: { gp: 10 } }
      ],
      items: [
        { id: "i1", name: "Dagger", img: "d.svg", qty: 1, sourceNpc: "t1", state: "unclaimed", uuid: "u1" },
        { id: "i2", name: "Rusty Sword", img: "r.svg", qty: 1, sourceNpc: "t1", state: "unclaimed", itemData: { name: "Rusty Sword" }, carried: true, sourceTokenUuid: "Scene.s.Token.t1" },
        { id: "i3", name: "Axe", img: "a.svg", qty: 1, sourceNpc: "t2", state: "unclaimed", uuid: "u2" }
      ],
      currency: { gp: 15 },
      currencyManual: false,
      ...over
    };
  }

  const rolled = (over = {}) => ({ items: [{ uuid: "u9", name: "Longsword", img: "l.svg", qty: 2 }], currency: { gp: 7 }, ...over });

  it("replaces the NPC's generated (non-carried) items with the freshly rolled ones", () => {
    const draft = applyReroll(makeSession(), "t1", rolled());
    const t1Items = draft.items.filter((i) => i.sourceNpc === "t1");
    expect(t1Items).toHaveLength(2); // carried kept + 1 new generated
    expect(t1Items.some((i) => i.name === "Dagger")).toBe(false); // old generated item gone
    expect(t1Items.some((i) => i.name === "Longsword")).toBe(true);
  });

  it("leaves carried items for that NPC untouched", () => {
    const draft = applyReroll(makeSession(), "t1", rolled());
    const carried = draft.items.find((i) => i.id === "i2");
    expect(carried).toMatchObject({ name: "Rusty Sword", carried: true, sourceNpc: "t1" });
  });

  it("leaves other NPCs' items untouched", () => {
    const draft = applyReroll(makeSession(), "t1", rolled());
    const t2Items = draft.items.filter((i) => i.sourceNpc === "t2");
    expect(t2Items).toHaveLength(1);
    expect(t2Items[0].name).toBe("Axe");
  });

  it("new item rows get fresh ids distinct from any prior row", () => {
    const draft = applyReroll(makeSession(), "t1", rolled());
    const newItem = draft.items.find((i) => i.name === "Longsword");
    expect(newItem.id).toBeTruthy();
    expect(["i1", "i2", "i3"]).not.toContain(newItem.id);
  });

  it("updates the NPC row's npcCurrency to the rerolled amount", () => {
    const draft = applyReroll(makeSession(), "t1", rolled({ currency: { gp: 7 } }));
    expect(draft.npcs.find((n) => n.tokenId === "t1").npcCurrency).toEqual({ gp: 7 });
  });

  it("recomputes session.currency from all included npc rows (sums t1's new + t2's unchanged)", () => {
    const draft = applyReroll(makeSession(), "t1", rolled({ currency: { gp: 7 } }));
    expect(draft.currency).toEqual({ gp: 17 }); // 7 (t1 new) + 10 (t2 unchanged)
  });

  it("does NOT recompute session.currency when currencyManual is true (GM edited the pot)", () => {
    const draft = applyReroll(makeSession({ currencyManual: true, currency: { gp: 999 } }), "t1", rolled({ currency: { gp: 7 } }));
    expect(draft.currency).toEqual({ gp: 999 });
    // npcCurrency still updates even though the summed pot is left alone
    expect(draft.npcs.find((n) => n.tokenId === "t1").npcCurrency).toEqual({ gp: 7 });
  });

  it("rerolling an excluded npc still swaps its items/currency but session.currency excludes it either way", () => {
    const session = makeSession();
    session.npcs[0].included = false;
    const draft = applyReroll(session, "t1", rolled({ currency: { gp: 7 } }));
    expect(draft.npcs.find((n) => n.tokenId === "t1").npcCurrency).toEqual({ gp: 7 });
    expect(draft.currency).toEqual({ gp: 10 }); // only t2 (included)
  });

  it("does not mutate the input session (returns a new object)", () => {
    const session = makeSession();
    const before = JSON.parse(JSON.stringify(session));
    applyReroll(session, "t1", rolled());
    expect(session).toEqual(before);
  });

  it("unknown tokenId leaves the session's npcs/items/currency unchanged", () => {
    const session = makeSession();
    const draft = applyReroll(session, "nope", rolled());
    expect(draft.npcs).toEqual(session.npcs);
    expect(draft.items).toEqual(session.items);
    expect(draft.currency).toEqual(session.currency);
  });

  it("rerolled item rows omit currency-only entries (only items[] entries land in items)", () => {
    const draft = applyReroll(makeSession(), "t1", rolled({ items: [], currency: { gp: 3 } }));
    expect(draft.items.filter((i) => i.sourceNpc === "t1" && !i.carried)).toHaveLength(0);
  });
});

describe("rerollNpc", () => {
  // Deterministic single-entry tables: rolls: "1" is a constant (no dice), and a
  // lone weight-1 entry is the only weightedPick() candidate, so the item drawn
  // is fully predictable regardless of Math.random.
  function singleItemTable(name, uuid) {
    return { name, rolls: "1", entries: [{ id: "e1", weight: 1, type: "item", uuid, qty: "1" }] };
  }

  beforeEach(() => {
    installShim({ settings: { "tristons-loot-generator.contentPack": "dnd5e", "tristons-loot-generator.generosity": "standard" } });
  });

  afterEach(() => {
    delete globalThis.fromUuid;
  });

  async function seedTables() {
    const liveTable = await createCustomTable("Live-match table");
    liveTable.entries = [{ id: "e1", weight: 1, type: "item", uuid: "Item.liveMatch", qty: "1" }];
    await saveTable(liveTable);

    const storedTable = await createCustomTable("Stored fallback table");
    storedTable.entries = [{ id: "e1", weight: 1, type: "item", uuid: "Item.storedFallback", qty: "1" }];
    await saveTable(storedTable);

    return { liveTable, storedTable };
  }

  function baseSession(over = {}) {
    return {
      name: "Ambush",
      npcs: [
        { tokenId: "t1", actorName: "Goblin", img: "g.svg", cr: 0.25, tableSource: "keyword", tableId: null, included: true, defeated: true, npcCurrency: { gp: 1 } },
        { tokenId: "t2", actorName: "Orc", img: "o.svg", cr: 1, tableSource: "type:humanoid", tableId: "type:humanoid", included: true, defeated: true, npcCurrency: { gp: 20 } }
      ],
      items: [
        { id: "i-t2", name: "Axe", img: "a.svg", qty: 1, sourceNpc: "t2", state: "unclaimed", uuid: "Item.axe" }
      ],
      currency: { gp: 21 },
      currencyManual: false,
      ...over
    };
  }

  it("returns null when the session id is unknown", async () => {
    const result = await rerollNpc("nope", "t1");
    expect(result).toBeNull();
  });

  it("returns null when the tokenId has no matching npc row", async () => {
    await seedTables();
    const session = await createSession(baseSession({ npcs: baseSession().npcs }));
    const result = await rerollNpc(session.id, "nope");
    expect(result).toBeNull();
  });

  describe("LIVE path (carried row + resolvable token + actor)", () => {
    it("re-runs matchTable against the live actor, ignoring the stored tableId, and rolls from the matched table", async () => {
      const { liveTable, storedTable } = await seedTables();
      await saveKeywordRules([
        { id: "r1", pattern: "Goblin", matchType: "includes", tableId: liveTable.id, enabled: true }
      ]);

      const session = await createSession(baseSession({
        npcs: [
          // stored tableId deliberately points at the OTHER table, proving re-match happens
          { tokenId: "t1", actorName: "Goblin", img: "g.svg", cr: 0.25, tableSource: "type:humanoid", tableId: storedTable.id, included: true, defeated: true, npcCurrency: { gp: 1 } },
          { tokenId: "t2", actorName: "Orc", img: "o.svg", cr: 1, tableSource: "type:humanoid", tableId: "type:humanoid", included: true, defeated: true, npcCurrency: { gp: 20 } }
        ],
        items: [
          { id: "i-carried", name: "Rusty knife", img: "k.svg", qty: 1, sourceNpc: "t1", state: "unclaimed", itemData: { name: "Rusty knife" }, carried: true, sourceTokenUuid: "Scene.s.Token.t1" },
          { id: "i-t2", name: "Axe", img: "a.svg", qty: 1, sourceNpc: "t2", state: "unclaimed", uuid: "Item.axe" }
        ]
      }));

      const fakeActor = {
        name: "Goblin",
        system: { details: { biography: { value: "" }, type: { value: "humanoid" }, cr: 0.25 } },
        getFlag: () => undefined
      };
      globalThis.fromUuid = async (uuid) => {
        if (uuid === "Scene.s.Token.t1") return { actor: fakeActor };
        return null;
      };

      const updated = await rerollNpc(session.id, "t1");

      const t1Items = updated.items.filter((i) => i.sourceNpc === "t1" && !i.carried);
      expect(t1Items).toHaveLength(1);
      expect(t1Items[0].uuid).toBe("Item.liveMatch"); // from the keyword-matched table, NOT storedTable

      // carried row for t1 preserved untouched
      const carried = updated.items.find((i) => i.id === "i-carried");
      expect(carried).toMatchObject({ carried: true, sourceNpc: "t1", itemData: { name: "Rusty knife" }, sourceTokenUuid: "Scene.s.Token.t1" });

      // t2's items untouched
      const t2Items = updated.items.filter((i) => i.sourceNpc === "t2");
      expect(t2Items).toHaveLength(1);
      expect(t2Items[0].id).toBe("i-t2");

      // npcCurrency swapped for t1, t2 unchanged
      const npc1 = updated.npcs.find((n) => n.tokenId === "t1");
      const npc2 = updated.npcs.find((n) => n.tokenId === "t2");
      expect(npc2.npcCurrency).toEqual({ gp: 20 });
      // this table has no currency entries -> rolled currency is {}
      expect(npc1.npcCurrency).toEqual({});

      // session.currency recomputed from included rows: t1 now {} + t2 {gp:20}
      expect(updated.currency).toEqual({ gp: 20 });
    });

    it("preserves session.currency when currencyManual is true, but still updates npcCurrency", async () => {
      const { liveTable, storedTable } = await seedTables();
      await saveKeywordRules([
        { id: "r1", pattern: "Goblin", matchType: "includes", tableId: liveTable.id, enabled: true }
      ]);

      const session = await createSession(baseSession({
        currency: { gp: 999 },
        npcs: [
          { tokenId: "t1", actorName: "Goblin", img: "g.svg", cr: 0.25, tableSource: "type:humanoid", tableId: storedTable.id, included: true, defeated: true, npcCurrency: { gp: 1 } },
          { tokenId: "t2", actorName: "Orc", img: "o.svg", cr: 1, tableSource: "type:humanoid", tableId: "type:humanoid", included: true, defeated: true, npcCurrency: { gp: 20 } }
        ],
        items: [
          { id: "i-carried", name: "Rusty knife", img: "k.svg", qty: 1, sourceNpc: "t1", state: "unclaimed", itemData: { name: "Rusty knife" }, carried: true, sourceTokenUuid: "Scene.s.Token.t1" }
        ]
      }));
      // createSession() only whitelists a fixed set of fields (see session-store.js);
      // currencyManual is set later via an updateSession mutator in real usage
      // (loot-review.js), so seed it the same way here.
      await updateSession(session.id, (draft) => { draft.currencyManual = true; });

      const fakeActor = {
        name: "Goblin",
        system: { details: { biography: { value: "" }, type: { value: "humanoid" }, cr: 0.25 } },
        getFlag: () => undefined
      };
      globalThis.fromUuid = async (uuid) => (uuid === "Scene.s.Token.t1" ? { actor: fakeActor } : null);

      const updated = await rerollNpc(session.id, "t1");

      expect(updated.currency).toEqual({ gp: 999 }); // untouched (manual)
      expect(updated.npcs.find((n) => n.tokenId === "t1").npcCurrency).toEqual({}); // still updates
    });
  });

  describe("FALLBACK path (no carried row, or fromUuid/actor resolution fails)", () => {
    it("uses the npc row's stored tableId directly, skipping matchTable, when there is no carried row", async () => {
      const { liveTable, storedTable } = await seedTables();
      // A keyword rule that WOULD match "Goblin" if matchTable ran -- fallback path must ignore it.
      await saveKeywordRules([
        { id: "r1", pattern: "Goblin", matchType: "includes", tableId: liveTable.id, enabled: true }
      ]);

      const session = await createSession(baseSession({
        npcs: [
          { tokenId: "t1", actorName: "Goblin", img: "g.svg", cr: 0.25, tableSource: "type:humanoid", tableId: storedTable.id, included: true, defeated: true, npcCurrency: { gp: 1 } },
          { tokenId: "t2", actorName: "Orc", img: "o.svg", cr: 1, tableSource: "type:humanoid", tableId: "type:humanoid", included: true, defeated: true, npcCurrency: { gp: 20 } }
        ],
        items: [
          // no carried row for t1 at all
          { id: "i-t2", name: "Axe", img: "a.svg", qty: 1, sourceNpc: "t2", state: "unclaimed", uuid: "Item.axe" }
        ]
      }));

      globalThis.fromUuid = async () => { throw new Error("fromUuid should not be called on the fallback path"); };

      const updated = await rerollNpc(session.id, "t1");

      const t1Items = updated.items.filter((i) => i.sourceNpc === "t1" && !i.carried);
      expect(t1Items).toHaveLength(1);
      expect(t1Items[0].uuid).toBe("Item.storedFallback"); // from the STORED tableId, not the keyword rule

      const t2Items = updated.items.filter((i) => i.sourceNpc === "t2");
      expect(t2Items).toHaveLength(1);
      expect(t2Items[0].id).toBe("i-t2");

      expect(updated.currency).toEqual({ gp: 20 }); // t1's new {} + t2's {gp:20}
    });

    it("falls back to the stored tableId when the carried row's token no longer resolves (fromUuid -> null)", async () => {
      const { storedTable } = await seedTables();

      const session = await createSession(baseSession({
        npcs: [
          { tokenId: "t1", actorName: "Goblin", img: "g.svg", cr: 0.25, tableSource: "type:humanoid", tableId: storedTable.id, included: true, defeated: true, npcCurrency: { gp: 1 } },
          { tokenId: "t2", actorName: "Orc", img: "o.svg", cr: 1, tableSource: "type:humanoid", tableId: "type:humanoid", included: true, defeated: true, npcCurrency: { gp: 20 } }
        ],
        items: [
          { id: "i-carried", name: "Rusty knife", img: "k.svg", qty: 1, sourceNpc: "t1", state: "unclaimed", itemData: { name: "Rusty knife" }, carried: true, sourceTokenUuid: "Scene.s.Token.t1" },
          { id: "i-t2", name: "Axe", img: "a.svg", qty: 1, sourceNpc: "t2", state: "unclaimed", uuid: "Item.axe" }
        ]
      }));

      // Token gone: fromUuid resolves but returns null (deleted token).
      globalThis.fromUuid = async () => null;

      const updated = await rerollNpc(session.id, "t1");

      const t1Items = updated.items.filter((i) => i.sourceNpc === "t1" && !i.carried);
      expect(t1Items).toHaveLength(1);
      expect(t1Items[0].uuid).toBe("Item.storedFallback");

      const carried = updated.items.find((i) => i.id === "i-carried");
      expect(carried).toMatchObject({ carried: true, sourceNpc: "t1" });
    });

    it("falls back to the stored tableId when the resolved token has no actor", async () => {
      const { storedTable } = await seedTables();

      const session = await createSession(baseSession({
        npcs: [
          { tokenId: "t1", actorName: "Goblin", img: "g.svg", cr: 0.25, tableSource: "type:humanoid", tableId: storedTable.id, included: true, defeated: true, npcCurrency: { gp: 1 } },
          { tokenId: "t2", actorName: "Orc", img: "o.svg", cr: 1, tableSource: "type:humanoid", tableId: "type:humanoid", included: true, defeated: true, npcCurrency: { gp: 20 } }
        ],
        items: [
          { id: "i-carried", name: "Rusty knife", img: "k.svg", qty: 1, sourceNpc: "t1", state: "unclaimed", itemData: { name: "Rusty knife" }, carried: true, sourceTokenUuid: "Scene.s.Token.t1" }
        ]
      }));

      globalThis.fromUuid = async () => ({ actor: null }); // token exists but its actor is gone

      const updated = await rerollNpc(session.id, "t1");

      const t1Items = updated.items.filter((i) => i.sourceNpc === "t1" && !i.carried);
      expect(t1Items).toHaveLength(1);
      expect(t1Items[0].uuid).toBe("Item.storedFallback");
    });

    it("returns null and does not update the session when the npc row has no stored tableId and there is no live token", async () => {
      await seedTables();
      const session = await createSession(baseSession({
        npcs: [
          { tokenId: "t1", actorName: "Goblin", img: "g.svg", cr: 0.25, tableSource: null, tableId: null, included: true, defeated: true, npcCurrency: {} }
        ],
        items: [],
        currency: {}
      }));

      const result = await rerollNpc(session.id, "t1");
      expect(result).toBeNull();

      const unchanged = getSession(session.id);
      expect(unchanged.npcs[0].npcCurrency).toEqual({});
    });
  });
});
