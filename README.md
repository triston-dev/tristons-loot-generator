# Triston's Loot Generator

A Foundry VTT module that rolls contextual loot for hostile NPCs when combat starts, then walks the table through GM review, party distribution, and finalization onto character sheets. Tables, boss overrides, and keyword rules are all GM-editable in-app.

## What it does

- **Automatic generation.** When combat starts, each hostile NPC is matched to a loot table (boss override → keyword rule → creature type → fallback) and rolled. Loot can also be generated on demand from the combat tracker.
- **GM review gate.** When combat ends, defeated hostiles are captured into a loot session. If the review gate setting is on, the Loot Review window opens for the GM to toggle NPCs in/out, add or remove items, reroll, and adjust currency before anything reaches the players.
- **Player split window.** Releasing a session opens the Loot Distribution window for everyone. Players claim or are given items, currency can be split evenly or allocated manually, and every item and currency pot must be resolved (claimed, given, or abandoned) before the session can be finalized.
- **Finalize to character sheets.** Once everything is resolved, the GM (or, if configured, the flow itself) finalizes the session: items and currency are granted to the owning actors, and a chat card summarizes what went where.
- **Revert and history.** The Loot History window lists every finalized or discarded session. The most recently finalized session can be reverted — created items are deleted, granted currency is subtracted, and carried gear is restored where possible.

## Requirements

- Foundry VTT v13
- dnd5e system, version 5.2.5 through 5.3.3 (verified range)
- Optional: an SW5E-compatible module for Star Wars 5e games. When present, the module auto-detects it and switches its content pack and currency handling accordingly (see the "Content pack" setting below).

## Installation

**Manifest URL (recommended once published):**

```
<manifest URL not yet published — fill in before distributing>
```

Paste that URL into Foundry's **Add-on Modules → Install Module** dialog. This module is not yet in the Foundry package directory, so this URL is a placeholder until a release is published somewhere reachable.

**Manual install:**

1. Download or clone this repository.
2. Copy (or extract, if you have a zip) the module folder so it ends up at `Data/modules/tristons-loot-generator` inside your Foundry user data directory. The folder must contain `module.json` directly inside it — not nested one level deeper.
3. Restart Foundry (or refresh the setup page) so it picks up the new module.
4. Enable **Triston's Loot Generator** in your world's **Manage Modules** dialog.

## Quick start

1. Enable the module in your world.
2. Run a combat encounter with hostile NPCs as normal.
3. End the combat once the hostiles are defeated. If loot generation is on, each defeated hostile already has loot rolled and attached; ending combat captures them into a new loot session.
4. If the GM review gate is on, the **Loot Review** window opens automatically. Toggle NPCs in or out, reroll individuals or everyone, add/remove items, and adjust currency, then click **Release to players**.
5. The **Loot Distribution** window opens for the whole table. Players claim items for their characters (or the GM gives items directly), currency is split evenly or allocated manually, and anything left over can be abandoned.
6. Once every item and currency pot is resolved, the GM clicks **Finalize**. Items and currency land on the owning character sheets and a summary chat card is posted.
7. If something went wrong, open **Loot History** and revert the most recent finalize.

## Table editing guide

Open the Table Manager from the token controls sidebar (loot table icon) or via **Game Settings → Loot Table Manager**.

- **Groups.** The sidebar lists tables in three groups: the active content pack's built-in tables (dnd5e or SW5E, depending on the "Content pack" setting), your custom tables, and boss overrides (tables assigned directly to specific NPC actors). A dot next to a pack table means you've modified it from its shipped default.
- **Table fields.** Each table has a name and a **Rolls** formula — a dice expression (e.g. `1d2`) for how many entries to draw. The formula can reference `@cr` to scale draws with the NPC's challenge rating.
- **Entries and weights.** Each table is a weighted list of entries. Higher weight means more likely to be picked on a given draw. Entry types:
  - **Item** — a specific item (dragged in from a compendium or the world, or picked from search) with a quantity formula.
  - **Currency** — a currency formula (e.g. `2d6*10`) and denomination (e.g. `gp`).
  - **Nested table** — rolls into another table in this module (from the same pack or your custom tables) instead of producing an item directly. Nested table references resolve recursively, with a depth cap and cycle protection so a table can't reference itself into an infinite loop.
  - **Roll table** — draws from a Foundry core `RollTable` document by UUID, letting you reuse existing world roll tables.
  - **Nothing** — an explicit "no loot" outcome you can weight into the table, useful for making some draws whiff.
- **CR gates.** Any entry can have a **Min CR** and/or **Max CR**, restricting it to NPCs whose challenge rating falls in that range. Leave either blank to leave that side ungated.
- **Test roll.** Enter a CR in the test-roll bar and click **Roll** to preview what the table would produce for an NPC of that CR, without touching any real session.
- **Import / export.** Export writes your custom tables and keyword rules to a JSON file. Import reads that file back in — it validates the file's schema and pack origin before applying it, so you can't accidentally import a SW5E export into a dnd5e world (or vice versa).
- **Saving.** Changes are staged in the editor and only committed with **Save**. Switching tables (or closing the window) with unsaved changes prompts for confirmation. Pack tables can be reverted to their shipped defaults; custom tables can be deleted.

