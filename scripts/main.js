import { MODULE_ID, SETTINGS } from "./config.js";
import { initEncounterHooks } from "./core/encounter-service.js";
import { initSocket } from "./core/socket-service.js";

Hooks.once("init", () => {
  const s = game.settings;
  s.register(MODULE_ID, SETTINGS.AUTO_GENERATE, { name: "TLG.Settings.AutoGenerate", scope: "world", config: true, type: Boolean, default: true });
  s.register(MODULE_ID, SETTINGS.REVIEW_GATE, { name: "TLG.Settings.ReviewGate", scope: "world", config: true, type: Boolean, default: true });
  s.register(MODULE_ID, SETTINGS.GENEROSITY, { name: "TLG.Settings.Generosity", scope: "world", config: true, type: String, default: "standard", choices: { sparse: "TLG.Generosity.Sparse", standard: "TLG.Generosity.Standard", generous: "TLG.Generosity.Generous" } });
  s.register(MODULE_ID, SETTINGS.CARRIED_GEAR, { name: "TLG.Settings.CarriedGear", scope: "world", config: true, type: Boolean, default: true });
  s.register(MODULE_ID, SETTINGS.REMAINDER, { name: "TLG.Settings.Remainder", scope: "world", config: true, type: String, default: "random", choices: { random: "TLG.Remainder.Random", gm: "TLG.Remainder.GM" } });
  s.register(MODULE_ID, SETTINGS.PACK, { name: "TLG.Settings.Pack", scope: "world", config: true, type: String, default: "auto", choices: { auto: "TLG.Pack.Auto", dnd5e: "TLG.Pack.Dnd5e", sw5e: "TLG.Pack.Sw5e" } });
  s.register(MODULE_ID, SETTINGS.CHAT_VIS, { name: "TLG.Settings.ChatVis", scope: "world", config: true, type: String, default: "public", choices: { public: "TLG.ChatVis.Public", gm: "TLG.ChatVis.GM" } });
  for (const key of [SETTINGS.TABLE_OVERRIDES, SETTINGS.CUSTOM_TABLES, SETTINGS.SESSIONS]) {
    s.register(MODULE_ID, key, { scope: "world", config: false, type: Object, default: {} });
  }
  s.register(MODULE_ID, SETTINGS.KEYWORD_RULES, { scope: "world", config: false, type: Object, default: { rules: [] } });
});

Hooks.once("ready", () => {
  initSocket();
  initEncounterHooks();
});
