import { ADSError } from "./errors";
import type { ADSRecord } from "./types";

export const API_ORIGIN = "https://api.adsabs.harvard.edu";
export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}
const defaultTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: id => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
};

export class ADSClient {
  private controllers = new Set<AbortController>();
  private closed = false;
  constructor(private readonly token: string, private readonly fetcher: typeof fetch = fetch,
    private readonly timers = defaultTimers, private readonly timeout = 30_000) {
    if (!token || /\s/.test(token)) throw new ADSError("auth", "Enter a valid ADS API token in Settings → ADS BibTeX.");
  }

  close(): void {
    this.closed = true;
    for (const c of this.controllers) c.abort();
  }

  private async request(endpoint: "search/query" | "export/bibtex", params?: URLSearchParams, body?: object): Promise<any> {
    if (this.closed) throw new ADSError("cancelled", "The operation was cancelled.");
    const url = `${API_ORIGIN}/v1/${endpoint}${params ? `?${params}` : ""}`;
    const controller = new AbortController();
    this.controllers.add(controller);
    let timedOut = false;
    const timer = this.timers.setTimeout(() => { timedOut = true; controller.abort(); }, this.timeout);
    try {
      const response = await this.fetcher(url, {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal, redirect: "error", credentials: "omit", referrerPolicy: "no-referrer",
      });
      if (response.status === 401 || response.status === 403) throw new ADSError("auth", "ADS rejected the API token. Check your token in Settings → ADS BibTeX.");
      if (response.status === 429) {
        const seconds = response.headers.get("Retry-After");
        const suffix = seconds && /^\d{1,6}$/.test(seconds) ? ` Retry after ${seconds} seconds.` : " Try again after your ADS quota resets.";
        throw new ADSError("rate", `ADS API rate limit reached.${suffix}`);
      }
      if (response.status >= 500) throw new ADSError("server", "The ADS service is temporarily unavailable. Please try again later.");
      if (!response.ok) throw new ADSError("response", `ADS returned HTTP ${response.status}.`);
      // Do not include response content in exceptions or logs.
      try { return await response.json(); }
      catch {
        if (controller.signal.aborted) throw new ADSError(timedOut ? "timeout" : "cancelled", timedOut ? "The ADS request timed out. Please try again." : "The operation was cancelled.");
        throw new ADSError("response", "ADS returned an invalid JSON response.");
      }
    } catch (error) {
      if (error instanceof ADSError) throw error;
      if (timedOut) throw new ADSError("timeout", "The ADS request timed out. Please try again.");
      if (this.closed) throw new ADSError("cancelled", "The operation was cancelled.");
      throw new ADSError("network", "Could not reach the official ADS API. Check your network connection.");
    } finally {
      this.timers.clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }

  async search(query: string): Promise<{ numFound: number; docs: ADSRecord[] }> {
    const result = await this.request("search/query", new URLSearchParams({ q: query, fl: "bibcode,doi,identifier,alternate_bibcode", rows: "10" }));
    const r = result?.response;
    if (!r || !Number.isInteger(r.numFound) || r.numFound < 0 || !Array.isArray(r.docs) ||
      r.docs.some((d: any) => !d || typeof d.bibcode !== "string" ||
        [d.doi, d.identifier, d.alternate_bibcode].some(a => a !== undefined && (!Array.isArray(a) || a.some(v => typeof v !== "string"))))) {
      throw new ADSError("response", "ADS returned an invalid search response.");
    }
    return r;
  }

  async exportBibtex(bibcodes: string[]): Promise<string> {
    const result = await this.request("export/bibtex", undefined, { bibcode: bibcodes, sort: "no sort" });
    if (typeof result?.export !== "string") throw new ADSError("response", "ADS returned no BibTeX export text.");
    return result.export; // No trim, newline normalization, or BibTeX serialization.
  }

  async testConnection(): Promise<void> { await this.search('bibcode:"2015ApJS..219...21Z"'); }
}
