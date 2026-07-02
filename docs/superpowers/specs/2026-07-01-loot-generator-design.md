# Triston's Loot Generator — Design Spec

Date: 2026-07-01
Status: Approved by user (sections 1–5 approved in conversation)

## Overview

A Foundry VTT module for the dnd5e system that automatically generates contextual
loot for NPCs when an encounter begins, then presents a shared loot-splitting GUI
so the party can divide items among their character sheets, with the GM in full
control of the tables that drive generation.

## Target environment

- Foundry VTT v13 (verified 13.351)
- dnd5e system 5.2.5–5.3.3 (required)
- SW5E module 1.3.6 (optional — auto-detected, adds an SW5E content profile)
- No library dependencies (no socketlib, no libWrapper). Core v13 APIs only:
  ApplicationV2 + HandlebarsApplicationMixin, DialogV2, hooks, `game.socket`.
- Plain ES modules, no build step. Vitest for unit tests (dev-only dependency).

## Approved product decisions

1. Loot is generated silently when combat starts; revealed when combat ends.
2. Engine: built-in tables keyed by creature type and scaled by CR, shipped as
   content packs (D&D 5e + SW5E), fully GM-editable, with per-actor override
   tables for bosses/uniques.
3. Distribution: free claim by players with GM veto/reassignment, live-synced.
4. GM review gate between generation and release — optional setting, on by default.
5. Mandatory resolution: the distribution session cannot close until every item
   is claimed or abandoned. GM has an "Abandon remaining" escape hatch.
6. Only defeated (0 HP / dead) hostile NPCs drop loot; GM can include/exclude
   any NPC in the review screen.
7. NPCs' carried equipment (physical items on their sheet) is lootable, with
   smart filters, a global setting, and a per-encounter toggle.
8. Claimed items land on character sheets in one atomic batch at finalize,
   never instantly per-claim.

## Architecture

Seven components, one responsibility each:

| Component | Responsibility |
|---|---|
| ContentPacks | Static data shipped with the module: default table sets, currency config, rarity budgets, carried-gear filter rules for D&D 5e and SW5E |
| TableStore | Persists GM customizations in world settings as override copies layered over the active pack; CRUD + import/export |
| LootEngine | Pure logic: (NPC data, resolved tables, settings) → loot result. No UI, no document writes. Unit-testable |
| EncounterService | Combat lifecycle hooks: rolls loot at combat start, rolls for mid-combat additions, captures defeated hostiles into a session when combat ends |
| SessionStore | Persistent distribution sessions in world settings — survives reloads and Combat document deletion |
| SocketService | GM-authority relay: players emit intents, GM client validates + mutates + broadcasts |
| UI layer | Table Manager (GM), Loot Review (GM), Distribution window (all), settings, NPC-sheet header button, chat cards |

### Data flow

Combat starts → EncounterService pre-rolls loot per combatant via LootEngine
(stored in Combat flags) → combat ends (Combat document is deleted by Foundry —
capture happens at that moment) → defeated hostiles become a Session (pending) →
GM Loot Review → release → Distribution window opens on all clients → claims
sync via socket → all items resolved → finalize writes items + currency to
actors in one batch → summary chat card → session archived to history.

## Data model

### Table

```js
{
  id: string,              // slug
  name: string,
  rolls: string,           // dice formula, e.g. "1d2" — number of entry draws
  entries: [{
    id: string,
    weight: number,        // relative weight
    type: "item" | "currency" | "table" | "rolltable" | "nothing",
    uuid: string?,         // compendium item UUID (item) or RollTable UUID (rolltable)
    ref: { pack: string, name: string }?,  // name-based compendium ref, used by
                           // shipped pack tables (resolved to a UUID at load,
                           // robust across dnd5e releases); GM drag-drop stores uuid
    itemData: object?,     // inline item data (trinkets/valuables with no
                           // compendium entry) — created directly at finalize
    tableId: string?,      // nested table reference (table)
    qty: string?,          // dice formula, default "1"
    currency: { formula: string, denom: string }?,  // formula may use @cr
    minCr: number?, maxCr: number?
  }]
}
```

