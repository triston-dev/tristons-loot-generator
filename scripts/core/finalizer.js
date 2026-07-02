// Finalizer: turns a resolved (isFullyResolved) released session into actual
// items/currency on player characters, posts a chat summary, and supports
// reverting the most recent finalized session back to "released".
//
// Architecture rule (matches encounter-service.js / socket-service.js):
// ALL branching/decision logic lives in the PURE exported functions
// (groupGrants, buildSummaryHTML, buildRevertPlan) so it gets isolated unit
// coverage with plain objects and no Foundry globals. The document-facing
// wrappers (finalizeSession, revertSession) are intentionally thin — they
// gather Foundry documents, delegate to the pure functions for every
// decision, and are not unit-tested here (live-verified in Task 14).

import { MODULE_ID, SETTINGS } from "../config.js";
import { getSession, getSessions, updateSession, isFullyResolved, pruneHistory } from "./session-store.js";
import { getActivePack } from "../content/index.js";
import { isPrimaryGM } from "./socket-service.js";

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Groups a session's claimed items and allocated currency by recipient actor.
 *
 * @param {object} session
 * @returns {{
 *   itemGrants: {[actorUuid: string]: Array<{name:string, qty:number, uuid?:string,
 *     itemData?:object, carried:boolean, sourceTokenUuid?:string, sessionItemId:string}>},
 *   currencyGrants: {[actorUuid: string]: {[denom:string]: number}}
 * }}
 */
export function groupGrants(session) {
  const itemGrants = {};

  for (const item of session.items ?? []) {
    if (item.state !== "claimed" || !item.claimedBy) continue;

    const grant = {
      name: item.name,
      qty: item.qty,
      carried: Boolean(item.carried),
      sessionItemId: item.id,
      ...(item.uuid !== undefined ? { uuid: item.uuid } : {}),
      ...(item.itemData !== undefined ? { itemData: item.itemData } : {}),
      ...(item.sourceTokenUuid !== undefined ? { sourceTokenUuid: item.sourceTokenUuid } : {})
    };

    (itemGrants[item.claimedBy] ??= []).push(grant);
  }

  const currencyGrants = {};
  if (session.currencyAllocation) {
    for (const [actorUuid, shares] of Object.entries(session.currencyAllocation)) {
      const hasNonZero = Object.values(shares ?? {}).some((v) => v);
      if (!hasNonZero) continue;
      currencyGrants[actorUuid] = { ...shares };
    }
  }

  return { itemGrants, currencyGrants };
}

/**
 * Builds the HTML content for the finalize summary chat card.
 *
 * @param {object} session
 * @param {{itemGrants: object, currencyGrants: object}} grants
 * @param {{[actorUuid:string]: string}} actorNames - display names, injected for purity.
 * @param {(key: string) => string} [i18n] - defaults to identity (returns the key).
 * @returns {string}
 */
export function buildSummaryHTML(session, grants, actorNames = {}, i18n = (k) => k) {
  const { itemGrants, currencyGrants } = grants;
  const actorUuids = new Set([...Object.keys(itemGrants), ...Object.keys(currencyGrants)]);

  const parts = [];
  parts.push(`<div class="tlg-summary">`);
  parts.push(`<h3>${i18n("TLG.Summary.Title")}</h3>`);

  if (actorUuids.size === 0) {
    parts.push(`<p>${i18n("TLG.Summary.Nothing")}</p>`);
  }

  for (const actorUuid of actorUuids) {
    const name = actorNames[actorUuid] ?? actorUuid;
    parts.push(`<div class="tlg-summary-actor">`);
    parts.push(`<strong>${name}</strong>`);

    const items = itemGrants[actorUuid] ?? [];
    if (items.length) {
      parts.push("<ul>");
      for (const grant of items) {
        parts.push(`<li>${grant.name} ×${grant.qty}</li>`);
      }
      parts.push("</ul>");
    }

    const currency = currencyGrants[actorUuid];
    if (currency) {
      const denomParts = Object.entries(currency)
        .filter(([, amount]) => amount)
        .map(([denom, amount]) => `${amount} ${denom}`);
      if (denomParts.length) {
        parts.push(`<p class="tlg-summary-currency">${denomParts.join(", ")}</p>`);
      }
    }

    parts.push("</div>");
  }

  const abandoned = (session.items ?? []).filter((i) => i.state === "abandoned");
  if (abandoned.length) {
    parts.push(`<div class="tlg-summary-abandoned">`);
    parts.push(`<strong>${i18n("TLG.Summary.Abandoned")}</strong>`);
    parts.push("<ul>");
    for (const item of abandoned) {
      parts.push(`<li>${item.name}</li>`);
    }
    parts.push("</ul>");
    parts.push("</div>");
  }

  parts.push(`<button type="button" data-tlg-action="open-history">${i18n("TLG.Summary.OpenHistory")}</button>`);
  parts.push("</div>");

  return parts.join("");
}

