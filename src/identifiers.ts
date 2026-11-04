import { ADSError } from "./errors";
import type { Identifiers, Paper } from "./types";

// ADS bibcodes are exactly 19 characters. Punctuation is meaningful.
export const isBibcode = (s: string): boolean => /^[12]\d{3}[A-Za-z0-9.&]{5}[A-Za-z0-9.]{4}[A-Za-z0-9.][A-Za-z0-9.]{4}[A-Za-z.]$/.test(s);

function decode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

export function normalizeDOI(value: string): string | undefined {
  const s = decode(value.trim()).replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "");
  return /^10\.\d{4,9}\/[^\s"<>]+$/i.test(s) ? s.toLowerCase() : undefined;
}

export function normalizeArxiv(value: string): string | undefined {
  const s = decode(value.trim()).replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, "")
    .replace(/^arxiv:\s*/i, "").replace(/\.pdf$/i, "").replace(/v\d+$/i, "");
  return /^(?:\d{4}\.\d{4,5}|[a-z][a-z.-]+\/\d{7})$/i.test(s) ? s.toLowerCase() : undefined;
}

function adsURL(value: string): string | undefined {
  const match = value.trim().match(/^https?:\/\/(?:ui\.)?adsabs\.harvard\.edu\/(?:#\/)?abs\/([^/?#]+)/i);
  const code = match && decode(match[1]);
  return code && isBibcode(code) ? code : undefined;
}

function unique(values: (string | undefined)[], label: string): string | undefined {
  const found = [...new Set(values.filter((v): v is string => !!v))];
  if (found.length > 1) throw new ADSError("ambiguous", `Conflicting ${label} values in this item's metadata.`);
  return found[0];
}

export function extractIdentifiers(paper: Paper): Identifiers {
  const f = paper.fields;
  const extra = new Map<string, string[]>();
  for (const line of (f.extra || "").split(/\r?\n/)) {
    const m = line.match(/^\s*([^:]+):\s*(.*?)\s*$/);
    if (m) {
      const key = m[1].toLowerCase().replace(/[\s_-]/g, "");
      extra.set(key, [...(extra.get(key) || []), m[2]]);
    }
  }
  const values = (...keys: string[]) => keys.flatMap(k => extra.get(k) || []);
  const bibcode = unique([
    ...values("bibcode", "adsbibcode", "ads").map(v => isBibcode(v) ? v : adsURL(v)),
    adsURL(f.url || ""),
    ...[f.archiveID, f.archiveLocation, f.callNumber].map(v => v && isBibcode(v.trim()) ? v.trim() : undefined),
  ], "ADS bibcode");
  // A reliable higher-priority identifier is sufficient; unrelated lower-priority
  // metadata must not prevent it from being used.
  if (bibcode) return { bibcode };
  const doi = unique([f.DOI, ...values("doi"), /^https?:\/\/(?:dx\.)?doi\.org\//i.test(f.url || "") ? f.url : ""].map(v => normalizeDOI(v || "")), "DOI");
  const arxiv = unique([
    ...values("arxiv", "arxivid", "eprint", "archiveid").map(normalizeArxiv),
    ...[f.archiveID, f.archiveLocation, f.locInArchive].map(v => normalizeArxiv(v || "")),
    /^https?:\/\/(?:www\.)?arxiv\.org\//i.test(f.url || "") ? normalizeArxiv(f.url) : undefined,
    doi?.startsWith("10.48550/arxiv.") ? normalizeArxiv(doi.slice("10.48550/arxiv.".length)) : undefined,
  ], "arXiv identifier");
  return { doi, arxiv };
}