### Content pack

```js
{
  id: "dnd5e" | "sw5e",
  version: number,          // bumped when defaults change; merge logic keys on this
  label: string,
  detect: () => boolean,    // sw5e: game.modules.get("sw5e")?.active
  currency: {
    denominations: [{ key: "pp"|"gp"|"ep"|"sp"|"cp", label, conversion }],
    // sw5e: single denomination mapped to the module's credits storage
    path: "system.currency" // actor data path
  },
  creatureTypes: string[],  // sw5e adds droid etc.
  typeTables: { [type]: Table },
  fallbackTable: Table,
  rarityBudget: [{ maxCr: number, allowed: rarity[] }],
  carriedGear: {
    includeTypes: ["weapon","equipment","consumable","tool","loot","container"],
    exclude: (item) => bool   // natural weapons, spells, features
  }
}
```

### TableStore world settings

- `tableOverrides`: `{ [packId]: { [tableId]: Table } }` — full modified copy of a
  pack table; "revert to default" deletes the copy. Pack updates never touch these.
- `customTables`: `{ [tableId]: Table }` — GM-created tables (custom + boss tables).
- `keywordRules`: ordered `[{ id, pattern, matchType: "includes"|"regex", tableId, enabled }]`.
- Actor overrides are NOT in settings — stored as a flag on the actor:
  `flags.tristons-loot-generator.tableId`, so they travel with actor exports.
  The Table Manager's "Boss overrides" group is built by scanning world actors
  for this flag.

### Session record (world setting `sessions`, keyed by id)

```js
{
  id, name, created,               // name = combat/scene label
  status: "pending" | "released" | "finalized" | "discarded",
  npcs: [{ tokenId, actorName, img, cr, tableSource, included, defeated }],
  items: [{
    id, name, img, qty, sourceNpc,
    uuid: string?,                 // compendium ref (generated items)
    itemData: object?,             // full item data (carried gear / world items)
    carried: bool,
    state: "unclaimed" | "claimed" | "abandoned",
    claimedBy: actorUuid?
  }],
  currency: { [denom]: number },
  currencyAllocation: { [actorUuid]: { [denom]: number } } | null,
  createdItemIds: [{ actorUuid, itemId }],   // filled at finalize, enables revert
  currencyGranted: { [actorUuid]: {...} }    // filled at finalize, enables revert
}
```

### Combat flags (transient, pre-capture)

`combat.flags.tristons-loot-generator.rolled[combatantId] = { loot, carried, tableSource, packId }`

## Loot engine

### Table matching — first match wins, all layers visible to the GM

1. **Actor override** — `flags.tristons-loot-generator.tableId` on the actor.
2. **Keyword rules** — ordered GM-defined matchers against actor name + biography.
3. **Creature type** — `actor.system.details.type.value` → active pack's type table.
4. **Fallback table** — pack default; nothing ever errors from zero config.

### Rolling

- Table's `rolls` formula determines number of draws; each draw picks one entry
  by weight among entries whose CR gate admits the NPC's CR.
- Entry resolution: item → (uuid, qty roll); currency → formula evaluated with
  `@cr`; table → recursive roll (depth cap 5, cycle-safe); rolltable → draw from
  the native RollTable, mapping results to items where possible; nothing → skip.
- Generosity setting (sparse ×0.5 / standard ×1 / generous ×2) multiplies
  currency results and shifts roll counts by −1/0/+1 (floor 1).
- Rarity budget: item entries whose compendium rarity exceeds the CR band are
  excluded from *pack* tables' draws. Explicit GM tables (overrides, customs,
  actor overrides) bypass the budget entirely.

### Carried gear

