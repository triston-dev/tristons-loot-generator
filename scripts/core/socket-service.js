// SocketService: the GM-authority relay through which all player mutations
// to a released session flow.
//
// Architecture: `validateIntent` is PURE (no Foundry globals, no mutation of
// its inputs) so every rule gets isolated unit coverage. Everything else here
// is a thin Foundry-facing wrapper that gathers context (session, requesting
// user, party uuids) and delegates to it.
//
// The `queue` module-level variable is the ONE permitted mutable module
// state (per task contract). It exists because intents arrive as
// independent async socket events, but Foundry world-setting writes
// (`updateSession`) are read-modify-write and NOT atomic across concurrent
// callers — two intents racing on the same session could both read the old
// value and clobber each other. Chaining `queue = queue.then(work)` forces
// GM-side processing to run strictly one-at-a-time in arrival order, which
// is what makes "conflicts resolve by arrival order at the GM client" (spec)
// true. `_resetQueue()` is exported only so tests can start from a clean
// queue; it is not meant for production call sites.

import { MODULE_ID, SOCKET_NAME } from "../config.js";
import { getSession, updateSession } from "./session-store.js";

let queue = Promise.resolve();

export function _resetQueue() {
  queue = Promise.resolve();
}

/**
 * Test/diagnostic helper: returns a promise that resolves once every intent
 * enqueued so far has finished processing (success or failure). Production
 * code never needs to await this — the queue drains itself — but tests that
 * fire socket events synchronously need a deterministic point to assert
 * from.
 */
export function _flushQueue() {
  return queue;
}

export function isPrimaryGM() {
  return game.users.activeGM?.id === game.user.id;
}

/**
 * PURE. No Foundry globals, no mutation of session/user/payload.
 *
 * @param {string} action
 * @param {object} payload
 * @param {object|null} session
 * @param {{id: string, isGM: boolean, ownedActorUuids: string[]}} user
 * @param {string[]} partyUuids
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function validateIntent(action, payload, session, user, partyUuids) {
  if (!session || session.status !== "released") {
    return { ok: false, reason: "TLG.Intent.SessionNotReleased" };
  }

  switch (action) {
    case "claim":
      return validateClaim(payload, session, user, partyUuids);
    case "unclaim":
      return validateUnclaim(payload, session, user);
    case "abandon":
      return validateAbandon(payload, session, user);
    case "restore":
      return validateRestore(payload, session);
    case "allocateCurrency":
      return validateAllocateCurrency(payload, session, partyUuids);
    default:
      return { ok: false, reason: "TLG.Intent.UnknownAction" };
  }
}

function findItem(session, itemId) {
  return session.items.find((i) => i.id === itemId) ?? null;
}

function ownsClaimant(user, item) {
  return Boolean(item.claimedBy) && user.ownedActorUuids.includes(item.claimedBy);
}

function validateClaim(payload, session, user, partyUuids) {
  const { itemId, actorUuid } = payload;
  const item = findItem(session, itemId);
  if (!item) return { ok: false, reason: "TLG.Intent.ItemNotFound" };
  if (!partyUuids.includes(actorUuid)) return { ok: false, reason: "TLG.Intent.ActorNotInParty" };

  if (item.state === "unclaimed") return { ok: true };
  if (item.state === "claimed" && (user.isGM || ownsClaimant(user, item))) return { ok: true };
  return { ok: false, reason: "TLG.Intent.ItemNotClaimable" };
}

function validateUnclaim(payload, session, user) {
  const item = findItem(session, payload.itemId);
  if (!item) return { ok: false, reason: "TLG.Intent.ItemNotFound" };
  if (item.state === "claimed" && (user.isGM || ownsClaimant(user, item))) return { ok: true };
  return { ok: false, reason: "TLG.Intent.ItemNotUnclaimable" };
}

function validateAbandon(payload, session, user) {
  const item = findItem(session, payload.itemId);
  if (!item) return { ok: false, reason: "TLG.Intent.ItemNotFound" };
  if (item.state === "unclaimed") return { ok: true };
  if (item.state === "claimed" && (user.isGM || ownsClaimant(user, item))) return { ok: true };
  return { ok: false, reason: "TLG.Intent.ItemNotAbandonable" };
}

function validateRestore(payload, session) {
  const item = findItem(session, payload.itemId);
  if (!item) return { ok: false, reason: "TLG.Intent.ItemNotFound" };
  if (item.state === "abandoned") return { ok: true };
  return { ok: false, reason: "TLG.Intent.ItemNotRestorable" };
}

function validateAllocateCurrency(payload, session, partyUuids) {
  const allocation = payload.allocation ?? {};
  const uuids = Object.keys(allocation);
  if (!uuids.every((uuid) => partyUuids.includes(uuid))) {
    return { ok: false, reason: "TLG.Intent.AllocationActorNotInParty" };
  }

  for (const shares of Object.values(allocation)) {
    for (const v of Object.values(shares)) {
      if (!Number.isInteger(v) || v < 0) {
        return { ok: false, reason: "TLG.Intent.BadAllocation" };
      }
    }
  }

  const denoms = new Set(Object.keys(session.currency ?? {}));
  for (const shares of Object.values(allocation)) {
    for (const denom of Object.keys(shares)) denoms.add(denom);
  }

  for (const denom of denoms) {
    const pot = session.currency?.[denom] ?? 0;
    let sum = 0;
    for (const shares of Object.values(allocation)) sum += shares[denom] ?? 0;
    if (sum !== pot) return { ok: false, reason: "TLG.Intent.AllocationMismatch" };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Mutators — applied inside session-store's updateSession(id, mutator).
// ---------------------------------------------------------------------------

function applyMutation(action, payload, draft) {
  switch (action) {
    case "claim": {
      const item = draft.items.find((i) => i.id === payload.itemId);
      item.state = "claimed";
      item.claimedBy = payload.actorUuid;
      break;
    }
    case "unclaim": {
      const item = draft.items.find((i) => i.id === payload.itemId);
      item.state = "unclaimed";
      delete item.claimedBy;
      break;
    }
    case "abandon": {
      const item = draft.items.find((i) => i.id === payload.itemId);
      item.state = "abandoned";
      delete item.claimedBy;
      break;
    }
    case "restore": {
      const item = draft.items.find((i) => i.id === payload.itemId);
      item.state = "unclaimed";
      break;
    }
    case "allocateCurrency": {
      draft.currencyAllocation = payload.allocation;
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Foundry-facing wrappers (not unit-tested in isolation from the shim).
// ---------------------------------------------------------------------------

function getPartyUuids() {
  return game.actors
    .filter((a) => a.type === "character" && a.hasPlayerOwner)
    .map((a) => a.uuid);
}

// SECURITY: `trusted` must be `true` ONLY for intents processed via the local
// sendIntent() path (the primary GM's own client, never crossing the wire).
// Foundry module sockets carry no server-verified sender identity — `msg.userId`
// on a socket-delivered intent is entirely attacker-controlled. A malicious
// client could emit `{userId: "<a-real-GM's-id>"}` and, if we trusted it,
// `buildUserContext` would resolve `user.isGM === true` and every authority
// check in validateIntent (claim-steal, unclaim-others, GM-only branches)
// would treat the attacker as the GM. Capping `isGM = false` for anything
// that arrived via socket closes that hole; it is safe because the primary
// GM's own actions never arrive via socket (sendIntent processes them
// locally, `trusted: true`).
//
// Residual risk (accepted, spec-owner ruling): Foundry provides no verified
// sender for module sockets at all — this is the same trust model as the
// socketlib ecosystem. A player who spoofs another PLAYER's userId can still
// claim/unclaim/abandon on that player's behalf within a released session
// (identity spoofing among non-GM players is not mitigated here). Only the
// GM-privilege-escalation vector is closed.
function buildUserContext(userId, trusted) {
  const requester = game.users.get(userId);
  const isGM = trusted && Boolean(requester?.isGM);
  const ownedActorUuids = game.actors
    .filter((a) => a.testUserPermission(requester, "OWNER"))
    .map((a) => a.uuid);
  return { id: userId, isGM, ownedActorUuids };
}

function emitToast(userId, message) {
  // The socket has no loopback — a GM processing their OWN intent locally
  // (sendIntent's trusted path) would never see their own toast if we always
  // emitted. Show it directly instead of round-tripping through the socket.
  if (userId === game.user.id) {
    ui.notifications.warn(message);
    return;
  }
  game.socket.emit(SOCKET_NAME, { type: "toast", userId, message });
}

/**
 * Processes a single intent GM-side. Always resolves (never rejects) so it
 * is safe to chain onto the serialization queue without wedging it: any
 * failure — validation or unexpected throw — is turned into a toast back to
 * the requesting user (or swallowed if we can't even identify who to notify).
 */
