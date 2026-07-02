# Triston's Loot Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Foundry v13 dnd5e module that rolls contextual loot for NPCs at combat start and gives the party a live, GM-supervised loot-splitting window at combat end.

**Architecture:** Pure-logic core (dice, engine, stores) unit-tested with Vitest under a Foundry shim; GM-authority sync where players send socket intents and the GM client writes world settings whose `onChange` re-renders every client; three ApplicationV2 UIs (Table Manager, Loot Review, Distribution) over that state.

**Tech Stack:** Foundry VTT v13 API (ApplicationV2 + HandlebarsApplicationMixin, DialogV2, hooks, `game.socket`), dnd5e 5.2.5–5.3.3 data model, plain ES modules (no build step), Vitest (dev only).

**Read first:** `docs/superpowers/specs/2026-07-01-loot-generator-design.md` — the approved spec. Every task implements part of it.

## Global Constraints

- Foundry compatibility: minimum `13`, verified `13.351`.
- Requires system `dnd5e`, compatibility minimum `5.2.5`, verified `5.3.3`.
- Optional SW5E module (`sw5e`, 1.3.6) — detected at runtime, NEVER a hard dependency.
- No runtime library dependencies. No socketlib, no libWrapper, no bundler.
- Module id is exactly `tristons-loot-generator` everywhere (folder, module.json, flags, settings, socket channel `module.tristons-loot-generator`).
- All user-facing strings go through `game.i18n.localize`/`format` with keys in `lang/en.json` prefixed `TLG.` (UI tasks may add keys; final task audits).
- Players NEVER write world documents or settings; every mutation flows through the primary GM client.
- Pure modules (`scripts/core/dice.js`, `loot-engine.js`, plus the pure helpers in other core files) must not reference `game`, `ui`, `Hooks`, or any Foundry global — dependencies are injected.
- Commit after every task (steps include exact commands). Windows PowerShell 5.1: chain with `;`, never `&&`.

---

### Task 1: Module scaffold + test harness

**Files:**
- Create: `module.json`, `package.json`, `.gitignore`, `scripts/config.js`, `scripts/main.js`, `lang/en.json`, `styles/tlg.css`, `templates/.gitkeep`, `tests/foundry-shim.js`, `tests/config.test.js`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `MODULE_ID`, `SETTINGS`, `FLAGS`, `SOCKET_NAME` constants from `scripts/config.js`; `installShim()` from `tests/foundry-shim.js` used by every later test file; settings registered in `main.js` `init` hook.

- [ ] **Step 1: Write module.json**

```json
{
  "id": "tristons-loot-generator",
  "title": "Triston's Loot Generator",
  "description": "Rolls contextual loot for NPCs when combat starts and opens a party loot-splitting window when it ends. GM-editable tables, boss overrides, SW5E support.",
  "version": "0.1.0",
  "authors": [{ "name": "Triston" }],
  "compatibility": { "minimum": "13", "verified": "13.351" },
  "relationships": {
    "systems": [{ "id": "dnd5e", "type": "system", "compatibility": { "minimum": "5.2.5", "verified": "5.3.3" } }]
  },
  "esmodules": ["scripts/main.js"],
  "styles": ["styles/tlg.css"],
  "languages": [{ "lang": "en", "name": "English", "path": "lang/en.json" }]
}
```

- [ ] **Step 2: Write package.json and .gitignore**

```json
{
  "name": "tristons-loot-generator",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run" },
  "devDependencies": { "vitest": "^3.0.0" }
}
```

`.gitignore`: `node_modules/`

- [ ] **Step 3: Write scripts/config.js**

```js
export const MODULE_ID = "tristons-loot-generator";
export const SOCKET_NAME = `module.${MODULE_ID}`;

export const SETTINGS = {
  AUTO_GENERATE: "autoGenerate",
  REVIEW_GATE: "reviewGate",
  GENEROSITY: "generosity",
  CARRIED_GEAR: "carriedGear",
  REMAINDER: "currencyRemainder",
  PACK: "contentPack",
  CHAT_VIS: "chatVisibility",
  TABLE_OVERRIDES: "tableOverrides",
  CUSTOM_TABLES: "customTables",
  KEYWORD_RULES: "keywordRules",
  SESSIONS: "sessions"
};

export const FLAGS = {
  TABLE: "tableId",      // actor flag: boss/unique override table id
  ROLLED: "rolled",      // combat flag: { [combatantId]: RolledLoot }
  SKIP: "skipLoot",      // combat flag: boolean
  NO_LOOT: "noLoot",     // item flag: exclude from carried gear
  STARTED: "lootRolled"  // combat flag: generation ran for this combat
};

export const GENEROSITY = { sparse: 0.5, standard: 1, generous: 2 };
export const ROLL_SHIFT = { sparse: -1, standard: 0, generous: 1 };
```

- [ ] **Step 4: Write scripts/main.js** (settings registration; later tasks add init calls where marked)

```js
import { MODULE_ID, SETTINGS } from "./config.js";

Hooks.once("init", () => {
  const s = game.settings;
  s.register(MODULE_ID, SETTINGS.AUTO_GENERATE, { name: "TLG.Settings.AutoGenerate", scope: "world", config: true, type: Boolean, default: true });
  s.register(MODULE_ID, SETTINGS.REVIEW_GATE, { name: "TLG.Settings.ReviewGate", scope: "world", config: true, type: Boolean, default: true });
  s.register(MODULE_ID, SETTINGS.GENEROSITY, { name: "TLG.Settings.Generosity", scope: "world", config: true, type: String, default: "standard", choices: { sparse: "TLG.Generosity.Sparse", standard: "TLG.Generosity.Standard", generous: "TLG.Generosity.Generous" } });
  s.register(MODULE_ID, SETTINGS.CARRIED_GEAR, { name: "TLG.Settings.CarriedGear", scope: "world", config: true, type: Boolean, default: true });
  s.register(MODULE_ID, SETTINGS.REMAINDER, { name: "TLG.Settings.Remainder", scope: "world", config: true, type: String, default: "random", choices: { random: "TLG.Remainder.Random", gm: "TLG.Remainder.GM" } });
  s.register(MODULE_ID, SETTINGS.PACK, { name: "TLG.Settings.Pack", scope: "world", config: true, type: String, default: "auto", choices: { auto: "TLG.Pack.Auto", dnd5e: "TLG.Pack.Dnd5e", sw5e: "TLG.Pack.Sw5e" } });
  s.register(MODULE_ID, SETTINGS.CHAT_VIS, { name: "TLG.Settings.ChatVis", scope: "world", config: true, type: String, default: "public", choices: { public: "TLG.ChatVis.Public", gm: "TLG.ChatVis.GM" } });
  for (const key of [SETTINGS.TABLE_OVERRIDES, SETTINGS.CUSTOM_TABLES, SETTINGS.SESSIONS]) {
    s.register(MODULE_ID, key, { scope: "world", config: false, type: Object, default: {} });
  }
  s.register(MODULE_ID, SETTINGS.KEYWORD_RULES, { scope: "world", config: false, type: Object, default: { rules: [] } });
});
```

