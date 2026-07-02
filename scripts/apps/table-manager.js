// TableManagerApp: GM window for browsing/editing loot tables, boss overrides,
// keyword rules, test rolls, and import/export.
//
// UI-wiring only — every decision (validation, matching, rolling, persistence)
// lives in table-store.js / loot-engine.js / content/. This file reads forms,
// calls those functions, and re-renders.

import { MODULE_ID, SETTINGS, FLAGS } from "../config.js";
import {
  listTables,
  getEffectiveTable,
  saveTable,
  revertOverride,
  createCustomTable,
  deleteCustomTable,
  getKeywordRules,
  saveKeywordRules,
  exportData,
  importData,
  validateTable
} from "../core/table-store.js";
import { rollLoot } from "../core/loot-engine.js";
import { getActivePack } from "../content/index.js";
import { resolveRef } from "../content/resolver.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

let idCounter = 0;
function nextEntryId() {
  idCounter += 1;
  return `entry-${Date.now().toString(36)}-${idCounter}`;
}

/**
 * validateTable() problem strings are `"TLG.Some.Key: detail"` — localize just
 * the key portion and keep the detail suffix as-is for display.
 */
function formatProblem(problem) {
  const idx = problem.indexOf(":");
  if (idx === -1) return game.i18n.localize(problem);
  const key = problem.slice(0, idx).trim();
  const rest = problem.slice(idx + 1).trim();
  return `${game.i18n.localize(key)}: ${rest}`;
}

