// Opt-in live ADS verification. Read a token from stdin; never store or print it.
import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { ADSClient } from "../src/ads-client.ts";
import { copyPapers } from "../src/copy-service.ts";
import { resolvePaper } from "../src/resolver.ts";
import { scanEntries } from "../src/bibtex.ts";
import { ADSError } from "../src/errors.ts";
import { spawn } from "node:child_process";

const input = createInterface({ input: process.stdin, terminal: false });
let token = "";
for await (const line of input) { token = line.trim(); input.close(); break; }
if (!token) throw new Error("Supply an ADS token on standard input.");
const report: { date: string; transport: string; checks: { name: string; passed: boolean }[]; requests: number; error?: string } = {
  date: new Date().toISOString(), transport: process.env.ADSBIB_LIVE_CURL ? "curl (Node DNS unavailable)" : "fetch", checks: [], requests: 0,
};
async function curlFetch(url: string, options: RequestInit): Promise<Response> {
  assert.equal(new URL(url).origin, "https://api.adsabs.harvard.edu");
  // Credentials enter curl through an anonymous pipe, never argv or a file.
  const lines = [`url = ${JSON.stringify(url)}`, `request = ${JSON.stringify(options.method || "GET")}`];
  for (const [key, value] of Object.entries(options.headers as Record<string, string>)) lines.push(`header = ${JSON.stringify(`${key}: ${value}`)}`);
  if (options.body) lines.push(`data = ${JSON.stringify(options.body)}`);
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/curl", ["--silent", "--show-error", "--max-time", "30", "--proto", "=https", "--max-redirs", "0", "--config", "-", "--write-out", "\n%{http_code}"], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.resume(); // Never print a raw credential-bearing transport error.
    child.on("error", () => reject(new Error("Live curl transport failed.")));
    child.on("close", code => {
      if (code) { reject(new Error("Live curl transport failed.")); return; }
      const boundary = output.lastIndexOf("\n");
      const status = Number(output.slice(boundary + 1));
      resolve(new Response(output.slice(0, boundary), { status, headers: { "Content-Type": "application/json" } }));
    });
    child.stdin.end(lines.join("\n") + "\n");
  });
}
const exports: { codes: string[]; text: string }[] = [];
const fetcher: typeof fetch = async (url, options) => {
  report.requests++;
  const response = process.env.ADSBIB_LIVE_CURL ? await curlFetch(String(url), options!) : await fetch(url, options);
  if (String(url).endsWith("/export/bibtex") && response.ok) {
    const json = await response.clone().json();
    exports.push({ codes: JSON.parse(options!.body as string).bibcode, text: json.export });
  }
  return response;
};
const client = new ADSClient(token, fetcher);
token = "";
const A = "2015ApJS..219...21Z";
const B = "2018AAS...23221409A";
const paper = (fields: Record<string, string>) => ({ title: "Live ADS test record", fields });
const byCode = (code: string) => paper({ extra: `ADS Bibcode: ${code}` });
async function check(name: string, action: () => Promise<void>) {
  try { await action(); report.checks.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { report.checks.push({ name, passed: false }); throw error; }
}
try {
  await check("authentication", () => client.testConnection());
  await check("existing bibcode resolution", async () => { assert.equal(await resolvePaper(byCode(A), client), A); });
  await check("DOI-only resolution", async () => { assert.equal(await resolvePaper(paper({ DOI: "10.1088/0067-0049/219/2/21" }), client), A); });
  await check("arXiv-only resolution", async () => { assert.equal(await resolvePaper(paper({ extra: "arXiv: 1506.08372" }), client), A); });
  await check("single export equals actual ADS response string", async () => {
    let clipboard = "";
    const result = await copyPapers([byCode(A)], client, text => { clipboard = text; });
    assert.equal(result.failures.length, 0);
    assert.ok(clipboard.length > 0);
    assert.equal(clipboard, exports.at(-1)!.text);
    assert.equal(scanEntries(clipboard)[0].key, A);
  });
  await check("batch export, deduplication and unchanged entry bodies", async () => {
    const before = exports.length;
    let clipboard = "";
    const result = await copyPapers([byCode(A), byCode(B), byCode(A)], client, text => { clipboard = text; });
    assert.equal(result.failures.length, 0);
    assert.deepEqual(result.bibcodes, [A, B]);
    assert.equal(result.duplicates, 1);
    assert.equal(exports.length - before, 1);
    assert.deepEqual(exports.at(-1)!.codes, [A, B]);
    const rawEntries = new Map(scanEntries(exports.at(-1)!.text).map(e => [e.key, e.raw]));
    assert.deepEqual(scanEntries(clipboard).map(e => e.raw), [rawEntries.get(A), rawEntries.get(B)]);
  });
  await check("partial identifier failure retains successful live export", async () => {
    let clipboard = "";
    const result = await copyPapers([byCode(A), paper({})], client, text => { clipboard = text; });
    assert.equal(result.failures.length, 1);
    assert.equal(clipboard, exports.at(-1)!.text);
  });
  await check("invalid token rejected with sanitized error", async () => {
    const invalid = new ADSClient("invalid-development-test-token", fetcher);
    try { await assert.rejects(invalid.testConnection(), (e: unknown) => e instanceof ADSError && e.code === "auth"); }
    finally { invalid.close(); }
  });
} catch (error) {
  // Raw assertions may include exported text; raw transports may include
  // credentials. Only persist an intentionally sanitized diagnostic.
  report.error = error instanceof ADSError ? `${error.code}: ${error.message}` : "A live verification assertion failed.";
  console.error(report.error);
  process.exitCode = 1;
} finally {
  client.close();
  await mkdir("tests/results", { recursive: true });
  await writeFile("tests/results/live-ads.json", JSON.stringify(report, null, 2) + "\n");
  console.log(`Live checks: ${report.checks.filter(c => c.passed).length}/${report.checks.length}; requests: ${report.requests}.`);
}