(`sessions` gets an `onChange` in Task 12; keep registration here.)

- [ ] **Step 5: Write tests/foundry-shim.js** — the fake Foundry runtime every test uses

```js
export function installShim({ modules = {}, settings = {} } = {}) {
  const store = { ...settings };
  globalThis.game = {
    settings: {
      get: (ns, key) => structuredClone(store[`${ns}.${key}`] ?? getDefault(key)),
      set: async (ns, key, value) => { store[`${ns}.${key}`] = structuredClone(value); return value; }
    },
    modules: { get: (id) => modules[id] },
    i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
    user: { id: "gm1", isGM: true },
    users: []
  };
  globalThis.foundry = { utils: { randomID: () => Math.random().toString(36).slice(2, 12), deepClone: (o) => structuredClone(o) } };
  globalThis.Hooks = { on: () => {}, once: () => {}, callAll: () => {} };
  globalThis.ui = { notifications: { warn: () => {}, info: () => {}, error: () => {} } };
  return { store };
}
function getDefault(key) {
  if (["tableOverrides", "customTables", "sessions"].includes(key)) return {};
  if (key === "keywordRules") return { rules: [] };
  return undefined;
}
```

- [ ] **Step 6: Write tests/config.test.js**

```js
import { describe, it, expect } from "vitest";
import { MODULE_ID, SETTINGS, GENEROSITY } from "../scripts/config.js";

describe("config", () => {
  it("module id is stable", () => expect(MODULE_ID).toBe("tristons-loot-generator"));
  it("generosity multipliers", () => expect(GENEROSITY).toEqual({ sparse: 0.5, standard: 1, generous: 2 }));
  it("settings keys unique", () => {
    const vals = Object.values(SETTINGS);
    expect(new Set(vals).size).toBe(vals.length);
  });
});
```

- [ ] **Step 7: Create stubs** — `lang/en.json` with `{ "TLG": { "Settings": { "AutoGenerate": "Auto-generate loot on combat start" } } }` (full copy audited in Task 14), empty `styles/tlg.css`, empty `templates/.gitkeep`.

- [ ] **Step 8: Install and run**

Run: `npm install; npx vitest run`
Expected: 3 tests pass.

- [ ] **Step 9: Commit**

```powershell
git add -A; git commit -m "feat: module scaffold, settings registration, test harness"
```

---

### Task 2: Dice evaluator

**Files:**
- Create: `scripts/core/dice.js`
- Test: `tests/dice.test.js`

**Interfaces:**
- Consumes: nothing (pure module, no Foundry globals).
- Produces: `evaluateDice(formula: string, data?: Record<string, number>, rng?: () => number): number` — evaluates `NdM`, integers, `@var` substitution, `+ - * /`, parentheses; result is `Math.max(0, Math.floor(total))`. Throws `Error("TLG.Dice.Invalid")` on unparseable input. `validateDice(formula: string): boolean`.

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect } from "vitest";
import { evaluateDice, validateDice } from "../scripts/core/dice.js";

const fixed = (v) => () => v; // rng returning constant

describe("evaluateDice", () => {
  it("evaluates integers", () => expect(evaluateDice("5")).toBe(5));
  it("rolls NdM with injected rng", () => {
    expect(evaluateDice("2d6", {}, fixed(0))).toBe(2);      // both dice roll 1
    expect(evaluateDice("2d6", {}, fixed(0.999))).toBe(12); // both dice roll 6
  });
  it("substitutes @cr", () => expect(evaluateDice("@cr * 10", { cr: 3 })).toBe(30));
  it("handles parens and mixed ops", () => expect(evaluateDice("(2d4 + @cr) * 10", { cr: 2 }, fixed(0))).toBe(40));
  it("missing variable becomes 0", () => expect(evaluateDice("@cr + 1", {})).toBe(1));
  it("fractional CR floors final result only", () => expect(evaluateDice("@cr * 3", { cr: 0.5 })).toBe(1));
  it("never returns negatives", () => expect(evaluateDice("1 - 5")).toBe(0));
  it("throws on garbage", () => expect(() => evaluateDice("2d6; alert(1)")).toThrow());
  it("throws on d0 and 0 dice cap", () => expect(() => evaluateDice("1d0")).toThrow());
});

