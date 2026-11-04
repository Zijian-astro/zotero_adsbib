import { ADSError } from "./errors";
import { API_ORIGIN } from "./ads-client";

export const TOKEN_REALM = "Zotero ADS BibTeX Copier API token";
// XPCOM interfaces differ across Gecko versions; keep that boundary here.
export class TokenStore {
  constructor(private readonly logins: any, private readonly newLogin: (token: string) => any) {}

  private async find(): Promise<any[]> {
    if (typeof this.logins.searchLoginsAsync === "function") {
      return this.logins.searchLoginsAsync({ origin: API_ORIGIN, httpRealm: TOKEN_REALM });
    }
    // Zotero 7 / Firefox 115 has synchronous lookup; Zotero 11 removes it.
    return this.logins.findLogins(API_ORIGIN, null, TOKEN_REALM);
  }

  async get(): Promise<string> {
    try { return (await this.find())[0]?.password || ""; }
    catch { throw new ADSError("credentials", "Could not unlock Zotero's credential store. Please try again in Settings → ADS BibTeX."); }
  }

  async save(token: string): Promise<void> {
    token = token.trim();
    if (!token || /\s/.test(token)) throw new ADSError("auth", "Enter an ADS API token without spaces or line breaks.");
    try {
      const old = await this.find();
      const login = this.newLogin(token);
      if (old.length) {
        if (typeof this.logins.modifyLoginAsync === "function") await this.logins.modifyLoginAsync(old[0], login);
        else this.logins.modifyLogin(old[0], login);
      } else if (typeof this.logins.addLoginAsync === "function") await this.logins.addLoginAsync(login);
      else this.logins.addLogin(login);
      for (const duplicate of old.slice(1)) await this.remove(duplicate);
    } catch { throw new ADSError("credentials", "Could not save the token in Zotero's credential store."); }
  }

  private async remove(login: any): Promise<void> {
    if (typeof this.logins.removeLoginAsync === "function") await this.logins.removeLoginAsync(login);
    else this.logins.removeLogin(login);
  }

  async clear(): Promise<void> {
    try { for (const login of await this.find()) await this.remove(login); }
    catch { throw new ADSError("credentials", "Could not remove the token from Zotero's credential store."); }
  }
}
