const cur = (weight, formula, denom = "gp", gates = {}) => ({ id: `c${weight}${denom}`, weight, type: "currency", currency: { formula, denom }, ...gates });
const item = (weight, name, qty = "1", gates = {}) => ({ id: name.toLowerCase().replace(/\W+/g, "-"), weight, type: "item", ref: { name }, qty, ...gates });
const inline = (weight, itemData, gates = {}) => ({ id: itemData.name.toLowerCase().replace(/\W+/g, "-"), weight, type: "item", itemData, ...gates });
const nested = (weight, tableId, qty = "1") => ({ id: tableId.replace(/\W+/g, "-"), weight, type: "table", tableId, qty });
const nothing = (weight) => ({ id: `none${weight}`, weight, type: "nothing" });

// Inline itemData builders (flavor loot; refs limited to Vibroblade, Blaster Pistol, Medpac).
const creditChip = () => ({ name: "Credit chip", img: "icons/commodities/currency/coin-inset-copper-axe.webp", type: "loot", system: { price: { value: 15, denomination: "gp" }, quantity: 1 } });
const powerCell = () => ({ name: "Power cell", img: "icons/commodities/tech/steel-battery.webp", type: "loot", system: { price: { value: 10, denomination: "gp" }, quantity: 1 } });
const scrapMetal = () => ({ name: "Scrap metal", img: "icons/commodities/metal/scrap-plates-steel.webp", type: "loot", system: { price: { value: 3, denomination: "gp" }, quantity: 1 } });
const holodisk = () => ({ name: "Holodisk", img: "icons/commodities/tech/disc-blue.webp", type: "loot", system: { price: { value: 20, denomination: "gp" }, quantity: 1 } });
const servoMotor = () => ({ name: "Servo motor", img: "icons/commodities/tech/cog-brass.webp", type: "loot", system: { price: { value: 12, denomination: "gp" }, quantity: 1 } });
const droidChassisPart = () => ({ name: "Droid chassis fragment", img: "icons/commodities/metal/plate-steel.webp", type: "loot", system: { price: { value: 8, denomination: "gp" }, quantity: 1 } });
const opticalSensor = () => ({ name: "Optical sensor", img: "icons/commodities/tech/sensor-red.webp", type: "loot", system: { price: { value: 18, denomination: "gp" }, quantity: 1 } });
const dataChip = () => ({ name: "Encrypted data chip", img: "icons/commodities/tech/chip-yellow.webp", type: "loot", system: { price: { value: 25, denomination: "gp" }, quantity: 1 } });
const circuitBoard = () => ({ name: "Damaged circuit board", img: "icons/commodities/tech/circuitboard-orange.webp", type: "loot", system: { price: { value: 6, denomination: "gp" }, quantity: 1 } });
const kyberShard = () => ({ name: "Kyber crystal shard", img: "icons/commodities/gems/gem-rough-cushion-blue.webp", type: "loot", system: { price: { value: 90, denomination: "gp" }, quantity: 1 } });
const alienResidue = () => ({ name: "Unidentified organic residue", img: "icons/commodities/materia/orb-swirl-green.webp", type: "loot", system: { price: { value: 5, denomination: "gp" }, quantity: 1 } });
const rationPack = () => ({ name: "Ration pack", img: "icons/consumables/food/pack-ration-nutrient-brown.webp", type: "loot", system: { price: { value: 4, denomination: "gp" }, quantity: 1 } });
const seedPouch = () => ({ name: "Seed pouch", img: "icons/commodities/plants/plant-marked-yellow.webp", type: "loot", system: { price: { value: 7, denomination: "gp" }, quantity: 1 } });
const barkSample = () => ({ name: "Fibrous bark sample", img: "icons/commodities/wood/bark-shredded-brown.webp", type: "loot", system: { price: { value: 3, denomination: "gp" }, quantity: 1 } });
const ancientRelicPart = () => ({ name: "Ancient relic fragment", img: "icons/commodities/stone/stone-engraved-glowing-teal.webp", type: "loot", system: { price: { value: 35, denomination: "gp" }, quantity: 1 } });
const forceCrystal = () => ({ name: "Force-attuned crystal", img: "icons/commodities/gems/gem-rough-navette-red.webp", type: "loot", system: { price: { value: 60, denomination: "gp" }, quantity: 1 } });
const preservedRemains = () => ({ name: "Preserved remains", img: "icons/commodities/bones/bone-white.webp", type: "loot", system: { price: { value: 2, denomination: "gp" }, quantity: 1 } });
const corrodedPlating = () => ({ name: "Corroded plating", img: "icons/commodities/metal/plate-dented-steel.webp", type: "loot", system: { price: { value: 4, denomination: "gp" }, quantity: 1 } });

