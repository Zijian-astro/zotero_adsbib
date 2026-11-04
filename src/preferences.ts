declare const Zotero: any;

// Preference scripts run before their XHTML is inserted. Observe insertion
// instead of using inline event handlers or assuming a window load event.
const observer = new MutationObserver(init);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("unload", () => observer.disconnect(), { once: true });
init();

function init() {
  const root = document.getElementById("adsbib-preferences");
  if (!root || root.dataset.initialized) return;
  root.dataset.initialized = "true";
  observer.disconnect();
  const input = document.getElementById("adsbib-token") as HTMLInputElement;
  const status = document.getElementById("adsbib-status")!;
  const stored = document.getElementById("adsbib-stored")!;
  const buttons = [...root.querySelectorAll("button")];
  const api = Zotero.ADSBibTeXCopier;
  const show = (text: string) => { status.textContent = text; };
  async function refresh() {
    const hasToken = !!await api.tokens.get();
    stored.textContent = hasToken ? "A token is saved in Zotero's credential store." : "No token saved yet.";
  }
  async function run(action: () => Promise<void>) {
    buttons.forEach(b => { b.disabled = true; });
    try {
      if (!api?.isActive()) throw new Error("disabled");
      await action();
    } catch (error) { show(api?.safeReason(error) || "The plugin is disabled. Reopen Settings after enabling it."); }
    finally { buttons.forEach(b => { b.disabled = false; }); }
  }
  document.getElementById("adsbib-save")!.addEventListener("click", () => void run(async () => {
    await api.tokens.save(input.value);
    input.value = "";
    await refresh();
    show("Token saved.");
  }));
  document.getElementById("adsbib-test")!.addEventListener("click", () => void run(async () => {
    show("Testing connection to NASA ADS…");
    const entered = input.value.trim();
    await api.testConnection(entered || undefined);
    show(entered ? "Authentication succeeded. Click Save Token to keep this token." : "Authentication succeeded with the saved token.");
  }));
  document.getElementById("adsbib-remove")!.addEventListener("click", () => void run(async () => {
    await api.tokens.clear();
    input.value = "";
    await refresh();
    show("Saved token removed.");
  }));
  document.getElementById("adsbib-token-link")!.addEventListener("click", () => Zotero.launchURL("https://ui.adsabs.harvard.edu/user/settings/token"));
  void run(refresh);
}
