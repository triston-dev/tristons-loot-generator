// LootEngine: pure generation core. No game/ui/Hooks, no imports beyond
// evaluateDice and the two config constant maps — everything else arrives via
// ctx/deps parameters injected by the caller.

import { evaluateDice } from "./dice.js";
import { GENEROSITY, ROLL_SHIFT } from "../config.js";

const MAX_DEPTH = 5;

export function matchTable(ctx, deps) {
  const { flagTableId, name, biography, creatureType } = ctx;
  const { rules, tableExists, creatureTypes } = deps;

  if (flagTableId && tableExists(flagTableId)) {
    return { tableId: flagTableId, source: "override" };
  }

  for (const rule of rules ?? []) {
    if (!rule.enabled) continue;
    if (ruleMatches(rule, name) || ruleMatches(rule, biography)) {
      return { tableId: rule.tableId, source: "keyword" };
    }
  }

  if (creatureType && creatureTypes.includes(creatureType)) {
    const tableId = `type:${creatureType}`;
    if (tableExists(tableId)) return { tableId, source: "type" };
  }

  return { tableId: "fallback", source: "fallback" };
}

function ruleMatches(rule, text) {
  const value = text ?? "";
  if (rule.matchType === "regex") {
    let re;
    try {
      re = new RegExp(rule.pattern, "i");
    } catch {
      return false;
    }
    return re.test(value);
  }
  // "includes" (and any unrecognized matchType) falls back to substring match.
  return value.toLowerCase().includes(String(rule.pattern).toLowerCase());
}

export async function rollLoot(ctx) {
  const result = { items: [], currency: {} };
  await rollInto(result, ctx.tableId, ctx, 0, new Set());
  return result;
}

async function rollInto(result, tableId, ctx, depth, visited) {
  if (depth >= MAX_DEPTH) return;
  if (visited.has(tableId)) return;

  const table = ctx.getTable(tableId);
  if (!table) return;

  const nextVisited = new Set(visited);
  nextVisited.add(tableId);

  const draws = Math.max(1, evaluateDice(table.rolls, { cr: ctx.cr }, ctx.rng) + ROLL_SHIFT[ctx.generosity]);

  for (let i = 0; i < draws; i++) {
    const candidates = await filterEntries(table, ctx);
    const entry = weightedPick(candidates, ctx.rng);
    if (!entry) continue;
    await resolveEntry(result, entry, ctx, depth, nextVisited);
  }
}

async function filterEntries(table, ctx) {
  const entries = Array.isArray(table.entries) ? table.entries : [];
  const out = [];
  for (const entry of entries) {
    if (!crGateOk(entry, ctx.cr)) continue;
    if (!table.gmAuthored && !(await rarityOk(entry, ctx))) continue;
    out.push(entry);
  }
  return out;
}

function crGateOk(entry, cr) {
  if (entry.minCr !== undefined && cr < entry.minCr) return false;
  if (entry.maxCr !== undefined && cr > entry.maxCr) return false;
  return true;
}

async function rarityOk(entry, ctx) {
  if (entry.type !== "item") return true;
  const budget = ctx.pack?.rarityBudget;
  if (!budget || !budget.length) return true;
  const rarity = await ctx.getRarity(entry);
  if (rarity === null || rarity === undefined) return true;
  const band = budget.find((b) => ctx.cr <= b.maxCr);
  if (!band) return true;
  return band.allowed.includes(rarity);
}

function weightedPick(entries, rng) {
  if (!entries.length) return null;
  const total = entries.reduce((sum, e) => sum + (e.weight ?? 0), 0);
  if (total <= 0) return null;
  let roll = rng() * total;
  for (const entry of entries) {
    roll -= entry.weight ?? 0;
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

async function resolveEntry(result, entry, ctx, depth, visited) {
  switch (entry.type) {
    case "item": {
      const qty = evaluateDice(entry.qty ?? "1", { cr: ctx.cr }, ctx.rng);
      mergeItem(result.items, entry, qty);
      break;
    }
    case "currency": {
      const denom = entry.currency.denom;
      const raw = evaluateDice(entry.currency.formula, { cr: ctx.cr }, ctx.rng);
      const amount = Math.round(raw * GENEROSITY[ctx.generosity]);
      result.currency[denom] = (result.currency[denom] ?? 0) + amount;
      break;
    }
    case "table": {
      const qty = evaluateDice(entry.qty ?? "1", { cr: ctx.cr }, ctx.rng);
      for (let i = 0; i < qty; i++) {
        await rollInto(result, entry.tableId, ctx, depth + 1, visited);
      }
      break;
    }
    case "rolltable": {
      const qty = evaluateDice(entry.qty ?? "1", { cr: ctx.cr }, ctx.rng);
      for (let i = 0; i < qty; i++) {
        const drawn = await ctx.drawRollTable(entry.uuid);
        for (const item of drawn ?? []) {
          result.items.push(item);
        }
      }
      break;
    }
    case "nothing":
    default:
      break;
  }
}

function mergeItem(items, entry, qty) {
  const uuid = entry.uuid;
  const refName = entry.ref?.name;
  const itemDataName = entry.itemData?.name;
  const key = uuid ?? refName ?? itemDataName;

  const existing = key !== undefined ? items.find((i) => (i.uuid ?? i.ref?.name ?? i.itemData?.name) === key) : undefined;
  if (existing) {
    existing.qty += qty;
    return;
  }

  const item = { qty };
  if (uuid !== undefined) item.uuid = uuid;
  if (entry.ref !== undefined) item.ref = entry.ref;
  if (entry.itemData !== undefined) item.itemData = entry.itemData;
  const name = entry.name ?? entry.itemData?.name;
  if (name !== undefined) item.name = name;
  const img = entry.img ?? entry.itemData?.img;
  if (img !== undefined) item.img = img;
  items.push(item);
}

export function filterCarriedGear(items, pack) {
  const { includeTypes, excludeNaturalWeapons } = pack.carriedGear;
  return items.filter((item) => {
    if (!includeTypes.includes(item.type)) return false;
    if (excludeNaturalWeapons && item.type === "weapon" && item.system?.type?.value === "natural") return false;
    if (item.system?.quantity === 0) return false;
    if (item.flags?.["tristons-loot-generator"]?.noLoot === true) return false;
    return true;
  });
}
