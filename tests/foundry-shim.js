export function installShim({ modules = {}, settings = {} } = {}) {
  const store = { ...settings };
  globalThis.game = {
    settings: {
      get: (ns, key) => structuredClone(store[`${ns}.${key}`] ?? getDefault(key)),
      set: async (ns, key, value) => { store[`${ns}.${key}`] = structuredClone(value); return value; }
    },
    modules: { get: (id) => modules[id] },
    i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
    user: { id: "gm1", isGM: true },
    users: []
  };
  globalThis.foundry = { utils: { randomID: () => Math.random().toString(36).slice(2, 12), deepClone: (o) => structuredClone(o) } };
  globalThis.Hooks = { on: () => {}, once: () => {}, callAll: () => {} };
  globalThis.ui = { notifications: { warn: () => {}, info: () => {}, error: () => {} } };
  return { store };
}
function getDefault(key) {
  if (["tableOverrides", "customTables", "sessions"].includes(key)) return {};
  if (key === "keywordRules") return { rules: [] };
  return undefined;
}
