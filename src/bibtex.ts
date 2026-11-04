import { ADSError } from "./errors";

export interface RawEntry { key: string; raw: string }

// Only locate entry boundaries and keys for validation/reordering. Fields are
// never parsed, interpreted, unescaped, or serialized. Fail closed on unexpected
// syntax rather than risking a corrupted or unrelated citation.
export function scanEntries(text: string): RawEntry[] {
  const entries: RawEntry[] = [];
  let i = 0;
  const invalid = () => new ADSError("response", "ADS returned unexpected or incomplete BibTeX. No unverified entries were copied.");
  while (i < text.length) {
    while (/\s/.test(text[i] || "") && i < text.length) i++;
    if (i === text.length) break;
    const start = i;
    const header = /^@[A-Za-z]+\s*\{\s*([^\s,{}]+)\s*,/.exec(text.slice(i));
    if (!header) throw invalid();
    i += header[0].length;
    let depth = 1;
    let quoted = false;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === "\\") { i++; continue; }
      // A quote only delimits strings at entry depth, never within braced values.
      if (c === '"' && depth === 1) { quoted = !quoted; continue; }
      if (c === "{" ) depth++;
      else if (c === "}") {
        if (quoted && depth === 1) continue;
        depth--;
        if (depth === 0) { i++; break; }
      }
    }
    if (depth !== 0 || quoted) throw invalid();
    entries.push({ key: header[1], raw: text.slice(start, i) });
  }
  if (new Set(entries.map(e => e.key)).size !== entries.length) throw invalid();
  return entries;
}

export function validateExport(text: string, requested: string[]): RawEntry[] {
  const entries = scanEntries(text);
  if (entries.some(e => !requested.includes(e.key))) throw new ADSError("response", "ADS returned an unexpected citation key. No unverified entries were copied.");
  return entries;
}

export function orderedText(original: string | undefined, entries: RawEntry[], order: string[]): string {
  if (original !== undefined && entries.length === order.length && entries.every((e, i) => e.key === order[i])) return original;
  const byKey = new Map(entries.map(e => [e.key, e.raw]));
  return order.filter(k => byKey.has(k)).map(k => byKey.get(k)!).join("\n\n");
}
