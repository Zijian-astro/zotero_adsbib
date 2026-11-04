import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TokenStore, TOKEN_REALM } from "../src/credentials";
import { API_ORIGIN } from "../src/ads-client";
import { createPlugin, snapshotItem, MENU_LABEL } from "../src/integration";
import { A, published } from "./helpers";

test("install manifest includes required Zotero metadata and a secure inert update URL", () => {
  const m = JSON.parse(readFileSync(new URL("../plugin/manifest.json", import.meta.url), "utf8"));
  const app = m.applications.zotero;
  assert.equal(m.manifest_version, 2);
  assert.equal(app.id, "ads-bibtex-copier@zotero-adsbib.org");
  assert.equal(app.strict_min_version, "7.0");
  assert.equal(app.strict_max_version, "7.0.*");
  assert.equal(new URL(app.update_url).protocol, "https:");
  assert.equal(new URL(app.update_url).hostname, "example.invalid");
});

test("credential store supports asynchronous current Gecko APIs", async () => {
  let records: any[] = [];
  const store = new TokenStore({
    searchLoginsAsync: async (q: any) => { assert.deepEqual(q, { origin: API_ORIGIN, httpRealm: TOKEN_REALM }); return records; },
    addLoginAsync: async (r: any) => { records.push(r); },
    modifyLoginAsync: async (_old: any, r: any) => { records[0] = r; },
    removeLoginAsync: async (r: any) => { records = records.filter(v => v !== r); },
  }, password => ({ password }));
  assert.equal(await store.get(), "");
  await store.save(" secret-one ");
  assert.equal(await store.get(), "secret-one");
  await store.save("secret-two");
  assert.equal(await store.get(), "secret-two");
  assert.equal(records.length, 1);
  await store.clear();
  assert.equal(await store.get(), "");
});

test("credential store supports Zotero 7 synchronous fallback without plain-text prefs", async () => {
  let record: any;
  const store = new TokenStore({
    findLogins: (origin: string, action: null, realm: string) => { assert.equal(origin, API_ORIGIN); assert.equal(action, null); assert.equal(realm, TOKEN_REALM); return record ? [record] : []; },
    addLogin: (r: any) => { record = r; }, modifyLogin: (_old: any, r: any) => { record = r; }, removeLogin: () => { record = undefined; },
  }, password => ({ password }));
  await store.save("one"); await store.save("two");
  assert.equal(await store.get(), "two");
  await store.clear(); assert.equal(await store.get(), "");
});

test("credential failures never reflect secrets in errors", async () => {
  const store = new TokenStore({ findLogins: () => { throw new Error("sensitive-secret"); } }, () => ({}));
  for (const action of [() => store.get(), () => store.save("sensitive-secret"), () => store.clear()]) {
    await assert.rejects(action(), (e: any) => !e.message.includes("sensitive-secret"));
  }
  await assert.rejects(store.save("bad token"), /without spaces/);
});

class Element {
  hidden = false; disabled = false; removed = false;
  id = ""; attributes: Record<string, string> = {};
  listeners = new Map<string, (...args: any[]) => void>();
  children: Element[] = [];
  setAttribute(k: string, v: string) { this.attributes[k] = v; }
  addEventListener(k: string, fn: (...args: any[]) => void) { this.listeners.set(k, fn); }
  removeEventListener(k: string) { this.listeners.delete(k); }
  appendChild(child: Element) { this.children.push(child); }
  remove() { this.removed = true; }
}

function environment(modern = true) {
  const popup = new Element();
  const regular = { isRegularItem: () => true, getField: (f: string) => f === "extra" ? `ADS Bibcode: ${A}` : f === "title" ? "A paper" : "" };
  const attachment = { isRegularItem: () => false, getField: () => { throw new Error("must ignore"); } };
  let items = [regular, attachment];
  const win = { document: { getElementById: (id: string) => id === "zotero-itemmenu" ? popup : popup.children.find(c => c.id === id), createXULElement: () => new Element() }, ZoteroPane: { getSelectedItems: () => items } };
  let clipboard = "old clipboard";
  let menuOptions: any; let unregistered = false; let paneRemoved = false;
  let login: any;
  const notices: string[] = []; const alerts: string[] = [];
  const Zotero: any = {
    getMainWindows: () => [win], getMainWindow: () => win,
    PreferencePanes: { register: async () => "pane-id", unregister: () => { paneRemoved = true; } },
    ProgressWindow: class { changeHeadline(s: string) { notices.push(s); } show() {} startCloseTimer() {} close() {} },
    ...(modern ? { MenuManager: { registerMenu: (options: any) => { menuOptions = options; return "menu-id"; }, unregisterMenu: () => { unregistered = true; } } } : {}),
  };
  const host = { Zotero,
    Services: { logins: { findLogins: () => login ? [login] : [], addLogin: (r: any) => { login = r; } }, prompt: { alert: (_win: any, _title: string, text: string) => { alerts.push(text); } } },
    Cc: {
      "@mozilla.org/login-manager/loginInfo;1": { createInstance: () => ({ password: "", init(_o: string, _a: any, _r: string, _u: string, password: string) { this.password = password; } }) },
      "@mozilla.org/widget/clipboardhelper;1": { getService: () => ({ copyString: (s: string) => { clipboard = s; } }) },
    }, Ci: {},
    fetch: (async url => Response.json(String(url).includes("search/query") ? { response: { numFound: 1, docs: [{ bibcode: A, identifier: [A] }] } } : { export: published })) as typeof fetch,
    timers: { setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>) },
  };
  return { host, popup, win, regular, attachment, notices, alerts,
    select: (next: any[]) => { items = next; },
    menu: () => menuOptions, clipboard: () => clipboard,
    cleaned: () => paneRemoved && (!modern || unregistered),
  };
}

