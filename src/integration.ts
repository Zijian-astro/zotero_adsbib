import { ADSClient, API_ORIGIN, type Timers } from "./ads-client";
import { copyPapers } from "./copy-service";
import { TokenStore, TOKEN_REALM } from "./credentials";
import { ADSError, safeReason } from "./errors";
import type { Paper } from "./types";

export const PLUGIN_ID = "ads-bibtex-copier@zotero-adsbib.org";
export const MENU_LABEL = "Copy NASA ADS BibTeX";
const MENU_ID = "adsbib-copy";
const FIELD_NAMES = ["title", "DOI", "url", "extra", "archive", "archiveID", "archiveLocation", "locInArchive", "callNumber"];

// The Zotero/XPCOM boundary is intentionally separate from the typed core.
// API signatures were checked against Zotero's documentation and owning source.
export function snapshotItem(item: any): Paper {
  const fields: Record<string, string> = {};
  for (const name of FIELD_NAMES) {
    try { fields[name] = String(item.getField(name) || ""); }
    catch { fields[name] = ""; } // Fields unavailable for this item type
  }
  return { title: fields.title || "Untitled item", fields };
}

export function createPlugin(host: {
  Zotero: any; Services: any; Cc: any; Ci: any;
  fetch: typeof fetch; timers: Timers;
}) {
  const { Zotero, Services, Cc, Ci } = host;
  const tokens = new TokenStore(Services.logins, token => {
    const login = Cc["@mozilla.org/login-manager/loginInfo;1"].createInstance(Ci.nsILoginInfo);
    login.init(API_ORIGIN, null, TOKEN_REALM, "ADS API token", token, "", "");
    return login;
  });
  const clients = new Set<ADSClient>();
  const windows = new Map<any, () => void>();
  let active = true;
  let busy = false;
  let menuID: string | false = false;
  let paneID: string | undefined;
  const popups = new Set<any>();
  const makeClient = (token: string) => {
    if (!active) throw new ADSError("cancelled", "The plugin was disabled.");
    const client = new ADSClient(token.trim(), host.fetch, host.timers);
    clients.add(client);
    return client;
  };
  const dispose = (client: ADSClient) => { client.close(); clients.delete(client); };
  const supported = (items: any[]) => items.filter(i => i?.isRegularItem?.());

  function notify(win: any, headline: string) {
    const popup = new Zotero.ProgressWindow({ window: win, closeOnClick: true });
    popups.add(popup);
    // Don't retain every completed notification for the entire session.
    if (popups.size > 5) { const old = popups.values().next().value; old.close(); popups.delete(old); }
    popup.changeHeadline(headline);
    popup.show();
    popup.startCloseTimer(6000);
  }

  async function copy(win: any, items: any[]) {
    if (!active || busy) return;
    const papers = supported(items).map(snapshotItem); // Freeze selection before awaiting
    if (!papers.length) return;
    busy = true;
    let client: ADSClient | undefined;
    let progress: any;
    try {
      client = makeClient(await tokens.get());
      if (papers.length > 5) {
        progress = new Zotero.ProgressWindow({ window: win, closeOnClick: false });
        popups.add(progress);
        progress.changeHeadline("Resolving NASA ADS records…");
        progress.show();
      }
      const result = await copyPapers(papers, client, text => {
        if (!active) return;
        Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(text);
      }, (done, total) => progress?.changeHeadline(`Resolving NASA ADS records: ${done}/${total}`));
      if (!active) return;
      const count = result.bibcodes.length;
      const headline = count ? `Copied NASA ADS BibTeX for ${count} ${count === 1 ? "paper" : "papers"}.` : "No NASA ADS BibTeX copied. Clipboard unchanged.";
      const extra = result.duplicates ? ` ${result.duplicates} duplicate selection(s) merged.` : "";
      notify(win, headline + (result.failures.length ? ` ${result.failures.length} item(s) failed.` : ""));
      if (result.failures.length) {
        // A persistent native plain-text dialog shows every failed title/reason.
        Services.prompt.alert(win, "NASA ADS BibTeX — copy report", headline + extra + "\n\n" +
          result.failures.map(f => `${f.title}\n${f.reason}`).join("\n\n"));
      }
    } catch (error) {
      if (active) Services.prompt.alert(win, "NASA ADS BibTeX", safeReason(error));
    } finally {
      if (client) dispose(client);
      if (progress) { progress.close(); popups.delete(progress); }
      busy = false;
    }
  }

  function addWindow(win: any) {
    if (windows.has(win) || !active) return;
    // Window hooks can arrive while asynchronous preference registration is
    // still running. Don't inject a fallback while the official API exists.
    if (Zotero.MenuManager?.registerMenu) {
      // unregisterMenu removes registration immediately but may leave a rendered
      // node until the next popup refresh. Remove our identified node as well.
      windows.set(win, () => win.document.getElementById(MENU_ID)?.remove());
      return;
    }
    // Zotero 7 has no MenuManager. Window hooks + createXULElement are the
    // supported bootstrapped-plugin approach; remove everything on unload.
    const popup = win.document.getElementById("zotero-itemmenu");
    if (!popup) return;
    const item = win.document.createXULElement("menuitem");
    item.id = MENU_ID;
    item.setAttribute("label", MENU_LABEL);
    const showing = (event: Event) => {
      if (event.target !== popup) return;
      item.hidden = !supported(win.ZoteroPane.getSelectedItems()).length;
      item.disabled = busy;
    };
    const command = () => { void copy(win, win.ZoteroPane.getSelectedItems()); };
    item.addEventListener("command", command);
    popup.addEventListener("popupshowing", showing);
    popup.appendChild(item);
    windows.set(win, () => {
      popup.removeEventListener("popupshowing", showing);
      item.removeEventListener("command", command);
      item.remove();
    });
  }

  function removeWindow(win: any) { windows.get(win)?.(); windows.delete(win); }

  const api = {
    tokens,
    safeReason,
    isActive: () => active,
    async testConnection(token?: string) {
      if (!active) return;
      const client = makeClient(token || await tokens.get());
      try { await client.testConnection(); } finally { dispose(client); }
    },
  };

  return {
    api, copy, addWindow, removeWindow,
    async start() {
      Zotero.ADSBibTeXCopier = api;
      paneID = await Zotero.PreferencePanes.register({ id: "adsbib-settings", pluginID: PLUGIN_ID,
        src: "preferences.xhtml", scripts: ["preferences.js"], label: "ADS BibTeX" });
      if (Zotero.MenuManager?.registerMenu) {
        menuID = Zotero.MenuManager.registerMenu({ menuID: MENU_ID, pluginID: PLUGIN_ID, target: "main/library/item",
          menus: [{ menuType: "menuitem",
            onShowing(_event: Event, context: any) {
              // Set the label directly: no Fluent/chrome registration needed.
              context.menuElem.id = MENU_ID;
              context.menuElem.setAttribute("label", MENU_LABEL);
              context.setVisible(supported(context.items || []).length > 0);
              context.setEnabled(!busy);
            },
            onCommand(event: Event, context: any) {
              const win = (event.target as Node)?.ownerDocument?.defaultView || Zotero.getMainWindow();
              void copy(win, context.items || []);
            },
          }],
        });
      }
      for (const win of Zotero.getMainWindows()) addWindow(win);
    },
    stop() {
      active = false;
      for (const client of clients) client.close();
      clients.clear();
      for (const win of windows.keys()) removeWindow(win);
      if (menuID) Zotero.MenuManager.unregisterMenu(menuID);
      if (paneID) Zotero.PreferencePanes.unregister(paneID);
      for (const popup of popups) popup.close();
      popups.clear();
      if (Zotero.ADSBibTeXCopier === api) delete Zotero.ADSBibTeXCopier;
    },
  };
}
