import { ADSError } from "./errors";
import { extractIdentifiers, isBibcode, normalizeArxiv, normalizeDOI } from "./identifiers";
import type { ADSClient } from "./ads-client";
import type { ADSRecord, Paper } from "./types";

const quote = (s: string) => `"${s.replace(/([\\"])/g, "\\$1")}"`;

export async function resolvePaper(paper: Paper, client: Pick<ADSClient, "search">): Promise<string> {
  const ids = extractIdentifiers(paper);
  const candidates: { query: string; exact: (doc: ADSRecord) => boolean }[] = [];
  if (ids.bibcode) candidates.push({
    query: `identifier:${quote(ids.bibcode)}`,
    exact: d => [d.bibcode, ...(d.alternate_bibcode || []), ...(d.identifier || [])].includes(ids.bibcode!),
  });
  if (ids.doi) candidates.push({
    query: `doi:${quote(ids.doi)}`,
    exact: d => (d.doi || []).some(v => normalizeDOI(v) === ids.doi),
  });
  if (ids.arxiv) candidates.push({
    query: `identifier:${quote(`arXiv:${ids.arxiv}`)}`,
    exact: d => (d.identifier || []).some(v => normalizeArxiv(v) === ids.arxiv),
  });
  if (!candidates.length) throw new ADSError("missing", "No valid ADS bibcode, DOI, or arXiv identifier. Add one in the item's metadata or Extra field.");
  for (const candidate of candidates) {
    const result = await client.search(candidate.query);
    if (!result.numFound && !result.docs.length) continue;
    if (result.numFound > result.docs.length) throw new ADSError("ambiguous", "ADS returned too many matches; add an explicit ADS bibcode in Extra.");
    const exact = result.docs.filter(candidate.exact);
    const codes = [...new Set(exact.map(d => d.bibcode))];
    if (codes.length > 1) throw new ADSError("ambiguous", "Multiple ADS records match this identifier; add an explicit ADS bibcode in Extra.");
    if (codes.length === 1 && isBibcode(codes[0])) return codes[0];
    // Never use a search hit whose identifier doesn't exactly match.
  }
  throw new ADSError("missing", "No exact ADS record found for the available identifier(s).");
}