test("main library API menu registers, labels, filters mixed selections, and unregisters", async () => {
  const env = environment(); const plugin = createPlugin(env.host);
  plugin.addWindow(env.win); // A window hook can precede async startup completion
  assert.equal(env.popup.children.length, 0);
  await plugin.start();
  assert.equal(env.menu().target, "main/library/item");
  const element = new Element(); let visible = false; let enabled = false;
  env.menu().menus[0].onShowing({}, { menuElem: element, items: [env.regular, env.attachment], setVisible: (v: boolean) => { visible = v; }, setEnabled: (v: boolean) => { enabled = v; } });
  assert.equal(element.attributes.label, MENU_LABEL); assert.ok(visible && enabled);
  env.popup.appendChild(element);
  env.menu().menus[0].onShowing({}, { menuElem: element, items: [env.attachment], setVisible: (v: boolean) => { visible = v; }, setEnabled: () => {} });
  assert.equal(visible, false);
  plugin.stop(); assert.ok(element.removed); assert.ok(env.cleaned()); assert.equal(env.host.Zotero.ADSBibTeXCopier, undefined);
});

test("Zotero 7 fallback menu handles window lifecycle and unsupported selections", async () => {
  const env = environment(false); const plugin = createPlugin(env.host);
  await plugin.start(); plugin.addWindow(env.win);
  assert.equal(env.popup.children.length, 1);
  const item = env.popup.children[0];
  assert.equal(item.attributes.label, MENU_LABEL);
  env.popup.listeners.get("popupshowing")!({ target: env.popup });
  assert.equal(item.hidden, false);
  env.select([env.attachment]); env.popup.listeners.get("popupshowing")!({ target: env.popup });
  assert.equal(item.hidden, true);
  plugin.removeWindow(env.win); assert.equal(item.removed, true); assert.equal(env.popup.listeners.size, 0);
  plugin.stop(); assert.ok(env.cleaned());
});

test("integration copies only supported papers, preserves text and reports success", async () => {
  const env = environment(); const plugin = createPlugin(env.host);
  await plugin.start(); await plugin.api.tokens.save("mock-token");
  await plugin.copy(env.win, [env.regular, env.attachment]);
  assert.equal(env.clipboard(), published);
  assert.ok(env.notices.some(s => s === "Copied NASA ADS BibTeX for 1 paper."));
  assert.equal(env.alerts.length, 0);
  plugin.stop();
});

test("integration missing token leaves clipboard unchanged and points to Settings", async () => {
  const env = environment(); const plugin = createPlugin(env.host);
  await plugin.start(); await plugin.copy(env.win, [env.regular]);
  assert.equal(env.clipboard(), "old clipboard");
  assert.match(env.alerts[0], /Settings/);
  plugin.stop();
});

test("integration reports failed item title and reason alongside successful copy", async () => {
  const env = environment(); const plugin = createPlugin(env.host);
  await plugin.start(); await plugin.api.tokens.save("mock-token");
  await plugin.copy(env.win, [env.regular, { isRegularItem: () => true, getField: (name: string) => name === "title" ? "Unidentified paper" : "" }]);
  assert.equal(env.clipboard(), published);
  assert.match(env.alerts[0], /Unidentified paper\nNo valid ADS/);
  plugin.stop();
});

test("snapshot reads metadata safely without modifying items", () => {
  const snap = snapshotItem({ getField: (name: string) => { if (name === "archiveID") throw new Error("unsupported field"); return name === "title" ? "Title" : ""; } });
  assert.equal(snap.title, "Title"); assert.equal(snap.fields.archiveID, "");
});
