// DistributionApp: the player-facing loot-splitting window. Opens on release
// for every connected client (see syncOpenWindows / main.js), stays open
// live-synced via the `sessions` world setting's onChange re-render.
//
// UI-wiring only — every decision (resolve counts, even split math, intent
// validation) lives in session-store.js / socket-service.js / finalizer.js.
// This file reads the session, renders it, and calls those functions. ALL
// claim-type mutations (claim/unclaim/give/abandon/restore/allocateCurrency)
// go through sendIntent() — including the GM's own clicks, which sendIntent
// routes locally-but-trusted. GM-only, non-intent operations (finalize,
// abandonRemaining's per-item abandon intents are still sendIntent — see
// below) call their functions directly.

import { MODULE_ID } from "../config.js";
import {
  getSession,
  getSessions,
  resolveCounts,
  isFullyResolved,
  computeEvenSplit
} from "../core/session-store.js";
import { sendIntent, isPrimaryGM } from "../core/socket-service.js";
import { finalizeSession } from "../core/finalizer.js";
import { getActivePack } from "../content/index.js";
import { LootReviewApp } from "./loot-review.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in tests/distribution-pure.test.js)
// ---------------------------------------------------------------------------

/**
 * Escapes HTML special characters so untrusted strings (session names, actor
 * names) can be safely interpolated into JS-built HTML. Pure function.
 *
 * @param {string} str
 * @returns {string}
 */
export function escapeHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Builds the "N sp each, M sp over" preview lines for an even split, one per
 * denomination with a non-zero pot amount. Pure — takes the currency pot, the
 * party-character count, and the pack's denomination label list.
 *
 * @param {{[denom:string]: number}} currency
 * @param {number} partyCount
 * @param {Array<{key:string, label:string}>} denominations
 * @param {(key:string, data?:object) => string} [i18n] - defaults to a plain-English builder.
 * @returns {string[]} one formatted line per non-zero denomination
 */
export function buildEvenSplitPreview(currency, partyCount, denominations, i18n = null) {
  if (!partyCount) return [];
  const labelFor = (key) => denominations.find((d) => d.key === key)?.label ?? key;
  const lines = [];
  for (const [denom, amount] of Object.entries(currency ?? {})) {
    if (!amount) continue;
    const share = Math.floor(amount / partyCount);
    const remainder = amount - share * partyCount;
    const label = labelFor(denom);
    if (i18n) {
      lines.push(
        remainder > 0
          ? i18n("TLG.Distribution.SplitPreviewWithRemainder", { share, label, remainder })
          : i18n("TLG.Distribution.SplitPreviewEven", { share, label })
      );
    } else {
      lines.push(remainder > 0 ? `${share} ${label} each, ${remainder} ${label} over` : `${share} ${label} each`);
    }
  }
  return lines;
}

/**
 * Builds the choice list for a claim/give picker DialogV2: one entry per
 * candidate party character. Pure — takes the pre-resolved party character
 * list (already {uuid,name,img,ownerUserIds}) and an optional filter of
 * uuids owned by the current user (used by "Claim" to restrict to own chars).
 *
 * @param {{uuid:string, name:string, img:string, ownerUserIds:string[]}[]} characters
 * @param {string[]|null} restrictToUuids - if provided, only these uuids are included.
 * @returns {{uuid:string, name:string, img:string}[]}
 */
export function buildClaimChoices(characters, restrictToUuids = null) {
  const pool = restrictToUuids ? characters.filter((c) => restrictToUuids.includes(c.uuid)) : characters;
  return pool.map((c) => ({ uuid: c.uuid, name: c.name, img: c.img }));
}

/**
 * Validates a manually-entered currency allocation client-side before
 * sending the intent: every denomination's sum across all rows must equal
 * the pot exactly, and every entered value must be a non-negative integer.
 * Pure. Mirrors validateAllocateCurrency in socket-service.js so the UI can
 * short-circuit with an inline error instead of round-tripping a rejection.
 *
 * @param {{[actorUuid:string]: {[denom:string]: number}}} allocation
 * @param {{[denom:string]: number}} pot
 * @returns {{ok:true} | {ok:false, denom?:string}}
 */
