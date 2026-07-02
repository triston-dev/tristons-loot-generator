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

beforeEach(async () => {
  installShim({ settings: { "tristons-loot-generator.contentPack": "dnd5e" } });
  ({ TableManagerApp, openTablePicker } = await import("../scripts/apps/table-manager.js?fresh=apps-smoke"));
  ({ LootReviewApp } = await import("../scripts/apps/loot-review.js?fresh=apps-smoke"));
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
