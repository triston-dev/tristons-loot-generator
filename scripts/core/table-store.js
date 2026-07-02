// TableStore: reads/writes loot table overrides, custom tables, and keyword rules.
//
// IMPORTANT: this module keeps NO module-level mutable caches. Every exported
// function re-reads `game.settings.get(...)` on each call and re-resolves the
// active pack via `getActivePack()`. This is deliberate: GM edits must be
// visible immediately to every other function in this file without needing an
// explicit cache-invalidation step, and it keeps tests free of stale state
// leaking between `installShim()` resets.

import { MODULE_ID, SETTINGS } from "../config.js";
import { getActivePack } from "../content/index.js";
import { validateDice } from "./dice.js";

const ENTRY_TYPES = ["item", "currency", "table", "rolltable", "nothing"];

function clone(value) {
  return structuredClone(value);
}

function getOverrides() {
  return game.settings.get(MODULE_ID, SETTINGS.TABLE_OVERRIDES) ?? {};
}

function getCustoms() {
  return game.settings.get(MODULE_ID, SETTINGS.CUSTOM_TABLES) ?? {};
}

function getRulesStore() {
  return game.settings.get(MODULE_ID, SETTINGS.KEYWORD_RULES) ?? { rules: [] };
}

function findPackTable(pack, tableId) {
  if (tableId === "fallback") return pack.fallbackTable ?? null;
  if (tableId.startsWith("type:")) {
    const key = tableId.slice("type:".length);
    return pack.typeTables?.[key] ?? null;
  }
  if (tableId.startsWith("shared:")) {
    return pack.sharedTables?.[tableId] ?? null;
  }
  return null;
}

export function getEffectiveTable(tableId) {
  if (tableId.startsWith("custom:")) {
    const customs = getCustoms();
    const table = customs[tableId];
    return table ? clone(table) : null;
  }
  const pack = getActivePack();
  const overrides = getOverrides();
  const packOverrides = overrides[pack.id] ?? {};
  if (packOverrides[tableId]) return clone(packOverrides[tableId]);
  const packTable = findPackTable(pack, tableId);
  return packTable ? clone(packTable) : null;
}

export function listTables() {
  const pack = getActivePack();
  const overrides = getOverrides();
  const packOverrides = overrides[pack.id] ?? {};
  const customs = getCustoms();

  const packTables = [];
  for (const [key, table] of Object.entries(pack.typeTables ?? {})) {
    const id = `type:${key}`;
    packTables.push({ id, name: (packOverrides[id] ?? table).name, modified: Boolean(packOverrides[id]) });
  }
  for (const [id, table] of Object.entries(pack.sharedTables ?? {})) {
    packTables.push({ id, name: (packOverrides[id] ?? table).name, modified: Boolean(packOverrides[id]) });
  }
  if (pack.fallbackTable) {
    const id = pack.fallbackTable.id ?? "fallback";
    packTables.push({ id, name: (packOverrides[id] ?? pack.fallbackTable).name, modified: Boolean(packOverrides[id]) });
  }

  const customTables = Object.values(customs).map((t) => ({ id: t.id, name: t.name, modified: true }));

  const modifiedIds = [...Object.keys(packOverrides), ...Object.keys(customs)];

  return {
    pack: { id: pack.id, label: pack.label },
    packTables,
    customTables,
    modifiedIds
  };
}

export async function saveTable(table) {
  const toSave = clone(table);
  toSave.gmAuthored = true;

  if (toSave.id.startsWith("custom:")) {
    const customs = getCustoms();
    customs[toSave.id] = toSave;
    await game.settings.set(MODULE_ID, SETTINGS.CUSTOM_TABLES, customs);
    return;
  }

  const pack = getActivePack();
  const overrides = getOverrides();
  overrides[pack.id] = overrides[pack.id] ?? {};
  overrides[pack.id][toSave.id] = toSave;
  await game.settings.set(MODULE_ID, SETTINGS.TABLE_OVERRIDES, overrides);
}

export async function revertOverride(tableId) {
  const pack = getActivePack();
  const overrides = getOverrides();
  if (!overrides[pack.id] || !(tableId in overrides[pack.id])) return;
  delete overrides[pack.id][tableId];
  await game.settings.set(MODULE_ID, SETTINGS.TABLE_OVERRIDES, overrides);
}

export async function createCustomTable(name) {
  const id = `custom:${foundry.utils.randomID()}`;
  const table = { id, name, rolls: "1", entries: [], gmAuthored: true };
  const customs = getCustoms();
  customs[id] = table;
  await game.settings.set(MODULE_ID, SETTINGS.CUSTOM_TABLES, customs);
  return clone(table);
}

export async function deleteCustomTable(tableId) {
  const customs = getCustoms();
  if (!(tableId in customs)) return;
  delete customs[tableId];
  await game.settings.set(MODULE_ID, SETTINGS.CUSTOM_TABLES, customs);
}

