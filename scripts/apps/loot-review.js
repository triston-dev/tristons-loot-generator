// LootReviewApp: GM checkpoint window shown when combat ends (review gate
// on), before loot is released to players.
//
// UI-wiring only — every decision (included/excluded, currency scope, item
// row shapes, reroll swapping) lives in session-store.js / encounter-service
// .js. This file reads the session, renders it, and calls those functions.

import { MODULE_ID } from "../config.js";
import { getSession, updateSession, releaseSession, discardSession, recomputeCurrency } from "../core/session-store.js";
import { rerollNpc as rerollNpcService } from "../core/encounter-service.js";
import { getActivePack } from "../content/index.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

let idCounter = 0;
function nextItemId() {
  idCounter += 1;
  return `item-${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export class LootReviewApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** sessionId -> LootReviewApp instance, so other windows (Task 12's syncOpenWindows) can find/re-render/close this one. */
  static instances = new Map();

  static DEFAULT_OPTIONS = {
    id: "tlg-loot-review",
    classes: ["tlg", "tlg-loot-review"],
    window: { title: "TLG.LootReview.Title", icon: "fas fa-sack-dollar", resizable: true },
    position: { width: 720, height: 640 },
    actions: {
      toggleNpc: LootReviewApp.#onToggleNpc,
      toggleCarried: LootReviewApp.#onToggleCarried,
      rerollNpc: LootReviewApp.#onRerollNpc,
      rerollAll: LootReviewApp.#onRerollAll,
      removeItem: LootReviewApp.#onRemoveItem,
      addItem: LootReviewApp.#onAddItem,
      discard: LootReviewApp.#onDiscard,
      release: LootReviewApp.#onRelease
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/loot-review.hbs` }
  };

  constructor({ sessionId, ...options } = {}) {
    super(options);
    this.sessionId = sessionId;
    LootReviewApp.instances.set(sessionId, this);
  }

  async close(options) {
    LootReviewApp.instances.delete(this.sessionId);
    return super.close(options);
  }

  // ---------------------------------------------------------------------
  // Context preparation
  // ---------------------------------------------------------------------

  async _prepareContext() {
    const session = getSession(this.sessionId);
    if (!session) {
      return { missing: true };
    }

    const pack = getActivePack();
    const denominations = pack.currency?.denominations ?? [];

    const npcs = session.npcs.map((npc) => {
      const items = session.items.filter((i) => i.sourceNpc === npc.tokenId);
      return {
        ...npc,
        generatedChips: items.filter((i) => !i.carried),
        carriedChips: items.filter((i) => i.carried)
      };
    });

    let itemCount = 0;
    for (const npc of npcs) {
      if (npc.included === false) continue;
      itemCount += npc.generatedChips.length + npc.carriedChips.length;
    }

    const currencyRows = denominations.map((d) => ({
      key: d.key,
      label: d.label,
      amount: session.currency?.[d.key] ?? 0
    }));

    return {
      session,
      npcs,
      carriedEnabled: session.carriedEnabled !== false,
      currencyRows,
      itemCount,
      currencyManual: session.currencyManual === true
    };
  }

  // ---------------------------------------------------------------------
  // Rendering hooks
  // ---------------------------------------------------------------------

  _onRender(context, options) {
    super._onRender?.(context, options);

    const form = this.element.querySelector("form");
    if (!form) return;

    form.addEventListener("change", async (event) => {
      const target = event.target;
      if (target.matches(".tlg-chip-qty")) {
        await this.#onEditQty(target);
      } else if (target.matches(".tlg-currency-input")) {
        await this.#onEditCurrency(target);
      }
    });
  }

  async #onEditQty(input) {
    const itemId = input.closest("[data-item-id]")?.dataset.itemId;
    if (!itemId) return;
    let qty = Number(input.value);
    if (!Number.isFinite(qty) || qty < 1) qty = 1;
    qty = Math.floor(qty);

    await updateSession(this.sessionId, (draft) => {
      const item = draft.items.find((i) => i.id === itemId);
      if (item) item.qty = qty;
    });
    await this.render();
  }

  async #onEditCurrency(input) {
    const denom = input.dataset.denom;
    if (!denom) return;
    let amount = Number(input.value);
    if (!Number.isFinite(amount) || amount < 0) amount = 0;
    amount = Math.floor(amount);

    // GM manual edit: mark currencyManual so future include-toggles/rerolls
    // stop recomputing over the GM's explicit values (see session-store.js
    // recomputeCurrency and encounter-service.js applyReroll).
    await updateSession(this.sessionId, (draft) => {
      draft.currency = draft.currency ?? {};
      draft.currency[denom] = amount;
      draft.currencyManual = true;
    });
    await this.render();
  }

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------

  static async #onToggleNpc(_event, target) {
    const tokenId = target.dataset.tokenId;
    const included = target.checked;
    await updateSession(this.sessionId, (draft) => {
      const npc = draft.npcs.find((n) => n.tokenId === tokenId);
      if (npc) npc.included = included;
      if (draft.currencyManual !== true) draft.currency = recomputeCurrency(draft);
    });
    await this.render();
  }

  static async #onToggleCarried(_event, target) {
    const carriedEnabled = target.checked;
    await updateSession(this.sessionId, (draft) => {
      draft.carriedEnabled = carriedEnabled;
    });
    await this.render();
  }

  static async #onRerollNpc(_event, target) {
    const tokenId = target.dataset.tokenId;
    if (!tokenId) return;
    await rerollNpcService(this.sessionId, tokenId);
    await this.render();
  }

  static async #onRerollAll(_event, _target) {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("TLG.LootReview.RerollAllConfirmTitle") },
      content: `<p>${game.i18n.localize("TLG.LootReview.RerollAllConfirmBody")}</p>`
    });
    if (!confirmed) return;

    const session = getSession(this.sessionId);
    if (!session) return;
    const includedTokenIds = session.npcs.filter((n) => n.included).map((n) => n.tokenId);
    for (const tokenId of includedTokenIds) {
      await rerollNpcService(this.sessionId, tokenId);
    }
    await this.render();
  }

  static async #onRemoveItem(_event, target) {
    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    if (!itemId) return;
    await updateSession(this.sessionId, (draft) => {
      draft.items = draft.items.filter((i) => i.id !== itemId);
    });
    await this.render();
  }

  static async #onAddItem(_event, target) {
    const tokenId = target.dataset.tokenId;
    if (!tokenId) return;
    const picked = await openAddItemDialog();
    if (!picked) return;

    await updateSession(this.sessionId, (draft) => {
      const row = { id: nextItemId(), name: picked.name, img: picked.img, qty: 1, sourceNpc: tokenId, state: "unclaimed" };
      if (picked.uuid) row.uuid = picked.uuid;
      draft.items.push(row);
    });
    await this.render();
  }

  static async #onDiscard(_event, _target) {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("TLG.LootReview.DiscardConfirmTitle") },
      content: `<p>${game.i18n.localize("TLG.LootReview.DiscardConfirmBody")}</p>`
    });
    if (!confirmed) return;

    await discardSession(this.sessionId);
    await this.close();
  }

  static async #onRelease(_event, _target) {
    await releaseSession(this.sessionId);
    await this.close();
  }
}

