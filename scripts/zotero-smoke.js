// Appended ONLY to a temporary test copy of bootstrap.js, never the release XPI.
// The staging script substitutes the report/fixture paths below.
var releaseStartup = startup;
startup = async function (data, reason) {
  await releaseStartup(data, reason);
  const timers = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
  timers.setTimeout(async () => {
    const report = { version: Zotero.version, checks: [], error: null };
    function check(name, value) {
      report.checks.push({ name, passed: !!value });
      if (!value) throw new Error(name);
    }
    async function waitFor(fn) {
      for (let i = 0; i < 100; i++) {
        const value = fn();
        if (value) return value;
        await new Promise(r => timers.setTimeout(r, 100));
      }
      throw new Error("Timed out waiting for UI");
    }
    try {
      await Zotero.uiReadyPromise;
      check("production bootstrap initialized", !!instance && !!Zotero.ADSBibTeXCopier);
      const win = Zotero.getMainWindow();
      await waitFor(() => win.ZoteroPane?.itemsView);
      check("settings pane registered", Zotero.PreferencePanes.pluginPanes.some(p => p.id === "adsbib-settings"));
      await instance.api.tokens.save("smoke-test-token");
      check("real credential store save/read", await instance.api.tokens.get() === "smoke-test-token");
      await instance.api.tokens.save("replacement-smoke-token");
      check("real credential store replace", await instance.api.tokens.get() === "replacement-smoke-token");
      await instance.api.tokens.clear();
      check("real credential store remove", await instance.api.tokens.get() === "");
      const item = new Zotero.Item("journalArticle");
      item.setField("title", "ADS BibTeX isolated smoke-test paper");
      item.setField("extra", "ADS Bibcode: 2015ApJS..219...21Z");
      if (Zotero.MenuManager?.updateMenuPopup) {
        // A synthetic selection context avoids depending on the development
        // build's changing collection-tree selection APIs.
        Zotero.MenuManager.updateMenuPopup(win.document.getElementById("zotero-itemmenu"),
          "main/library/item", { event: new win.Event("popupshowing"), getContext: () => ({ items: [item] }) });
      } else {
        await item.saveTx(); // Only the disposable test library
        await win.ZoteroPane.selectItem(item.id);
        await win.ZoteroPane.buildItemContextMenu();
      }
      const getMenus = () => [...win.document.getElementById("zotero-itemmenu").querySelectorAll("menuitem")].filter(n => n.getAttribute("label") === "Copy NASA ADS BibTeX");
      check("real context-menu API renders synthetic selection", getMenus().length === 1 && !getMenus()[0].hidden);
      Zotero.Utilities.Internal.openPreferences("adsbib-settings");
      const prefWin = await waitFor(() => Services.wm.getMostRecentWindow("zotero:pref"));
      const root = await waitFor(() => prefWin.document.getElementById("adsbib-preferences"));
      await waitFor(() => root.dataset.initialized === "true");
      check("preference markup and external script loaded", !!prefWin.document.getElementById("adsbib-token"));
      const input = prefWin.document.getElementById("adsbib-token");
      await waitFor(() => !prefWin.document.getElementById("adsbib-save").disabled);
      input.value = "settings-smoke-token";
      prefWin.document.getElementById("adsbib-save").click();
      await waitFor(() => prefWin.document.getElementById("adsbib-status").textContent === "Token saved.");
      check("settings Save Token handler", await instance.api.tokens.get() === "settings-smoke-token" && input.value === "");
      let tested = false;
      const originalTest = instance.api.testConnection;
      instance.api.testConnection = async () => { tested = true; };
      prefWin.document.getElementById("adsbib-test").click();
      await waitFor(() => tested && prefWin.document.getElementById("adsbib-status").textContent.includes("Authentication succeeded"));
      check("Test Connection UI handler (mocked API)", tested);
      instance.api.testConnection = originalTest;
      prefWin.document.getElementById("adsbib-remove").click();
      await waitFor(() => prefWin.document.getElementById("adsbib-status").textContent === "Saved token removed.");
      check("settings Remove Saved Token handler", await instance.api.tokens.get() === "");
      instance.stop();
      check("menu and preferences cleanup", getMenus().length === 0 && !Zotero.PreferencePanes.pluginPanes.some(p => p.id === "adsbib-settings"));
      // Exercise actual Zotero notification/window code using mocked ADS HTTP
      // and a clipboard sink, preserving the user's system clipboard.
      const fixture = await IOUtils.readUTF8(__SMOKE_FIXTURE__);
      let clipboard = "untouched";
      const alerts = [];
      let requests = 0;
      // Use a plain adapter: XPCOM class registries can bypass Proxy traps.
      const testCc = {
        "@mozilla.org/login-manager/loginInfo;1": Cc["@mozilla.org/login-manager/loginInfo;1"],
        "@mozilla.org/widget/clipboardhelper;1": { getService: () => ({ copyString: text => { clipboard = text; } }) },
      };
      const testServices = { logins: Services.logins, prompt: { alert: (_win, _title, text) => alerts.push(text) } };
      instance = ADSBibTeXPlugin.createPlugin({ Zotero, Services: testServices, Cc: testCc, Ci, timers,
        fetch: async url => { requests++; return { ok: true, status: 200, json: async () => String(url).includes("search/query") ?
          { response: { numFound: 1, docs: [{ bibcode: "2015ApJS..219...21Z", identifier: ["2015ApJS..219...21Z"] }] } } : { export: fixture } }; },
      });
      await instance.start();
      await instance.api.tokens.save("smoke-test-token");
      await instance.copy(win, [item]);
      report.copyDiagnostics = { requests, alerts, clipboardWritten: clipboard !== "untouched" };
      check("Zotero copy workflow with mocked ADS and clipboard", clipboard === fixture);
      await instance.api.tokens.clear();
      // Leave the real settings pane visible for optional visual inspection.
      prefWin.close();
      Zotero.Utilities.Internal.openPreferences("adsbib-settings");
    } catch (error) {
      report.error = String(error.message || "Smoke test error");
    } finally {
      await IOUtils.writeUTF8(__SMOKE_REPORT__, JSON.stringify(report, null, 2));
    }
  }, 0);
};
