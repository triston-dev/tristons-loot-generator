import { MODULE_ID, SETTINGS } from "../config.js";
import DND5E from "./dnd5e-pack.js";
import SW5E from "./sw5e-pack.js";

const PACKS = { dnd5e: DND5E, sw5e: SW5E };
export function getPack(id) { return PACKS[id] ?? DND5E; }
export function getActivePack() {
  const forced = game.settings.get(MODULE_ID, SETTINGS.PACK);
  if (forced && forced !== "auto") return getPack(forced);
  return game.modules.get("sw5e")?.active ? SW5E : DND5E;
}
