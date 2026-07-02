import { describe, it, expect } from "vitest";
import { MODULE_ID, SETTINGS, GENEROSITY } from "../scripts/config.js";

describe("config", () => {
  it("module id is stable", () => expect(MODULE_ID).toBe("tristons-loot-generator"));
  it("generosity multipliers", () => expect(GENEROSITY).toEqual({ sparse: 0.5, standard: 1, generous: 2 }));
  it("settings keys unique", () => {
    const vals = Object.values(SETTINGS);
    expect(new Set(vals).size).toBe(vals.length);
  });
});