// ---------------------------------------------------------------------------
// Add-item dialog: name search across the active pack's itemPacks indexes +
// a drag-drop zone accepting Item drops. Mirrors table-manager's manual
// DialogV2 wiring style (openRulesEditorDialog).
// ---------------------------------------------------------------------------

async function openAddItemDialog() {
  const pack = getActivePack();
  let picked = null;

  const content = `<div class="tlg-add-item-dialog">
    <input type="text" class="tlg-add-item-search" placeholder="${game.i18n.localize("TLG.LootReview.SearchPlaceholder")}">
    <div class="tlg-add-item-results"></div>
    <div class="tlg-add-item-drop">${game.i18n.localize("TLG.LootReview.DropHint")}</div>
  </div>`;

  await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize("TLG.LootReview.AddItemTitle") },
    content,
    buttons: [{ action: "close", label: game.i18n.localize("TLG.LootReview.Close") }],
    render: (_event, dialog) => {
      const root = dialog.element;
      const searchInput = root.querySelector(".tlg-add-item-search");
      const results = root.querySelector(".tlg-add-item-results");
      const dropZone = root.querySelector(".tlg-add-item-drop");

      results.__matches = [];

      searchInput?.addEventListener("input", async () => {
        const query = searchInput.value.trim().toLowerCase();
        if (!query) {
          results.__matches = [];
          results.innerHTML = "";
          return;
        }
        const matches = await searchItemPacks(query, pack);
        results.__matches = matches;
        results.innerHTML = matches
          .map(
            (m) =>
              `<div class="tlg-add-item-result" data-uuid="${m.uuid}">
                ${m.img ? `<img src="${foundry.utils.escapeHTML(m.img)}" alt="">` : ""}
                <span>${foundry.utils.escapeHTML(m.name)}</span>
              </div>`
          )
          .join("");
      });

      results?.addEventListener("click", (event) => {
        const row = event.target.closest(".tlg-add-item-result");
        if (!row) return;
        const uuid = row.dataset.uuid;
        const match = results.__matches?.find((m) => m.uuid === uuid);
        picked = match ?? { uuid, name: row.textContent.trim() };
        dialog.close();
      });

      if (dropZone) {
        dropZone.addEventListener("dragover", (event) => event.preventDefault());
        dropZone.addEventListener("drop", async (event) => {
          event.preventDefault();
          let data;
          try {
            const TE = foundry.applications.ux.TextEditor.implementation;
            data = TE.getDragEventData(event);
          } catch {
            data = foundry.applications.ux.TextEditor.getDragEventData(event);
          }
          if (data?.type !== "Item" || !data.uuid) return;
          const doc = await fromUuid(data.uuid).catch(() => null);
          picked = { uuid: data.uuid, name: doc?.name ?? data.uuid, img: doc?.img };
          dialog.close();
        });
      }
    }
  }).catch(() => null);

  return picked;
}

/** Name-contains, case-insensitive search across the pack's itemPacks indexes. First 20 results. */
async function searchItemPacks(query, pack) {
  const out = [];
  for (const pid of pack.itemPacks ?? []) {
    const cp = game.packs?.get(pid);
    if (!cp) continue;
    const index = await cp.getIndex();
    for (const entry of index) {
      if (!entry.name?.toLowerCase().includes(query)) continue;
      const uuid = entry.uuid ?? `Compendium.${pid}.Item.${entry._id}`;
      out.push({ uuid, name: entry.name, img: entry.img });
      if (out.length >= 20) return out;
    }
  }
  return out;
}