export class TableManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tlg-table-manager",
    classes: ["tlg", "tlg-table-manager"],
    window: { title: "TLG.TableManager.Title", icon: "fas fa-list", resizable: true },
    position: { width: 860, height: 620 },
    actions: {
      selectTable: TableManagerApp.#onSelectTable,
      newTable: TableManagerApp.#onNewTable,
      deleteTable: TableManagerApp.#onDeleteTable,
      revert: TableManagerApp.#onRevert,
      addEntry: TableManagerApp.#onAddEntry,
      deleteEntry: TableManagerApp.#onDeleteEntry,
      testRoll: TableManagerApp.#onTestRoll,
      exportData: TableManagerApp.#onExport,
      importData: TableManagerApp.#onImport,
      saveTable: TableManagerApp.#onSave,
      rulesEditor: TableManagerApp.#onRulesEditor
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/table-manager.hbs` }
  };

  /** Currently selected table id, or null. */
  selectedId = null;
  /** Working (possibly-edited, unsaved) copy of the selected table. */
  workingTable = null;
  /** True once the working copy diverges from the saved copy. */
  dirty = false;
  /** Per-entry validation problems from the last save attempt/prepare. */
  problems = [];
  /** uuid/ref -> { name, img, broken } resolution cache, kept for the app's lifetime. */
  nameCache = new Map();
  /** CR used for the last test roll. */
  testCr = 0;

  // ---------------------------------------------------------------------
  // Context preparation
  // ---------------------------------------------------------------------

  async _prepareContext() {
    const tables = listTables();
    const bossGroup = buildBossOverrideGroup();

    if (this.selectedId && !this.workingTable) {
      this.workingTable = getEffectiveTable(this.selectedId);
    }

    let entries = [];
    if (this.workingTable) {
      entries = await this.#hydrateEntries(this.workingTable.entries ?? []);
      this.problems = validateTable(this.workingTable);
    } else {
      this.problems = [];
    }

    const problemsByEntry = new Map();
    for (const p of this.problems) {
      const match = /:\s*([^:]+)(?::|$)/.exec(p);
      const entryId = match ? match[1] : null;
      if (entryId) {
        if (!problemsByEntry.has(entryId)) problemsByEntry.set(entryId, []);
        problemsByEntry.get(entryId).push(formatProblem(p));
      }
    }
    for (const entry of entries) {
      entry.problems = problemsByEntry.get(entry.id) ?? [];
    }

    return {
      pack: tables.pack,
      packTables: tables.packTables,
      customTables: tables.customTables,
      bossOverrides: bossGroup,
      modifiedIds: tables.modifiedIds,
      selectedId: this.selectedId,
      table: this.workingTable,
      isCustom: Boolean(this.workingTable?.id?.startsWith("custom:")),
      entries,
      dirty: this.dirty,
      problems: this.problems.map(formatProblem),
      testCr: this.testCr,
      entryTypes: ["item", "currency", "table", "rolltable", "nothing"],
      allTables: [
        ...tables.packTables.map((t) => ({ id: t.id, name: t.name })),
        ...tables.customTables.map((t) => ({ id: t.id, name: t.name }))
      ]
    };
  }

  /**
   * Resolves display name/img/broken for each entry, caching by uuid/ref/tableId
   * on the app instance so repeated renders don't re-hit compendium indexes.
   */
  async #hydrateEntries(entries) {
    const pack = getActivePack();
    const out = [];
    for (const entry of entries) {
      const copy = { ...entry };
      copy.display = await this.#resolveDisplay(entry, pack);
      out.push(copy);
    }
    return out;
  }

  async #resolveDisplay(entry, pack) {
    if (entry.type === "table") {
      const target = getEffectiveTable(entry.tableId);
      return target ? { name: target.name, broken: false } : { name: entry.tableId ?? "?", broken: true };
    }
    if (entry.type === "rolltable") {
      return this.#resolveUuidDisplay(entry.uuid, pack);
    }
    if (entry.type === "item") {
      if (entry.itemData) return { name: entry.itemData.name, img: entry.itemData.img, broken: false };
      if (entry.uuid) return this.#resolveUuidDisplay(entry.uuid, pack);
      if (entry.ref) return this.#resolveRefDisplay(entry.ref, pack);
      return { name: "?", broken: true };
    }
    return { name: "", broken: false };
  }

  async #resolveUuidDisplay(uuid, _pack) {
    if (!uuid) return { name: "?", broken: true };
    const cacheKey = `uuid:${uuid}`;
    if (this.nameCache.has(cacheKey)) return this.nameCache.get(cacheKey);
    let result;
    try {
      const doc = await fromUuid(uuid);
      result = doc ? { name: doc.name, img: doc.img, broken: false } : { name: uuid, broken: true };
    } catch {
      result = { name: uuid, broken: true };
    }
    this.nameCache.set(cacheKey, result);
    return result;
  }

  async #resolveRefDisplay(ref, pack) {
    const cacheKey = `ref:${ref.name}`;
    if (this.nameCache.has(cacheKey)) return this.nameCache.get(cacheKey);
    const uuid = await resolveRef(ref, pack);
    const result = uuid ? await this.#resolveUuidDisplay(uuid, pack) : { name: ref.name, broken: true };
    this.nameCache.set(cacheKey, result);
    return result;
  }

  // ---------------------------------------------------------------------
  // Rendering hooks
  // ---------------------------------------------------------------------

  _onRender(context, options) {
    super._onRender?.(context, options);
    const dropZone = this.element.querySelector(".tlg-entries-region");
    if (dropZone) {
      dropZone.addEventListener("drop", this.#onDrop.bind(this));
      dropZone.addEventListener("dragover", (event) => event.preventDefault());
    }
    const editorForm = this.element.querySelector("form");
    if (editorForm) {
      editorForm.addEventListener("input", () => { this.dirty = true; });
      editorForm.addEventListener("change", () => { this.dirty = true; });
    }
  }

  async #onDrop(event) {
    event.preventDefault();
    if (!this.workingTable) return;

    let data;
    try {
      const TE = foundry.applications.ux.TextEditor.implementation;
      data = TE.getDragEventData(event);
    } catch {
      data = foundry.applications.ux.TextEditor.getDragEventData(event);
    }
    if (!data) return;

    if (data.type === "Item") {
      this.workingTable.entries.push({ id: nextEntryId(), type: "item", uuid: data.uuid, weight: 1, qty: "1" });
    } else if (data.type === "RollTable") {
      this.workingTable.entries.push({ id: nextEntryId(), type: "rolltable", uuid: data.uuid, weight: 1, qty: "1" });
    } else {
      return;
    }
    this.dirty = true;
    await this.render();
  }

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------

  static async #onSelectTable(event, target) {
    const id = target.dataset.tableId;
    if (!id || id === this.selectedId) return;

    if (this.dirty) {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("TLG.TableManager.UnsavedChangesTitle") },
        content: `<p>${game.i18n.format("TLG.TableManager.UnsavedChangesBody", { name: this.workingTable?.name ?? "" })}</p>`
      });
      if (!confirmed) return;
    }

    this.selectedId = id;
    this.workingTable = null;
    this.dirty = false;
    this.problems = [];
    await this.render();
  }

  static async #onNewTable(_event, _target) {
    const name = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("TLG.TableManager.NewTable") },
      content: `<div class="form-group"><label>${game.i18n.localize("TLG.TableManager.NewTablePrompt")}</label>
        <input type="text" name="name" value="${game.i18n.localize("TLG.TableManager.NewTableDefault")}"></div>`,
      ok: {
        callback: (_ev, button) => new foundry.applications.ux.FormDataExtended(button.form).object.name
      }
    }).catch(() => null);
    if (!name) return;

    const table = await createCustomTable(name);
    this.selectedId = table.id;
    this.workingTable = table;
    this.dirty = false;
    await this.render();
  }

  static async #onDeleteTable(_event, target) {
    const id = target.dataset.tableId ?? this.selectedId;
    if (!id || !id.startsWith("custom:")) return;
    const table = getEffectiveTable(id);

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("TLG.TableManager.DeleteTableConfirmTitle") },
      content: `<p>${game.i18n.format("TLG.TableManager.DeleteTableConfirmBody", { name: table?.name ?? id })}</p>`
    });
    if (!confirmed) return;

    await deleteCustomTable(id);
    if (this.selectedId === id) {
      this.selectedId = null;
      this.workingTable = null;
      this.dirty = false;
    }
    await this.render();
  }

  static async #onRevert(_event, target) {
    const id = target.dataset.tableId ?? this.selectedId;
    if (!id) return;
    const table = getEffectiveTable(id);

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("TLG.TableManager.RevertConfirmTitle") },
      content: `<p>${game.i18n.format("TLG.TableManager.RevertConfirmBody", { name: table?.name ?? id })}</p>`
    });
    if (!confirmed) return;

    await revertOverride(id);
    if (this.selectedId === id) {
      this.workingTable = null;
      this.dirty = false;
    }
    await this.render();
  }

  static async #onAddEntry(_event, _target) {
    if (!this.workingTable) return;
    this.workingTable.entries.push({ id: nextEntryId(), type: "nothing", weight: 1 });
    this.dirty = true;
    await this.render();
  }

  static async #onDeleteEntry(_event, target) {
    if (!this.workingTable) return;
    const entryId = target.dataset.entryId;
    this.workingTable.entries = this.workingTable.entries.filter((e) => e.id !== entryId);
    this.dirty = true;
    await this.render();
  }

  static async #onSave(_event, _target) {
    if (!this.workingTable) return;
    this.#syncFormIntoWorkingTable();

    const problems = validateTable(this.workingTable);
    this.problems = problems;
    if (problems.length) {
      ui.notifications.error(game.i18n.localize("TLG.TableManager.ValidationFailed"));
      await this.render();
      return;
    }

    await saveTable(this.workingTable);
    this.dirty = false;
    ui.notifications.info(game.i18n.localize("TLG.TableManager.SaveSuccess"));
    await this.render();
  }

  /** Reads the form and merges name/rolls/entry fields into the working table. */
  #syncFormIntoWorkingTable() {
    const form = this.element.querySelector("form");
    if (!form) return;
    const data = new foundry.applications.ux.FormDataExtended(form).object;

    if (data.name !== undefined) this.workingTable.name = data.name;
    if (data.rolls !== undefined) this.workingTable.rolls = data.rolls;

    const entryData = data.entries ?? {};
    for (const [index, fields] of Object.entries(entryData)) {
      const entry = this.workingTable.entries[Number(index)];
      if (!entry) continue;
      if (fields.type !== undefined) entry.type = fields.type;
      if (fields.weight !== undefined) entry.weight = Number(fields.weight) || 0;
      if (fields.qty !== undefined) entry.qty = fields.qty;
      if (fields.minCr !== undefined && fields.minCr !== "") entry.minCr = Number(fields.minCr);
      else if (fields.minCr === "") delete entry.minCr;
      if (fields.maxCr !== undefined && fields.maxCr !== "") entry.maxCr = Number(fields.maxCr);
      else if (fields.maxCr === "") delete entry.maxCr;
      if (fields.tableId !== undefined) entry.tableId = fields.tableId;
      if (fields.uuid !== undefined && fields.uuid !== "") entry.uuid = fields.uuid;
      if (entry.type === "currency") {
        entry.currency = entry.currency ?? {};
        if (fields.formula !== undefined) entry.currency.formula = fields.formula;
        if (fields.denom !== undefined) entry.currency.denom = fields.denom;
      }
    }
    this.dirty = true;
  }

  static async #onTestRoll(_event, target) {
    if (!this.workingTable) return;
    this.#syncFormIntoWorkingTable();

    const form = this.element.querySelector("form");
    const crInput = form?.querySelector('[name="testCr"]');
    const cr = Number(crInput?.value ?? target.dataset.cr ?? 0) || 0;
    this.testCr = cr;

    const pack = getActivePack();
    const ctx = {
      tableId: this.workingTable.id,
      cr,
      generosity: game.settings.get(MODULE_ID, SETTINGS.GENEROSITY),
      rng: Math.random,
      pack,
      getTable: (id) => (id === this.workingTable.id ? this.workingTable : getEffectiveTable(id)),
      drawRollTable: (uuid) => drawRollTable(uuid),
      getRarity: (entry) => getRarity(entry, pack)
    };

    const result = await rollLoot(ctx);

    const lines = [];
    for (const item of result.items) {
      const display = await this.#resolveDisplay(
        item.uuid ? { type: "item", uuid: item.uuid } : item.ref ? { type: "item", ref: item.ref } : { type: "item", itemData: item.itemData },
        pack
      );
      lines.push(`<li>${display.name} x${item.qty}</li>`);
    }
    for (const [denom, amount] of Object.entries(result.currency)) {
      if (!amount) continue;
      lines.push(`<li>${game.i18n.format("TLG.TableManager.TestRollCurrency", { amount, denom })}</li>`);
    }

    const content = lines.length
      ? `<ul>${lines.join("")}</ul>`
      : `<p>${game.i18n.localize("TLG.TableManager.TestRollEmpty")}</p>`;

    await ChatMessage.create({
      whisper: [game.user.id],
      content: `<h3>${game.i18n.format("TLG.TableManager.TestRollResultTitle", { name: this.workingTable.name, cr })}</h3>${content}`
    });

    await this.render();
  }

  static async #onExport(_event, _target) {
    const data = exportData();
    foundry.utils.saveDataToFile(data, "text/json", "tlg-tables.json");
  }

  static async #onImport(_event, _target) {
    const content = `<div class="form-group">
      <label>${game.i18n.localize("TLG.TableManager.ImportFileLabel")}</label>
      <input type="file" name="file" accept="application/json,.json">
    </div>`;

    const file = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize("TLG.TableManager.ImportTitle") },
      content,
      buttons: [
        {
          action: "import",
          label: game.i18n.localize("TLG.TableManager.ImportButton"),
          default: true,
          callback: (_ev, button) => {
            const input = button.form.querySelector('input[name="file"]');
            return input?.files?.[0] ?? null;
          }
        },
        { action: "cancel", label: game.i18n.localize("TLG.TableManager.Cancel") }
      ]
    }).catch(() => null);

    if (!file) {
      if (file === null) ui.notifications.warn(game.i18n.localize("TLG.TableManager.ImportNoFile"));
      return;
    }

    try {
      const text = await file.text();
      const result = await importData(text);
      ui.notifications.info(game.i18n.format("TLG.TableManager.ImportSuccess", { tables: result.tables, rules: result.rules }));
      this.workingTable = null;
      this.dirty = false;
      await this.render();
    } catch (error) {
      ui.notifications.error(game.i18n.format("TLG.TableManager.ImportError", { error: error.message ?? String(error) }));
    }
  }

  static async #onRulesEditor(_event, _target) {
    await openRulesEditorDialog();
  }
}

// ---------------------------------------------------------------------------
// Boss-override group: scans world actors for the TABLE flag.
// ---------------------------------------------------------------------------

function buildBossOverrideGroup() {
  const actors = game.actors?.filter?.((a) => a.getFlag?.(MODULE_ID, FLAGS.TABLE)) ?? [];
  return actors.map((a) => ({
    actorId: a.id,
    actorName: a.name,
    tableId: a.getFlag(MODULE_ID, FLAGS.TABLE)
  }));
}

// ---------------------------------------------------------------------------
// Shared roll helpers (mirrors encounter-service.js's rollForCombatant pattern)
// ---------------------------------------------------------------------------

async function drawRollTable(uuid) {
  const table = await fromUuid(uuid);
  if (!table) return [];
  const draw = await table.draw({ displayChat: false });
  const out = [];
  for (const result of draw.results ?? []) {
    if (result.type === CONST.TABLE_RESULT_TYPES.DOCUMENT || result.documentUuid) {
      out.push({ uuid: result.documentUuid ?? result.uuid, qty: 1 });
    }
  }
  return out;
}

async function getRarity(entry, pack) {
  let uuid = entry.uuid;
  if (!uuid && entry.ref) uuid = await resolveRef(entry.ref, pack);
  if (!uuid) return null;
  const doc = await fromUuid(uuid);
  return doc?.system?.rarity ?? null;
}

// ---------------------------------------------------------------------------
// Keyword rules editor (DialogV2)
// ---------------------------------------------------------------------------

async function openRulesEditorDialog() {
  let rules = getKeywordRules();
  const tables = listTables();
  const allTables = [...tables.packTables, ...tables.customTables];

  function renderContent() {
    const rows = rules
      .map(
        (rule, i) => `
      <div class="tlg-rule-row" data-index="${i}">
        <input type="checkbox" name="enabled" ${rule.enabled ? "checked" : ""}>
        <input type="text" name="pattern" value="${foundry.utils.escapeHTML ? foundry.utils.escapeHTML(rule.pattern ?? "") : rule.pattern ?? ""}" placeholder="${game.i18n.localize("TLG.TableManager.RulesPattern")}">
        <select name="matchType">
          <option value="includes" ${rule.matchType === "includes" ? "selected" : ""}>${game.i18n.localize("TLG.TableManager.RulesMatchType.includes")}</option>
          <option value="regex" ${rule.matchType === "regex" ? "selected" : ""}>${game.i18n.localize("TLG.TableManager.RulesMatchType.regex")}</option>
        </select>
        <select name="tableId">
          ${allTables.map((t) => `<option value="${t.id}" ${rule.tableId === t.id ? "selected" : ""}>${foundry.utils.escapeHTML(t.name)}</option>`).join("")}
        </select>
        <button type="button" data-rule-action="up" data-index="${i}" ${i === 0 ? "disabled" : ""}><i class="fas fa-arrow-up"></i></button>
        <button type="button" data-rule-action="down" data-index="${i}" ${i === rules.length - 1 ? "disabled" : ""}><i class="fas fa-arrow-down"></i></button>
        <button type="button" data-rule-action="delete" data-index="${i}"><i class="fas fa-trash"></i></button>
      </div>`
      )
      .join("");
    return `<div class="tlg-rules-editor">
      <p class="hint">${game.i18n.localize("TLG.TableManager.RulesEditorHint")}</p>
      <div class="tlg-rules-list">${rows}</div>
      <button type="button" data-rule-action="add">${game.i18n.localize("TLG.TableManager.RulesAddRule")}</button>
    </div>`;
  }

  function syncFromDom(root) {
    const rows = root.querySelectorAll(".tlg-rule-row");
    const updated = [];
    rows.forEach((row) => {
      const index = Number(row.dataset.index);
      const existing = rules[index];
      updated.push({
        id: existing?.id ?? foundry.utils.randomID(),
        enabled: row.querySelector('[name="enabled"]').checked,
        pattern: row.querySelector('[name="pattern"]').value,
        matchType: row.querySelector('[name="matchType"]').value,
        tableId: row.querySelector('[name="tableId"]').value
      });
    });
    rules = updated;
  }

  await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize("TLG.TableManager.RulesEditorTitle") },
    content: renderContent(),
    buttons: [
      {
        action: "save",
        label: game.i18n.localize("TLG.TableManager.RulesSave"),
        default: true,
        callback: async (_ev, button) => {
          syncFromDom(button.form);
          await saveKeywordRules(rules);
          ui.notifications.info(game.i18n.localize("TLG.TableManager.RulesSaved"));
        }
      },
      { action: "cancel", label: game.i18n.localize("TLG.TableManager.Cancel") }
    ],
    render: (_event, dialog) => {
      const root = dialog.element;
      root.addEventListener("click", (event) => {
        const btn = event.target.closest("[data-rule-action]");
        if (!btn) return;
        syncFromDom(root);
        const action = btn.dataset.ruleAction;
        const index = Number(btn.dataset.index);
        if (action === "add") {
          rules.push({ id: foundry.utils.randomID(), pattern: "", matchType: "includes", tableId: allTables[0]?.id ?? "fallback", enabled: true });
        } else if (action === "up" && index > 0) {
          [rules[index - 1], rules[index]] = [rules[index], rules[index - 1]];
        } else if (action === "down" && index < rules.length - 1) {
          [rules[index + 1], rules[index]] = [rules[index], rules[index + 1]];
        } else if (action === "delete") {
          rules.splice(index, 1);
        }
        const container = root.querySelector(".tlg-rules-editor");
        if (container) container.outerHTML = renderContent();
      });
    }
  }).catch(() => null);
}

// ---------------------------------------------------------------------------
// openTablePicker: reusable DialogV2 table picker for Task 13's boss-assign flow.
// ---------------------------------------------------------------------------

export async function openTablePicker(current) {
  const tables = listTables();
  const options = [
    { id: "", name: game.i18n.localize("TLG.TableManager.PickerNone") },
    ...tables.packTables,
    ...tables.customTables
  ];

  const content = `<div class="form-group">
    <select name="tableId">
      ${options.map((t) => `<option value="${t.id}" ${t.id === (current ?? "") ? "selected" : ""}>${foundry.utils.escapeHTML(t.name)}</option>`).join("")}
    </select>
  </div>`;

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize("TLG.TableManager.PickerTitle") },
    content,
    buttons: [
      {
        action: "ok",
        label: game.i18n.localize("TLG.TableManager.Save"),
        default: true,
        callback: (_ev, button) => new foundry.applications.ux.FormDataExtended(button.form).object.tableId
      },
      { action: "cancel", label: game.i18n.localize("TLG.TableManager.Cancel") }
    ]
  }).catch(() => null);

  if (!result) return null;
  return result || null;
}
