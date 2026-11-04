import test from "node:test";
import assert from "node:assert/strict";
import { ADSClient } from "../src/ads-client";
import { ADSError } from "../src/errors";
import { extractIdentifiers, isBibcode, normalizeArxiv, normalizeDOI } from "../src/identifiers";
import { resolvePaper } from "../src/resolver";
import { scanEntries, validateExport, orderedText } from "../src/bibtex";
import { collectBibtex, copyPapers, type CopyAPI } from "../src/copy-service";
import { A, B, C, published, preprint, mnras, aap, paper, byCode, searchResult } from "./helpers";

test("finds bibcode in Extra, ADS URL, legacy URL and archive metadata", () => {
  for (const fields of [{ extra: `Bibcode: ${A}` }, { extra: `ADS Bibcode: ${A}` },
    { url: `https://ui.adsabs.harvard.edu/abs/${A}/abstract` },
    { url: `https://ui.adsabs.harvard.edu/#/abs/${A}/abstract` }, { archiveLocation: A }] as Record<string, string>[]) {
    assert.equal(extractIdentifiers(paper(fields)).bibcode, A);
  }
  assert.ok(isBibcode("2020A&A...641A...6P"));
  assert.ok(!isBibcode("not-a-bibcode"));
});

test("normalizes DOI and modern/legacy/versioned arXiv identifiers", () => {
  assert.equal(normalizeDOI("https://doi.org/10.1234/ABC(1)"), "10.1234/abc(1)");
  for (const value of ["arXiv:2401.12345v2", "https://arxiv.org/pdf/2401.12345v3.pdf", "2401.12345"]) {
    assert.equal(normalizeArxiv(value), "2401.12345");
  }
  assert.equal(normalizeArxiv("astro-ph/0601001v2"), "astro-ph/0601001");
  assert.equal(extractIdentifiers(paper({ DOI: "10.48550/arXiv.2401.12345" })).arxiv, "2401.12345");
  assert.equal(extractIdentifiers(paper({ extra: "arXiv: 2401.12345v2" })).arxiv, "2401.12345");
  assert.equal(extractIdentifiers(paper({ url: "https://evil.test/2401.12345" })).arxiv, undefined);
});

test("conflicting bibcodes are rejected; higher priority bibcode wins over DOI", () => {
  assert.throws(() => extractIdentifiers(paper({ extra: `Bibcode: ${A}\nADS Bibcode: ${B}` })), /Conflicting/);
  assert.deepEqual(extractIdentifiers(paper({ extra: `Bibcode: ${A}\nDOI: 10.1234/a\nDOI: 10.1234/b` })), { bibcode: A });
});

test("resolves existing bibcode and canonicalizes alternate bibcodes", async () => {
  let query = "";
  const code = await resolvePaper(byCode(A), { search: async q => { query = q; return { numFound: 1, docs: [{ bibcode: C, alternate_bibcode: [A] }] }; } });
  assert.equal(query, `identifier:"${A}"`);
  assert.equal(code, C);
});

test("resolves DOI-only paper using exact returned DOI", async () => {
  const code = await resolvePaper(paper({ DOI: "10.1234/ABC" }), { search: async q => {
    assert.equal(q, 'doi:"10.1234/abc"');
    return { numFound: 1, docs: [{ bibcode: A, doi: ["10.1234/abc"] }] };
  } });
  assert.equal(code, A);
});

test("resolves arXiv-only paper including legacy identifiers", async () => {
  for (const id of ["2401.12345", "astro-ph/0601001"]) {
    assert.equal(await resolvePaper(paper({ archiveID: id }), { search: async q => {
      assert.equal(q, `identifier:"arXiv:${id}"`);
      return { numFound: 1, docs: [{ bibcode: B, identifier: [`arXiv:${id}`] }] };
    } }), B);
  }
});

test("falls back from unindexed DOI to exact arXiv ID", async () => {
  let n = 0;
  const code = await resolvePaper(paper({ DOI: "10.1234/missing", extra: "arXiv: 2401.12345" }), { search: async () => ++n === 1 ?
    { numFound: 0, docs: [] } : { numFound: 1, docs: [{ bibcode: B, identifier: ["arXiv:2401.12345"] }] } });
  assert.equal(code, B);
});

test("missing identifiers never trigger title guessing", async () => {
  await assert.rejects(resolvePaper(paper({ title: "Known paper" }), { search: async () => { throw new Error("must not search"); } }), /No valid ADS/);
});

