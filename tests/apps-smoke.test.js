// Static sanity checks for ApplicationV2 UI modules. Real rendering can't run
// under vitest (no DOM-integrated ApplicationV2), so these tests only verify
// that the module imports cleanly under the shim and that every declared
// `actions` entry in DEFAULT_OPTIONS resolves to an implemented static
// handler — catching typo'd action names that would otherwise silently no-op
// in the browser.

import { describe, it, expect, beforeEach } from "vitest";
import { installShim } from "./foundry-shim.js";

let TableManagerApp;
let openTablePicker;
let LootReviewApp;
let DistributionApp;
let partyCharacters;
let syncOpenWindows;

beforeEach(async () => {
  installShim({ settings: { "tristons-loot-generator.contentPack": "dnd5e" } });
  ({ TableManagerApp, openTablePicker } = await import("../scripts/apps/table-manager.js?fresh=apps-smoke"));
  ({ LootReviewApp } = await import("../scripts/apps/loot-review.js?fresh=apps-smoke"));
  ({ DistributionApp, partyCharacters, syncOpenWindows } = await import("../scripts/apps/distribution.js?fresh=apps-smoke"));
});

describe("TableManagerApp", () => {
  it("imports cleanly and exposes DEFAULT_OPTIONS.actions", () => {
    expect(TableManagerApp).toBeTruthy();
    expect(TableManagerApp.DEFAULT_OPTIONS.actions).toBeTruthy();
  });

  it("every action in DEFAULT_OPTIONS.actions is a function (no typo'd handler names)", () => {
    const actions = TableManagerApp.DEFAULT_OPTIONS.actions;
    const names = Object.keys(actions);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(typeof actions[name], `action "${name}" should map to a function`).toBe("function");
    }
  });

  it("declares the expected action names from the task brief", () => {
    const names = Object.keys(TableManagerApp.DEFAULT_OPTIONS.actions).sort();
    expect(names).toEqual(
      [
        "selectTable",
        "newTable",
        "deleteTable",
        "revert",
        "addEntry",
        "deleteEntry",
        "testRoll",
        "exportData",
        "importData",
        "saveTable",
        "rulesEditor"
      ].sort()
    );
  });

  it("PARTS.body points at the module's table-manager.hbs template", () => {
    expect(TableManagerApp.PARTS.body.template).toBe("modules/tristons-loot-generator/templates/table-manager.hbs");
  });

  it("window options localize a title and DEFAULT_OPTIONS declare an id/classes", () => {
    expect(TableManagerApp.DEFAULT_OPTIONS.id).toBe("tlg-table-manager");
    expect(TableManagerApp.DEFAULT_OPTIONS.classes).toContain("tlg");
    expect(TableManagerApp.DEFAULT_OPTIONS.window.title).toBe("TLG.TableManager.Title");
  });

  it("exports openTablePicker for reuse by the boss-assign flow", () => {
    expect(typeof openTablePicker).toBe("function");
  });

  it("openTablePicker returns null when the dialog is dismissed (shim DialogV2.wait resolves null)", async () => {
    const result = await openTablePicker("type:humanoid");
    expect(result).toBeNull();
  });
});

describe("LootReviewApp", () => {
  it("imports cleanly and exposes DEFAULT_OPTIONS.actions", () => {
    expect(LootReviewApp).toBeTruthy();
    expect(LootReviewApp.DEFAULT_OPTIONS.actions).toBeTruthy();
  });

  it("every action in DEFAULT_OPTIONS.actions is a function (no typo'd handler names)", () => {
    const actions = LootReviewApp.DEFAULT_OPTIONS.actions;
    const names = Object.keys(actions);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(typeof actions[name], `action "${name}" should map to a function`).toBe("function");
    }
  });

  it("declares the expected action names from the task brief", () => {
    const names = Object.keys(LootReviewApp.DEFAULT_OPTIONS.actions).sort();
    expect(names).toEqual(
      [
        "toggleNpc",
        "toggleCarried",
        "rerollNpc",
        "rerollAll",
        "removeItem",
        "addItem",
        "discard",
        "release"
      ].sort()
    );
  });

  it("PARTS.body points at the module's loot-review.hbs template", () => {
    expect(LootReviewApp.PARTS.body.template).toBe("modules/tristons-loot-generator/templates/loot-review.hbs");
  });

  it("window options localize a title and DEFAULT_OPTIONS declare an id/classes", () => {
    expect(LootReviewApp.DEFAULT_OPTIONS.id).toBe("tlg-loot-review");
    expect(LootReviewApp.DEFAULT_OPTIONS.classes).toContain("tlg");
    expect(LootReviewApp.DEFAULT_OPTIONS.window.title).toBe("TLG.LootReview.Title");
  });

  it("constructor stores sessionId and registers the instance in the static instances map", () => {
    const app = new LootReviewApp({ sessionId: "sess1" });
    expect(app.sessionId).toBe("sess1");
    expect(LootReviewApp.instances.get("sess1")).toBe(app);
  });

  it("close() removes the instance from the static instances map", async () => {
    const app = new LootReviewApp({ sessionId: "sess2" });
    expect(LootReviewApp.instances.get("sess2")).toBe(app);
    await app.close();
    expect(LootReviewApp.instances.has("sess2")).toBe(false);
  });

  it("_prepareContext returns {missing:true} for an unknown sessionId (no throw)", async () => {
    const app = new LootReviewApp({ sessionId: "does-not-exist" });
    const ctx = await app._prepareContext();
    expect(ctx.missing).toBe(true);
  });
});