async function processIntent({ action, payload, userId }, trusted) {
  try {
    const user = buildUserContext(userId, trusted);
    const session = getSession(payload.sessionId);
    const partyUuids = getPartyUuids();

    const result = validateIntent(action, payload, session, user, partyUuids);
    if (!result.ok) {
      emitToast(userId, result.reason);
      return;
    }

    await updateSession(payload.sessionId, (draft) => applyMutation(action, payload, draft));
  } catch (err) {
    // Defensive: an unexpected throw (e.g. updateSession rejecting) must
    // still surface as a toast and must not propagate out of the queue.
    // Always use the FIXED key here — never the raw err.message, which may
    // leak internal detail to the requesting client. The real error is
    // still logged for the GM operator.
    console.error("TLG | unexpected error processing intent", err);
    emitToast(userId, "TLG.Intent.UnexpectedError");
  }
}

function enqueueIntent(intent, trusted) {
  queue = queue.then(() => processIntent(intent, trusted));
  return queue;
}

export function initSocket() {
  game.socket.on(SOCKET_NAME, (msg) => {
    if (msg?.type === "intent") {
      if (!isPrimaryGM()) return;
      // arrivedViaSocket: never trusted, regardless of msg.userId — see the
      // SECURITY comment on buildUserContext.
      enqueueIntent(msg, false);
      return;
    }
    if (msg?.type === "toast") {
      if (msg.userId === game.user.id) ui.notifications.warn(msg.message);
    }
  });
}

export async function sendIntent(action, payload) {
  if (isPrimaryGM()) {
    // Local path: never crosses the wire, so it is trusted.
    await enqueueIntent({ action, payload, userId: game.user.id }, true);
    return;
  }
  game.socket.emit(SOCKET_NAME, { type: "intent", action, payload, userId: game.user.id });
}