test("rejects ambiguous, truncated, and inexact identifier matches", async () => {
  for (const response of [
    { numFound: 2, docs: [{ bibcode: A, doi: ["10.1234/a"] }, { bibcode: B, doi: ["10.1234/a"] }] },
    { numFound: 12, docs: [{ bibcode: A, doi: ["10.1234/a"] }] },
    { numFound: 1, docs: [{ bibcode: A, doi: ["10.1234/other"] }] },
  ]) await assert.rejects(resolvePaper(paper({ DOI: "10.1234/a" }), { search: async () => response }));
});

test("single-entry formatting is exactly the ADS response, including outer whitespace and CRLF", async () => {
  for (const fixture of [published, preprint, mnras, aap, ` \r\n${published}\t\n`]) {
    const code = scanEntries(fixture)[0].key;
    let copied = "previous clipboard";
    const result = await copyPapers([byCode(code)], { search: async () => searchResult(code), exportBibtex: async () => fixture }, s => { copied = s; });
    assert.equal(copied, fixture);
    assert.equal(result.text, fixture);
  }
});

test("scanner preserves macros, long author lists, special characters and nested apparent entry headers", () => {
  assert.equal(scanEntries(published + preprint + mnras + aap).length, 4);
  for (const fixture of [published, preprint, mnras, aap]) {
    const entry = scanEntries(fixture)[0];
    assert.equal(entry.raw, fixture.slice(0, fixture.lastIndexOf("}") + 1));
  }
});

test("scanner rejects malformed exports, duplicate keys and unrelated entries", () => {
  for (const fixture of [published.slice(0, -5), "HTML error", published + published, "@ARTICLE{bad, title = {open}"]) assert.throws(() => scanEntries(fixture));
  assert.throws(() => validateExport(preprint, [A]), /unexpected citation key/);
});

test("batch export uses one request, deduplicates, and retains exact in-order response", async () => {
  const requests: string[][] = [];
  const api: CopyAPI = { search: async q => searchResult(q.includes(A) ? A : B), exportBibtex: async codes => { requests.push(codes); return published + preprint; } };
  const result = await collectBibtex([byCode(A), byCode(B), byCode(A)], api);
  assert.deepEqual(requests, [[A, B]]);
  assert.deepEqual(result.bibcodes, [A, B]);
  assert.equal(result.duplicates, 1);
  assert.equal(result.text, published + preprint);
});

test("reorders whole unmodified entries when ADS ignores requested order", async () => {
  const result = await collectBibtex([byCode(A), byCode(B)], { search: async q => searchResult(q.includes(A) ? A : B), exportBibtex: async () => preprint + published });
  assert.deepEqual(scanEntries(result.text), [...scanEntries(published), ...scanEntries(preprint)]);
  assert.equal(result.text, orderedText(preprint + published, scanEntries(preprint + published), [A, B]));
});

test("partial resolution copies successes and reports failed titles and reasons", async () => {
  let copied = "old";
  const result = await copyPapers([byCode(A), paper({}, "Missing paper")], { search: async () => searchResult(A), exportBibtex: async () => published }, s => { copied = s; });
  assert.equal(copied, published);
  assert.equal(result.failures[0].title, "Missing paper");
  assert.match(result.failures[0].reason, /No valid/);
});

test("omitted batch entries are retried individually; record failure preserves successful entries", async () => {
  const calls: string[][] = [];
  const result = await collectBibtex([byCode(A), byCode(B, "Failed preprint")], { search: async q => searchResult(q.includes(A) ? A : B), exportBibtex: async codes => {
    calls.push(codes);
    if (codes.length === 2) return published;
    throw new ADSError("response", "Record export failed.");
  } });
  assert.deepEqual(calls, [[A, B], [B]]);
  assert.equal(result.text, published);
  assert.deepEqual(result.bibcodes, [A]);
  assert.deepEqual(result.failures, [{ title: "Failed preprint", reason: "Record export failed." }]);
});

test("recovers missing or malformed batch exports without duplicating/rebuilding entry bodies", async () => {
  for (const batch of [published, "broken", published + published]) {
    const result = await collectBibtex([byCode(A), byCode(B)], { search: async q => searchResult(q.includes(A) ? A : B), exportBibtex: async codes => codes.length > 1 ? batch : codes[0] === A ? published : preprint });
    assert.deepEqual(scanEntries(result.text), [...scanEntries(published), ...scanEntries(preprint)]);
    assert.equal(result.failures.length, 0);
  }
});

