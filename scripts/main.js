import { MODULE_ID, SETTINGS } from "./config.js";
import { initEncounterHooks, setOnCaptured } from "./core/encounter-service.js";
import { initSocket } from "./core/socket-service.js";
import { getSessions } from "./core/session-store.js";
import { TableManagerApp } from "./apps/table-manager.js";
import { LootReviewApp } from "./apps/loot-review.js";
import { DistributionApp, syncOpenWindows, lastKnownStatus } from "./apps/distribution.js";

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
  // Task 13 will open a GM history dialog here; until then, no-op so the
  // button doesn't throw when clicked.
  html.querySelector('[data-tlg-action="open-history"]')?.addEventListener("click", () => {
    console.log("TLG | open-history clicked — implemented in Task 13");
  });
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
