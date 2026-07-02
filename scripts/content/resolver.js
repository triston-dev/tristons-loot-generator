const cache = new Map();
export function clearRefCache() { cache.clear(); }
export async function resolveRef(ref, pack) {
  const key = `${ref.name}`.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const packIds = ref.packs ?? pack.itemPacks;
  for (const pid of packIds) {
    const cp = game.packs?.get(pid);
    if (!cp) continue;
    const index = await cp.getIndex();
    const hit = index.find((e) => e.name.toLowerCase() === key);
    if (hit) { const uuid = hit.uuid ?? `Compendium.${pid}.Item.${hit._id}`; cache.set(key, uuid); return uuid; }
  }
  console.warn(`${"TLG"} | unresolved item ref: ${ref.name}`);
  cache.set(key, null);
  return null;
}
