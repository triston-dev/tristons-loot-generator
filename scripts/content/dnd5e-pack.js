const cur = (weight, formula, denom = "sp", gates = {}) => ({ id: `c${weight}${denom}`, weight, type: "currency", currency: { formula, denom }, ...gates });
const item = (weight, name, qty = "1", gates = {}) => ({ id: name.toLowerCase().replace(/\W+/g, "-"), weight, type: "item", ref: { name }, qty, ...gates });
const inline = (weight, itemData, gates = {}) => ({ id: itemData.name.toLowerCase().replace(/\W+/g, "-"), weight, type: "item", itemData, ...gates });
const nested = (weight, tableId, qty = "1") => ({ id: tableId.replace(/\W+/g, "-"), weight, type: "table", tableId, qty });
const nothing = (weight) => ({ id: `none${weight}`, weight, type: "nothing" });

// Reusable inline itemData builders (flavor loot, no ref names invented).
const silverRing = () => ({ name: "Silver ring", img: "icons/equipment/finger/ring-band-engraved-silver.webp", type: "loot", system: { price: { value: 25, denomination: "gp" }, quantity: 1 } });
const jadeFigurine = () => ({ name: "Jade figurine", img: "icons/commodities/tech/cog-brass.webp", type: "loot", system: { price: { value: 40, denomination: "gp" }, quantity: 1 } });
const boneDiceSet = () => ({ name: "Bone dice set", img: "icons/sundries/gaming/dice-runed-brown.webp", type: "loot", system: { price: { value: 5, denomination: "gp" }, quantity: 1 } });
const bloodstone = () => ({ name: "Bloodstone", img: "icons/commodities/gems/gem-rough-navette-red.webp", type: "loot", system: { price: { value: 50, denomination: "gp" }, quantity: 1 } });
const goldIdol = () => ({ name: "Small gold idol", img: "icons/commodities/treasure/statue-primitive-carved.webp", type: "loot", system: { price: { value: 250, denomination: "gp" }, quantity: 1 } });
const monsterFang = () => ({ name: "Monster fang trophy", img: "icons/commodities/bones/tooth-sabre-white.webp", type: "loot", system: { price: { value: 2, denomination: "gp" }, quantity: 1 } });
const thickPelt = () => ({ name: "Thick pelt", img: "icons/commodities/leather/leather-scraps-tan.webp", type: "loot", system: { price: { value: 3, denomination: "gp" }, quantity: 1 } });
const arcaneResidue = () => ({ name: "Arcane residue", img: "icons/commodities/materia/orb-glowing-purple.webp", type: "loot", system: { price: { value: 15, denomination: "gp" }, quantity: 1 } });
const ancientCoin = () => ({ name: "Ancient coin", img: "icons/commodities/currency/coin-embossed-skull-gold.webp", type: "loot", system: { price: { value: 8, denomination: "gp" }, quantity: 1 } });
const clawTrophy = () => ({ name: "Sharpened claw", img: "icons/commodities/claws/claw-hooked-grey.webp", type: "loot", system: { price: { value: 1, denomination: "gp" }, quantity: 1 } });
const chitinShard = () => ({ name: "Chitin shard", img: "icons/commodities/bones/shell-tan.webp", type: "loot", system: { price: { value: 1, denomination: "gp" }, quantity: 1 } });
const oozeResidue = () => ({ name: "Congealed ooze residue", img: "icons/commodities/materia/orb-swirl-green.webp", type: "loot", system: { price: { value: 5, denomination: "gp" }, quantity: 1 } });
const driedHerbs = () => ({ name: "Dried herb bundle", img: "icons/commodities/plants/plant-sprout-green.webp", type: "loot", system: { price: { value: 2, denomination: "gp" }, quantity: 1 } });
const rareSeedPod = () => ({ name: "Rare seed pod", img: "icons/commodities/plants/plant-marked-yellow.webp", type: "loot", system: { price: { value: 20, denomination: "gp" }, quantity: 1 } });
const clockworkGear = () => ({ name: "Clockwork gear component", img: "icons/commodities/tech/cog-iron-partial.webp", type: "loot", system: { price: { value: 10, denomination: "gp" }, quantity: 1 } });
const fusedComponent = () => ({ name: "Fused construct component", img: "icons/commodities/tech/cog-brass-large.webp", type: "loot", system: { price: { value: 18, denomination: "gp" }, quantity: 1 } });
const dragonScale = () => ({ name: "Dragon scale", img: "icons/commodities/scales/scales-dragon-glowing-red.webp", type: "loot", system: { price: { value: 75, denomination: "gp" }, quantity: 1 } });
const preciousGem = () => ({ name: "Precious gem", img: "icons/commodities/gems/gem-rough-cushion-blue.webp", type: "loot", system: { price: { value: 100, denomination: "gp" }, quantity: 1 } });
const giantSack = () => ({ name: "Crude coin sack", img: "icons/containers/bags/sack-leather-brown.webp", type: "loot", system: { price: { value: 0, denomination: "gp" }, quantity: 1 } });
const gnarledTrophy = () => ({ name: "Gnarled bone trophy", img: "icons/commodities/bones/bone-white.webp", type: "loot", system: { price: { value: 6, denomination: "gp" }, quantity: 1 } });
const charredRelic = () => ({ name: "Charred relic", img: "icons/commodities/materia/orb-glowing-orange.webp", type: "loot", system: { price: { value: 30, denomination: "gp" }, quantity: 1 } });
const holySymbolShard = () => ({ name: "Radiant symbol shard", img: "icons/commodities/materia/orb-glowing-yellow.webp", type: "loot", system: { price: { value: 35, denomination: "gp" }, quantity: 1 } });
const elementalShard = () => ({ name: "Elemental shard", img: "icons/commodities/gems/gem-rough-rose-orange.webp", type: "loot", system: { price: { value: 45, denomination: "gp" }, quantity: 1 } });
const feyDust = () => ({ name: "Fey dust", img: "icons/commodities/materia/orb-glowing-green.webp", type: "loot", system: { price: { value: 12, denomination: "gp" }, quantity: 1 } });
const abyssalIchor = () => ({ name: "Vial of abyssal ichor", img: "icons/consumables/potions/bottle-round-corked-orange.webp", type: "loot", system: { price: { value: 22, denomination: "gp" }, quantity: 1 } });
const strangeCrystal = () => ({ name: "Strange crystal formation", img: "icons/commodities/gems/gem-rough-raw-teal.webp", type: "loot", system: { price: { value: 18, denomination: "gp" }, quantity: 1 } });