export function validateManualAllocation(allocation, pot) {
  const denoms = new Set(Object.keys(pot ?? {}));
  for (const shares of Object.values(allocation ?? {})) {
    for (const denom of Object.keys(shares ?? {})) denoms.add(denom);
  }
  for (const shares of Object.values(allocation ?? {})) {
    for (const v of Object.values(shares ?? {})) {
      if (!Number.isInteger(v) || v < 0) return { ok: false };
    }
  }
  for (const denom of denoms) {
    const potAmount = pot?.[denom] ?? 0;
    let sum = 0;
    for (const shares of Object.values(allocation ?? {})) sum += shares?.[denom] ?? 0;
    if (sum !== potAmount) return { ok: false, denom };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// partyCharacters: shared by DistributionApp and main.js's chat-card/ready flows.
// ---------------------------------------------------------------------------

/**
 * Party characters = actors of type "character" with a player owner.
 * @returns {{uuid:string, name:string, img:string, ownerUserIds:string[]}[]}
 */
export function partyCharacters() {
  return game.actors
    .filter((a) => a.type === "character" && a.hasPlayerOwner)
    .map((a) => ({
      uuid: a.uuid,
      name: a.name,
      img: a.img,
      ownerUserIds: game.users
        .filter((u) => !u.isGM && a.testUserPermission(u, "OWNER"))
        .map((u) => u.id)
    }));
}

// ---------------------------------------------------------------------------
// syncOpenWindows: called from the `sessions` setting's onChange (main.js).
// ---------------------------------------------------------------------------

/**
 * Tracks the last-seen status per sessionId across setting changes, so we
 * only auto-open on the TRANSITION into "released" (not on every re-render
 * of an already-released session) and only post the release chat card once
 * per transition. Module-level by design — one client, one truth of "what
 * did I last see" independent of which windows happen to be open.
 */
export const lastKnownStatus = new Map();

export async function syncOpenWindows() {
  const sessions = getSessions();
  const seenIds = new Set();

  for (const session of sessions) {
    seenIds.add(session.id);
    const previousStatus = lastKnownStatus.get(session.id);
    const transitionedToReleased = session.status === "released" && previousStatus !== "released";

    // Update BEFORE opening/posting so a re-entrant render triggered by our
    // own open()/render() can never re-detect the same transition (no loop).
    lastKnownStatus.set(session.id, session.status);

    if (session.status === "released") {
      if (transitionedToReleased) {
        DistributionApp.open(session.id);
        if (isPrimaryGM()) await postReleaseChatCard(session);
      } else if (DistributionApp.instances.has(session.id)) {
        DistributionApp.instances.get(session.id).render();
      }
    } else if (session.status === "finalized" || session.status === "discarded") {
      DistributionApp.instances.get(session.id)?.close();
    }

    LootReviewApp.instances.get(session.id)?.render();
  }

  // Sessions no longer present in the store at all (pruned by history cap):
  // close and forget any lingering window/tracking entry.
  for (const id of Array.from(lastKnownStatus.keys())) {
    if (!seenIds.has(id)) {
      lastKnownStatus.delete(id);
      DistributionApp.instances.get(id)?.close();
      LootReviewApp.instances.get(id)?.close();
    }
  }
}

async function postReleaseChatCard(session) {
  const name = escapeHTML(session.name || game.i18n.localize("TLG.Distribution.UnnamedSession"));
  const content = `<div class="tlg-release-card">
    <p>${game.i18n.format("TLG.Distribution.ReleaseCardBody", { name })}</p>
    <button type="button" data-tlg-open="${session.id}">${game.i18n.localize("TLG.Distribution.ReleaseCardOpen")}</button>
  </div>`;
  await ChatMessage.create({ content });
}

// ---------------------------------------------------------------------------
// DistributionApp
// ---------------------------------------------------------------------------

export class DistributionApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** sessionId -> DistributionApp instance. */
  static instances = new Map();

  /** Focuses an existing window for sessionId, or renders a new one. */
  static open(sessionId) {
    const existing = DistributionApp.instances.get(sessionId);
    if (existing) {
      existing.render(true);
      existing.bringToFront?.();
      return existing;
    }
    const app = new DistributionApp({ sessionId });
    app.render(true);
    return app;
  }

  static DEFAULT_OPTIONS = {
    id: "tlg-distribution",
    classes: ["tlg", "tlg-distribution"],
    window: { title: "TLG.Distribution.Title", icon: "fas fa-coins", resizable: true },
    position: { width: 760, height: 640 },
    actions: {
      claim: DistributionApp.#onClaim,
      give: DistributionApp.#onGive,
      unclaim: DistributionApp.#onUnclaim,
      abandon: DistributionApp.#onAbandon,
      restore: DistributionApp.#onRestore,
      splitEvenly: DistributionApp.#onSplitEvenly,
      allocateManually: DistributionApp.#onAllocateManually,
      openItem: DistributionApp.#onOpenItem,
      abandonRemaining: DistributionApp.#onAbandonRemaining,
      finalize: DistributionApp.#onFinalize,
      switchSession: DistributionApp.#onSwitchSession
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/distribution.hbs` }
  };

  /** uuid -> {name, img} resolution cache, rebuilt each render (fromUuid can be slow but is cheap once warm). */
  #nameCache = new Map();

  constructor({ sessionId, ...options } = {}) {
    super(options);
    this.sessionId = sessionId;
    DistributionApp.instances.set(sessionId, this);
  }

  async close(options) {
    DistributionApp.instances.delete(this.sessionId);
    return super.close(options);
  }

  // ---------------------------------------------------------------------
  // Context preparation
  // ---------------------------------------------------------------------

  async _prepareContext() {
    const session = getSession(this.sessionId);
    if (!session) return { missing: true };

    const pack = getActivePack();
    const denominations = pack.currency?.denominations ?? [];
    const party = partyCharacters();

    const currencyRows = denominations
      .map((d) => ({ key: d.key, label: d.label, amount: session.currency?.[d.key] ?? 0 }))
      .filter((r) => r.amount > 0);

    const evenSplitPreview = buildEvenSplitPreview(session.currency ?? {}, party.length, denominations, (k, d) =>
      game.i18n.format(k, d)
    );

    const itemRows = [];
    for (const item of session.items) {
      itemRows.push(await this.#buildItemRow(item, party));
    }

    const { resolved, total } = resolveCounts(session);
    const isGM = Boolean(game.user.isGM);
    const isPrimary = isPrimaryGM();
    const noGM = !game.users.activeGM;

    const myUserId = game.user.id;
    const myCharacters = party.filter((c) => c.ownerUserIds.includes(myUserId));

    const releasedSessions = getSessions(["released"]);
    const showSessionPicker = releasedSessions.length > 1;

    return {
      session,
      currencyRows,
      currencyHasAny: currencyRows.length > 0,
      evenSplitPreview,
      party,
      itemRows,
      resolved,
      total,
      isFullyResolved: isFullyResolved(session),
      isGM,
      isPrimary,
      noGM,
      myCharacters,
      hasMyCharacters: myCharacters.length > 0,
      showSessionPicker,
      releasedSessions: releasedSessions.map((s) => ({ id: s.id, name: s.name || s.id, active: s.id === this.sessionId }))
    };
  }

  async #buildItemRow(item, party) {
    const row = { id: item.id, name: item.name, img: item.img, qty: item.qty, sourceNpc: item.sourceNpc, state: item.state };

    if (item.state === "claimed" && item.claimedBy) {
      row.claimant = await this.#resolveActorDisplay(item.claimedBy, party);
    }

    const myUserId = game.user.id;
    row.isMine = item.state === "claimed" && item.claimedBy
      ? party.some((c) => c.uuid === item.claimedBy && c.ownerUserIds.includes(myUserId))
      : false;

    return row;
  }

  async #resolveActorDisplay(uuid, party) {
    if (this.#nameCache.has(uuid)) return this.#nameCache.get(uuid);
    const fromParty = party.find((c) => c.uuid === uuid);
    let result;
    if (fromParty) {
      result = { uuid, name: fromParty.name, img: fromParty.img };
    } else {
      try {
        const doc = await fromUuid(uuid);
        result = doc ? { uuid, name: doc.name, img: doc.img } : { uuid, name: uuid, img: null };
      } catch {
        result = { uuid, name: uuid, img: null };
      }
    }
    this.#nameCache.set(uuid, result);
    return result;
  }

  // ---------------------------------------------------------------------
  // Actions — player mutations (ALL via sendIntent, no direct updateSession)
  // ---------------------------------------------------------------------

  static async #onClaim(_event, target) {
    const itemId = target.dataset.itemId ?? target.closest("[data-item-id]")?.dataset.itemId;
    if (!itemId) return;

    const party = partyCharacters();
    const myUserId = game.user.id;
    const myCharacters = party.filter((c) => c.ownerUserIds.includes(myUserId));
    if (!myCharacters.length) return;

    let actorUuid;
    if (myCharacters.length === 1) {
      actorUuid = myCharacters[0].uuid;
    } else {
      actorUuid = await openCharacterPickerDialog(buildClaimChoices(myCharacters), "TLG.Distribution.ClaimPickerTitle");
      if (!actorUuid) return;
    }

    await sendIntent("claim", { sessionId: this.sessionId, itemId, actorUuid });
    await this.render();
  }

  static async #onGive(_event, target) {
    const itemId = target.dataset.itemId ?? target.closest("[data-item-id]")?.dataset.itemId;
    if (!itemId) return;

    const party = partyCharacters();
    const actorUuid = await openCharacterPickerDialog(buildClaimChoices(party), "TLG.Distribution.GivePickerTitle");
    if (!actorUuid) return;

    await sendIntent("claim", { sessionId: this.sessionId, itemId, actorUuid });
    await this.render();
  }

  static async #onUnclaim(_event, target) {
    const itemId = target.dataset.itemId ?? target.closest("[data-item-id]")?.dataset.itemId;
    if (!itemId) return;
    await sendIntent("unclaim", { sessionId: this.sessionId, itemId });
    await this.render();
  }

  static async #onAbandon(_event, target) {
    const itemId = target.dataset.itemId ?? target.closest("[data-item-id]")?.dataset.itemId;
    if (!itemId) return;
    await sendIntent("abandon", { sessionId: this.sessionId, itemId });
    await this.render();
  }

  static async #onRestore(_event, target) {
    const itemId = target.dataset.itemId ?? target.closest("[data-item-id]")?.dataset.itemId;
    if (!itemId) return;
    await sendIntent("restore", { sessionId: this.sessionId, itemId });
    await this.render();
  }

  static async #onSplitEvenly(_event, _target) {
    const session = getSession(this.sessionId);
    if (!session) return;
    const party = partyCharacters();
    if (!party.length) return;

    const { allocation, remainders } = computeEvenSplit(session.currency ?? {}, party.map((c) => c.uuid), Math.random);
    await sendIntent("allocateCurrency", { sessionId: this.sessionId, allocation });

    for (const [denom, luckyUuid] of Object.entries(remainders)) {
      const lucky = party.find((c) => c.uuid === luckyUuid);
      if (!lucky) continue;
      await ChatMessage.create({
        content: game.i18n.format("TLG.Distribution.SplitRemainderChat", {
          name: escapeHTML(lucky.name),
          denom: escapeHTML(denom)
        })
      });
    }

    await this.render();
  }

  static async #onAllocateManually(_event, _target) {
    const session = getSession(this.sessionId);
    if (!session) return;
    const pack = getActivePack();
    const denominations = (pack.currency?.denominations ?? []).filter((d) => (session.currency?.[d.key] ?? 0) > 0);
    const party = partyCharacters();
    if (!party.length || !denominations.length) return;

    const allocation = await openManualAllocationDialog(party, denominations, session.currency ?? {});
    if (!allocation) return;

    await sendIntent("allocateCurrency", { sessionId: this.sessionId, allocation });
    await this.render();
  }

  static async #onOpenItem(_event, target) {
    const itemId = target.dataset.itemId ?? target.closest("[data-item-id]")?.dataset.itemId;
    if (!itemId) return;
    const session = getSession(this.sessionId);
    const item = session?.items.find((i) => i.id === itemId);
    if (!item) return;

    if (item.uuid) {
      const doc = await fromUuid(item.uuid).catch(() => null);
      doc?.sheet?.render(true);
      return;
    }

    if (item.itemData) {
      await openItemPreviewDialog(item);
    }
  }

  // ---------------------------------------------------------------------
  // Actions — GM only
  // ---------------------------------------------------------------------

  static async #onAbandonRemaining(_event, _target) {
    if (!game.user.isGM) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("TLG.Distribution.AbandonRemainingConfirmTitle") },
      content: `<p>${game.i18n.localize("TLG.Distribution.AbandonRemainingConfirmBody")}</p>`
    });
    if (!confirmed) return;

    const session = getSession(this.sessionId);
    if (!session) return;
    const unclaimedIds = session.items.filter((i) => i.state === "unclaimed").map((i) => i.id);
    for (const itemId of unclaimedIds) {
      // Sequential await: the queue serializes anyway, but awaiting here
      // keeps this handler's own promise chain honest for tests/callers.
      await sendIntent("abandon", { sessionId: this.sessionId, itemId });
    }
    await this.render();
  }

  static async #onFinalize(_event, _target) {
    if (!game.user.isGM) return;
    const session = getSession(this.sessionId);
    if (!session) return;

    if (!isFullyResolved(session)) {
      const { resolved, total } = resolveCounts(session);
      ui.notifications.info(game.i18n.format("TLG.Distribution.FinalizeNotResolved", { resolved, total }));
      return;
    }

    await finalizeSession(this.sessionId);
  }

  static async #onSwitchSession(_event, target) {
    const sessionId = target.dataset.sessionId;
    if (!sessionId || sessionId === this.sessionId) return;
    // Re-key this instance in the singleton map so DistributionApp.open()
    // and syncOpenWindows() find it under its new sessionId.
    DistributionApp.instances.delete(this.sessionId);
    this.sessionId = sessionId;
    DistributionApp.instances.set(this.sessionId, this);
    await this.render();
  }
}

// ---------------------------------------------------------------------------
// Dialog helpers (DialogV2, mirroring loot-review.js / table-manager.js style)
// ---------------------------------------------------------------------------

async function openCharacterPickerDialog(choices, titleKey) {
  if (!choices.length) return null;
  const content = `<div class="tlg-char-picker">
    ${choices
      .map(
        (c) => `<label class="tlg-char-picker-row">
          <input type="radio" name="actorUuid" value="${escapeHTML(c.uuid)}">
          ${c.img ? `<img src="${escapeHTML(c.img)}" alt="">` : ""}
          <span>${escapeHTML(c.name)}</span>
        </label>`
      )
      .join("")}
  </div>`;

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize(titleKey) },
    content,
    buttons: [
      {
        action: "ok",
        label: game.i18n.localize("TLG.Distribution.PickerConfirm"),
        default: true,
        callback: (_ev, button) => new foundry.applications.ux.FormDataExtended(button.form).object.actorUuid
      },
      { action: "cancel", label: game.i18n.localize("TLG.Distribution.Cancel") }
    ]
  }).catch(() => null);

  return result || null;
}

async function openManualAllocationDialog(party, denominations, pot) {
  let error = "";

  function renderContent() {
    const rows = party
      .map(
        (c) => `<tr data-actor-uuid="${escapeHTML(c.uuid)}">
          <td>${escapeHTML(c.name)}</td>
          ${denominations
            .map(
              (d) =>
                `<td><input type="number" min="0" step="1" class="tlg-alloc-input" data-denom="${d.key}" value="0"></td>`
            )
            .join("")}
        </tr>`
      )
      .join("");

    return `<div class="tlg-manual-allocation">
      ${error ? `<p class="tlg-alloc-error">${escapeHTML(error)}</p>` : ""}
      <table class="tlg-alloc-table">
        <thead><tr><th></th>${denominations.map((d) => `<th>${escapeHTML(d.label)}</th>`).join("")}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  function readAllocation(root) {
    const allocation = {};
    root.querySelectorAll("tr[data-actor-uuid]").forEach((row) => {
      const uuid = row.dataset.actorUuid;
      allocation[uuid] = {};
      row.querySelectorAll(".tlg-alloc-input").forEach((input) => {
        allocation[uuid][input.dataset.denom] = Math.max(0, Math.floor(Number(input.value) || 0));
      });
    });
    return allocation;
  }

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize("TLG.Distribution.ManualAllocationTitle") },
    content: renderContent(),
    buttons: [
      {
        action: "ok",
        label: game.i18n.localize("TLG.Distribution.PickerConfirm"),
        default: true,
        callback: (_ev, button) => readAllocation(button.form)
      },
      { action: "cancel", label: game.i18n.localize("TLG.Distribution.Cancel") }
    ],
    render: (_event, dialog) => {
      const root = dialog.element;
      const submitBtn = root.querySelector('[data-action="ok"]');
      submitBtn?.addEventListener("click", (ev) => {
        const allocation = readAllocation(root);
        const check = validateManualAllocation(allocation, pot);
        if (!check.ok) {
          ev.preventDefault();
          ev.stopPropagation();
          error = check.denom
            ? game.i18n.format("TLG.Distribution.ManualAllocationMismatch", { denom: check.denom })
            : game.i18n.localize("TLG.Distribution.ManualAllocationInvalid");
          const container = root.querySelector(".tlg-manual-allocation");
          if (container) container.outerHTML = renderContent();
        }
      });
    }
  }).catch(() => null);

  if (!result) return null;
  const check = validateManualAllocation(result, pot);
  if (!check.ok) return null;
  return result;
}

async function openItemPreviewDialog(item) {
  const name = escapeHTML(item.name);
  const img = item.img ? escapeHTML(item.img) : "";
  const description = escapeHTML(item.itemData?.system?.description?.value ?? "");
  const content = `<div class="tlg-item-preview">
    ${img ? `<img src="${img}" alt="">` : ""}
    <h3>${name}</h3>
    ${description ? `<div class="tlg-item-preview-desc">${description}</div>` : ""}
  </div>`;

  await foundry.applications.api.DialogV2.wait({
    window: { title: item.name },
    content,
    buttons: [{ action: "close", label: game.i18n.localize("TLG.Distribution.Close") }]
  }).catch(() => null);
}
