import { MODULE_ID, SETTINGS, FLAGS } from "./config.js";
import { initEncounterHooks, setOnCaptured, generateNow } from "./core/encounter-service.js";
import { initSocket } from "./core/socket-service.js";
import { getSessions } from "./core/session-store.js";
import { TableManagerApp } from "./apps/table-manager.js";
import { LootReviewApp } from "./apps/loot-review.js";
import { DistributionApp, syncOpenWindows, lastKnownStatus } from "./apps/distribution.js";
import { assignFlow, resolveActorFromListItem } from "./apps/assign-table.js";
import { HistoryApp } from "./apps/history.js";
import TRANSLATIONS from "./lang-en.js";

// Some hosts (observed on Sqyre) serve WRONG content when Foundry fetches
// module lang files, so the declared lang/en.json cannot be trusted to load.
// The translations are embedded in scripts/lang-en.js (generated from
// lang/en.json; a test enforces they stay identical) and applied directly
// whenever the TLG namespace is missing. Direct assignment of only our own
// namespace - never a deep merge over core translations.
function applyEmbeddedTranslations(phase) {
  if (game.i18n?.translations?.TLG) return;
  try {
    game.i18n.translations.TLG = foundry.utils.deepClone(TRANSLATIONS.TLG);
    console.warn(`TLG | host did not load lang/en.json; embedded translations applied (${phase})`);
  } catch (err) {
    console.error(`TLG | embedded translation apply failed`, err);
  }
}
Hooks.once("i18nInit", () => applyEmbeddedTranslations("i18nInit"));
Hooks.once("setup", () => applyEmbeddedTranslations("setup"));
Hooks.once("ready", () => applyEmbeddedTranslations("ready"));

Hooks.once("init", () => {
  const s = game.settings;
  s.register(MODULE_ID, SETTINGS.AUTO_GENERATE, { name: "TLG.Settings.AutoGenerate", scope: "world", config: true, type: Boolean, default: true });
  s.register(MODULE_ID, SETTINGS.REVIEW_GATE, { name: "TLG.Settings.ReviewGate", scope: "world", config: true, type: Boolean, default: true });
  s.register(MODULE_ID, SETTINGS.GENEROSITY, { name: "TLG.Settings.Generosity", scope: "world", config: true, type: String, default: "standard", choices: { sparse: "TLG.Generosity.Sparse", standard: "TLG.Generosity.Standard", generous: "TLG.Generosity.Generous" } });
  s.register(MODULE_ID, SETTINGS.CARRIED_GEAR, { name: "TLG.Settings.CarriedGear", scope: "world", config: true, type: Boolean, default: true });
  s.register(MODULE_ID, SETTINGS.REMAINDER, { name: "TLG.Settings.Remainder", scope: "world", config: true, type: String, default: "random", choices: { random: "TLG.Remainder.Random", gm: "TLG.Remainder.GM" } });
  s.register(MODULE_ID, SETTINGS.PACK, { name: "TLG.Settings.Pack", scope: "world", config: true, type: String, default: "auto", choices: { auto: "TLG.Pack.Auto", dnd5e: "TLG.Pack.Dnd5e", sw5e: "TLG.Pack.Sw5e" } });
  s.register(MODULE_ID, SETTINGS.CHAT_VIS, { name: "TLG.Settings.ChatVis", scope: "world", config: true, type: String, default: "public", choices: { public: "TLG.ChatVis.Public", gm: "TLG.ChatVis.GM" } });
  for (const key of [SETTINGS.TABLE_OVERRIDES, SETTINGS.CUSTOM_TABLES]) {
    s.register(MODULE_ID, key, { scope: "world", config: false, type: Object, default: {} });
  }
  // onChange fires on EVERY client (including the writer) whenever the
  // sessions world setting changes — this is the sole sync mechanism (spec
  // §Sync model: "no manual stateUpdate broadcast needed"). syncOpenWindows
  // re-renders/opens/closes windows per the transition rules documented on
  // it (scripts/apps/distribution.js).
  s.register(MODULE_ID, SETTINGS.SESSIONS, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: () => { syncOpenWindows(); }
  });
  s.register(MODULE_ID, SETTINGS.KEYWORD_RULES, { scope: "world", config: false, type: Object, default: { rules: [] } });

  // ApplicationV2 subclasses are directly constructable/renderable, so
  // TableManagerApp works as-is for registerMenu's `new menu.type().render(true)`
  // contract — no shim class needed.
  s.registerMenu(MODULE_ID, "tableManager", {
    name: "TLG.TableManager.MenuName",
    label: "TLG.TableManager.MenuLabel",
    hint: "TLG.TableManager.MenuHint",
    icon: "fas fa-list",
    type: TableManagerApp,
    restricted: true
  });

  s.registerMenu(MODULE_ID, "history", {
    name: "TLG.History.MenuName",
    label: "TLG.History.MenuLabel",
    hint: "TLG.History.MenuHint",
    icon: "fas fa-clock-rotate-left",
    type: HistoryApp,
    restricted: true
  });
});

Hooks.once("ready", () => {
  initSocket();
  initEncounterHooks();

  // Loot Review opens automatically when a combat capture produces a pending
  // session and the GM review gate is on — captureSession() in
  // encounter-service.js only invokes this callback when the gate is on, so
  // no setting check is needed here.
  setOnCaptured((session) => {
    new LootReviewApp({ sessionId: session.id }).render(true);
  });

  foundry.applications.handlebars.loadTemplates([
    `modules/${MODULE_ID}/templates/parts/entry-row.hbs`,
    `modules/${MODULE_ID}/templates/parts/loot-chip.hbs`
  ]);

  // Late joiners / page reloads: any already-released session needs its
  // Distribution window open on this client too. Seed lastKnownStatus first
  // so syncOpenWindows()'s later onChange-driven calls don't treat these as
  // fresh transitions (which would re-post the release chat card / re-open
  // a window the user just closed).
  for (const session of getSessions()) lastKnownStatus.set(session.id, session.status);
  for (const session of getSessions(["released"])) {
    DistributionApp.open(session.id);
  }
});

