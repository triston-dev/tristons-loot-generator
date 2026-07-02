import { describe, it, expect } from "vitest";
import { buildSessionData, applyReroll } from "../scripts/core/encounter-service.js";

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
