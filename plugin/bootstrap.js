/* global Zotero, Services, Cc, Ci, Cu, ChromeUtils, ADSBibTeXPlugin */
var instance;

async function startup({ rootURI }) {
  Cu.importGlobalProperties(["fetch", "AbortController", "URL", "URLSearchParams"]);
  const timers = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
  Services.scriptloader.loadSubScript(rootURI + "plugin.js", this);
  instance = ADSBibTeXPlugin.createPlugin({ Zotero, Services, Cc, Ci, fetch, timers });
  try { await instance.start(); }
  catch (_error) {
    instance.stop();
    instance = undefined;
    // Never log raw exceptions, which could include credentials.
    Zotero.logError("ADS BibTeX Copier could not initialize.");
  }
}

function onMainWindowLoad({ window }) { instance?.addWindow(window); }
function onMainWindowUnload({ window }) { instance?.removeWindow(window); }
function shutdown() { instance?.stop(); instance = undefined; }
function install() {}
function uninstall() {}
