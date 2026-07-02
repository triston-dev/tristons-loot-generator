import { describe, it, expect, beforeEach, vi } from "vitest";
import { installShim } from "./foundry-shim.js";
import { SOCKET_NAME } from "../scripts/config.js";

let SVC;
let SS;

beforeEach(async () => {
  installShim();
  SVC = await import("../scripts/core/socket-service.js?fresh=" + Math.random());
  SS = await import("../scripts/core/session-store.js?fresh=" + Math.random());
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides = {}) {
  return {
    id: overrides.id ?? "item1",
    name: "Longsword",
    img: "icons/sword.svg",
    qty: 1,
    sourceNpc: "npc1",
    carried: false,
    state: "unclaimed",
    ...overrides
  };
}

function makeSession(overrides = {}) {
  return {
    id: "sess1",
    name: "Goblin ambush",
    created: Date.now(),
    status: "released",
    npcs: [],
    items: [makeItem()],
    currency: { gp: 10, sp: 5 },
    currencyAllocation: null,
    createdItemIds: [],
    currencyGranted: {},
    ...overrides
  };
}

function makeUser(overrides = {}) {
  return { id: "player1", isGM: false, ownedActorUuids: ["Actor.pc1"], ...overrides };
}

const PARTY_UUIDS = ["Actor.pc1", "Actor.pc2"];

// ---------------------------------------------------------------------------
// isPrimaryGM
// ---------------------------------------------------------------------------

describe("isPrimaryGM", () => {
  it("true when activeGM id matches game.user.id", async () => {
    installShim({
      user: { id: "gm1", isGM: true },
      users: [{ id: "gm1", isGM: true, active: true }]
    });
    const mod = await import("../scripts/core/socket-service.js?fresh=" + Math.random());
    expect(mod.isPrimaryGM()).toBe(true);
  });

  it("false when activeGM id does not match game.user.id", async () => {
    installShim({
      user: { id: "gm2", isGM: true },
      users: [{ id: "gm1", isGM: true, active: true }, { id: "gm2", isGM: true, active: true }],
      activeGMId: "gm1"
    });
    const mod = await import("../scripts/core/socket-service.js?fresh=" + Math.random());
    expect(mod.isPrimaryGM()).toBe(false);
  });

  it("false when there is no activeGM at all", async () => {
    installShim({ user: { id: "player1", isGM: false }, users: [] });
    const mod = await import("../scripts/core/socket-service.js?fresh=" + Math.random());
    expect(mod.isPrimaryGM()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateIntent — pure, exported. Signature per contract:
// validateIntent(action, payload, session, user, partyUuids)
// ---------------------------------------------------------------------------

describe("validateIntent", () => {
  it("fails when session is null", () => {
    const r = SVC.validateIntent("claim", { itemId: "item1", actorUuid: "Actor.pc1" }, null, makeUser(), PARTY_UUIDS);
    expect(r.ok).toBe(false);
    expect(typeof r.reason).toBe("string");
  });

  it("fails when session status is not released (e.g. pending)", () => {
    const session = makeSession({ status: "pending" });
    const r = SVC.validateIntent("claim", { itemId: "item1", actorUuid: "Actor.pc1" }, session, makeUser(), PARTY_UUIDS);
    expect(r.ok).toBe(false);
  });

  it("succeeds validating structurally sound claim on released session", () => {
    const session = makeSession();
    const r = SVC.validateIntent("claim", { itemId: "item1", actorUuid: "Actor.pc1" }, session, makeUser(), PARTY_UUIDS);
    expect(r.ok).toBe(true);
  });

  describe("claim", () => {
    it("ok: item unclaimed, actorUuid in party", () => {
      const session = makeSession({ items: [makeItem({ state: "unclaimed" })] });
      const r = SVC.validateIntent("claim", { itemId: "item1", actorUuid: "Actor.pc1" }, session, makeUser(), PARTY_UUIDS);
      expect(r.ok).toBe(true);
    });

    it("fails: item does not exist", () => {
      const session = makeSession({ items: [makeItem({ id: "item1" })] });
      const r = SVC.validateIntent("claim", { itemId: "nope", actorUuid: "Actor.pc1" }, session, makeUser(), PARTY_UUIDS);
      expect(r.ok).toBe(false);
    });

    it("fails: actorUuid not in partyUuids", () => {
      const session = makeSession({ items: [makeItem({ state: "unclaimed" })] });
      const r = SVC.validateIntent("claim", { itemId: "item1", actorUuid: "Actor.outsider" }, session, makeUser(), PARTY_UUIDS);
      expect(r.ok).toBe(false);
    });

    it("ok: item already claimed by an actor the user owns (move own claim)", () => {
      const session = makeSession({ items: [makeItem({ state: "claimed", claimedBy: "Actor.pc1" })] });
      const user = makeUser({ ownedActorUuids: ["Actor.pc1"] });
      const r = SVC.validateIntent("claim", { itemId: "item1", actorUuid: "Actor.pc2" }, session, user, PARTY_UUIDS);
      expect(r.ok).toBe(true);
    });

    it("fails: item claimed by another user's actor, requester does not own it and is not GM", () => {
      const session = makeSession({ items: [makeItem({ state: "claimed", claimedBy: "Actor.pc2" })] });
      const user = makeUser({ ownedActorUuids: ["Actor.pc1"] });
      const r = SVC.validateIntent("claim", { itemId: "item1", actorUuid: "Actor.pc1" }, session, user, PARTY_UUIDS);
      expect(r.ok).toBe(false);
    });

    it("ok: GM may always claim/steal regardless of ownership", () => {
      const session = makeSession({ items: [makeItem({ state: "claimed", claimedBy: "Actor.pc2" })] });
      const gm = makeUser({ id: "gm1", isGM: true, ownedActorUuids: [] });
      const r = SVC.validateIntent("claim", { itemId: "item1", actorUuid: "Actor.pc1" }, session, gm, PARTY_UUIDS);
      expect(r.ok).toBe(true);
    });
  });

  describe("unclaim", () => {
    it("ok: item claimed, requester owns claimedBy actor", () => {
      const session = makeSession({ items: [makeItem({ state: "claimed", claimedBy: "Actor.pc1" })] });
      const user = makeUser({ ownedActorUuids: ["Actor.pc1"] });
      const r = SVC.validateIntent("unclaim", { itemId: "item1" }, session, user, PARTY_UUIDS);
      expect(r.ok).toBe(true);
    });

    it("ok: GM may unclaim regardless of ownership", () => {
      const session = makeSession({ items: [makeItem({ state: "claimed", claimedBy: "Actor.pc2" })] });
      const gm = makeUser({ id: "gm1", isGM: true, ownedActorUuids: [] });
      const r = SVC.validateIntent("unclaim", { itemId: "item1" }, session, gm, PARTY_UUIDS);
      expect(r.ok).toBe(true);
    });

    it("fails: item is not claimed (already unclaimed)", () => {
      const session = makeSession({ items: [makeItem({ state: "unclaimed" })] });
      const user = makeUser();
      const r = SVC.validateIntent("unclaim", { itemId: "item1" }, session, user, PARTY_UUIDS);
      expect(r.ok).toBe(false);
    });

    it("fails: item claimed by someone else's actor and requester is not GM", () => {
      const session = makeSession({ items: [makeItem({ state: "claimed", claimedBy: "Actor.pc2" })] });
      const user = makeUser({ ownedActorUuids: ["Actor.pc1"] });
      const r = SVC.validateIntent("unclaim", { itemId: "item1" }, session, user, PARTY_UUIDS);
      expect(r.ok).toBe(false);
    });
  });

  describe("abandon", () => {
    it("ok: item unclaimed", () => {
      const session = makeSession({ items: [makeItem({ state: "unclaimed" })] });
      const user = makeUser();
      const r = SVC.validateIntent("abandon", { itemId: "item1" }, session, user, PARTY_UUIDS);
      expect(r.ok).toBe(true);
    });

    it("ok: item claimed, requester owns claimedBy actor", () => {
      const session = makeSession({ items: [makeItem({ state: "claimed", claimedBy: "Actor.pc1" })] });
      const user = makeUser({ ownedActorUuids: ["Actor.pc1"] });
      const r = SVC.validateIntent("abandon", { itemId: "item1" }, session, user, PARTY_UUIDS);
      expect(r.ok).toBe(true);
    });

    it("ok: GM may abandon regardless of ownership", () => {
      const session = makeSession({ items: [makeItem({ state: "claimed", claimedBy: "Actor.pc2" })] });
      const gm = makeUser({ id: "gm1", isGM: true, ownedActorUuids: [] });
      const r = SVC.validateIntent("abandon", { itemId: "item1" }, session, gm, PARTY_UUIDS);
      expect(r.ok).toBe(true);
    });

    it("fails: item claimed by someone else's actor and requester is not GM", () => {
      const session = makeSession({ items: [makeItem({ state: "claimed", claimedBy: "Actor.pc2" })] });
      const user = makeUser({ ownedActorUuids: ["Actor.pc1"] });
      const r = SVC.validateIntent("abandon", { itemId: "item1" }, session, user, PARTY_UUIDS);
      expect(r.ok).toBe(false);
    });

    it("fails: item does not exist", () => {
      const session = makeSession({ items: [] });
      const user = makeUser();
      const r = SVC.validateIntent("abandon", { itemId: "nope" }, session, user, PARTY_UUIDS);
      expect(r.ok).toBe(false);
    });
  });

  describe("restore", () => {
    it("ok: item is abandoned", () => {
      const session = makeSession({ items: [makeItem({ state: "abandoned" })] });
      const user = makeUser();
      const r = SVC.validateIntent("restore", { itemId: "item1" }, session, user, PARTY_UUIDS);
      expect(r.ok).toBe(true);
    });

    it("fails: item is not abandoned (e.g. unclaimed)", () => {
      const session = makeSession({ items: [makeItem({ state: "unclaimed" })] });
      const user = makeUser();
      const r = SVC.validateIntent("restore", { itemId: "item1" }, session, user, PARTY_UUIDS);
      expect(r.ok).toBe(false);
    });
  });

  describe("allocateCurrency", () => {
    it("ok: allocation sums exactly match pot per denom, all uuids in party", () => {
      const session = makeSession({ currency: { gp: 10, sp: 5 } });
      const allocation = {
        "Actor.pc1": { gp: 6, sp: 5 },
        "Actor.pc2": { gp: 4, sp: 0 }
      };
      const user = makeUser({ isGM: true });
      const r = SVC.validateIntent("allocateCurrency", { allocation }, session, user, PARTY_UUIDS);
      expect(r.ok).toBe(true);
    });

    it("fails: a uuid key is not in partyUuids", () => {
      const session = makeSession({ currency: { gp: 10 } });
      const allocation = {
        "Actor.pc1": { gp: 10 },
        "Actor.outsider": { gp: 0 }
      };
      const r = SVC.validateIntent("allocateCurrency", { allocation }, session, makeUser(), PARTY_UUIDS);
      expect(r.ok).toBe(false);
    });

    it("fails: per-denom sum does not exactly equal session.currency", () => {
      const session = makeSession({ currency: { gp: 10 } });
      const allocation = {
        "Actor.pc1": { gp: 6 },
        "Actor.pc2": { gp: 3 }
      };
      const r = SVC.validateIntent("allocateCurrency", { allocation }, session, makeUser(), PARTY_UUIDS);
      expect(r.ok).toBe(false);
    });

    it("treats missing denom in allocation as 0 and still validates other denoms", () => {
      const session = makeSession({ currency: { gp: 10, sp: 0 } });
      const allocation = {
        "Actor.pc1": { gp: 10 },
        "Actor.pc2": {}
      };
      const r = SVC.validateIntent("allocateCurrency", { allocation }, session, makeUser(), PARTY_UUIDS);
      expect(r.ok).toBe(true);
    });
  });

  describe("unknown action", () => {
    it("fails for an unrecognized action name", () => {
      const session = makeSession();
      const r = SVC.validateIntent("teleport", {}, session, makeUser(), PARTY_UUIDS);
      expect(r.ok).toBe(false);
    });
  });

  it("is pure: does not mutate the session or user objects passed in", () => {
    const session = makeSession({ items: [makeItem({ state: "unclaimed" })] });
    const user = makeUser();
    const sessionCopy = structuredClone(session);
    const userCopy = structuredClone(user);
    SVC.validateIntent("claim", { itemId: "item1", actorUuid: "Actor.pc1" }, session, user, PARTY_UUIDS);
    expect(session).toEqual(sessionCopy);
    expect(user).toEqual(userCopy);
  });

  it("does not reference any Foundry globals (works with globals undefined)", () => {
    const savedGame = globalThis.game;
    const savedUi = globalThis.ui;
    const savedFoundry = globalThis.foundry;
    // @ts-ignore
    globalThis.game = undefined;
    // @ts-ignore
    globalThis.ui = undefined;
    // @ts-ignore
    globalThis.foundry = undefined;
    try {
      const session = makeSession({ items: [makeItem({ state: "unclaimed" })] });
      const r = SVC.validateIntent("claim", { itemId: "item1", actorUuid: "Actor.pc1" }, session, makeUser(), PARTY_UUIDS);
      expect(r.ok).toBe(true);
    } finally {
      globalThis.game = savedGame;
      globalThis.ui = savedUi;
      globalThis.foundry = savedFoundry;
    }
  });
});

// ---------------------------------------------------------------------------
// initSocket / GM-side handler routing + queue serialization
// ---------------------------------------------------------------------------

describe("initSocket routing", () => {
  it("registers a handler on SOCKET_NAME", () => {
    const { socket } = installShim({
      user: { id: "gm1", isGM: true },
      users: [{ id: "gm1", isGM: true, active: true }]
    });
    const spy = vi.spyOn(socket, "on");
    return import("../scripts/core/socket-service.js?fresh=" + Math.random()).then((mod) => {
      mod.initSocket();
      expect(spy).toHaveBeenCalledWith(SOCKET_NAME, expect.any(Function));
    });
  });

  it("non-GM handler shows toast via ui.notifications.warn when userId matches game.user.id", async () => {
    const shim = installShim({
      user: { id: "player1", isGM: false },
      users: [{ id: "gm1", isGM: true, active: true }, { id: "player1", isGM: false, active: true }],
      activeGMId: "gm1"
    });
    const mod = await import("../scripts/core/socket-service.js?fresh=" + Math.random());
    const warnSpy = vi.spyOn(ui.notifications, "warn");
    mod.initSocket();
    shim.socket._trigger(SOCKET_NAME, { type: "toast", userId: "player1", message: "TLG.Toast.Rejected" });
    expect(warnSpy).toHaveBeenCalledWith("TLG.Toast.Rejected");
  });

  it("non-GM handler ignores toast messages addressed to a different user", async () => {
    const shim = installShim({
      user: { id: "player2", isGM: false },
      users: [{ id: "gm1", isGM: true, active: true }],
      activeGMId: "gm1"
    });
    const mod = await import("../scripts/core/socket-service.js?fresh=" + Math.random());
    const warnSpy = vi.spyOn(ui.notifications, "warn");
    mod.initSocket();
    shim.socket._trigger(SOCKET_NAME, { type: "toast", userId: "player1", message: "TLG.Toast.Rejected" });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("non-primary-GM client does not process 'intent' messages", async () => {
    const shim = installShim({
      user: { id: "gm2", isGM: true },
      users: [{ id: "gm1", isGM: true, active: true }, { id: "gm2", isGM: true, active: true }],
      activeGMId: "gm1",
      actors: []
    });
    const mod = await import("../scripts/core/socket-service.js?fresh=" + Math.random());
    mod.initSocket();
    // Should not throw even though session/actor lookups would fail if it tried to process.
    expect(() => shim.socket._trigger(SOCKET_NAME, {
      type: "intent", action: "claim", payload: { itemId: "item1", actorUuid: "Actor.pc1" }, userId: "player1"
    })).not.toThrow();
  });
});

describe("sendIntent", () => {
  it("primary GM processes locally without emitting on the socket", async () => {
    const actorPc1 = { uuid: "Actor.pc1", type: "character", hasPlayerOwner: true, testUserPermission: () => true };
    const shim = installShim({
      user: { id: "gm1", isGM: true },
      users: [{ id: "gm1", isGM: true, active: true }, { id: "player1", isGM: false, active: true }],
      actors: [actorPc1]
    });
    await SS.createSession({});
    const session = await (async () => {
      const s = await SS.createSession({ items: [makeItem({ state: "unclaimed" })] });
      return SS.getSession ? s : s;
    })();
    // Release it so validateIntent accepts.
    await import("../scripts/core/session-store.js?fresh=x").then(() => {});
    const mod = await import("../scripts/core/socket-service.js?fresh=" + Math.random());
    const emitSpy = vi.spyOn(shim.socket, "emit");

    // Build a released session directly through the imported SS to keep store consistent.
    const released = await SS.updateSession(session.id, (draft) => { draft.status = "released"; });

    await mod.sendIntent("claim", { sessionId: released.id, itemId: released.items[0].id, actorUuid: "Actor.pc1" });

    const after = SS.getSession(released.id);
    expect(after.items[0].state).toBe("claimed");
    expect(after.items[0].claimedBy).toBe("Actor.pc1");
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it("non-GM emits an intent message on the socket instead of processing locally", async () => {
    const shim = installShim({
      user: { id: "player1", isGM: false },
      users: [{ id: "gm1", isGM: true, active: true }, { id: "player1", isGM: false, active: true }],
      activeGMId: "gm1"
    });
    const mod = await import("../scripts/core/socket-service.js?fresh=" + Math.random());
    const emitSpy = vi.spyOn(shim.socket, "emit");

    await mod.sendIntent("claim", { sessionId: "sess1", itemId: "item1", actorUuid: "Actor.pc1" });

    expect(emitSpy).toHaveBeenCalledWith(SOCKET_NAME, {
      type: "intent",
      action: "claim",
      payload: { sessionId: "sess1", itemId: "item1", actorUuid: "Actor.pc1" },
      userId: "player1"
    });
  });
});

describe("GM-side intent processing: validation failure emits toast", () => {
  it("emits a toast with the rejection reason when validation fails", async () => {
    const shim = installShim({
      user: { id: "gm1", isGM: true },
      users: [{ id: "gm1", isGM: true, active: true }, { id: "player1", isGM: false, active: true }],
      actors: []
    });
    const mod = await import("../scripts/core/socket-service.js?fresh=" + Math.random());
    const emitSpy = vi.spyOn(shim.socket, "emit");
    mod.initSocket();

    // No session exists with id "missing" -> validateIntent fails.
    shim.socket._trigger(SOCKET_NAME, {
      type: "intent", action: "claim", payload: { sessionId: "missing", itemId: "item1", actorUuid: "Actor.pc1" }, userId: "player1"
    });

    await mod._flushQueue?.();

    expect(emitSpy).toHaveBeenCalled();
    const call = emitSpy.mock.calls.find((c) => c[1]?.type === "toast");
    expect(call[1]).toMatchObject({ type: "toast", userId: "player1" });
    expect(typeof call[1].message).toBe("string");
  });
});

describe("GM-side queue serialization", () => {
  it("two racing claims on the same item resolve to exactly one success and one toast, in arrival order", async () => {
    const actorPc1 = { uuid: "Actor.pc1", type: "character", hasPlayerOwner: true, testUserPermission: (u) => u.id === "player1" };
    const actorPc2 = { uuid: "Actor.pc2", type: "character", hasPlayerOwner: true, testUserPermission: (u) => u.id === "player2" };
    const shim = installShim({
      user: { id: "gm1", isGM: true },
      users: [
        { id: "gm1", isGM: true, active: true },
        { id: "player1", isGM: false, active: true },
        { id: "player2", isGM: false, active: true }
      ],
      actors: [actorPc1, actorPc2]
    });

    const created = await SS.createSession({ items: [makeItem({ state: "unclaimed" })] });
    await SS.updateSession(created.id, (draft) => { draft.status = "released"; });

    const mod = await import("../scripts/core/socket-service.js?fresh=" + Math.random());
    mod._resetQueue?.();
    mod.initSocket();

    const emitSpy = vi.spyOn(shim.socket, "emit");

    // Fire two racing claims for different actors on the same item "at once".
    shim.socket._trigger(SOCKET_NAME, {
      type: "intent", action: "claim", payload: { sessionId: created.id, itemId: "item1", actorUuid: "Actor.pc1" }, userId: "player1"
    });
    shim.socket._trigger(SOCKET_NAME, {
      type: "intent", action: "claim", payload: { sessionId: created.id, itemId: "item1", actorUuid: "Actor.pc2" }, userId: "player2"
    });

    await mod._flushQueue();

    const final = SS.getSession(created.id);
    expect(final.items[0].state).toBe("claimed");
    // Exactly one of the two claims won (first arrival wins since item became non-unclaimed).
    expect(["Actor.pc1", "Actor.pc2"]).toContain(final.items[0].claimedBy);
    expect(final.items[0].claimedBy).toBe("Actor.pc1");

    const toastCalls = emitSpy.mock.calls.filter((c) => c[1]?.type === "toast");
    expect(toastCalls.length).toBe(1);
    expect(toastCalls[0][1].userId).toBe("player2");
  });

  it("a throwing/rejecting intent does not wedge the queue for subsequent intents", async () => {
    const actorPc1 = { uuid: "Actor.pc1", type: "character", hasPlayerOwner: true, testUserPermission: () => true };
    const shim = installShim({
      user: { id: "gm1", isGM: true },
      users: [{ id: "gm1", isGM: true, active: true }, { id: "player1", isGM: false, active: true }],
      actors: [actorPc1]
    });

    const created = await SS.createSession({ items: [makeItem({ state: "unclaimed" })] });
    await SS.updateSession(created.id, (draft) => { draft.status = "released"; });

    const mod = await import("../scripts/core/socket-service.js?fresh=" + Math.random());
    mod._resetQueue?.();
    mod.initSocket();

    // First intent references a session that doesn't exist -> GM-side lookup / validateIntent
    // fails gracefully (toast), it must not throw synchronously nor wedge the queue.
    shim.socket._trigger(SOCKET_NAME, {
      type: "intent", action: "claim", payload: { sessionId: "does-not-exist", itemId: "x", actorUuid: "Actor.pc1" }, userId: "player1"
    });
    // Second, valid intent should still succeed afterward.
    shim.socket._trigger(SOCKET_NAME, {
      type: "intent", action: "claim", payload: { sessionId: created.id, itemId: "item1", actorUuid: "Actor.pc1" }, userId: "player1"
    });

    await mod._flushQueue();

    const final = SS.getSession(created.id);
    expect(final.items[0].state).toBe("claimed");
    expect(final.items[0].claimedBy).toBe("Actor.pc1");
  });
});

// ---------------------------------------------------------------------------
// Mutators applied under updateSession for each action (via full round trip)
// ---------------------------------------------------------------------------

describe("mutators applied via GM-side processing", () => {
  function setupGm(actors) {
    return installShim({
      user: { id: "gm1", isGM: true },
      users: [{ id: "gm1", isGM: true, active: true }, { id: "player1", isGM: false, active: true }],
      actors
    });
  }

  it("unclaim: sets state unclaimed and removes claimedBy", async () => {
    const actorPc1 = { uuid: "Actor.pc1", type: "character", hasPlayerOwner: true, testUserPermission: () => true };
    setupGm([actorPc1]);
    const created = await SS.createSession({ items: [makeItem({ state: "claimed", claimedBy: "Actor.pc1" })] });
    await SS.updateSession(created.id, (draft) => { draft.status = "released"; });
    const mod = await import("../scripts/core/socket-service.js?fresh=" + Math.random());

    await mod.sendIntent("unclaim", { sessionId: created.id, itemId: "item1" });

    const after = SS.getSession(created.id);
    expect(after.items[0].state).toBe("unclaimed");
    expect(after.items[0].claimedBy).toBeUndefined();
  });

  it("abandon: sets state abandoned and removes claimedBy", async () => {
    const actorPc1 = { uuid: "Actor.pc1", type: "character", hasPlayerOwner: true, testUserPermission: () => true };
    setupGm([actorPc1]);
    const created = await SS.createSession({ items: [makeItem({ state: "claimed", claimedBy: "Actor.pc1" })] });
    await SS.updateSession(created.id, (draft) => { draft.status = "released"; });
    const mod = await import("../scripts/core/socket-service.js?fresh=" + Math.random());

    await mod.sendIntent("abandon", { sessionId: created.id, itemId: "item1" });

    const after = SS.getSession(created.id);
    expect(after.items[0].state).toBe("abandoned");
    expect(after.items[0].claimedBy).toBeUndefined();
  });

  it("restore: sets state unclaimed", async () => {
    setupGm([]);
    const created = await SS.createSession({ items: [makeItem({ state: "abandoned" })] });
    await SS.updateSession(created.id, (draft) => { draft.status = "released"; });
    const mod = await import("../scripts/core/socket-service.js?fresh=" + Math.random());

    await mod.sendIntent("restore", { sessionId: created.id, itemId: "item1" });

    const after = SS.getSession(created.id);
    expect(after.items[0].state).toBe("unclaimed");
  });

  it("allocateCurrency: sets session.currencyAllocation", async () => {
    const actorPc1 = { uuid: "Actor.pc1", type: "character", hasPlayerOwner: true, testUserPermission: () => true };
    const actorPc2 = { uuid: "Actor.pc2", type: "character", hasPlayerOwner: true, testUserPermission: () => true };
    setupGm([actorPc1, actorPc2]);
    const created = await SS.createSession({ currency: { gp: 10 } });
    await SS.updateSession(created.id, (draft) => { draft.status = "released"; });
    const mod = await import("../scripts/core/socket-service.js?fresh=" + Math.random());

    const allocation = { "Actor.pc1": { gp: 6 }, "Actor.pc2": { gp: 4 } };
    await mod.sendIntent("allocateCurrency", { sessionId: created.id, allocation });

    const after = SS.getSession(created.id);
    expect(after.currencyAllocation).toEqual(allocation);
  });
});