Filter the NPC's owned items by the pack's carriedGear rules: physical item
types only; exclude natural weapons (`system.type.value === "natural"`),
anything zero-quantity, and items flagged `tristons-loot-generator.noLoot`
(escape hatch for "this is flavor, don't drop it"). Controlled by a world
setting (default on) and a per-encounter toggle in Loot Review.

### CR / type reading

- CR: `actor.system.details.cr` (missing → 0).
- Creature type: `actor.system.details.type.value` (missing/custom → fallback).
- Unlinked tokens roll independently per token (each goblin gets its own loot).

## Combat lifecycle (EncounterService)

- `combatStart` hook: roll loot for every NPC combatant, store in Combat flags.
- `createCombatant` hook (combat already started): roll for the newcomer.
- `deleteCombat` hook: if the combat had started, build a session from combatants
  that are hostile (token disposition) AND defeated (HP 0 or defeated status),
  reading rolled flags + carried gear. Status: `pending` (review gate on) or
  straight to `released` (gate off). If the combat never started, do nothing.
- The session's `items` array is fully built at capture (all NPCs, including
  excludable ones). Release drops items whose `sourceNpc` is unchecked in
  review; reroll in review rebuilds that NPC's items in place.
- Combat tracker context menu: "Skip loot for this combat" toggle; a
  "Generate loot now" button covers combats created before the module enabled.

## GM UIs

### Table Manager (ApplicationV2)

- Opened from token scene-controls button + module settings menu button.
- Sidebar: search; groups = active pack creature types (modified ones dotted),
  Custom tables, Boss overrides (flag scan), Keyword rules; "New table".
- Editor pane: name, rolls formula, entry rows (weight / type / detail / qty /
  CR gate / delete), add entry, drag-drop items from compendia or the items
  directory to create item entries, drag RollTables for rolltable entries.
- "Modified" badge + "Revert to default" on pack tables.
- Test roll: pick a CR, roll the table, whisper the result to the GM.
- Import/export: JSON file of overrides + customs + rules.
- Keyword rules editor: ordered list, add/remove/reorder, pattern + target table.

### Loot Review (ApplicationV2, GM only)

- Opens when combat ends (gate on). Lists each NPC: include checkbox (defeated
  hostiles pre-checked; others dimmed + unchecked but includable), name, CR,
  matched table source, loot chips (generated neutral, carried accented).
- Chip click → edit qty / remove. Plus button → add item by search or drag.
- Per-NPC reroll; "Reroll all"; encounter-level carried-gear toggle.
- Footer: totals, "Discard" (session → discarded), "Release to players".
- If gate setting is off this window never appears (session auto-releases);
  GM can still open review from the session list before anyone claims.

### NPC sheet header button

"Loot table" button on NPC sheets → dialog: pick existing table or create new
(pre-named after the actor) → sets the actor flag. This is the boss-table flow.

## Player Distribution window (ApplicationV2, all clients)

- Opens on release for all connected clients; late joiners get it on connect;
  reopenable from the summary chat card button and a scene-controls button.
- Currency bar: pot total, even-split preview ("27 sp each, 1 sp over"),
  "Split evenly" (remainder → random recipient, called out), "Allocate
  manually" (per-character fields; must sum to pot). Currency is a resolvable
  like items — resolved when allocated. Even split divides each denomination
  across ALL party characters (as defined below), not just claimants.
- Item rows: icon, name (click → item sheet preview), qty, source NPC, state:
  - Unclaimed: "Claim" (own character; picker if user owns several),
    "Give to…" (any party character), abandon button.
  - Claimed: claimant chip (avatar + name). Claimant or GM can unclaim.
  - Abandoned: struck through + "Restore".
- GM view: same window + reassign/unclaim/delete on every row, "Abandon
  remaining", "Finalize".
- Progress bar "N of M resolved". Finalize activates when all resolved;
  clicking early lists what's pending.
- Finalize (GM client): atomic batch — create claimed items on actors
  (compendium items copied fresh; carried gear copied from stored itemData and
  removed from the source token actor), apply currency, record
  createdItemIds/currencyGranted, status → finalized, broadcast close,
  post summary chat card.
