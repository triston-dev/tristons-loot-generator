# Triston's Loot Generator

Every fight ends with the same question: *"what's on the bodies?"* This module answers it for you.

When combat starts, every hostile NPC quietly gets loot appropriate to what it is — bandits carry coins and blades, beasts have pelts and fangs, dragons hoard treasure. When combat ends, you review the haul, release it to your players, and they divvy it up themselves in a shared window. One click later it's all on their character sheets.

Works with **D&D 5e**, and automatically switches to credits, blasters, and droid parts if you're running **SW5E**.

## Installation

In Foundry: **Add-on Modules → Install Module**, paste this manifest URL, and click Install:

```
https://github.com/triston-dev/tristons-loot-generator/releases/latest/download/module.json
```

Then enable **Triston's Loot Generator** in your world's **Manage Modules**.

Requires Foundry v13 and the dnd5e system (5.2.5–5.3.3).

## How a session flows

1. **Run combat like you always do.** Loot is rolled silently in the background — no spoilers for the players.
2. **End combat.** The **Loot Review** window opens for you (and only you). Defeated enemies are listed with their loot — rolled items, coins, and the gear they were actually carrying. Reroll anything, remove or add items, tweak the coin, untick an enemy that got away.
3. **Click "Release to players."** Everyone gets the **Loot Distribution** window. Players claim items for their characters, pass items to each other, and split the coins evenly (or however they argue it out). Nothing is missed — every item has to be claimed or deliberately left behind before the session can close.
4. **Finalize.** Items and currency land on the character sheets, and a summary posts to chat so there's no "wait, who took the potion?"
5. **Made a mistake?** Open **Loot History** (in module settings) and revert the last finalize. Everything comes back off the sheets.

## Making the loot yours

Open the **Loot Table Manager** from the token toolbar (coin icon) or Game Settings.

- **Edit any built-in table.** Every creature type (humanoid, undead, dragon…) has its own table of weighted entries — items, coin formulas, even "nothing" (not every wolf swallowed a gold ring). Edited tables show a dot and can be reverted to defaults anytime.
- **Drag and drop.** Drag items from any compendium straight into a table to add them.
- **Test roll.** Preview what a table produces for a given challenge rating before it ever hits a real game.
- **Custom tables.** Build your own from scratch and chain tables into each other (a "Bandit" table can roll into your "Common weapons" table).
- **Share.** Export your tables to a file and import them in another world.

### Boss loot

Give any specific NPC its own personal loot table: right-click the actor in the sidebar (or use the coin button on its sheet) and assign one — or create a new table named after them on the spot. That dragon's hoard can be exactly what you want it to be.

### Keyword rules

Want every NPC with "cultist" in the name to drop ritual gear? Add a keyword rule in the Table Manager: match on a word in the name or bio, point it at a table, done. No need to touch individual actors.

## Settings worth knowing

| Setting | What it does |
|---|---|
| GM review gate | On (default): you approve loot before players see it. Off: loot goes straight to players when combat ends. |
| Generosity | Sparse / Standard / Generous — one dial for how much loot drops overall. |
| Include carried gear | Whether enemies' actual equipped weapons and armor are lootable too. |
| Content pack | Auto-detects D&D 5e vs SW5E; you can force either. |

There's also a **Skip loot** toggle in the combat tracker for encounters that shouldn't drop anything, and a **Generate loot now** button for combats that started before you enabled the module.

## Good to know

- A GM needs to be connected for players to claim loot — the GM's client is the referee for the whole distribution.
- Loot sessions survive reloads and disconnects. If someone closes the window, the chat card reopens it.
