// EncounterService: combat lifecycle layer. Rolls loot at combat start (and
// for mid-combat additions), captures defeated hostiles into a session when
// combat ends.
//
// Architecture rule: ALL capture/decision logic (included/excluded, currency
// scope, item row shapes) lives in the PURE exported `buildSessionData`,
// unit-testable with plain objects and no Foundry globals. The document-facing
// wrappers below only assemble snapshots from Foundry documents and delegate —
// they are intentionally thin and are not unit-tested here (live-verified in
// Task 14).

import { MODULE_ID, SETTINGS, FLAGS } from "../config.js";
import { matchTable, rollLoot, filterCarriedGear } from "./loot-engine.js";
import { getEffectiveTable, getKeywordRules } from "./table-store.js";
import { getActivePack } from "../content/index.js";
import { resolveRef } from "../content/resolver.js";
import { createSession, releaseSession, recomputeCurrency, getSession, updateSession } from "./session-store.js";
import { isPrimaryGM } from "./socket-service.js";

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `item-${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Pure decision core. No Foundry globals — snapshots and opts are plain data.
 *
 * snapshots: [{ combatantId, tokenId, actorName, img, cr, disposition, hp,
 *   defeatedStatus, rolled: {items, currency, tableSource, tableId}|null,
 *   carriedItems: ItemLike[] }]
 * opts: { hostileDisposition, name, carriedEnabled }
 */
export function buildSessionData(snapshots, opts) {
  const { hostileDisposition, name, carriedEnabled } = opts;

  const npcs = [];
  const items = [];
  const currency = {};

  for (const snap of snapshots) {
    const defeated = Boolean(snap.hp <= 0 || snap.defeatedStatus);
    const included = snap.disposition === hostileDisposition && defeated;
    const npcCurrency = { ...(snap.rolled?.currency ?? {}) };

    npcs.push({
      tokenId: snap.tokenId,
      actorName: snap.actorName,
      img: snap.img,
      cr: snap.cr,
      tableSource: snap.rolled?.tableSource ?? null,
      tableId: snap.rolled?.tableId ?? null,
      included,
      defeated,
      // Per-NPC currency contribution, recorded regardless of `included` so a
      // reroll or an include-toggle can recompute session.currency purely
      // from npcs[] without re-rolling. session.currency itself (below)
      // still only sums INCLUDED rows — see recomputeCurrency in
      // session-store.js, which repeats this exact summing rule.
      npcCurrency
    });

    if (snap.rolled?.items) {
      for (const rolledItem of snap.rolled.items) {
        items.push({
          id: nextId(),
          name: rolledItem.name,
          img: rolledItem.img,
          qty: rolledItem.qty ?? 1,
          sourceNpc: snap.tokenId,
          state: "unclaimed",
          ...(rolledItem.uuid !== undefined ? { uuid: rolledItem.uuid } : {}),
          ...(rolledItem.ref !== undefined ? { ref: rolledItem.ref } : {}),
          ...(rolledItem.itemData !== undefined ? { itemData: rolledItem.itemData } : {})
        });
      }
    }

    for (const carried of snap.carriedItems ?? []) {
      items.push({
        id: nextId(),
        name: carried.itemData?.name,
        img: carried.itemData?.img,
        qty: carried.qty ?? 1,
        sourceNpc: snap.tokenId,
        state: "unclaimed",
        itemData: carried.itemData,
        carried: true,
        sourceTokenUuid: carried.sourceTokenUuid
      });
    }

    if (included && snap.rolled?.currency) {
      for (const [denom, amount] of Object.entries(snap.rolled.currency)) {
        currency[denom] = (currency[denom] ?? 0) + amount;
      }
    }
  }

  return { name, npcs, items, currency, carriedEnabled };
}

/**
 * Pure decision core for a per-NPC reroll (Loot Review's "reroll" / "reroll
 * all" actions). No Foundry globals — session and rolledResult are plain
 * data; rerollNpc() below gathers rolledResult by re-running the engine and
 * delegates every decision here.
 *
 * - Drops the NPC's previous generated (non-carried) item rows and appends
 *   fresh ones built from rolledResult.items. Carried items and every other
 *   NPC's rows are untouched.
 * - Overwrites that NPC's npcs[].npcCurrency with rolledResult.currency
 *   (replaces, does not add to, the previous contribution — see task brief).
 * - Recomputes session.currency from all INCLUDED npc rows via
 *   recomputeCurrency, UNLESS session.currencyManual is true, in which case
 *   the GM's explicit pot edit is left alone (npcCurrency still updates so a
 *   later un-flagged recompute would be accurate).
 * - Unknown tokenId: returns an equivalent (deep-cloned) session unchanged.
 *
 * @param {object} session
 * @param {string} tokenId
 * @param {{items: Array, currency: Object}} rolledResult
 */
export function applyReroll(session, tokenId, rolledResult) {
  const draft = structuredClone(session);
  const npc = draft.npcs.find((n) => n.tokenId === tokenId);
  if (!npc) return draft;

  npc.npcCurrency = { ...(rolledResult.currency ?? {}) };

  draft.items = draft.items.filter((item) => !(item.sourceNpc === tokenId && !item.carried));
  for (const rolledItem of rolledResult.items ?? []) {
    draft.items.push({
      id: nextId(),
      name: rolledItem.name,
      img: rolledItem.img,
      qty: rolledItem.qty ?? 1,
      sourceNpc: tokenId,
      state: "unclaimed",
      ...(rolledItem.uuid !== undefined ? { uuid: rolledItem.uuid } : {}),
      ...(rolledItem.ref !== undefined ? { ref: rolledItem.ref } : {}),
      ...(rolledItem.itemData !== undefined ? { itemData: rolledItem.itemData } : {})
    });
  }

  if (draft.currencyManual !== true) {
    draft.currency = recomputeCurrency(draft);
  }

  return draft;
}

// ---------------------------------------------------------------------------
// Document-facing wrappers (thin — assemble snapshots/ctx from Foundry docs
// and delegate to the pure functions above). Not unit-tested; live-verified
// in Task 14.
// ---------------------------------------------------------------------------

let onCaptured = null;
export function setOnCaptured(fn) {
  onCaptured = fn;
}

export function initEncounterHooks() {
  Hooks.on("combatStart", async (combat) => {
    if (!game.user.isGM) return;
    if (!isPrimaryGM()) return;
    if (!game.settings.get(MODULE_ID, SETTINGS.AUTO_GENERATE)) return;
    if (combat.getFlag(MODULE_ID, FLAGS.SKIP)) return;

    const rolled = {};
    for (const combatant of combat.combatants ?? []) {
      if (combatant.actor?.type !== "npc") continue;
      rolled[combatant.id] = await rollForCombatant(combatant, combat);
    }
    await combat.setFlag(MODULE_ID, FLAGS.ROLLED, rolled);
    await combat.setFlag(MODULE_ID, FLAGS.STARTED, true);
  });

  Hooks.on("createCombatant", async (combatant, _options, _userId) => {
    if (!game.user.isGM) return;
    if (!isPrimaryGM()) return;
    const combat = combatant.parent;
    if (!combat?.started) return;
    if (!combat.getFlag(MODULE_ID, FLAGS.STARTED)) return;
    if (combatant.actor?.type !== "npc") return;

    const rolledLoot = await rollForCombatant(combatant, combat);
    const map = foundry.utils.deepClone(combat.getFlag(MODULE_ID, FLAGS.ROLLED) ?? {});
    map[combatant.id] = rolledLoot;
    await combat.setFlag(MODULE_ID, FLAGS.ROLLED, map);
  });

  Hooks.on("deleteCombat", async (combat) => {
    if (!game.user.isGM) return;
    if (!isPrimaryGM()) return;
    await captureSession(combat);
  });
}

/**
 * Rolls loot for a single NPC combatant and returns RolledLoot:
 * { items, currency, tableSource, tableId, packId }.
 */
export async function rollForCombatant(combatant, _combat) {
  const actor = combatant.actor;
  const pack = getActivePack();

  const matchCtx = {
    name: actor?.name,
    biography: actor?.system?.details?.biography?.value ?? "",
    creatureType: actor?.system?.details?.type?.value,
    cr: actor?.system?.details?.cr ?? 0,
    flagTableId: actor?.getFlag?.(MODULE_ID, FLAGS.TABLE)
  };

  const matchDeps = {
    rules: getKeywordRules(),
    tableExists: (id) => getEffectiveTable(id) !== null,
    creatureTypes: pack.creatureTypes ?? []
  };

  const { tableId, source } = matchTable(matchCtx, matchDeps);

  const result = await rollByTableId(tableId, matchCtx.cr, pack);

  return { items: result.items, currency: result.currency, tableSource: source, tableId, packId: pack.id };
}

/** Shared roll-given-a-resolved-tableId core, reused by rollForCombatant and rerollNpc. */
async function rollByTableId(tableId, cr, pack) {
  const generosity = game.settings.get(MODULE_ID, SETTINGS.GENEROSITY);

  const rollCtx = {
    tableId,
    cr,
    generosity,
    rng: Math.random,
    pack,
    getTable: (id) => getEffectiveTable(id),
    drawRollTable,
    getRarity: (entry) => getRarity(entry, pack)
  };

  return rollLoot(rollCtx);
}

/** Resolves any `ref`-only rolled items to `uuid`, dropping ones that fail to resolve. */
async function resolveRolledItems(items, pack) {
  const resolved = [];
  const unresolved = [];
  for (const item of items ?? []) {
    if (item.uuid || item.itemData) {
      resolved.push(item);
      continue;
    }
    if (item.ref) {
      const uuid = await resolveRef(item.ref, pack);
      if (!uuid) {
        unresolved.push(item.ref?.name ?? item.name ?? "unknown");
        continue;
      }
      resolved.push({ ...item, uuid });
      continue;
    }
    resolved.push(item);
  }
  return { resolved, unresolved };
}

async function drawRollTable(uuid) {
  const table = await fromUuid(uuid);
  if (!table) return [];
  const draw = await table.draw({ displayChat: false });
  const out = [];
  for (const result of draw.results ?? []) {
    if (result.type === CONST.TABLE_RESULT_TYPES.DOCUMENT || result.documentUuid) {
      out.push({ uuid: result.documentUuid ?? result.uuid, qty: 1 });
    }
    // text results are skipped
  }
  return out;
}

async function getRarity(entry, pack) {
  let uuid = entry.uuid;
  if (!uuid && entry.ref) {
    uuid = await resolveRef(entry.ref, pack);
  }
  if (!uuid) return null;
  const doc = await fromUuid(uuid);
  return doc?.system?.rarity ?? null;
}

/**
 * Builds a session from the combat's NPC combatants and creates it via
 * session-store, unless the wrapper-skip condition applies (no includable
 * NPCs AND no items AND no currency).
 */
export async function captureSession(combat) {
  if (!combat.getFlag(MODULE_ID, FLAGS.STARTED)) return null;
  if (combat.getFlag(MODULE_ID, FLAGS.SKIP)) return null;

  const rolledMap = combat.getFlag(MODULE_ID, FLAGS.ROLLED) ?? {};
  const pack = getActivePack();
  const carriedGearOn = game.settings.get(MODULE_ID, SETTINGS.CARRIED_GEAR);

  const unresolvedRefs = [];
  const snapshots = [];

  for (const combatant of combat.combatants ?? []) {
    const actor = combatant.actor;
    if (actor?.type !== "npc") continue;

    const rolled = rolledMap[combatant.id] ?? null;
    let resolvedRolled = rolled;
    if (rolled) {
      const resolvedItems = [];
      for (const item of rolled.items ?? []) {
        if (item.uuid || item.itemData) {
          resolvedItems.push(item);
          continue;
        }
        if (item.ref) {
          const uuid = await resolveRef(item.ref, pack);
          if (!uuid) {
            unresolvedRefs.push(item.ref?.name ?? item.name ?? "unknown");
            continue;
          }
          resolvedItems.push({ ...item, uuid });
          continue;
        }
        resolvedItems.push(item);
      }
      resolvedRolled = { ...rolled, items: resolvedItems };
    }

    let carriedItems = [];
    if (carriedGearOn) {
      const rawItems = (actor.items ?? []).map((i) => i.toObject());
      const filtered = filterCarriedGear(rawItems, pack);
      const sourceTokenUuid = combatant.token?.uuid;
      carriedItems = filtered.map((itemData) => ({ itemData, sourceTokenUuid }));
    }

    snapshots.push({
      combatantId: combatant.id,
      tokenId: combatant.tokenId ?? combatant.token?.id,
      actorName: actor.name,
      img: actor.img,
      cr: actor.system?.details?.cr ?? 0,
      disposition: combatant.token?.disposition,
      hp: actor.system?.attributes?.hp?.value,
      defeatedStatus: combatant.isDefeated ?? combatant.defeated,
      rolled: resolvedRolled,
      carriedItems
    });
  }

  if (unresolvedRefs.length) {
    ui.notifications.warn(`${"TLG"} | unresolved loot refs dropped: ${unresolvedRefs.join(", ")}`);
  }

  const data = buildSessionData(snapshots, {
    hostileDisposition: CONST.TOKEN_DISPOSITIONS.HOSTILE,
    name: combat.scene?.name ?? combat.name ?? "",
    carriedEnabled: carriedGearOn
  });

  const hasIncludableNpc = data.npcs.some((n) => n.included);
  const hasCurrency = Object.values(data.currency).some((v) => v);
  if (!hasIncludableNpc && data.items.length === 0 && !hasCurrency) return null;

  const session = await createSession(data);

  const reviewGateOn = game.settings.get(MODULE_ID, SETTINGS.REVIEW_GATE);
  if (reviewGateOn) {
    onCaptured?.(session);
  } else {
    await releaseSession(session.id);
  }

  return session;
}

/**
 * Loot Review's per-NPC "reroll" action. Re-runs the engine for the NPC at
 * npcs[].tokenId and swaps its generated items + currency contribution in
 * the session (via applyReroll). Table matching:
 *  - If a live token can be found (by scanning the session's own carried
 *    item rows for a matching sourceTokenUuid, since npc rows don't store
 *    one directly), rebuild the full match context from the live actor —
 *    same behavior as combat-start rolling, so keyword rules/overrides that
 *    changed since capture are honored.
 *  - Otherwise (actor/token gone), reuse the npc row's stored `tableId`
 *    directly, skipping matchTable entirely.
 */
export async function rerollNpc(sessionId, tokenId) {
  const session = getSession(sessionId);
  if (!session) return null;
  const npc = session.npcs.find((n) => n.tokenId === tokenId);
  if (!npc) return null;

  const pack = getActivePack();
  let tableId = npc.tableId;
  let cr = npc.cr ?? 0;

  const carriedRow = session.items.find((i) => i.sourceNpc === tokenId && i.carried && i.sourceTokenUuid);
  if (carriedRow) {
    const token = await fromUuid(carriedRow.sourceTokenUuid).catch(() => null);
    const actor = token?.actor;
    if (actor) {
      const matchCtx = {
        name: actor.name,
        biography: actor.system?.details?.biography?.value ?? "",
        creatureType: actor.system?.details?.type?.value,
        cr: actor.system?.details?.cr ?? 0,
        flagTableId: actor.getFlag?.(MODULE_ID, FLAGS.TABLE)
      };
      const matchDeps = {
        rules: getKeywordRules(),
        tableExists: (id) => getEffectiveTable(id) !== null,
        creatureTypes: pack.creatureTypes ?? []
      };
      tableId = matchTable(matchCtx, matchDeps).tableId;
      cr = matchCtx.cr;
    }
  }

  if (!tableId) return null;

  const rawResult = await rollByTableId(tableId, cr, pack);
  const { resolved, unresolved } = await resolveRolledItems(rawResult.items, pack);
  if (unresolved.length) {
    ui.notifications.warn(`${"TLG"} | unresolved loot refs dropped: ${unresolved.join(", ")}`);
  }

  return updateSession(sessionId, (draft) => {
    const rerolled = applyReroll(draft, tokenId, { items: resolved, currency: rawResult.currency });
    draft.npcs = rerolled.npcs;
    draft.items = rerolled.items;
    draft.currency = rerolled.currency;
  });
}

/**
 * Manual trigger: rolls any combatant lacking an entry in the ROLLED map.
 */
export async function generateNow(combat) {
  const map = foundry.utils.deepClone(combat.getFlag(MODULE_ID, FLAGS.ROLLED) ?? {});
  for (const combatant of combat.combatants ?? []) {
    if (combatant.actor?.type !== "npc") continue;
    if (map[combatant.id]) continue;
    map[combatant.id] = await rollForCombatant(combatant, combat);
  }
  await combat.setFlag(MODULE_ID, FLAGS.ROLLED, map);
  await combat.setFlag(MODULE_ID, FLAGS.STARTED, true);
}