describe("validateDice", () => {
  it("accepts valid", () => expect(validateDice("1d4 + 2")).toBe(true));
  it("rejects invalid", () => expect(validateDice("hello()")).toBe(false));
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/dice.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement scripts/core/dice.js** — recursive-descent parser, NOT `eval`/`Function`:

```js
const TOKEN = /\s*(\d+d\d+|\d+\.?\d*|@[a-zA-Z_]\w*|[()+\-*/])/y;

function tokenize(formula) {
  const tokens = [];
  let pos = 0;
  while (pos < formula.length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(formula);
    if (!m) {
      if (/^\s*$/.test(formula.slice(pos))) break;
      throw new Error("TLG.Dice.Invalid");
    }
    tokens.push(m[1]);
    pos = TOKEN.lastIndex;
  }
  if (!tokens.length) throw new Error("TLG.Dice.Invalid");
  return tokens;
}

export function evaluateDice(formula, data = {}, rng = Math.random) {
  const tokens = tokenize(String(formula));
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  function primary() {
    const t = next();
    if (t === "(") { const v = expr(); if (next() !== ")") throw new Error("TLG.Dice.Invalid"); return v; }
    if (t === "-") return -primary();
    if (/^\d+d\d+$/.test(t)) {
      const [n, m] = t.split("d").map(Number);
      if (n < 1 || n > 100 || m < 1 || m > 1000) throw new Error("TLG.Dice.Invalid");
      let sum = 0;
      for (let k = 0; k < n; k++) sum += 1 + Math.floor(rng() * m);
      return sum;
    }
    if (/^@/.test(t)) return Number(data[t.slice(1)]) || 0;
    if (/^\d/.test(t)) return Number(t);
    throw new Error("TLG.Dice.Invalid");
  }
  function term() {
    let v = primary();
    while (peek() === "*" || peek() === "/") v = next() === "*" ? v * primary() : v / primary();
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === "+" || peek() === "-") v = next() === "+" ? v + term() : v - term();
    return v;
  }
  const out = expr();
  if (i !== tokens.length || Number.isNaN(out)) throw new Error("TLG.Dice.Invalid");
  return Math.max(0, Math.floor(out));
}

export function validateDice(formula) {
  try { evaluateDice(formula, {}, () => 0.5); return true; } catch { return false; }
}
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/dice.test.js` → all pass.

- [ ] **Step 5: Commit** — `git add -A; git commit -m "feat: pure dice formula evaluator"`

---

### Task 3: Content packs + item reference resolver

**Files:**
- Create: `scripts/content/dnd5e-pack.js`, `scripts/content/sw5e-pack.js`, `scripts/content/index.js`, `scripts/content/resolver.js`
- Test: `tests/content.test.js`

**Interfaces:**
- Consumes: `MODULE_ID`, `SETTINGS` from `scripts/config.js`.
- Produces:
  - `getActivePack(): Pack` and `getPack(id): Pack` from `content/index.js` — reads the `contentPack` setting; `"auto"` → `sw5e` if `game.modules.get("sw5e")?.active` else `dnd5e`.
  - `resolveRef(ref: {name: string, packs?: string[]}, pack: Pack): Promise<string|null>` and `clearRefCache()` from `resolver.js`. Case-insensitive index search across `ref.packs ?? pack.itemPacks`; caches hits AND misses; on miss logs `console.warn` once per name.
  - Pack shape (both packs conform):

```js
{
  id, label,
  itemPacks: string[],            // candidate compendium ids for name refs
  currency: { path: "system.currency", denominations: [{ key, label }], primary },
  creatureTypes: string[],
  typeTables: { [type]: Table },  // Table shape per spec §Data model
  fallbackTable: Table,
  rarityBudget: [{ maxCr, allowed: string[] }],
  carriedGear: { includeTypes: string[], excludeNaturalWeapons: true }
}
```

  - Table ids inside packs are `type:<creatureType>` and `fallback`. Entry shape per spec: `{ id, weight, type: "item"|"currency"|"table"|"rolltable"|"nothing", ref?, uuid?, itemData?, qty?, currency?: {formula, denom}, minCr?, maxCr? }`.

- [ ] **Step 1: Write failing tests** (`tests/content.test.js`)

```js
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
      const tables = [...Object.values(pack.typeTables), pack.fallbackTable];
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
```

Note the test introduces `pack.sharedTables` — an extra map `{ [tableId]: Table }` for nested reusable tables (e.g. `shared:trinkets`). Add it to the pack shape; `getEffectiveTable` (Task 4) resolves ids from it too.

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/content.test.js` → FAIL.

- [ ] **Step 3: Implement `content/index.js` and `resolver.js`**

```js
// index.js
import { MODULE_ID, SETTINGS } from "../config.js";
import DND5E from "./dnd5e-pack.js";
import SW5E from "./sw5e-pack.js";

const PACKS = { dnd5e: DND5E, sw5e: SW5E };
export function getPack(id) { return PACKS[id] ?? DND5E; }
export function getActivePack() {
  const forced = game.settings.get(MODULE_ID, SETTINGS.PACK);
  if (forced && forced !== "auto") return getPack(forced);
  return game.modules.get("sw5e")?.active ? SW5E : DND5E;
}
```

```js
// resolver.js
const cache = new Map();
export function clearRefCache() { cache.clear(); }
export async function resolveRef(ref, pack) {
  const key = `${ref.name}`.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const packIds = ref.packs ?? pack.itemPacks;
  for (const pid of packIds) {
    const cp = game.packs?.get(pid);
    if (!cp) continue;
    const index = await cp.getIndex();
    const hit = index.find((e) => e.name.toLowerCase() === key);
    if (hit) { const uuid = hit.uuid ?? `Compendium.${pid}.Item.${hit._id}`; cache.set(key, uuid); return uuid; }
  }
  console.warn(`${"TLG"} | unresolved item ref: ${ref.name}`);
  cache.set(key, null);
  return null;
}
```

- [ ] **Step 4: Author the dnd5e pack** (`dnd5e-pack.js`). Real content, SRD-safe item names only (all exist in the dnd5e system's `dnd5e.items` / `dnd5e.tradegoods` compendia): Dagger, Club, Mace, Spear, Shortsword, Scimitar, Shortbow, Sling, Handaxe, Battleaxe, Longsword, Light Hammer, Quarterstaff, Leather Armor, Hide Armor, Chain Shirt, Shield, Torch, Potion of Healing. Inline `itemData` entries (type `"loot"`) for valuables: e.g. `{ name: "Silver ring", img: "icons/equipment/finger/ring-band-engraved-silver.webp", type: "loot", system: { price: { value: 25, denomination: "gp" }, quantity: 1 } }`, plus "Jade figurine", "Bone dice set", "Bloodstone", "Small gold idol", "Monster fang trophy", "Thick pelt", "Arcane residue", "Ancient coin". Structure (write ALL 14 types — abbreviated here only to show the pattern; the implementer writes every table with 3–7 entries following it):

```js
const cur = (weight, formula, denom = "sp", gates = {}) => ({ id: `c${weight}${denom}`, weight, type: "currency", currency: { formula, denom }, ...gates });
const item = (weight, name, qty = "1", gates = {}) => ({ id: name.toLowerCase().replace(/\W+/g, "-"), weight, type: "item", ref: { name }, qty, ...gates });
const inline = (weight, itemData, gates = {}) => ({ id: itemData.name.toLowerCase().replace(/\W+/g, "-"), weight, type: "item", itemData, ...gates });
const nested = (weight, tableId, qty = "1") => ({ id: tableId.replace(/\W+/g, "-"), weight, type: "table", tableId, qty });
const nothing = (weight) => ({ id: `none${weight}`, weight, type: "nothing" });

export default {
  id: "dnd5e", label: "D&D 5e",
  itemPacks: ["dnd5e.items", "dnd5e.tradegoods"],
  currency: { path: "system.currency", primary: "gp",
    denominations: [{ key: "pp", label: "PP" }, { key: "gp", label: "GP" }, { key: "ep", label: "EP" }, { key: "sp", label: "SP" }, { key: "cp", label: "CP" }] },
  creatureTypes: ["aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead"],
  sharedTables: {
    "shared:trinkets": { id: "shared:trinkets", name: "Trinkets & valuables", rolls: "1",
      entries: [inline(3, {/* Silver ring as above */}), inline(3, {/* Jade figurine */}), inline(2, {/* Bone dice set */}), inline(2, {/* Bloodstone */}), inline(1, {/* Small gold idol */}, { minCr: 3 })] },
    "shared:weapons-common": { id: "shared:weapons-common", name: "Common weapons", rolls: "1",
      entries: [item(3, "Dagger"), item(2, "Shortsword"), item(2, "Scimitar"), item(2, "Shortbow"), item(1, "Handaxe"), item(1, "Mace")] }
  },
  typeTables: {
    humanoid: { id: "type:humanoid", name: "Humanoid", rolls: "1d2",
      entries: [cur(30, "(2d6 + @cr) * 10", "sp"), nested(20, "shared:weapons-common"), nested(10, "shared:trinkets"), item(8, "Potion of Healing", "1", { minCr: 2 }), nothing(20)] },
    undead: { id: "type:undead", name: "Undead", rolls: "1",
      entries: [cur(25, "(1d6 + @cr) * 5", "sp"), inline(15, {/* Ancient coin */}), nested(10, "shared:trinkets"), nothing(40)] }
    // ...write beast (trophies, no coin), dragon (heavy coin + trinkets, gp),
    // fiend/celestial/fey/elemental (arcane residue inline + coin), giant (coin sack),
    // construct (components), monstrosity/ooze/plant/aberration (sparse trophies + nothing-heavy)
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
```

- [ ] **Step 5: Author the sw5e pack** (`sw5e-pack.js`) — same helpers. `itemPacks: ["sw5e.blasters", "sw5e.lightweapons", "sw5e.adventuringgear", "sw5e.enhanceditems"]` (Task 14 verifies against the live module and corrects). Currency: `denominations: [{ key: "gp", label: "Credits" }], primary: "gp"` (SW5E module maps credits onto the gp slot; Task 14 verifies). `creatureTypes: ["aberration", "beast", "construct", "droid", "force entity", "humanoid", "plant", "undead"]`. Tables use inline itemData heavily (credit chips, power cells, scrap components, holodisks) plus refs: "Vibroblade", "Blaster Pistol", "Medpac" — droids drop parts not credits, humanoids drop credits `cur(30, "(2d6 + @cr) * 25", "gp")`.

- [ ] **Step 6: Run tests** — `npx vitest run tests/content.test.js` → pass.

- [ ] **Step 7: Commit** — `git add -A; git commit -m "feat: content packs (dnd5e, sw5e) and item ref resolver"`

---

### Task 4: TableStore

**Files:**
- Create: `scripts/core/table-store.js`
- Test: `tests/table-store.test.js`

**Interfaces:**
- Consumes: `MODULE_ID`, `SETTINGS` (config.js); `getActivePack` (content/index.js).
- Produces (all exported functions, GM-client only for writes):
  - `getEffectiveTable(tableId: string): Table|null` — id forms `type:<t>`, `fallback`, `shared:<x>` (override copy from `tableOverrides[pack.id][tableId]` wins over pack), `custom:<id>` (from `customTables`).
  - `listTables(): { pack: {id,label}, packTables: TableMeta[], customTables: TableMeta[], modifiedIds: string[] }` where TableMeta = `{ id, name, modified }`.
  - `saveTable(table: Table): Promise<void>` — pack-id tables write to overrides; `custom:` ids to customs.
  - `revertOverride(tableId): Promise<void>`; `createCustomTable(name): Promise<Table>` (id `custom:<randomID>`, rolls "1", entries []); `deleteCustomTable(tableId): Promise<void>` (also strips dangling actor flags is Task 13's job, not here).
  - `getKeywordRules(): Rule[]` / `saveKeywordRules(rules: Rule[])` — Rule = `{ id, pattern, matchType: "includes"|"regex", tableId, enabled }`.
  - `exportData(): string` (JSON of overrides+customs+rules+packId) / `importData(json: string): Promise<{tables: number, rules: number}>` — throws on schema mismatch, never partial-applies.
  - `validateTable(table): string[]` — array of problem strings (empty = valid); checks weights > 0, known entry types, formulas via `validateDice`, nested ids resolvable.

- [ ] **Step 1: Write failing tests** — cover: effective table returns pack table verbatim when no override; saveTable on `type:humanoid` → getEffectiveTable returns modified copy and `listTables().modifiedIds` includes it; revertOverride restores pack version; custom create/update/delete roundtrip; keyword rules save/load preserving order; export→import roundtrip onto a clean store; importData with garbage throws and changes nothing; validateTable flags bad formula and unknown nested id.

```js
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
  TS = await import("../scripts/core/table-store.js?fresh"); // note below
  await TS.importData(dump);
  expect(TS.getKeywordRules()).toHaveLength(1);
  await expect(TS.importData("{\"nope\":1}")).rejects.toThrow();
});
it("validateTable reports problems", () => {
  const bad = { id: "custom:x", name: "X", rolls: "banana", entries: [{ id: "e", weight: 0, type: "table", tableId: "type:nope" }] };
  expect(TS.validateTable(bad).length).toBeGreaterThanOrEqual(3);
});
```

(Module state note: table-store must keep NO module-level mutable caches — read settings on every call — so `?fresh` re-import tricks aren't fragile. Document this in a comment at top of file.)

- [ ] **Step 2: Run to verify failure.** `npx vitest run tests/table-store.test.js` → FAIL.

- [ ] **Step 3: Implement** — straightforward: reads via `game.settings.get(MODULE_ID, ...)`, writes via `game.settings.set`. `getEffectiveTable`: if id starts `custom:` → customs; else look in `tableOverrides[activePack.id][id]` then `pack.typeTables/sharedTables/fallbackTable` by id. Always return deep clones. `exportData` embeds `{ format: 1, packId, overrides, customs, rules }`; `importData` validates `format === 1` and every table with `validateTable` before writing anything.

- [ ] **Step 4: Run tests** — pass. **Step 5: Commit** — `git add -A; git commit -m "feat: table store with override layering, rules, import/export"`

---

### Task 5: LootEngine

**Files:**
- Create: `scripts/core/loot-engine.js`
- Test: `tests/loot-engine.test.js`

**Interfaces:**
- Consumes: `evaluateDice` (core/dice.js). NOTHING else — fully pure, all data injected.
- Produces:
  - `matchTable(ctx, deps): { tableId: string, source: "override"|"keyword"|"type"|"fallback" }`
    - ctx: `{ flagTableId?: string, name: string, biography: string, creatureType?: string, cr: number }`
    - deps: `{ rules: Rule[], tableExists(id): boolean, creatureTypes: string[] }`
    - Order: flagTableId (if exists) → first enabled rule matching name or biography (includes = case-insensitive substring; regex = `new RegExp(pattern, "i")`, invalid regex skipped) → `type:<creatureType>` if type in creatureTypes AND table exists → `fallback`.
  - `async rollLoot(ctx): { items: LootRoll[], currency: {[denom]: number} }`
    - ctx: `{ cr, tableId, getTable(id): Table|null, pack, generosity, rng, drawRollTable(uuid): Promise<LootRoll[]>, getRarity(entry): Promise<string|null> }`
    - LootRoll: `{ uuid?, ref?, itemData?, name?, qty: number }`
    - Behavior: rolls = `max(1, evaluateDice(table.rolls, {cr}, rng) + ROLL_SHIFT[generosity])`; per draw filter entries by CR gate (`minCr <= cr <= maxCr`, absent = open) AND rarity budget (pack tables only — a `table.gmAuthored` boolean set by TableStore for overrides/customs/actor tables bypasses it; getRarity resolves an item entry's rarity, null = unrestricted); weighted pick; resolve: item → qty roll; currency → `Math.round(evaluateDice(formula,{cr},rng) * GENEROSITY[generosity])` added into currency map; table → recurse `qty` times (depth cap 5, visited-set cycle guard — a revisited tableId in the current chain is skipped); rolltable → `await drawRollTable(uuid)` results appended qty times; nothing → skip. Identical item rolls merge quantities (key: uuid ?? ref.name ?? itemData.name).
  - `filterCarriedGear(items: ItemLike[], pack): ItemLike[]` — ItemLike = plain `{ id, name, type, system, flags }`; keep `pack.carriedGear.includeTypes`; drop natural weapons (`system.type?.value === "natural"` when type === "weapon"), drop `system.quantity === 0`, drop `flags["tristons-loot-generator"]?.noLoot === true`.

- [ ] **Step 1: Write failing tests** — the most important test file in the module. Cover at minimum:

```js
import { describe, it, expect } from "vitest";
import { matchTable, rollLoot, filterCarriedGear } from "../scripts/core/loot-engine.js";

const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const deps = (over = {}) => ({ rules: [], tableExists: (id) => id !== "custom:gone", creatureTypes: ["humanoid", "undead"], ...over });

describe("matchTable precedence", () => {
  const ctx = { name: "Bandit Cultist", biography: "", creatureType: "humanoid", cr: 1 };
  it("flag beats everything", () =>
    expect(matchTable({ ...ctx, flagTableId: "custom:boss" }, deps()).source).toBe("override"));
  it("dangling flag falls through", () =>
    expect(matchTable({ ...ctx, flagTableId: "custom:gone" }, deps()).source).toBe("keyword") // with a matching rule
  );
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
});
```

- [ ] **Step 2: Run to verify failure.** — [ ] **Step 3: Implement** exactly to the behaviors the tests pin down (single file, ~150 lines; import only `evaluateDice`, `GENEROSITY`, `ROLL_SHIFT`). — [ ] **Step 4: Run tests, all green.** — [ ] **Step 5: Commit** `git add -A; git commit -m "feat: pure loot engine (matching, rolling, carried gear)"`

---

### Task 6: SessionStore

**Files:**
- Create: `scripts/core/session-store.js`
- Test: `tests/session-store.test.js`

**Interfaces:**
- Consumes: `MODULE_ID`, `SETTINGS` (config.js).
- Produces:
  - CRUD: `createSession(data): Promise<Session>` (fills id/created/status:"pending"), `getSession(id): Session|null`, `getSessions(statuses?: string[]): Session[]` (sorted newest first), `updateSession(id, mutator: (s) => void): Promise<Session>` (clone → mutate → validate transition → write), `releaseSession(id)` (drops items of excluded NPCs, pending→released), `discardSession(id)`, `pruneHistory()` (keep newest 50 finalized/discarded).
  - Pure helpers (exported for engine/UI reuse):
    - `resolveCounts(session): { resolved, total }` — items where state ≠ "unclaimed" are resolved; currency pot (any nonzero denom) adds 1 to total, resolved when `currencyAllocation !== null`.
    - `isFullyResolved(session): boolean`.
    - `computeEvenSplit(currency, actorUuids, rng): { allocation: {[uuid]: {[denom]: number}}, remainders: {[denom]: string} }` — per denomination: `Math.floor(amount / n)` each, remainder assigned whole to one rng-chosen uuid recorded in `remainders`.
    - `validateTransition(from, to): boolean` — pending→released|discarded, released→finalized|discarded, else false (same-status writes always allowed).
  - Session shape exactly per spec §Session record.

- [ ] **Step 1: Failing tests** — create→get roundtrip; updateSession claim marks resolveCounts correctly (items 2/3 + currency unallocated → `{resolved: 2, total: 4}`); isFullyResolved flips when last item abandoned AND currency allocated; releaseSession drops excluded-NPC items and rejects from "released"; discard from both pending and released ok; finalize transition only from released; computeEvenSplit: `{sp: 109}` across 4 → three get 27, one gets 28, remainders.sp names the lucky uuid; `{gp: 8, sp: 3}` across 3 works per-denomination; empty actor list returns empty allocation; pruneHistory drops oldest beyond 50.

- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → pass. Step 5: Commit** `git add -A; git commit -m "feat: session store with transitions and split math"`

---

### Task 7: EncounterService

**Files:**
- Create: `scripts/core/encounter-service.js`
- Test: `tests/encounter-service.test.js`

**Interfaces:**
- Consumes: `rollLoot`, `matchTable`, `filterCarriedGear` (loot-engine), `getActivePack` (content), `getEffectiveTable`, `getKeywordRules` (table-store), `createSession` (session-store), `resolveRef` (resolver), config constants.
- Produces:
  - `initEncounterHooks()` — called from `main.js` `ready` (GM client only registers write-paths): `combatStart` → roll all NPC combatants into combat flag `rolled`; `createCombatant` → if `combat.started`, roll newcomer; `deleteCombat` → `captureSession(combat)`.
  - `async rollForCombatant(combatant, combat): Promise<RolledLoot>` — RolledLoot = `{ items, currency, tableSource, tableId, packId }`; builds engine ctx from the combatant's actor (`system.details.type.value`, `system.details.cr`, name, `system.details.biography.value`), calls matchTable + rollLoot with real deps (`drawRollTable` uses `fromUuid` + `table.roll()` mapping RollTable item-type results to uuids; `getRarity` resolves entry uuid/ref via `fromUuid`/resolver and reads `system.rarity`).
  - `async captureSession(combat): Promise<Session|null>` — null when: flag SKIP set, combat never started, or zero included NPCs. Included = hostile disposition (`token.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE`) AND defeated (`combatant.isDefeated` OR actor hp ≤ 0). Snapshot every NPC combatant into session.npcs with `included` precomputed; build session.items from rolled flags (resolving `ref`→uuid now, dropping unresolvable with a GM warning) + carried gear snapshot (full `item.toObject()` into `itemData`, `carried: true`, source token id remembered as `sourceTokenUuid` for finalize removal). Currency = sum of included NPCs' rolled currency. Status: review gate on → "pending" + render LootReviewApp (via injected `onCaptured(session)` callback registered by UI task — store callback module-level via `setOnCaptured(fn)`); gate off → releaseSession immediately.
  - Pure + exported for tests: `buildSessionData(snapshots, opts): SessionData` where snapshots = array of `{ combatantId, tokenId, actorName, img, cr, disposition, hp, defeatedStatus, rolled, carriedItems }` — ALL capture logic lives here; the hook handler only assembles snapshots from documents.
  - `async generateNow(combat)` — manual trigger; rolls any combatant lacking a rolled flag.

- [ ] **Step 1: Failing tests for `buildSessionData`** — hostile+dead included / hostile+alive excluded-but-listed / friendly+dead excluded / neutral excluded; carried gear lands as itemData items with `carried: true`; currency sums only included NPCs; unlinked tokens: two snapshots sharing actorName but different tokenId produce separate npc rows and separate items; zero included → `{ npcs: [...], items: [], currency: {} }` and caller (captureSession) yields null only when ALL of items+currency empty AND no includable NPC.

- [ ] **Step 2: Run → FAIL. Step 3: Implement buildSessionData pure, then the document-facing wrappers.** Hook registration guards: `if (!game.user.isGM) return;` at the top of each handler; only the primary GM (import `isPrimaryGM` lazily from socket-service in Task 8 — until then use `game.users.activeGM?.id === game.user.id`, Foundry v13's built-in). — [ ] **Step 4: Run tests → pass. Step 5: Wire `initEncounterHooks()` into main.js under `Hooks.once("ready", ...)`. Step 6: Commit** `git add -A; git commit -m "feat: encounter lifecycle - roll at combat start, capture on end"`

---

### Task 8: SocketService

**Files:**
- Create: `scripts/core/socket-service.js`
- Modify: `scripts/main.js` (call `initSocket()` in ready hook)
- Test: `tests/socket-service.test.js`

**Interfaces:**
- Consumes: session-store (`getSession`, `updateSession`), config.
- Produces:
  - `initSocket()` — `game.socket.on(SOCKET_NAME, handler)`.
  - `isPrimaryGM(): boolean` — `game.users.activeGM?.id === game.user.id` (v13 built-in `activeGM` = lowest-id active GM; matches spec's deterministic pick).
  - `async sendIntent(action, payload)` — if `isPrimaryGM()` handle locally; else `game.socket.emit(SOCKET_NAME, { type: "intent", action, payload, userId: game.user.id })`. Fire-and-forget; rejection arrives as toast message.
  - `validateIntent(action, payload, session, user): { ok: boolean, reason?: string }` — PURE, exported. Rules: session exists & status "released"; `claim` → item exists, state "unclaimed" (or "claimed" by an actor the requesting user owns — re-claim/steal own only), target actorUuid in provided partyUuids; `unclaim` → item claimed, requester owns claimant actor or isGM; `abandon` → item unclaimed or requester owns claimant; `restore` → state "abandoned"; `allocateCurrency` → allocation sums per denom equal pot exactly, all uuids in partyUuids. user = `{ id, isGM, ownedActorUuids: string[] }`.
  - GM-side handler: serialize through a promise queue (`queue = queue.then(work)`) so concurrent intents apply one at a time; on validation failure emit `{ type: "toast", userId, message }`; on success `updateSession` (settings onChange re-renders everyone — Task 12).
  - Toast receipt: non-GM handler shows `ui.notifications.warn(message)` when `userId === game.user.id`.

- [ ] **Step 1: Failing tests for `validateIntent`** — every rule above gets a positive and negative case (≈14 tests). Plus queue-serialization test: handler processes two racing claims on the same item → exactly one success (fake updateSession recording call order).
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → pass. Step 5: Commit** `git add -A; git commit -m "feat: GM-authority socket relay with intent validation"`

---

### Task 9: Finalizer

**Files:**
- Create: `scripts/core/finalizer.js`
- Test: `tests/finalizer.test.js`

**Interfaces:**
- Consumes: session-store, config, `getActivePack` (currency path/denominations).
- Produces:
  - Pure, exported: `groupGrants(session): { itemGrants: {[actorUuid]: Grant[]}, currencyGrants: {[actorUuid]: {[denom]: number}} }` — Grant = `{ name, qty, uuid?, itemData?, carried, sourceTokenUuid? }`; claimed items only; currency from `currencyAllocation`; abandoned/unclaimed items excluded.
  - Pure, exported: `buildSummaryHTML(session, grants): string` — per-actor list + abandoned section; every string i18n'd.
  - `async finalizeSession(sessionId)` (primary GM only): grants = groupGrants; for each actor `fromUuid` → build embedded item array (uuid grants: `(await fromUuid(uuid)).toObject()` with `system.quantity = qty`; itemData grants: clone with qty) → `actor.createEmbeddedDocuments("Item", batch)` recording created ids into `createdItemIds`; currency: read `foundry.utils.getProperty(actor, pack.currency.path)`, add, `actor.update`; carried grants: remove source item from the source token actor if it still exists (match by original item id stored in Grant.itemData._id via `sourceToken.actor.items.get`); mark finalized with `createdItemIds` + `currencyGranted`; post ChatMessage (whisper to GMs when CHAT_VIS = "gm") with reopen button `<button data-tlg-action="open-history">`; `pruneHistory()`.
  - `async revertSession(sessionId)` — most recent finalized only (guard + error notification otherwise): delete created items that still exist (collect missing into a warning), subtract granted currency floored at 0, restore carried itemData to source token actors that still exist, transition finalized→released (validateTransition already allows? NO — spec says revert goes finalized→released: extend `validateTransition` in session-store with `finalized→released` — do it in this task, with a test added to `tests/session-store.test.js`).
- [ ] **Step 1: Failing tests** — groupGrants: mixed session (2 claimed to A, 1 to B, 1 abandoned, currency split) groups correctly; qty preserved; carried grant carries sourceTokenUuid; buildSummaryHTML contains actor names and abandoned item names; validateTransition("finalized","released") === true.
- [ ] **Step 2–4: Red → implement → green.** Document-facing `finalizeSession`/`revertSession` are not unit-tested (live-verified Task 14) but ALL branching lives in the pure functions.
- [ ] **Step 5: Commit** `git add -A; git commit -m "feat: finalize batch grants, revert, chat summary"`

---

### Task 10: Table Manager UI

**Files:**
- Create: `scripts/apps/table-manager.js`, `templates/table-manager.hbs`, `templates/parts/entry-row.hbs`
- Modify: `scripts/main.js` (register settings menu + scene control), `styles/tlg.css`, `lang/en.json`

**Interfaces:**
- Consumes: table-store (everything), content (`getActivePack`), dice (`validateDice`), loot-engine (`rollLoot` for test rolls), resolver.
- Produces: `TableManagerApp` (ApplicationV2) opened via `new TableManagerApp().render(true)` from: a settings menu (`game.settings.registerMenu(MODULE_ID, "tableManager", {...})`) and a token-layer scene control button (`getSceneControlButtons` hook, GM only). Also exports `openTablePicker(current?: string): Promise<string|null>` — a DialogV2 listing all tables for reuse by Task 13's boss-assign flow.

Implementation contract (v13 AppV2 idioms):

```js
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
export class TableManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tlg-table-manager",
    classes: ["tlg", "tlg-table-manager"],
    window: { title: "TLG.TableManager.Title", icon: "fas fa-list", resizable: true },
    position: { width: 860, height: 620 },
    actions: {
      selectTable: TableManagerApp.#onSelectTable, newTable: TableManagerApp.#onNewTable,
      deleteTable: TableManagerApp.#onDeleteTable, revert: TableManagerApp.#onRevert,
      addEntry: TableManagerApp.#onAddEntry, deleteEntry: TableManagerApp.#onDeleteEntry,
      testRoll: TableManagerApp.#onTestRoll, exportData: TableManagerApp.#onExport,
      importData: TableManagerApp.#onImport, saveTable: TableManagerApp.#onSave,
      rulesEditor: TableManagerApp.#onRulesEditor
    }
  };
  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/table-manager.hbs` } };
}
```

Behaviors (each is a small method; no hand-waving — these ARE the requirements):
- `_prepareContext`: `listTables()` for the sidebar (pack group with `modified` dots, shared group, custom group, boss-override group built by scanning `game.actors` for the TABLE flag), selected table's entries hydrated with display names (resolve uuid/ref names async in `_prepareContext`, cache on the app instance), per-entry `problems` from `validateTable`.
- Editing is form-based: inputs bound with `name="entries.{{i}}.weight"` etc.; `#onSave` reads the form via `new foundry.applications.ux.FormDataExtended(form).object`, reassembles the table, `validateTable`, `saveTable`, re-render. Unsaved-changes guard on table switch (DialogV2.confirm).
- Drag-drop: `_onRender` binds a `drop` listener on the entries region; `foundry.applications.ux.TextEditor.implementation.getDragEventData(event)` → if `data.type === "Item"` push `{ type: "item", uuid: data.uuid, weight: 1, qty: "1" }`; `"RollTable"` → rolltable entry. Re-render.
- Test roll: `#onTestRoll` reads the CR input, calls `rollLoot` with real deps and `ChatMessage.create({ whisper: [game.user.id], content })` listing results.
- Keyword rules editor: `#onRulesEditor` opens a DialogV2 with an ordered rule list (pattern input, matchType select, table select from `listTables`, enabled checkbox, up/down/delete buttons) saving via `saveKeywordRules`.
- Import/export: export → `saveDataToFile(exportData(), "text/json", "tlg-tables.json")` (v13: `foundry.utils.saveDataToFile`); import → file picker dialog + `importData` with try/catch error notification.
- Template: sidebar `<nav>` + editor `<section>`; entry rows via `{{#each}}` partial `parts/entry-row.hbs` (selects for type, inputs for weight/qty/formula/minCr/maxCr, name span with broken-ref `.tlg-broken` class). CSS: two-pane flex, `.tlg-modified-dot`, chip styles reused later.

- [ ] **Step 1: Implement app + templates + registration.** No vitest for rendering; extract nothing — logic already lives in tested modules.
- [ ] **Step 2: Static sanity test** — add `tests/apps-smoke.test.js`: import the file with shim installed + `foundry.applications = { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (c) => c } }` in the shim; assert `TableManagerApp.DEFAULT_OPTIONS.actions` keys match the methods (catches typo'd action names). Extend `installShim` accordingly.
- [ ] **Step 3: Run `npx vitest run` → all green. Step 4: Commit** `git add -A; git commit -m "feat: table manager UI with editor, rules, test rolls, import/export"`

---

### Task 11: Loot Review UI

**Files:**
- Create: `scripts/apps/loot-review.js`, `templates/loot-review.hbs`
- Modify: `scripts/core/encounter-service.js` (register onCaptured → open review), `scripts/main.js`, `styles/tlg.css`, `lang/en.json`

**Interfaces:**
- Consumes: session-store, encounter-service (`setOnCaptured`, `rollForCombatant`-style reroll — expose `rerollNpc(session, npcTokenId): Promise<void>` from encounter-service in this task: re-runs engine for that NPC and swaps its items in the session), table-manager's `openTablePicker` (unused here; listed for clarity NO — not consumed. omit).
- Produces: `LootReviewApp` — constructor `new LootReviewApp({ sessionId })`; GM-only. Registered as `setOnCaptured((session) => new LootReviewApp({ sessionId: session.id }).render(true))` when review gate on.

Behaviors:
- `_prepareContext`: session npcs each with include checkbox, name, CR, tableSource label, chips (generated neutral / carried accent via `.tlg-chip--carried`), item qty inline `<input type="number">`; footer totals (sum currency by denom, item count), encounter-level carried-gear checkbox (strips/restores `carried` items from view state — persisted as `session.carriedEnabled`, default from world setting; releaseSession drops carried items when false — extend `releaseSession` with this filter + a session-store test in this task).
- Actions: `toggleNpc` (flips `npcs[i].included` via updateSession), `rerollNpc`, `rerollAll`, `removeItem`, `addItem` (DialogV2 with item-name search across pack itemPacks + drag-drop zone), `editQty` (change listener, clamps ≥1), `discard` (confirm → discardSession → close), `release` (releaseSession → close; Distribution opens everywhere via the sessions onChange — Task 12).
- Also: currency per-denom `<input>` row (GM can edit pot before release; writes through updateSession).
- [ ] **Step 1: session-store changes with tests first** (carriedEnabled filter in releaseSession: red → green). **Step 2: implement app + template + wiring. Step 3: extend apps-smoke test for action-name consistency. Step 4: `npx vitest run` green. Step 5: Commit** `git add -A; git commit -m "feat: GM loot review window"`

---

### Task 12: Distribution UI + live sync

**Files:**
- Create: `scripts/apps/distribution.js`, `templates/distribution.hbs`
- Modify: `scripts/main.js` (sessions setting `onChange` + ready-check + chat button binding), `styles/tlg.css`, `lang/en.json`

**Interfaces:**
- Consumes: session-store (all pure helpers), socket-service (`sendIntent`, `isPrimaryGM`), finalizer (`finalizeSession`), config.
- Produces:
  - `DistributionApp` — `new DistributionApp({ sessionId })`, singleton-per-session (`static instances = new Map()`; `open(sessionId)` focuses existing).
  - `syncOpenWindows()` exported — called from the `sessions` setting `onChange` registered in main.js: re-render any open DistributionApp/LootReviewApp for changed sessions; auto-open DistributionApp for sessions newly "released" (all clients); auto-close finalized/discarded ones.
  - Ready-hook check: on `ready`, if any released session exists → open (late joiners / reloads).
  - `partyCharacters(): {uuid, name, img, ownerUserIds}[]` exported helper — `game.actors.filter(a => a.type === "character" && a.hasPlayerOwner)`.

Behaviors (per spec §Player Distribution window — implement ALL):
- Currency bar: pot by denomination, even-split preview text (`computeEvenSplit` dry-run), buttons Split evenly (GM applies allocation via updateSession; player sends `allocateCurrency` intent with the computed allocation — computed identically from shared helper), Allocate manually (DialogV2 grid of per-character per-denom inputs, validated sums).
- Item rows: img, name (click → `(await fromUuid(uuid))?.sheet.render(true)` for uuid items; DialogV2 read-only description for itemData items), qty, source NPC, state cluster:
  - unclaimed → Claim (self; if user owns multiple party characters show picker DialogV2), Give to… (picker of all party characters), abandon icon-button;
  - claimed → claimant chip (name + img); unclaim button when owner or GM; GM additionally gets a reassign select;
  - abandoned → struck row + Restore.
- All player mutations go through `sendIntent(action, payload)`; GM clicking the same controls short-circuits locally through the same handler queue (socket-service handles this via `isPrimaryGM()` branch in `sendIntent`).
- Progress bar `resolveCounts`; footer GM buttons: Abandon remaining (confirm → all unclaimed → abandoned), Finalize (enabled look regardless; if `!isFullyResolved` → info notification listing counts; else `finalizeSession`).
- No-GM banner: if `!game.users.activeGM` render `.tlg-banner-warning` and disable all mutation buttons (`disabled` + tooltip).
- Session picker row when >1 unresolved released session: tabs across the top switching sessionId.
- Chat card binding: `Hooks.on("renderChatMessageHTML", (msg, html) => html.querySelector("[data-tlg-open]")?.addEventListener("click", () => DistributionApp.open(sessionId)))` — release posts a public "Loot released — Open loot window" ChatMessage with `data-tlg-open="<sessionId>"` (add this post to `releaseSession` call site in socket/review release path — put it in `syncOpenWindows` on transition detect instead, GM client only, so ALL release paths get the card).
- [ ] **Step 1: implement app/template/wiring. Step 2: extend apps-smoke test. Step 3: full `npx vitest run` green. Step 4: Commit** `git add -A; git commit -m "feat: player distribution window with live claim sync"`

---

### Task 13: Assignment flows, tracker controls, history

**Files:**
- Create: `scripts/apps/history.js`, `templates/history.hbs`
- Modify: `scripts/main.js`, `scripts/apps/table-manager.js` (export already done), `styles/tlg.css`, `lang/en.json`

**Interfaces:**
- Consumes: table-store, session-store, finalizer (`revertSession`), `openTablePicker` (table-manager).
- Produces:
  - NPC sheet header button: `Hooks.on("getHeaderControlsActorSheetV2", (sheet, controls) => ...)` pushing `{ icon: "fas fa-coins", label: "TLG.AssignTable", action: "tlgAssignTable", visible: sheet.document?.type === "npc" && game.user.isGM, onClick: () => assignFlow(sheet.document) }`. ALSO register the actor-directory context menu (`Hooks.on("getActorContextOptions", ...)` — v13 sidebar hook) with the same `assignFlow`; if the header-controls hook name proves wrong at live verification (Task 14), the context menu is the guaranteed path and the header hook gets fixed there.
  - `assignFlow(actor)`: `openTablePicker(actor.getFlag(MODULE_ID, FLAGS.TABLE))` → DialogV2 offering [pick existing / create new named `"<actor.name>'s loot"` / clear] → set/unset flag.
  - Combat tracker (GM): `Hooks.on("renderCombatTracker", (app, html) => ...)` injecting two buttons into the tracker footer (plain DOM, html is HTMLElement in v13): "Skip loot" toggle (combat flag SKIP, pressed styling reflects state) and "Generate loot now" (`generateNow(game.combat)`).
  - `HistoryApp` (GM): lists finalized/discarded sessions newest-first with per-actor grant summary (reuse `groupGrants`), Revert button on the most recent finalized (confirm → `revertSession`); opened from a settings-menu entry and from the summary chat card's `data-tlg-action="open-history"` binding.
- [ ] **Step 1: implement. Step 2: extend apps-smoke. Step 3: `npx vitest run` green. Step 4: Commit** `git add -A; git commit -m "feat: boss table assignment, tracker controls, history and revert"`

---

### Task 14: Copy audit, README, packaging, live end-to-end

**Files:**
- Modify: `lang/en.json` (complete audit), `module.json` (bump 0.1.0 → 1.0.0), any file with hardcoded strings
- Create: `README.md`

**Interfaces:** consumes everything; produces the shippable module.

- [ ] **Step 1: i18n audit** — grep for user-visible literals in `scripts/` (`Grep: "[A-Z][a-z]+ [a-z]"` on template/js files, manual pass); every UI string keyed under `TLG.*` in en.json.
- [ ] **Step 2: README.md** — install (manifest path), features overview, table editing guide, boss tables, SW5E notes, settings reference, screenshots deferred.
- [ ] **Step 3: Full test suite** — `npx vitest run` → everything green.
- [ ] **Step 4: Live end-to-end via the connected Foundry MCP** (the world must be running; coordinate with the user if not):
  1. Verify module loads: `get-world-info`, check no console errors via user.
  2. Verify pack item names resolve: run resolver against live compendia (execute-macro with a small script calling `game.modules.get("tristons-loot-generator").api` — expose `api = { resolveAll, openTableManager, ... }` in main.js ready hook as part of this step); fix any wrong names in packs (esp. SW5E pack ids/names and credits storage — inspect an SW5E actor's currency schema live).
  3. `create-encounter` with 2–3 hostile NPCs + `start-combat`; check combat flags rolled.
  4. Apply damage to 0 HP, `end-combat`; verify LootReviewApp opens, toggle/reroll/edit, release.
  5. As GM client: claim/give/abandon flow, split currency, finalize; verify items + currency on the character sheet (`get-character`), summary chat card posts, history lists the session, revert works and restores state.
  6. Fix everything found; each fix gets its own commit.
- [ ] **Step 5: Verify hook names live** (header controls, context menu, renderChatMessageHTML) and correct if needed.
- [ ] **Step 6: Final commit + tag** — `git add -A; git commit -m "chore: 1.0.0 - copy audit, README, live-verified"; git tag v1.0.0`

---

## Self-review (performed while writing)

- **Spec coverage:** every spec section maps to a task — architecture/components (T1–T9), engine details (T2/T3/T5), GM UIs (T10/T11), NPC sheet button (T13), distribution + sync + mandatory resolution + finalize (T12/T9), history/revert (T13), settings (T1), edge cases (validators + guards T4–T8), testing (per-task + T14). Session picker (T12), chat cards (T12/T9), tracker controls (T13), generosity/rarity (T5), carried gear toggle chain (T11).
- **Placeholder scan:** dnd5e pack table list in T3 shows the pattern with an explicit instruction to write all 14 type tables — deliberate data-authoring latitude, not a logic placeholder; SW5E compendium ids/currency are marked as live-verified in T14 with concrete defaults shipped. No TBDs elsewhere.
- **Type consistency:** Session/Table/Entry/Grant/Rule shapes defined once (spec + T3/T4/T6/T9 Interfaces) and referenced by name; `validateTransition` extension (finalized→released) explicitly owned by T9; `carriedEnabled` extension owned by T11; `sharedTables` introduced in T3 and honored by T4's `getEffectiveTable`.