- Party characters = actors of type "character" with a player owner.
- Multiple unresolved sessions queue; a session picker row appears when > 1.

## Sync model (SocketService)

- Channel: `module.tristons-loot-generator`.
- Player intents: `claim`, `unclaim`, `give`, `abandon`, `restore`,
  `allocateCurrency`. Payload: { sessionId, itemId?, actorUuid?, ... }.
- Only the active GM client (first active GM by user id) processes intents:
  validate (session released? item unclaimed? actor is party character?) →
  mutate session in world settings. World-setting changes propagate to every
  client automatically, and the setting's `onChange` re-renders open windows —
  no manual `stateUpdate` broadcast needed. The socket carries only player
  intents (player → GM) and rejection toasts (GM → player).
- Conflicts resolve by arrival order at the GM client; losers get a toast.
- No GM connected → window renders read-only with a notice bar.
- GM-side actions (review edits, release, finalize, revert) run locally on the
  GM client and broadcast the same way.

## Finalize, history, revert

- History: finalized/discarded sessions kept (cap 50, oldest pruned), viewable
  in a GM history dialog listing who got what.
- Revert (GM, most recent finalized session): delete recorded created items
  (skip already-deleted with a warning list), subtract granted currency
  (floor 0), restore carried gear to source tokens if they still exist,
  status → released (so it can be redistributed or abandoned).

## Settings (world-scoped unless noted)

| Setting | Default |
|---|---|
| Auto-generate on combat start | on |
| GM review gate | on |
| Generosity (sparse / standard / generous) | standard |
| Include carried gear | on |
| Currency remainder (random recipient / GM assigns) | random |
| Content pack (auto / dnd5e / sw5e) | auto |
| Chat summary visibility (public / GM only) | public |

## Error handling & edge cases

- Broken compendium UUID in a table: entry skipped at roll time with a GM
  whisper; Table Manager flags the entry red.
- SW5E currency storage verified at implementation time against module 1.3.6;
  pack config isolates the mapping so a wrong guess is a one-file fix.
- NPC missing type/CR → fallback table, CR 0.
- Session references an actor/token deleted mid-flow → claims for it are
  blocked with a notice; GM can reassign.
- Two GMs online → deterministic primary (lowest active GM user id) processes.
- Version drift (Foundry/dnd5e outside supported range) → startup warning
  notification, module still attempts to run.
- Combat deleted without starting → no session.
- Module updates that change pack defaults never touch GM overrides
  (override copies win; pack `version` recorded for future migrations).

## File layout

```
module.json
scripts/
  main.js                 # hook + settings + socket registration
  config.js               # module id, constants, settings defs
  content/
    dnd5e-pack.js
    sw5e-pack.js
  core/
    table-store.js
    loot-engine.js
    encounter-service.js
    session-store.js
    socket-service.js
  apps/
    table-manager.js
    loot-review.js
    distribution.js
    history.js
templates/                # .hbs per app + partials
styles/tlg.css
lang/en.json
tests/                    # vitest: loot-engine, table-store, session logic
package.json              # dev: vitest
```

## Testing

- Unit (Vitest, no Foundry runtime): weighted draw distribution, CR gating,
  currency formula evaluation with @cr, nested table depth/cycle caps,
  generosity scaling, rarity budget, table matching precedence, override
  merge/revert, session state transitions, even-split math with remainders.
  Foundry globals faked with a tiny test shim (`tests/foundry-shim.js`).
- Integration: manual checklist + live end-to-end drive of the user's Foundry
  world via the connected Foundry MCP (spawn NPCs, run combat, end it, verify
  review → release → claim → finalize → items on sheets).

## Out of scope (explicitly)

- Loot for non-combat contexts (chests, pickpocketing).
- Selling/shop features.
- Localization beyond English (i18n keys used throughout, only en.json ships).
- Undo for anything older than the most recent finalized session.
