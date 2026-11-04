import { ADSClient } from "./ads-client";
import { orderedText, validateExport, type RawEntry } from "./bibtex";
import { ADSError, safeReason, stopsRequests } from "./errors";
import { resolvePaper } from "./resolver";
import type { CopyResult, Paper } from "./types";

export interface CopyAPI extends Pick<ADSClient, "search" | "exportBibtex"> {}

export async function collectBibtex(papers: Paper[], client: CopyAPI,
  progress: (done: number, total: number) => void = () => {}): Promise<CopyResult> {
  const result: CopyResult = { text: "", bibcodes: [], failures: [], duplicates: 0 };
  const resolved = new Map<string, Paper[]>();
  const cache = new Map<string, Promise<string>>();
  let stopped: unknown;
  for (let i = 0; i < papers.length; i++) {
    const paper = papers[i];
    try {
      if (stopped) throw stopped;
      const key = JSON.stringify(paper.fields);
      if (!cache.has(key)) cache.set(key, resolvePaper(paper, client));
      const code = await cache.get(key)!;
      if (resolved.has(code)) { resolved.get(code)!.push(paper); result.duplicates++; }
      else resolved.set(code, [paper]);
    } catch (error) {
      result.failures.push({ title: paper.title, reason: safeReason(error) });
      if (stopsRequests(error)) stopped = error;
    }
    progress(i + 1, papers.length);
  }
  const codes = [...resolved.keys()];
  // Conservatively bound export size well below the ADS service limit.
  const chunks: string[] = [];
  for (let offset = 0; offset < codes.length; offset += 100) {
    const batch = codes.slice(offset, offset + 100);
    const found = new Map<string, RawEntry>();
    let original: string | undefined;
    let batchError: unknown = stopped;
    if (!stopped) {
      try {
        original = await client.exportBibtex(batch);
        for (const entry of validateExport(original, batch)) found.set(entry.key, entry);
      } catch (error) {
        original = undefined;
        batchError = error;
        if (stopsRequests(error)) stopped = error;
      }
    }
    // Recover omitted entries and isolate record-specific export failures.
    for (const code of batch) {
      if (found.has(code)) continue;
      try {
        if (stopped) throw stopped;
        // A failed single export is already definitive; don't repeat it.
        if (batch.length === 1 && batchError) throw batchError;
        const text = await client.exportBibtex([code]);
        const entries = validateExport(text, [code]);
        if (entries.length !== 1) throw new ADSError("missing", "ADS did not return a BibTeX entry for this record.");
        found.set(code, entries[0]);
        if (batch.length === 1) original = text;
      } catch (error) {
        for (const paper of resolved.get(code)!) result.failures.push({ title: paper.title, reason: safeReason(error) });
        if (stopsRequests(error)) stopped = error;
      }
    }
    const exported = batch.filter(code => found.has(code));
    result.bibcodes.push(...exported);
    if (exported.length) {
      const rawEntries = [...found.values()];
      // Reuse the untouched response only if it contains all successful entries.
      const canReuse = original !== undefined && validateExport(original, batch).length === rawEntries.length;
      chunks.push(orderedText(canReuse ? original : undefined, rawEntries, exported));
    }
  }
  result.text = chunks.join("\n\n");
  return result;
}

export async function copyPapers(papers: Paper[], client: CopyAPI, writeClipboard: (text: string) => void,
  progress?: (done: number, total: number) => void): Promise<CopyResult> {
  const result = await collectBibtex(papers, client, progress);
  if (result.bibcodes.length && result.text) writeClipboard(result.text);
  return result;
}