export default {
  id: "sw5e", label: "SW5e",
  itemPacks: ["sw5e.blasters", "sw5e.lightweapons", "sw5e.adventuringgear", "sw5e.enhanceditems"],
  currency: { path: "system.currency", primary: "gp",
    denominations: [{ key: "gp", label: "Credits" }] },
  creatureTypes: ["aberration", "beast", "construct", "droid", "force entity", "humanoid", "plant", "undead"],
  sharedTables: {
    "shared:tech-scraps": {
      id: "shared:tech-scraps", name: "Tech scraps", rolls: "1",
      entries: [inline(4, scrapMetal()), inline(3, circuitBoard()), inline(2, servoMotor()), inline(1, dataChip())]
    },
    "shared:field-gear": {
      id: "shared:field-gear", name: "Field gear", rolls: "1",
      entries: [item(3, "Blaster Pistol"), item(2, "Vibroblade"), item(2, "Medpac")]
    }
  },
  typeTables: {
    aberration: {
      id: "type:aberration", name: "Aberration", rolls: "1",
      entries: [inline(10, alienResidue()), inline(6, forceCrystal(), { minCr: 3 }), nothing(54)]
    },
    beast: {
      id: "type:beast", name: "Beast", rolls: "1",
      entries: [inline(18, preservedRemains()), inline(8, alienResidue()), nothing(54)]
    },
    construct: {
      id: "type:construct", name: "Construct", rolls: "1",
      entries: [nested(20, "shared:tech-scraps"), inline(10, corrodedPlating()), nothing(40)]
    },
    droid: {
      id: "type:droid", name: "Droid", rolls: "1",
      entries: [nested(30, "shared:tech-scraps"), inline(14, droidChassisPart()), inline(8, opticalSensor()), nothing(18)]
    },
    "force entity": {
      id: "type:force entity", name: "Force entity", rolls: "1",
      entries: [inline(16, forceCrystal()), inline(10, ancientRelicPart()), nothing(54)]
    },
    humanoid: {
      id: "type:humanoid", name: "Humanoid", rolls: "1d2",
      entries: [cur(30, "(2d6 + @cr) * 25", "gp"), nested(15, "shared:field-gear"), inline(10, creditChip()), inline(8, holodisk()), item(6, "Medpac", "1", { minCr: 2 }), nothing(21)]
    },
    plant: {
      id: "type:plant", name: "Plant", rolls: "1",
      entries: [inline(14, barkSample()), inline(8, seedPouch()), nothing(58)]
    },
    undead: {
      id: "type:undead", name: "Undead", rolls: "1",
      entries: [inline(15, ancientRelicPart()), inline(10, preservedRemains()), nothing(55)]
    }
  },
  fallbackTable: { id: "fallback", name: "Fallback", rolls: "1", entries: [cur(20, "(1d6 + @cr) * 10", "gp"), nested(15, "shared:tech-scraps"), inline(10, rationPack()), nothing(45)] },
  rarityBudget: [
    { maxCr: 4, allowed: ["common", "uncommon"] },
    { maxCr: 10, allowed: ["common", "uncommon", "rare"] },
    { maxCr: 16, allowed: ["common", "uncommon", "rare", "veryRare"] },
    { maxCr: 99, allowed: ["common", "uncommon", "rare", "veryRare", "legendary", "artifact"] }
  ],
  carriedGear: { includeTypes: ["weapon", "equipment", "consumable", "tool", "loot", "container"], excludeNaturalWeapons: true }
};
