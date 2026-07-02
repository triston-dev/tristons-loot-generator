// Unit tests for the pure helper functions extracted from distribution.js:
// escapeHTML, buildEvenSplitPreview, buildClaimChoices, validateManualAllocation.
// No Foundry globals needed — these are plain-data-in, plain-data-out.

import { describe, it, expect, beforeEach } from "vitest";
import { installShim } from "./foundry-shim.js";

let escapeHTML;
let buildEvenSplitPreview;
let buildClaimChoices;
let validateManualAllocation;
let buildAllocationSummary;

beforeEach(async () => {
  installShim({ settings: { "tristons-loot-generator.contentPack": "dnd5e" } });
  ({ escapeHTML, buildEvenSplitPreview, buildClaimChoices, validateManualAllocation, buildAllocationSummary } = await import(
    "../scripts/apps/distribution.js?fresh=distribution-pure"
  ));
});

describe("escapeHTML", () => {
  it("escapes the five HTML special characters", () => {
    expect(escapeHTML(`<script>alert("x") & 'y'</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;"
    );
  });

  it("coerces non-string input", () => {
    expect(escapeHTML(42)).toBe("42");
  });
});

describe("buildEvenSplitPreview", () => {
  const denominations = [{ key: "gp", label: "GP" }, { key: "sp", label: "SP" }];

  it("returns one line per non-zero denomination, dividing evenly with no remainder", () => {
    const lines = buildEvenSplitPreview({ gp: 10 }, 5, denominations);
    expect(lines).toEqual(["2 GP each"]);
  });

  it("calls out the remainder when the pot does not divide evenly", () => {
    const lines = buildEvenSplitPreview({ sp: 109 }, 4, denominations);
    expect(lines).toEqual(["27 SP each, 1 SP over"]);
  });

  it("skips zero-amount denominations", () => {
    const lines = buildEvenSplitPreview({ gp: 0, sp: 20 }, 4, denominations);
    expect(lines).toEqual(["5 SP each"]);
  });

  it("returns an empty array when there are no party characters", () => {
    expect(buildEvenSplitPreview({ gp: 10 }, 0, denominations)).toEqual([]);
  });

  it("falls back to the raw denom key when no label matches", () => {
    const lines = buildEvenSplitPreview({ pp: 3 }, 2, denominations);
    expect(lines).toEqual(["1 pp each, 1 pp over"]);
  });

  it("uses the injected i18n formatter when provided", () => {
    const i18n = (key, data) => `${key}:${JSON.stringify(data)}`;
    const lines = buildEvenSplitPreview({ gp: 10 }, 4, denominations, i18n);
    expect(lines).toEqual(['TLG.Distribution.SplitPreviewWithRemainder:{"share":2,"label":"GP","remainder":2}']);
  });
});

describe("buildClaimChoices", () => {
  const characters = [
    { uuid: "Actor.a", name: "Aria", img: "a.webp", ownerUserIds: ["u1"] },
    { uuid: "Actor.b", name: "Bram", img: "b.webp", ownerUserIds: ["u2"] }
  ];

  it("returns the full list stripped to uuid/name/img when no restriction is given", () => {
    expect(buildClaimChoices(characters)).toEqual([
      { uuid: "Actor.a", name: "Aria", img: "a.webp" },
      { uuid: "Actor.b", name: "Bram", img: "b.webp" }
    ]);
  });

  it("filters to only the restricted uuids", () => {
    expect(buildClaimChoices(characters, ["Actor.b"])).toEqual([{ uuid: "Actor.b", name: "Bram", img: "b.webp" }]);
  });

  it("returns an empty list when the restriction matches nothing", () => {
    expect(buildClaimChoices(characters, ["Actor.z"])).toEqual([]);
  });
});

describe("validateManualAllocation", () => {
  it("accepts an allocation whose per-denom sums match the pot exactly", () => {
    const allocation = { "Actor.a": { gp: 5, sp: 2 }, "Actor.b": { gp: 5, sp: 8 } };
    expect(validateManualAllocation(allocation, { gp: 10, sp: 10 })).toEqual({ ok: true });
  });

  it("rejects when a denomination sum is short of the pot", () => {
    const allocation = { "Actor.a": { gp: 4 }, "Actor.b": { gp: 5 } };
    const result = validateManualAllocation(allocation, { gp: 10 });
    expect(result.ok).toBe(false);
    expect(result.denom).toBe("gp");
  });

  it("rejects when a denomination sum exceeds the pot", () => {
    const allocation = { "Actor.a": { gp: 8 }, "Actor.b": { gp: 5 } };
    const result = validateManualAllocation(allocation, { gp: 10 });
    expect(result.ok).toBe(false);
    expect(result.denom).toBe("gp");
  });

  it("rejects negative values", () => {
    const allocation = { "Actor.a": { gp: -1 }, "Actor.b": { gp: 11 } };
    const result = validateManualAllocation(allocation, { gp: 10 });
    expect(result.ok).toBe(false);
  });

  it("rejects non-integer values", () => {
    const allocation = { "Actor.a": { gp: 5.5 }, "Actor.b": { gp: 4.5 } };
    const result = validateManualAllocation(allocation, { gp: 10 });
    expect(result.ok).toBe(false);
  });

  it("treats a missing pot denomination as zero", () => {
    const allocation = { "Actor.a": { sp: 0 } };
    expect(validateManualAllocation(allocation, {})).toEqual({ ok: true });
  });

  it("handles an empty allocation against an empty pot", () => {
    expect(validateManualAllocation({}, {})).toEqual({ ok: true });
  });
});

describe("buildAllocationSummary", () => {
  const denominations = [{ key: "gp", label: "GP" }, { key: "sp", label: "SP" }];
  const resolveName = (uuid) => ({ "Actor.a": "Aria", "Actor.b": "Bram" }[uuid] || uuid);

  it("returns one summary entry per actor with nonzero denominations", () => {
    const allocation = { "Actor.a": { gp: 5, sp: 0 }, "Actor.b": { gp: 0, sp: 10 } };
    const summary = buildAllocationSummary(allocation, denominations, resolveName);
    expect(summary).toEqual([
      { name: "Aria", amounts: "5 GP" },
      { name: "Bram", amounts: "10 SP" }
    ]);
  });

  it("combines multiple denominations for a single actor", () => {
    const allocation = { "Actor.a": { gp: 5, sp: 10 } };
    const summary = buildAllocationSummary(allocation, denominations, resolveName);
    expect(summary).toEqual([{ name: "Aria", amounts: "5 GP, 10 SP" }]);
  });

  it("skips actors with all-zero denominations", () => {
    const allocation = { "Actor.a": { gp: 5 }, "Actor.b": { gp: 0, sp: 0 } };
    const summary = buildAllocationSummary(allocation, denominations, resolveName);
    expect(summary).toEqual([{ name: "Aria", amounts: "5 GP" }]);
  });

  it("returns an empty array for an empty allocation", () => {
    expect(buildAllocationSummary({}, denominations, resolveName)).toEqual([]);
  });

  it("uses the resolveName callback for actor uuids", () => {
    const allocation = { "Actor.unknown": { gp: 5 } };
    const summary = buildAllocationSummary(allocation, denominations, resolveName);
    expect(summary).toEqual([{ name: "Actor.unknown", amounts: "5 GP" }]);
  });

  it("preserves actor order from the allocation object", () => {
    const allocation = { "Actor.b": { gp: 2 }, "Actor.a": { gp: 3 } };
    const summary = buildAllocationSummary(allocation, denominations, resolveName);
    // Object.entries preserves insertion order; allocation order is what we test
    expect(summary[0].name).toBe("Bram");
    expect(summary[1].name).toBe("Aria");
  });
});