// Chat card binding: the release card (posted by syncOpenWindows on
// transition into "released") and the finalize summary card (posted by
// finalizer.js, containing an "open history" placeholder for Task 13).
Hooks.on("renderChatMessageHTML", (_message, html) => {
  html.querySelector("[data-tlg-open]")?.addEventListener("click", (event) => {
    DistributionApp.open(event.currentTarget.dataset.tlgOpen);
  });
  html.querySelector('[data-tlg-action="open-history"]')?.addEventListener("click", () => {
    if (!game.user.isGM) return;
    HistoryApp.open();
  });
});

// NPC sheet header button (v13 header-controls hook). If this hook name
// proves wrong at live verification, the actor-directory context menu below
// is the guaranteed path (Task 14 verifies both).
Hooks.on("getHeaderControlsActorSheetV2", (sheet, controls) => {
  if (!game.user.isGM) return;
  if (sheet.document?.type !== "npc") return;
  controls.push({
    icon: "fa-solid fa-coins",
    label: "TLG.AssignTable.Button",
    action: "tlgAssignTable",
    onClick: () => assignFlow(sheet.document)
  });
});

// Actor directory context menu — guaranteed path for boss-table assignment
// regardless of whether the header-controls hook name above is correct.
Hooks.on("getActorContextOptions", (_app, options) => {
  options.push({
    name: "TLG.AssignTable.Button",
    icon: '<i class="fa-solid fa-coins"></i>',
    condition: (li) => {
      if (!game.user.isGM) return false;
      const actor = resolveActorFromListItem(li instanceof HTMLElement ? li : li?.[0]);
      return actor?.type === "npc";
    },
    callback: (li) => {
      const actor = resolveActorFromListItem(li instanceof HTMLElement ? li : li?.[0]);
      if (actor) assignFlow(actor);
    }
  });
});

// Combat tracker controls: "Skip loot" toggle + "Generate loot now" button,
// injected into the tracker footer. Guarded against duplicate injection
// since renderCombatTracker fires often.
Hooks.on("renderCombatTracker", (_app, html) => {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  if (root.querySelector(".tlg-tracker-controls")) return;

  const footer =
    root.querySelector(".combat-tracker-footer") ??
    root.querySelector(".directory-footer") ??
    root.querySelector("footer");

  if (!footer) {
    console.debug("TLG | renderCombatTracker: no footer element found to inject tracker controls into");
    return;
  }

  const combat = game.combat;
  const skipActive = combat ? Boolean(combat.getFlag(MODULE_ID, FLAGS.SKIP)) : false;

  const row = document.createElement("div");
  row.className = "tlg-tracker-controls";

  const skipBtn = document.createElement("button");
  skipBtn.type = "button";
  skipBtn.className = "tlg-tracker-skip";
  skipBtn.disabled = !combat;
  skipBtn.classList.toggle("active", skipActive);
  if (skipActive) skipBtn.setAttribute("aria-pressed", "true");
  skipBtn.innerHTML = `<i class="fas fa-ban"></i> ${game.i18n.localize("TLG.Tracker.SkipLoot")}`;
  skipBtn.addEventListener("click", async () => {
    if (!game.combat) return;
    const next = !game.combat.getFlag(MODULE_ID, FLAGS.SKIP);
    if (next) await game.combat.setFlag(MODULE_ID, FLAGS.SKIP, true);
    else await game.combat.unsetFlag(MODULE_ID, FLAGS.SKIP);
  });

  const generateBtn = document.createElement("button");
  generateBtn.type = "button";
  generateBtn.className = "tlg-tracker-generate";
  generateBtn.disabled = !combat;
  generateBtn.innerHTML = `<i class="fas fa-dice"></i> ${game.i18n.localize("TLG.Tracker.GenerateNow")}`;
  generateBtn.addEventListener("click", async () => {
    if (!game.combat) return;
    await generateNow(game.combat);
    ui.notifications.info(game.i18n.localize("TLG.Tracker.GenerateNowDone"));
  });

  row.append(skipBtn, generateBtn);
  footer.appendChild(row);
});

Hooks.on("getSceneControlButtons", (controls) => {
  const tokenControls = controls.tokens ?? Object.values(controls).find((c) => c.name === "tokens" || c.tools?.select);
  if (!tokenControls) return;

  if (game.user.isGM) {
    tokenControls.tools.tlgTableManager = {
      name: "tlgTableManager",
      title: "TLG.TableManager.SceneControlName",
      icon: "fas fa-list",
      order: Object.keys(tokenControls.tools).length,
      button: true,
      visible: true,
      onClick: () => new TableManagerApp().render(true)
    };
  }

  // Reopen loot windows: any client, GM or player — reopens every currently
  // released session's Distribution window (covers a user who closed it).
  tokenControls.tools.tlgReopenLoot = {
    name: "tlgReopenLoot",
    title: "TLG.Distribution.SceneControlName",
    icon: "fas fa-sack-dollar",
    order: Object.keys(tokenControls.tools).length,
    button: true,
    visible: true,
    onClick: () => {
      for (const session of getSessions(["released"])) DistributionApp.open(session.id);
    }
  };
});