/**
 * Builds the plan needed to revert a finalized session: which created items
 * to delete per actor, how much currency to deduct per actor, and which
 * carried items to restore to their source tokens.
 *
 * @param {object} session
 * @returns {{
 *   deletions: {[actorUuid:string]: string[]},
 *   currencyDeductions: {[actorUuid:string]: {[denom:string]: number}},
 *   restorations: Array<{sourceTokenUuid: string, itemData: object}>
 * }}
 */
export function buildRevertPlan(session) {
  const deletions = {};
  const restorations = [];

  for (const entry of session.createdItemIds ?? []) {
    (deletions[entry.actorUuid] ??= []).push(entry.itemId);
    if (entry.carried && entry.sourceTokenUuid && entry.itemData) {
      restorations.push({ sourceTokenUuid: entry.sourceTokenUuid, itemData: entry.itemData });
    }
  }

  const currencyDeductions = {};
  for (const [actorUuid, shares] of Object.entries(session.currencyGranted ?? {})) {
    currencyDeductions[actorUuid] = { ...shares };
  }

  return { deletions, currencyDeductions, restorations };
}

// ---------------------------------------------------------------------------
// Document-facing wrappers (thin — assemble Foundry documents and delegate
// to the pure functions above). Not unit-tested; live-verified in Task 14.
// ---------------------------------------------------------------------------

export async function finalizeSession(sessionId) {
  if (!isPrimaryGM()) return;

  const session = getSession(sessionId);
  if (!session || session.status !== "released" || !isFullyResolved(session)) {
    ui.notifications.warn("TLG.Finalize.NotResolved");
    return;
  }

  const pack = getActivePack();
  const { itemGrants, currencyGrants } = groupGrants(session);

  const createdItemIds = [];
  const failedActors = [];

  for (const [actorUuid, itemList] of Object.entries(itemGrants)) {
    const actor = await fromUuid(actorUuid);
    if (!actor) {
      failedActors.push(actorUuid);
      continue;
    }

    const batch = [];
    const alignedGrants = [];

    for (const grant of itemList) {
      let itemDoc = null;
      if (grant.uuid) {
        const source = await fromUuid(grant.uuid);
        if (!source) {
          console.warn(`TLG | finalize: could not resolve item uuid ${grant.uuid}, skipping`);
          continue;
        }
        itemDoc = source.toObject();
        foundry.utils.setProperty(itemDoc, "system.quantity", grant.qty);
      } else if (grant.itemData) {
        itemDoc = foundry.utils.deepClone(grant.itemData);
        foundry.utils.setProperty(itemDoc, "system.quantity", grant.qty);
      } else {
        console.warn(`TLG | finalize: grant for ${grant.name} has neither uuid nor itemData, skipping`);
        continue;
      }

      batch.push(itemDoc);
      alignedGrants.push(grant);
    }

    if (!batch.length) continue;

    let created;
    try {
      created = await actor.createEmbeddedDocuments("Item", batch);
    } catch (err) {
      console.error(`TLG | finalize: failed creating items on actor ${actorUuid}`, err);
      failedActors.push(actorUuid);
      continue;
    }

    for (let i = 0; i < created.length; i++) {
      const grant = alignedGrants[i];
      const newItem = created[i];
      createdItemIds.push({
        actorUuid,
        itemId: newItem.id,
        sessionItemId: grant.sessionItemId,
        carried: grant.carried,
        ...(grant.sourceTokenUuid !== undefined ? { sourceTokenUuid: grant.sourceTokenUuid } : {}),
        ...(grant.itemData !== undefined ? { itemData: grant.itemData } : {})
      });

      if (grant.carried && grant.sourceTokenUuid && grant.itemData?._id) {
        try {
          const sourceToken = await fromUuid(grant.sourceTokenUuid);
          const sourceItem = sourceToken?.actor?.items?.get(grant.itemData._id);
          await sourceItem?.delete();
        } catch (err) {
          console.warn(`TLG | finalize: could not remove carried source item for ${grant.name}`, err);
        }
      }
    }

    if (currencyGrants[actorUuid]) {
      try {
        const current = foundry.utils.getProperty(actor, pack.currency.path) ?? {};
        const merged = { ...current };
        for (const [denom, amount] of Object.entries(currencyGrants[actorUuid])) {
          merged[denom] = (merged[denom] ?? 0) + amount;
        }
        await actor.update({ [pack.currency.path]: merged });
      } catch (err) {
        console.error(`TLG | finalize: failed updating currency on actor ${actorUuid}`, err);
        failedActors.push(actorUuid);
      }
    }
  }

  // Actors that only have a currency grant (no items) still need it applied.
  for (const [actorUuid, shares] of Object.entries(currencyGrants)) {
    if (itemGrants[actorUuid]) continue; // already handled above
    const actor = await fromUuid(actorUuid);
    if (!actor) {
      failedActors.push(actorUuid);
      continue;
    }
    try {
      const current = foundry.utils.getProperty(actor, pack.currency.path) ?? {};
      const merged = { ...current };
      for (const [denom, amount] of Object.entries(shares)) {
        merged[denom] = (merged[denom] ?? 0) + amount;
      }
      await actor.update({ [pack.currency.path]: merged });
    } catch (err) {
      console.error(`TLG | finalize: failed updating currency on actor ${actorUuid}`, err);
      failedActors.push(actorUuid);
    }
  }

  const updated = await updateSession(sessionId, (draft) => {
    draft.status = "finalized";
    draft.createdItemIds = createdItemIds;
    draft.currencyGranted = currencyGrants;
  });

  if (failedActors.length) {
    ui.notifications.warn(`TLG.Finalize.PartialFailure: ${failedActors.join(", ")}`);
  }

  const actorNames = {};
  for (const actorUuid of new Set([...Object.keys(itemGrants), ...Object.keys(currencyGrants)])) {
    const actor = await fromUuid(actorUuid);
    actorNames[actorUuid] = actor?.name ?? actorUuid;
  }

  const grantsForSummary = { itemGrants, currencyGrants };
  const content = buildSummaryHTML(updated, grantsForSummary, actorNames, (key) => game.i18n.localize(key));

  const chatVis = game.settings.get(MODULE_ID, SETTINGS.CHAT_VIS);
  const messageData = { content };
  if (chatVis === "gm") {
    messageData.whisper = game.users.filter((u) => u.isGM).map((u) => u.id);
  }
  await ChatMessage.create(messageData);

  await pruneHistory();
}

