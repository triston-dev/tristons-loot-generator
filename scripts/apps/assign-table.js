// assignFlow: boss-table assignment for a single NPC actor. GM only.
//
// Entry points (wired in main.js):
//  - NPC sheet header button (getHeaderControlsActorSheetV2 hook)
//  - Actor directory context menu (getActorContextOptions hook) — the
//    guaranteed path if the header-controls hook name proves wrong live
//    (Task 14 verifies both; the header hook gets fixed there if needed).
//
// UI-wiring only: table creation/lookup lives in table-store.js, the actual
// picker dialog is table-manager.js's openTablePicker. This module is just
// the three-way branch (pick / create / clear) + flag set/unset.

import { MODULE_ID, FLAGS } from "../config.js";
import { openTablePicker } from "./table-manager.js";
import { createCustomTable } from "../core/table-store.js";
import { TableManagerApp } from "./table-manager.js";

/**
 * Opens the boss-table assignment dialog for `actor`: pick an existing
 * table, create a new one named "<actor.name>'s loot", or clear the flag.
 *
 * @param {Actor} actor
 */
export async function assignFlow(actor) {
  if (!actor) return;

  const current = actor.getFlag(MODULE_ID, FLAGS.TABLE);

  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("TLG.AssignTable.Title", { name: actor.name }) },
    content: `<div class="tlg-assign-table">
      <p>${game.i18n.localize("TLG.AssignTable.Body")}</p>
    </div>`,
    buttons: [
      {
        action: "pick",
        label: game.i18n.localize("TLG.AssignTable.Pick"),
        default: true
      },
      {
        action: "create",
        label: game.i18n.localize("TLG.AssignTable.Create")
      },
      {
        action: "clear",
        label: game.i18n.localize("TLG.AssignTable.Clear")
      },
      {
        action: "cancel",
        label: game.i18n.localize("TLG.AssignTable.Cancel")
      }
    ]
  }).catch(() => null);

  if (!choice || choice === "cancel") return;

  if (choice === "pick") {
    const tableId = await openTablePicker(current);
    if (tableId === undefined) return; // user cancelled the picker
    if (tableId === "") {
      // user explicitly picked "(none)"
      await actor.unsetFlag(MODULE_ID, FLAGS.TABLE);
      ui.notifications.info(game.i18n.format("TLG.AssignTable.Cleared", { name: actor.name }));
    } else {
      // user picked a table
      await actor.setFlag(MODULE_ID, FLAGS.TABLE, tableId);
      ui.notifications.info(game.i18n.format("TLG.AssignTable.Assigned", { name: actor.name }));
    }
    return;
  }

  if (choice === "create") {
    const table = await createCustomTable(game.i18n.format("TLG.AssignTable.NewTableName", { name: actor.name }));
    await actor.setFlag(MODULE_ID, FLAGS.TABLE, table.id);
    ui.notifications.info(game.i18n.format("TLG.AssignTable.Assigned", { name: actor.name }));
    const manager = new TableManagerApp();
    manager.selectedId = table.id;
    manager.render(true);
    return;
  }

  if (choice === "clear") {
    await actor.unsetFlag(MODULE_ID, FLAGS.TABLE);
    ui.notifications.info(game.i18n.format("TLG.AssignTable.Cleared", { name: actor.name }));
  }
}

/**
 * Resolves the Actor document from an actor-directory `<li>` element,
 * checking both attribute names Foundry has used across versions.
 *
 * @param {HTMLElement} li
 * @returns {Actor|null}
 */
export function resolveActorFromListItem(li) {
  const id = li?.dataset?.entryId ?? li?.dataset?.documentId ?? li?.getAttribute?.("data-entry-id") ?? li?.getAttribute?.("data-document-id");
  if (!id) return null;
  return game.actors.get(id) ?? null;
}
