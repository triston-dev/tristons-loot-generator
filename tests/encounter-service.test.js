import { describe, it, expect } from "vitest";
import { buildSessionData } from "../scripts/core/encounter-service.js";

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

  it("npc row shape: tokenId, actorName, img, cr, tableSource, included, defeated", () => {
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
      included: true,
      defeated: true
    });
  });

  it("npc row tableSource is null when rolled is null", () => {
    const data = buildSessionData([snap({ rolled: null })], opts());
    expect(data.npcs[0].tableSource).toBeNull();
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