## Boss tables

To give a specific NPC its own loot table (bypassing keyword rules and creature-type matching), assign it directly:

- **From the NPC's character sheet:** open the NPC's sheet as a GM and use the coin-stack button in the sheet's header controls. It opens a picker to choose an existing table, create a new one seeded with that NPC's name, or clear the current assignment.
- **From the Actors directory:** right-click an NPC actor in the sidebar and choose the loot table option from the context menu. This is the guaranteed path if your Foundry version doesn't expose the sheet header button.

A boss-assigned table always wins over keyword rules and creature-type fallbacks for that actor, for as long as the assignment is in place.

## Keyword rules

Keyword rules let you route NPCs to a table by matching their name or biography text, without editing every actor individually — useful for "any NPC named/described as X should drop from table Y" patterns (e.g. anything with "cultist" in the name uses a cultist loot table).

Open the rules editor from the Table Manager sidebar (**Keyword rules**). Each rule has:

- A **pattern** to match against the NPC's name and biography.
- A **match type** — either "Contains" (case-insensitive substring match) or "Regex" (a JavaScript regular expression, case-insensitive; an invalid pattern simply never matches instead of erroring).
- A **target table**.
- An **enabled** toggle, so you can keep rules around without them being active.

Rules are checked top to bottom, and the first enabled rule that matches wins. You can reorder rules with the move up/down controls. Matching order overall is: boss override (if assigned) → first matching keyword rule → creature-type table (if the pack defines one for that creature type) → the pack's fallback table.

## Settings reference

All settings are world-scoped and GM-configurable from **Game Settings → Configure Settings → Triston's Loot Generator**, except the four marked "internal" which are not shown in that UI and exist only to persist module state.

| Setting | Purpose | Default |
|---|---|---|
| Auto-generate loot on combat start | Whether hostile NPCs automatically get loot rolled and attached when combat starts (or loot is generated on demand from the tracker). | On |
| GM review gate | Whether ending combat opens the Loot Review window for GM approval before release, versus releasing captured loot straight to players. | On |
| Generosity | Overall loot volume: Sparse, Standard, or Generous. Shifts the number of draws per table up or down. | Standard |
| Include carried gear | Whether a defeated NPC's own inventory items are included in the captured session alongside rolled loot (individual items can be excluded per-item via a "no loot" flag). | On |
| Currency remainder | How to resolve currency that doesn't split evenly among the party: give it to a random recipient, or let the GM assign it manually. | Random recipient |
| Content pack | Which built-in content pack to use for tables: auto-detect based on installed systems/modules, force D&D 5e, or force SW5E. | Auto-detect |
| Chat summary visibility | Whether the finalize summary chat card is posted publicly or GM-only. | Public |
| *(internal)* Table overrides | Stores per-pack table edits (the "Modified" tables in the manager). Not user-configurable directly. | `{}` |
| *(internal)* Custom tables | Stores GM-created custom tables. Not user-configurable directly. | `{}` |
| *(internal)* Keyword rules | Stores the keyword rule list edited via the rules editor. Not user-configurable directly. | no rules |
| *(internal)* Sessions | Stores all loot sessions (pending, released, finalized, discarded) and is the sync mechanism between clients — every client re-renders its loot windows when this setting changes. Not user-configurable directly. | `{}` |

## Combat tracker controls

When a combat is active, GM-only controls appear in the combat tracker footer:

- **Skip loot** — toggles a per-combat flag that suppresses loot capture for the current combat, without changing the world-wide auto-generate setting. Useful for one-off combats (e.g. a scripted non-loot encounter) where you don't want the review/distribution flow to trigger at all.
- **Generate loot now** — manually triggers loot generation for the current combat's hostiles immediately, rather than waiting for combat to start naturally (or if auto-generate is off).

## Multiplayer notes

- **A GM must be online for players to act.** Claiming, giving, unclaiming, abandoning, and currency allocation in the Loot Distribution window all route through the primary (first-connected) GM's client, which is the sole writer of session state. If no GM is connected, the distribution window shows a banner and disables those controls until one connects.
- **Non-primary co-GMs act with player-level claim powers by design.** If more than one GM account is online, only the primary GM processes claim/give/abandon actions server-side (in the "route through the GM client" sense — Foundry has no real server component here). Other connected GM accounts can still open the distribution window and claim/give/abandon like a player would, but they don't get the elevated authority checks that the primary GM's own local actions get. This is intentional, not a bug: it keeps write authority for a given session on one client at a time.
- **Claims trust the reported user identity.** Foundry's module socket layer does not cryptographically verify who sent a given socket message — a message simply carries whatever user ID the sending client claims. This module closes the most serious version of that gap (a malicious client can't grant itself GM-level authority over a session by spoofing a GM's user ID: the GM-authority check only ever trusts the primary GM's own locally-processed actions, never anything arriving over the wire). It does not, and cannot, prevent a compromised or malicious player client from spoofing *another player's* user ID to claim/unclaim/abandon items as if it were that other player. This is the same trust model the broader Foundry module ecosystem (including socketlib-based modules) operates under — it assumes clients in your game are run by people you trust, not a hostile-multi-tenant environment.

## Screenshots

Not included in this version — deferred.
