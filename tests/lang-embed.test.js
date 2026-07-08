import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import TRANSLATIONS from "../scripts/lang-en.js";

describe("embedded translations", () => {
  it("scripts/lang-en.js exactly matches lang/en.json", () => {
    const json = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf-8"));
    expect(TRANSLATIONS).toEqual(json);
  });
  it("carries the TLG namespace", () => {
    expect(TRANSLATIONS.TLG.LootReview.Title).toBe("Loot Review");
  });
});