export default {
  id: "dnd5e", label: "D&D 5e",
  itemPacks: ["dnd5e.items", "dnd5e.tradegoods"],
  currency: { path: "system.currency", primary: "gp",
    denominations: [{ key: "pp", label: "PP" }, { key: "gp", label: "GP" }, { key: "ep", label: "EP" }, { key: "sp", label: "SP" }, { key: "cp", label: "CP" }] },
  creatureTypes: ["aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead"],
  sharedTables: {
    "shared:trinkets": {
      id: "shared:trinkets", name: "Trinkets & valuables", rolls: "1",
      entries: [inline(3, silverRing()), inline(3, jadeFigurine()), inline(2, boneDiceSet()), inline(2, bloodstone()), inline(1, goldIdol(), { minCr: 3 })]
    },
    "shared:weapons-common": {
      id: "shared:weapons-common", name: "Common weapons", rolls: "1",
      entries: [item(3, "Dagger"), item(2, "Shortsword"), item(2, "Scimitar"), item(2, "Shortbow"), item(1, "Handaxe"), item(1, "Mace")]
    }
  },
  typeTables: {
    aberration: {
      id: "type:aberration", name: "Aberration", rolls: "1",
      entries: [inline(10, strangeCrystal()), inline(6, arcaneResidue()), nested(6, "shared:trinkets", "1"), nothing(48)]
    },
    beast: {
      id: "type:beast", name: "Beast", rolls: "1",
      entries: [inline(20, thickPelt()), inline(12, monsterFang()), inline(6, clawTrophy()), nothing(52)]
    },
    celestial: {
      id: "type:celestial", name: "Celestial", rolls: "1",
      entries: [cur(15, "(2d6 + @cr) * 10", "gp"), inline(15, holySymbolShard()), nested(10, "shared:trinkets"), item(6, "Potion of Healing", "1", { minCr: 2 }), nothing(34)]
    },
    construct: {
      id: "type:construct", name: "Construct", rolls: "1",
      entries: [inline(20, clockworkGear()), inline(12, fusedComponent()), nested(6, "shared:trinkets", "1"), nothing(52)]
    },
    dragon: {
      id: "type:dragon", name: "Dragon", rolls: "1d2",
      entries: [cur(35, "(4d10 + @cr) * 10", "gp"), inline(20, dragonScale()), inline(15, preciousGem()), nested(20, "shared:trinkets"), nothing(10)]
    },
    elemental: {
      id: "type:elemental", name: "Elemental", rolls: "1",
      entries: [inline(18, elementalShard()), inline(10, arcaneResidue()), cur(10, "(1d6 + @cr) * 5", "gp"), nothing(52)]
    },
    fey: {
      id: "type:fey", name: "Fey", rolls: "1",
      entries: [inline(18, feyDust()), nested(14, "shared:trinkets"), cur(10, "(1d8 + @cr) * 5", "gp"), nothing(48)]
    },
    fiend: {
      id: "type:fiend", name: "Fiend", rolls: "1",
      entries: [cur(20, "(2d6 + @cr) * 10", "gp"), inline(16, abyssalIchor()), inline(10, charredRelic()), nested(10, "shared:trinkets"), nothing(34)]
    },
    giant: {
      id: "type:giant", name: "Giant", rolls: "1",
      entries: [inline(15, giantSack()), cur(30, "(3d8 + @cr) * 10", "gp"), nested(15, "shared:weapons-common"), nested(10, "shared:trinkets"), nothing(20)]
    },
    humanoid: {
      id: "type:humanoid", name: "Humanoid", rolls: "1d2",
      entries: [cur(30, "(2d6 + @cr) * 10", "sp"), nested(20, "shared:weapons-common"), nested(10, "shared:trinkets"), item(8, "Potion of Healing", "1", { minCr: 2 }), nothing(20)]
    },
    monstrosity: {
      id: "type:monstrosity", name: "Monstrosity", rolls: "1",
      entries: [inline(15, gnarledTrophy()), inline(10, monsterFang()), nested(8, "shared:trinkets"), nothing(55)]
    },
    ooze: {
      id: "type:ooze", name: "Ooze", rolls: "1",
      entries: [inline(10, oozeResidue()), inline(3, strangeCrystal(), { minCr: 4 }), nested(2, "shared:trinkets", "1"), nothing(65)]
    },
    plant: {
      id: "type:plant", name: "Plant", rolls: "1",
      entries: [inline(14, driedHerbs()), inline(8, rareSeedPod(), { minCr: 2 }), nothing(60)]
    },
    undead: {
      id: "type:undead", name: "Undead", rolls: "1",
      entries: [cur(25, "(1d6 + @cr) * 5", "sp"), inline(15, ancientCoin()), nested(10, "shared:trinkets"), nothing(40)]
    }
  },
  fallbackTable: { id: "fallback", name: "Fallback", rolls: "1", entries: [cur(30, "(1d6 + @cr) * 5", "sp"), nested(15, "shared:trinkets"), nothing(45)] },
  rarityBudget: [
    { maxCr: 4, allowed: ["common", "uncommon"] },
    { maxCr: 10, allowed: ["common", "uncommon", "rare"] },
    { maxCr: 16, allowed: ["common", "uncommon", "rare", "veryRare"] },
    { maxCr: 99, allowed: ["common", "uncommon", "rare", "veryRare", "legendary", "artifact"] }
  ],
  carriedGear: { includeTypes: ["weapon", "equipment", "consumable", "tool", "loot", "container"], excludeNaturalWeapons: true }
};
