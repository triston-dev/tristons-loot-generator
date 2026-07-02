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

beforeEach(async () => {
  installShim({ settings: { "tristons-loot-generator.contentPack": "dnd5e" } });
  ({ TableManagerApp, openTablePicker } = await import("../scripts/apps/table-manager.js?fresh=apps-smoke"));
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