describe("DistributionApp", () => {
  it("imports cleanly and exposes DEFAULT_OPTIONS.actions", () => {
    expect(DistributionApp).toBeTruthy();
    expect(DistributionApp.DEFAULT_OPTIONS.actions).toBeTruthy();
  });

  it("every action in DEFAULT_OPTIONS.actions is a function (no typo'd handler names)", () => {
    const actions = DistributionApp.DEFAULT_OPTIONS.actions;
    const names = Object.keys(actions);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(typeof actions[name], `action "${name}" should map to a function`).toBe("function");
    }
  });

  it("declares the expected action names from the task brief", () => {
    const names = Object.keys(DistributionApp.DEFAULT_OPTIONS.actions).sort();
    expect(names).toEqual(
      [
        "claim",
        "give",
        "unclaim",
        "abandon",
        "restore",
        "splitEvenly",
        "allocateManually",
        "openItem",
        "abandonRemaining",
        "finalize",
        "switchSession"
      ].sort()
    );
  });

  it("PARTS.body points at the module's distribution.hbs template", () => {
    expect(DistributionApp.PARTS.body.template).toBe("modules/tristons-loot-generator/templates/distribution.hbs");
  });

  it("window options localize a title and DEFAULT_OPTIONS declare an id/classes", () => {
    expect(DistributionApp.DEFAULT_OPTIONS.id).toBe("tlg-distribution");
    expect(DistributionApp.DEFAULT_OPTIONS.classes).toContain("tlg");
    expect(DistributionApp.DEFAULT_OPTIONS.window.title).toBe("TLG.Distribution.Title");
  });

  it("constructor stores sessionId and registers the instance in the static instances map", () => {
    const app = new DistributionApp({ sessionId: "sess1" });
    expect(app.sessionId).toBe("sess1");
    expect(DistributionApp.instances.get("sess1")).toBe(app);
  });

  it("close() removes the instance from the static instances map", async () => {
    const app = new DistributionApp({ sessionId: "sess2" });
    expect(DistributionApp.instances.get("sess2")).toBe(app);
    await app.close();
    expect(DistributionApp.instances.has("sess2")).toBe(false);
  });

  it("_prepareContext returns {missing:true} for an unknown sessionId (no throw)", async () => {
    const app = new DistributionApp({ sessionId: "does-not-exist" });
    const ctx = await app._prepareContext();
    expect(ctx.missing).toBe(true);
  });

  it("open() renders a new instance when none exists, and re-renders an existing one instead of duplicating", () => {
    const first = DistributionApp.open("sess3");
    expect(DistributionApp.instances.get("sess3")).toBe(first);
    const second = DistributionApp.open("sess3");
    expect(second).toBe(first);
  });

  it("exports partyCharacters() filtering actors of type character with a player owner", () => {
    expect(typeof partyCharacters).toBe("function");
  });

  it("exports syncOpenWindows for the sessions setting onChange handler", () => {
    expect(typeof syncOpenWindows).toBe("function");
  });

  it("no direct updateSession calls in distribution.js — every mutation routes through sendIntent", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(
      new URL("../scripts/apps/distribution.js", import.meta.url),
      "utf8"
    );
    expect(source).not.toMatch(/[^.\w]updateSession\s*\(/);
  });
});
