export const MODULE_ID = "tristons-loot-generator";
export const SOCKET_NAME = `module.${MODULE_ID}`;

export const SETTINGS = {
  AUTO_GENERATE: "autoGenerate",
  REVIEW_GATE: "reviewGate",
  GENEROSITY: "generosity",
  CARRIED_GEAR: "carriedGear",
  REMAINDER: "currencyRemainder",
  PACK: "contentPack",
  CHAT_VIS: "chatVisibility",
  TABLE_OVERRIDES: "tableOverrides",
  CUSTOM_TABLES: "customTables",
  KEYWORD_RULES: "keywordRules",
  SESSIONS: "sessions"
};

export const FLAGS = {
  TABLE: "tableId",      // actor flag: boss/unique override table id
  ROLLED: "rolled",      // combat flag: { [combatantId]: RolledLoot }
  SKIP: "skipLoot",      // combat flag: boolean
  NO_LOOT: "noLoot",     // item flag: exclude from carried gear
  STARTED: "lootRolled"  // combat flag: generation ran for this combat
};

export const GENEROSITY = { sparse: 0.5, standard: 1, generous: 2 };
export const ROLL_SHIFT = { sparse: -1, standard: 0, generous: 1 };