test("complete failure and invalid single exports leave clipboard untouched", async () => {
  for (const fixture of ["broken", "", preprint]) {
    let writes = 0;
    const result = await copyPapers([byCode(A)], { search: async () => searchResult(A), exportBibtex: async () => fixture }, () => { writes++; });
    assert.equal(writes, 0);
    assert.equal(result.failures.length, 1);
  }
});

test("authentication/rate/network failures stop further requests and report every affected paper", async () => {
  for (const code of ["auth", "rate", "network", "timeout", "server"] as const) {
    let calls = 0;
    const result = await collectBibtex([byCode(A), byCode(B)], { search: async () => { calls++; throw new ADSError(code, "Request failed."); }, exportBibtex: async () => { throw new Error("must not export"); } });
    assert.equal(calls, 1);
    assert.equal(result.failures.length, 2);
  }
});

test("ADS client sends official authenticated search and batch export shapes with redirects forbidden", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (async (url, init) => { requests.push({ url: String(url), init: init! }); return Response.json(String(url).includes("search/query") ? { response: searchResult(A) } : { export: published }); }) as typeof fetch;
  const client = new ADSClient("test-secret", fakeFetch);
  await client.search(`identifier:"${A}"`);
  assert.equal(await client.exportBibtex([A]), published);
  await client.testConnection();
  for (const { url, init } of requests) {
    assert.equal(new URL(url).origin, "https://api.adsabs.harvard.edu");
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer test-secret");
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    assert.ok(!url.includes("test-secret"));
  }
  assert.deepEqual(JSON.parse(requests[1].init.body as string), { bibcode: [A], sort: "no sort" });
  assert.equal(new URL(requests[0].url).searchParams.get("rows"), "10");
});

test("ADS client sanitizes invalid-token, rate-limit, server, JSON and network failures", async () => {
  for (const [status, code] of [[401, "auth"], [403, "auth"], [429, "rate"], [503, "server"], [400, "response"]] as const) {
    const client = new ADSClient("test-secret", (async () => new Response("test-secret", { status, headers: { "Retry-After": "60" } })) as typeof fetch);
    await assert.rejects(client.search("x"), (e: any) => e.code === code && !e.message.includes("test-secret"));
  }
  const broken = new ADSClient("test-secret", (async () => { throw new Error("Authorization: Bearer test-secret"); }) as typeof fetch);
  await assert.rejects(broken.search("x"), (e: any) => e.code === "network" && !e.message.includes("test-secret"));
  const invalid = new ADSClient("test-secret", (async () => new Response("not json test-secret")) as typeof fetch);
  await assert.rejects(invalid.search("x"), (e: any) => e.code === "response" && !e.message.includes("test-secret"));
});

test("timeouts and shutdown abort in-flight requests", async () => {
  const hang = (async (_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  })) as typeof fetch;
  const timed = new ADSClient("token", hang, undefined, 5);
  await assert.rejects(timed.search("x"), (e: any) => e.code === "timeout");
  const cancelled = new ADSClient("token", hang);
  const pending = cancelled.search("x");
  cancelled.close();
  await assert.rejects(pending, (e: any) => e.code === "cancelled");
  await assert.rejects(cancelled.search("x"), (e: any) => e.code === "cancelled");
});

test("invalid search and export response schemas fail closed", async () => {
  for (const response of [{}, { response: { numFound: -1, docs: [] } }, { response: { numFound: 1, docs: [{ bibcode: A, doi: "bad" }] } }]) {
    const client = new ADSClient("token", (async () => Response.json(response)) as typeof fetch);
    await assert.rejects(client.search("x"), /invalid search response/);
  }
  const client = new ADSClient("token", (async () => Response.json({ msg: "no export" })) as typeof fetch);
  await assert.rejects(client.exportBibtex([A]), /no BibTeX/);
});

test("rate limiting on a later export chunk retains earlier successful entries", async () => {
  const codes = Array.from({ length: 101 }, (_, i) => `2024ApJ...900${String(i).padStart(5, ".")}A`);
  assert.ok(codes.every(isBibcode));
  let exports = 0;
  const result = await collectBibtex(codes.map(c => byCode(c)), {
    search: async q => searchResult(q.match(/"(.*)"/)![1]),
    exportBibtex: async batch => {
      if (++exports === 2) throw new ADSError("rate", "Rate limited.");
      return batch.map(c => `@ARTICLE{${c}, title={Test}}\n\n`).join("");
    },
  });
  assert.equal(result.bibcodes.length, 100);
  assert.equal(result.failures.length, 1);
  assert.equal(scanEntries(result.text).length, 100);
});