export function getKeywordRules() {
  const store = getRulesStore();
  return clone(store.rules ?? []);
}

export async function saveKeywordRules(rules) {
  await game.settings.set(MODULE_ID, SETTINGS.KEYWORD_RULES, { rules: clone(rules) });
}

export function exportData() {
  const pack = getActivePack();
  const overrides = getOverrides();
  const customs = getCustoms();
  const rules = getKeywordRules();
  const payload = {
    format: 1,
    packId: pack.id,
    overrides: overrides[pack.id] ?? {},
    customs,
    rules
  };
  return JSON.stringify(payload);
}

export async function importData(json) {
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("TLG.TableStore.InvalidJson");
  }

  if (!data || data.format !== 1) throw new Error("TLG.TableStore.SchemaMismatch");
  if (typeof data.packId !== "string") throw new Error("TLG.TableStore.SchemaMismatch");
  if (typeof data.overrides !== "object" || data.overrides === null) throw new Error("TLG.TableStore.SchemaMismatch");
  if (typeof data.customs !== "object" || data.customs === null) throw new Error("TLG.TableStore.SchemaMismatch");
  if (!Array.isArray(data.rules)) throw new Error("TLG.TableStore.SchemaMismatch");

  // The post-import id-universe below is built from the CURRENT active pack's
  // type/shared/fallback tables. A payload authored for a different pack
  // would validate its `type:`/`shared:`/`fallback` nested-table references
  // against the wrong pack's table ids, and its overrides would be written
  // under a pack id that doesn't match the universe just validated against.
  // Reject the mismatch up front, before any validation or writes.
  const pack = getActivePack();
  if (data.packId !== pack.id) throw new Error("TLG.TableStore.PackMismatch");

  // Nested `type: "table"` references must resolve against the universe of ids
  // that will exist AFTER this import is applied, not the current (pre-import)
  // store. Otherwise: (a) a custom table referencing a sibling custom table in
  // the same payload spuriously fails (sibling isn't in the store yet), and
  // (b) a payload that drops a currently-stored custom table which it still
  // references would pass (stale reference resolves against old state) but
  // dangle immediately after import.
  const postImportIds = new Set([
    ...Object.keys(data.customs),
    ...Object.keys(data.overrides),
    ...Object.keys(pack.typeTables ?? {}).map((key) => `type:${key}`),
    ...Object.keys(pack.sharedTables ?? {}),
    "fallback"
  ]);
  const tableExists = (id) => postImportIds.has(id);

  const allTables = [...Object.values(data.overrides), ...Object.values(data.customs)];
  for (const table of allTables) {
    const problems = validateTable(table, { tableExists });
    if (problems.length) throw new Error(`TLG.TableStore.InvalidTable: ${table?.id ?? "?"}: ${problems.join("; ")}`);
  }

  // All tables validated: safe to write. Do writes only after every check passes (atomic).
  const overrides = getOverrides();
  overrides[data.packId] = clone(data.overrides);
  await game.settings.set(MODULE_ID, SETTINGS.TABLE_OVERRIDES, overrides);
  await game.settings.set(MODULE_ID, SETTINGS.CUSTOM_TABLES, clone(data.customs));
  await game.settings.set(MODULE_ID, SETTINGS.KEYWORD_RULES, { rules: clone(data.rules) });

  return { tables: allTables.length, rules: data.rules.length };
}

export function validateTable(table, { tableExists = (id) => getEffectiveTable(id) !== null } = {}) {
  const problems = [];
  if (!table || typeof table !== "object") {
    problems.push("TLG.TableStore.Validate.NotAnObject");
    return problems;
  }
  if (!validateDice(table.rolls ?? "1")) problems.push(`TLG.TableStore.Validate.BadRollsFormula: ${table.rolls}`);

  const entries = Array.isArray(table.entries) ? table.entries : [];
  for (const entry of entries) {
    if (!(entry.weight > 0)) problems.push(`TLG.TableStore.Validate.BadWeight: ${entry.id}`);
    if (!ENTRY_TYPES.includes(entry.type)) problems.push(`TLG.TableStore.Validate.UnknownType: ${entry.id}:${entry.type}`);
    if (entry.type === "currency" && !validateDice(entry.currency?.formula)) {
      problems.push(`TLG.TableStore.Validate.BadCurrencyFormula: ${entry.id}`);
    }
    if (entry.qty !== undefined && !validateDice(entry.qty)) {
      problems.push(`TLG.TableStore.Validate.BadQtyFormula: ${entry.id}`);
    }
    if (entry.type === "table") {
      if (!entry.tableId || !tableExists(entry.tableId)) {
        problems.push(`TLG.TableStore.Validate.UnresolvedNestedTable: ${entry.id}:${entry.tableId}`);
      }
    }
  }
  return problems;
}
