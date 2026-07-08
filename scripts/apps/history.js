// HistoryApp: GM window listing finalized/discarded loot sessions, newest
// first, with a per-actor grant summary and a Revert button on the most
// recent finalized session.
//
// UI-wiring only — every decision (grouping grants, revert eligibility,
// the revert mutation itself) lives in finalizer.js / session-store.js.
// This file reads sessions, renders them, and calls those functions.

import { MODULE_ID } from "../config.js";
import { getSessions } from "../core/session-store.js";
import { groupGrants, revertSession } from "../core/finalizer.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in tests/history-pure.test.js)
// ---------------------------------------------------------------------------

/**
 * Escapes HTML special characters. Pure function, mirrors distribution.js /
 * finalizer.js's escapeHTML.
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
 * Builds one display row per session, newest-first (sessions is assumed
 * already sorted that way by getSessions). Each row carries a per-actor
 * grant summary (items + currency) with names resolved via `resolveName`.
 * `canRevert` is true only for the single most-recent finalized session in
 * the list (mirrors revertSession's own "most recent finalized" guard —
 * this only controls whether the UI *offers* the button; revertSession
 * re-validates independently).
 *
 * @param {object[]} sessions - sessions already filtered to finalized/discarded, newest-first.
 * @param {(actorUuid: string) => string} resolveName
 * @returns {Array<{
 *   id: string, name: string, created: number, status: string, canRevert: boolean,
 *   actors: Array<{ name: string, items: Array<{name:string, qty:number}>, currency: Array<{denom:string, amount:number}> }>
 * }>}
 */
export function buildHistoryRows(sessions, resolveName) {
  let revertAssigned = false;
  const rows = [];

  for (const session of sessions) {
    const canRevert = session.status === "finalized" && !revertAssigned;
    if (session.status === "finalized") revertAssigned = true;

    const { itemGrants, currencyGrants } = groupGrants(session);
    const actorUuids = new Set([...Object.keys(itemGrants), ...Object.keys(currencyGrants)]);

    const actors = [];
    for (const actorUuid of actorUuids) {
      const items = (itemGrants[actorUuid] ?? []).map((g) => ({ name: g.name, qty: g.qty }));
      const currency = Object.entries(currencyGrants[actorUuid] ?? {})
        .filter(([, amount]) => amount)
        .map(([denom, amount]) => ({ denom, amount }));
      if (!items.length && !currency.length) continue;
      actors.push({ name: resolveName(actorUuid), items, currency });
    }

    rows.push({
      id: session.id,
      name: session.name || session.id,
      created: session.created,
      status: session.status,
      canRevert,
      actors
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// HistoryApp
// ---------------------------------------------------------------------------

export class HistoryApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** Singleton — one history window per client. */
  static instance = null;

  /** Focuses the existing window, or renders a new one. */
  static open() {
    if (HistoryApp.instance) {
      HistoryApp.instance.render(true);
      HistoryApp.instance.bringToFront?.();
      return HistoryApp.instance;
    }
    const app = new HistoryApp();
    app.render(true);
    return app;
  }

  static DEFAULT_OPTIONS = {
    id: "tlg-history",
    classes: ["tlg", "tlg-history"],
    window: { title: "TLG.History.Title", icon: "fas fa-clock-rotate-left", resizable: true },
    position: { width: 640, height: 600 },
    actions: {
      revert: HistoryApp.#onRevert
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/history.hbs` }
  };

  constructor(options = {}) {
    super(options);
    HistoryApp.instance = this;
  }

  async close(options) {
    if (HistoryApp.instance === this) HistoryApp.instance = null;
    return super.close(options);
  }

  // ---------------------------------------------------------------------
  // Context preparation
  // ---------------------------------------------------------------------

  async _prepareContext() {
    const sessions = getSessions(["finalized", "discarded"]);
    const nameCache = new Map();

    const resolveName = (uuid) => nameCache.get(uuid) ?? uuid;

    // Pre-resolve names (async) before calling the pure row-builder.
    for (const session of sessions) {
      const { itemGrants, currencyGrants } = groupGrants(session);
      const actorUuids = new Set([...Object.keys(itemGrants), ...Object.keys(currencyGrants)]);
      for (const actorUuid of actorUuids) {
        if (nameCache.has(actorUuid)) continue;
        nameCache.set(actorUuid, await this.#resolveActorName(actorUuid));
      }
    }

    const rows = buildHistoryRows(sessions, resolveName).map((row) => ({
      ...row,
      createdLabel: new Date(row.created).toLocaleString()
    }));

    return { rows, hasRows: rows.length > 0 };
  }

  async #resolveActorName(uuid) {
    try {
      const doc = await fromUuid(uuid);
      return doc?.name ?? uuid;
    } catch {
      return uuid;
    }
  }

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------

  static async #onRevert(_event, target) {
    if (!game.user.isGM) return;
    const sessionId = target.dataset.sessionId;
    if (!sessionId) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("TLG.History.RevertConfirmTitle") },
      content: `<p>${game.i18n.localize("TLG.History.RevertConfirmBody")}</p>`
    });
    if (!confirmed) return;

    await revertSession(sessionId);
    await this.render();
  }
}
