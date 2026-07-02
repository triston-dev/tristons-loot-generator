export function installShim({ modules = {}, settings = {}, user = {}, users = [], actors = [], activeGMId } = {}) {
  const store = { ...settings };
  const socketHandlers = {};
  const socketEmitted = [];
  const socket = {
    on: (name, handler) => {
      (socketHandlers[name] ??= []).push(handler);
    },
    emit: (name, payload) => {
      socketEmitted.push({ name, payload });
    },
    // test helper: not part of the real Foundry API
    _trigger: (name, payload) => {
      for (const handler of socketHandlers[name] ?? []) handler(payload);
    }
  };
  const resolvedActiveGMId = activeGMId ?? users.find((u) => u.isGM && u.active)?.id ?? null;
  globalThis.game = {
    settings: {
      get: (ns, key) => structuredClone(store[`${ns}.${key}`] ?? getDefault(key)),
      set: async (ns, key, value) => { store[`${ns}.${key}`] = structuredClone(value); return value; }
    },
    modules: { get: (id) => modules[id] },
    i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
    user: { id: "gm1", isGM: true, ...user },
    users: {
      activeGM: resolvedActiveGMId ? users.find((u) => u.id === resolvedActiveGMId) ?? { id: resolvedActiveGMId } : null,
      get: (id) => users.find((u) => u.id === id) ?? null
    },
    actors: {
      filter: (fn) => actors.filter(fn)
    },
    socket
  };
  globalThis.foundry = {
    utils: {
      randomID: () => Math.random().toString(36).slice(2, 12),
      deepClone: (o) => structuredClone(o),
      escapeHTML: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
      saveDataToFile: () => {}
    },
    applications: {
      api: {
        // Minimal fakes: sufficient to IMPORT app modules that subclass these
        // and reference DialogV2 statics inside method bodies (not at class-
        // definition time). Not a real ApplicationV2 — no rendering support.
        ApplicationV2: class {
          static DEFAULT_OPTIONS = {};
          static PARTS = {};
          render() { return this; }
        },
        HandlebarsApplicationMixin: (Base) => Base,
        DialogV2: class {
          static async confirm() { return false; }
          static async prompt() { return null; }
          static async wait() { return null; }
        }
      },
      ux: {
        FormDataExtended: class {
          constructor(form) { this.object = form ?? {}; }
        },
        TextEditor: {
          implementation: { getDragEventData: () => null },
          getDragEventData: () => null
        }
      },
      handlebars: {
        loadTemplates: async () => {}
      }
    }
  };
  globalThis.Hooks = { on: () => {}, once: () => {}, callAll: () => {} };
  globalThis.ui = { notifications: { warn: () => {}, info: () => {}, error: () => {} } };
  return { store, socket, socketEmitted };
}
function getDefault(key) {
  if (["tableOverrides", "customTables", "sessions"].includes(key)) return {};
  if (key === "keywordRules") return { rules: [] };
  return undefined;
}