export async function revertSession(sessionId) {
  if (!isPrimaryGM()) return;

  const session = getSession(sessionId);
  if (!session || session.status !== "finalized") {
    ui.notifications.warn("TLG.Revert.NotFinalized");
    return;
  }

  const [mostRecent] = getSessions(["finalized"]);
  if (!mostRecent || mostRecent.id !== sessionId) {
    ui.notifications.warn("TLG.Revert.NotMostRecent");
    return;
  }

  const plan = buildRevertPlan(session);
  const missingItemNames = [];

  for (const [actorUuid, itemIds] of Object.entries(plan.deletions)) {
    const actor = await fromUuid(actorUuid);
    if (!actor) {
      missingItemNames.push(...itemIds);
      continue;
    }
    const existingIds = [];
    for (const itemId of itemIds) {
      if (actor.items.get(itemId)) existingIds.push(itemId);
      else missingItemNames.push(itemId);
    }
    if (existingIds.length) {
      await actor.deleteEmbeddedDocuments("Item", existingIds);
    }
  }

  for (const [actorUuid, deductions] of Object.entries(plan.currencyDeductions)) {
    const actor = await fromUuid(actorUuid);
    if (!actor) continue;
    const pack = getActivePack();
    const current = foundry.utils.getProperty(actor, pack.currency.path) ?? {};
    const merged = { ...current };
    for (const [denom, amount] of Object.entries(deductions)) {
      merged[denom] = Math.max(0, (merged[denom] ?? 0) - amount);
    }
    await actor.update({ [pack.currency.path]: merged });
  }

  for (const restoration of plan.restorations) {
    const sourceToken = await fromUuid(restoration.sourceTokenUuid);
    if (!sourceToken?.actor) continue;
    await sourceToken.actor.createEmbeddedDocuments("Item", [restoration.itemData]);
  }

  await updateSession(sessionId, (draft) => {
    draft.status = "released";
    draft.createdItemIds = [];
    draft.currencyGranted = {};
  });

  if (missingItemNames.length) {
    ui.notifications.warn(`TLG.Revert.MissingItems: ${missingItemNames.join(", ")}`);
  }
  ui.notifications.info("TLG.Revert.Success");
}
