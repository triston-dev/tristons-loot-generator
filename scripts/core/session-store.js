// SessionStore: persistent distribution sessions in world settings.
//
// IMPORTANT: like table-store.js, this module keeps NO module-level mutable
// caches. Every exported function re-reads `game.settings.get(...)` on each
// call and writes back the whole sessions map. Reads return deep clones so
// callers can freely mutate what they get back without corrupting the store.

import { MODULE_ID, SETTINGS } from "../config.js";

const TERMINAL_STATUSES = ["finalized", "discarded"];
const MAX_HISTORY = 50;

const TRANSITIONS = {
  pending: ["released", "discarded"],
  released: ["finalized", "discarded"],
  finalized: ["released"],
  discarded: []
};

function clone(value) {
  return structuredClone(value);
}

function getSessionsMap() {
  return game.settings.get(MODULE_ID, SETTINGS.SESSIONS) ?? {};
}

async function setSessionsMap(map) {
  await game.settings.set(MODULE_ID, SETTINGS.SESSIONS, map);
}

export function validateTransition(from, to) {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export async function createSession(data = {}) {
  const session = {
    id: foundry.utils.randomID(),
    name: data.name ?? "",
    created: Date.now(),
    status: "pending",
    npcs: clone(data.npcs ?? []),
    items: clone(data.items ?? []),
    currency: clone(data.currency ?? {}),
    currencyAllocation: null,
    createdItemIds: clone(data.createdItemIds ?? []),
    currencyGranted: clone(data.currencyGranted ?? {})
  };
  if (data.carriedEnabled !== undefined) session.carriedEnabled = data.carriedEnabled;

  const map = getSessionsMap();
  map[session.id] = session;
  await setSessionsMap(map);
  return clone(session);
}

export function getSession(id) {
  const map = getSessionsMap();
  const session = map[id];
  return session ? clone(session) : null;
}

export function getSessions(statuses) {
  const map = getSessionsMap();
  let sessions = Object.values(map);
  if (statuses) sessions = sessions.filter((s) => statuses.includes(s.status));
  sessions.sort((a, b) => b.created - a.created);
  return clone(sessions);
}

export async function updateSession(id, mutator) {
  const map = getSessionsMap();
  const existing = map[id];
  if (!existing) throw new Error(`TLG.SessionStore.UnknownSession: ${id}`);

  const draft = clone(existing);
  mutator(draft);

  if (!validateTransition(existing.status, draft.status)) {
    throw new Error(`TLG.SessionStore.IllegalTransition: ${existing.status} -> ${draft.status}`);
  }

  map[id] = draft;
  await setSessionsMap(map);
  return clone(draft);
}

export async function releaseSession(id) {
  const map = getSessionsMap();
  const existing = map[id];
  if (!existing) throw new Error(`TLG.SessionStore.UnknownSession: ${id}`);
  if (existing.status !== "pending") {
    throw new Error(`TLG.SessionStore.IllegalTransition: ${existing.status} -> released`);
  }

  return updateSession(id, (draft) => {
    const excludedNpcTokens = new Set(
      draft.npcs.filter((n) => n.included === false).map((n) => n.tokenId)
    );
    draft.items = draft.items.filter((item) => {
      if (excludedNpcTokens.has(item.sourceNpc)) return false;
      if (draft.carriedEnabled === false && item.carried === true) return false;
      return true;
    });
    draft.status = "released";
  });
}

export async function discardSession(id) {
  return updateSession(id, (draft) => { draft.status = "discarded"; });
}

export function resolveCounts(session) {
  const hasCurrency = Object.values(session.currency ?? {}).some((v) => v);
  const total = session.items.length + (hasCurrency ? 1 : 0);
  const resolvedItems = session.items.filter((i) => i.state !== "unclaimed").length;
  const resolved = resolvedItems + (hasCurrency && session.currencyAllocation !== null ? 1 : 0);
  return { resolved, total };
}

export function isFullyResolved(session) {
  const { resolved, total } = resolveCounts(session);
  return resolved === total;
}

export function computeEvenSplit(currency, actorUuids, rng) {
  const allocation = {};
  const remainders = {};
  if (!actorUuids.length) return { allocation, remainders };

  for (const uuid of actorUuids) allocation[uuid] = {};

  for (const [denom, amount] of Object.entries(currency)) {
    const share = Math.floor(amount / actorUuids.length);
    const remainder = amount - share * actorUuids.length;
    for (const uuid of actorUuids) allocation[uuid][denom] = share;

    const luckyIndex = Math.floor(rng() * actorUuids.length);
    const lucky = actorUuids[Math.min(luckyIndex, actorUuids.length - 1)];
    allocation[lucky][denom] += remainder;
    remainders[denom] = lucky;
  }

  return { allocation, remainders };
}

export async function pruneHistory() {
  const map = getSessionsMap();
  const terminal = Object.values(map)
    .filter((s) => TERMINAL_STATUSES.includes(s.status))
    .sort((a, b) => b.created - a.created);

  if (terminal.length <= MAX_HISTORY) return;

  const toDelete = terminal.slice(MAX_HISTORY);
  for (const session of toDelete) delete map[session.id];
  await setSessionsMap(map);
}
