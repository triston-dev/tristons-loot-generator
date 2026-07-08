import { describe, it, expect } from "vitest";
import { evaluateDice, validateDice } from "../scripts/core/dice.js";

const fixed = (v) => () => v; // rng returning constant

describe("evaluateDice", () => {
  it("evaluates integers", () => expect(evaluateDice("5")).toBe(5));
  it("rolls NdM with injected rng", () => {
    expect(evaluateDice("2d6", {}, fixed(0))).toBe(2);      // both dice roll 1
    expect(evaluateDice("2d6", {}, fixed(0.999))).toBe(12); // both dice roll 6
  });
  it("substitutes @cr", () => expect(evaluateDice("@cr * 10", { cr: 3 })).toBe(30));
  it("handles parens and mixed ops", () => expect(evaluateDice("(2d4 + @cr) * 10", { cr: 2 }, fixed(0))).toBe(40));
  it("missing variable becomes 0", () => expect(evaluateDice("@cr + 1", {})).toBe(1));
  it("fractional CR floors final result only", () => expect(evaluateDice("@cr * 3", { cr: 0.5 })).toBe(1));
  it("never returns negatives", () => expect(evaluateDice("1 - 5")).toBe(0));
  it("throws on garbage", () => expect(() => evaluateDice("2d6; alert(1)")).toThrow());
  it("throws on d0 and 0 dice cap", () => expect(() => evaluateDice("1d0")).toThrow());
  it("throws on division by zero", () => expect(() => evaluateDice("1/0")).toThrow());
});

describe("validateDice", () => {
  it("accepts valid", () => expect(validateDice("1d4 + 2")).toBe(true));
  it("rejects invalid", () => expect(validateDice("hello()")).toBe(false));
});
