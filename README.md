# Zotero ADS BibTeX Copier

Select papers in Zotero → right-click → **Copy NASA ADS BibTeX** → paste into your `.bib` file.

This lightweight plugin resolves papers with the official NASA ADS API and copies its BibTeX export directly. It never regenerates citations, changes library metadata, or requires Better BibTeX. The installer is approximately 11 KB with no third-party runtime dependencies.

## Install

1. Download or locate [`dist/zotero-ads-bibtex-copier-1.0.0.xpi`](dist/zotero-ads-bibtex-copier-1.0.0.xpi).
2. In **Zotero 7**, open **Tools → Plugins** (called **Add-ons** in some versions).
3. Click the gear menu → **Install Plugin From File…**, and choose the `.xpi`.
4. Open **Zotero → Settings** on macOS, or **Edit → Settings** on Windows/Linux, then choose **ADS BibTeX**.

The initial release manifest targets Zotero **7.0–7.0.x**. See compatibility and validation below before using a newer version. Updates are installed from a replacement XPI. Zotero requires an HTTPS `update_url`; this local release uses `https://example.invalid/zotero-ads-bibtex-copier/updates.json` as an intentionally non-resolving placeholder because no public release host has been configured. Zotero's update checker may report a failed update check for this plugin. No ADS token is sent to the updater. A distributor should replace this URL with their own hosted update manifest before publishing automatic updates. The installer checksum is in [`dist/SHA256SUMS`](dist/SHA256SUMS).

## Get and configure an ADS API token

1. Create an account or sign in to [NASA ADS](https://ui.adsabs.harvard.edu/).
2. Open [ADS API token settings](https://ui.adsabs.harvard.edu/user/settings/token) and generate a token. See the [official API access instructions](https://github.com/adsabs/adsabs-dev-api#access).
3. In Zotero **Settings → ADS BibTeX**, paste the token into the password field.
4. Click **Test Connection**. A success message confirms that ADS accepted it.
5. Click **Save Token** to keep it. Testing a typed token does not save it automatically.

An empty field means Test Connection uses the saved token. Saved tokens are never displayed back in the field. **Remove Saved Token** deletes the plugin's saved credential; uninstalling alone retains it for a possible reinstall.

The token uses Zotero's Mozilla credential store, rather than plain-text preferences. Its at-rest protection depends on the Zotero profile and platform credential implementation. The plugin only sends it in an Authorization header to `https://api.adsabs.harvard.edu`, rejects redirects, omits cookies, and does not log request headers, raw errors, or tokens. The installer, exports, and test reports contain no personal API token.

## Use

Select one or more bibliographic items in Zotero's main library list. Right-click and select **Copy NASA ADS BibTeX**. Attachments, notes, annotations, and other non-bibliographic selections are ignored. A selection containing only unsupported items hides the menu. Paste the result into your LaTeX bibliography file.

The plugin checks identifiers in this order:

1. An ADS bibcode in Extra (`ADS Bibcode: 2015ApJS..219...21Z`, `Bibcode: …`, or `ADS: …`), an ADS record URL, or supported archive/call-number metadata.
2. A DOI in Zotero's DOI field, Extra (`DOI: …`), or a doi.org URL.
3. An arXiv ID in Extra (`arXiv: …`, `arXiv ID: …`, or `eprint: …`), archive metadata, or an arxiv.org URL. Modern and legacy identifiers and version suffixes are supported. arXiv DOI forms are recognized as well.

Every search result must contain the exact identifier. An old/alternate bibcode may resolve to ADS's canonical bibcode. Ambiguous matches and conflicting identifiers require you to choose the record yourself, usually by adding an explicit ADS bibcode to Extra. There is no title/author/year guessing. If a DOI has no match, an available arXiv ID is tried.

The notification counts **unique exported ADS records**. Duplicate selections resolving to the same canonical bibcode produce one entry. The order follows Zotero's selected-items list, usually the visible row order; Zotero does not expose the history of selection clicks.

On partial failure, successful entries are copied and a persistent report lists every failed item's title and reason. On complete failure the plugin makes no clipboard write. Large selections show resolution progress. Another copy cannot start until the current one finishes.

## What “original ADS BibTeX” means

| Export source | How the entry is produced |
| --- | --- |
| Zotero BibTeX | Zotero's exporter converts the local library metadata into BibTeX. |
| Better BibTeX | Its exporter converts local metadata using its citation-key, formatting, and export settings. |
| This plugin | ADS resolves the record, and `/v1/export/bibtex` returns the text copied to the clipboard. |

“Original” refers to **the ADS API export**, not the publisher's submitted BibTeX. It reflects ADS's current records and server-side defaults. This plugin sends no custom citation-key, journal, author-list, or field-formatting options. Your ADS website's customized export settings and Better BibTeX settings are not applied.

For a successful single-record export, the decoded JSON `export` string is handed to the clipboard unchanged, including leading/trailing whitespace and line endings. It is never trimmed or reserialized. This is string preservation, not a claim about the bytes of the HTTP JSON envelope or how a destination application handles clipboard text.

For multiple records:

- Canonical bibcodes are deduplicated in first-selected order. One batch request is preferred, in chunks of at most 100, with `sort: "no sort"`.
- A complete response already in the requested order is copied unchanged.
- If ADS changes the order, only whole entry substrings are moved. A small brace/escape-aware boundary scanner reads citation keys and finds entry ends; it never parses or rewrites fields. Entries are separated by two LF characters. Surrounding inter-entry whitespace may therefore change.
- If a batch omits a record or has a record-specific failure, missing entries are requested individually. Entries recovered this way, or separate export chunks, are joined with two LF characters. Their field contents remain unchanged.
- Unexpected keys, repeated keys, incomplete entries, or unrecognized syntax fail validation. Individual retries can recover valid entries. No fabricated entry or placeholder is ever inserted.

Thus single exports preserve the API string exactly; reordered, recovered, or multi-chunk output is **not described as byte-for-byte identical to an entire batch response**. Journal macros such as `\apj`, `\mnras`, and `\aap` remain as returned by ADS. Your LaTeX setup must define them if needed.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Plugin is incompatible with your Zotero version | This release targets Zotero 7. See the compatibility section. Do not bypass a compatibility check on your regular library just to test it. |
| Menu absent | Select a regular bibliographic item in the main library list. Check that the plugin is enabled under Tools → Plugins. |
| No valid identifier | Add the DOI, arXiv ID, or `ADS Bibcode: …` in Extra. Titles alone are intentionally insufficient. |
| Multiple ADS matches | Find the intended record on ADS and add its explicit bibcode in Extra. |
| Authentication rejected | Generate/check your ADS token. Paste only the token, without `Bearer`, quotes, or whitespace; test and save it. |
| Credential store cannot be accessed | Unlock the store if prompted. Retry in Settings. The plugin does not fall back to insecure plain-text storage. |
| HTTP 429 / quota reached | Wait for the displayed Retry-After interval or your ADS quota reset. Requests stop rather than repeatedly consuming quota. |
| Network/timeout/server error | Check connectivity to api.adsabs.harvard.edu and retry later. Each request has a 30-second timeout. |
| One record missing from batch | The plugin retries omitted records separately, copies successes, and reports remaining failures. |
| Different output from ADS website | Compare with ADS's default API export. Website export customizations are not sent by this plugin. |
| Undefined journal macro in LaTeX | Load/define your journal macros in your LaTeX document. The plugin preserves ADS's macros. |

## Build and automated tests

Requires **Node.js 22+**, **pnpm 11.25.0**, and **Python 3** for ZIP packaging. Node is needed only for development; installing the XPI requires none of these tools. If using Corepack, activate the package manager version in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm check
```

Individual commands are `pnpm typecheck`, `pnpm test`, and `pnpm build`. The build bundles TypeScript into Firefox 115-compatible JavaScript and creates a deterministic XPI plus SHA-256 checksum in `dist/`. Only esbuild's dependency install script is allowed by the package-manager configuration.

Tests use Node's test runner and mocked ADS responses. Fixtures are **representative test data**, not live scientific records: they cover ADS-style keys, nested bracing, escaped characters, long author lists, preprints, published entries, macros, CRLF, and outer whitespace. Tests check exact equality for single exports and unchanged entry substrings when reordering is required.

The suite also covers identifiers, canonicalization, ambiguous/inexact matches, duplicates, mixed selections, missing tokens, authentication, rate limits, server/network failures, timeouts, cancellation, response validation, partial batches, credential APIs, clipboard non-overwrite on failure, and menu lifecycle cleanup. See [`TESTING.md`](TESTING.md) for executed results and limitations.

`scripts/live-check.ts` is an opt-in live integration check. It reads a token from standard input, performs a small number of official ADS requests, and saves a report without credentials in `tests/results/live-ads.json`. Run it with `node --import tsx scripts/live-check.ts` and hidden stdin input. `ADSBIB_LIVE_CURL=1` selects the macOS system curl transport when Node's DNS is unavailable. Live testing never uses the system clipboard.

To stage a disposable runtime smoke profile:

```sh
python3 scripts/stage-zotero-smoke.py
# Run the printed Zotero command; inspect the printed report path.
```

This helper uses a separate profile and data directory, test-only bootstrap instrumentation, mock ADS responses for the copy workflow, a clipboard sink, and dummy credentials. It must never be used to install the instrumented copy into a regular Zotero profile.

## Compatibility and API research

The maintained approach is Zotero's bootstrapped extension framework: `manifest.json`, lifecycle/window hooks, and `Zotero.PreferencePanes`. The Zotero 7 menu fallback inserts a XUL menuitem with complete window/unload cleanup. If `Zotero.MenuManager` is available, the plugin uses its official `main/library/item` integration instead.

Newer APIs were checked against the official Zotero 8, 10, and 11 developer guidance and the installed Zotero source. The credential adapter handles synchronous Zotero 7 APIs and the newer asynchronous lookup/add/modify/remove variants. It avoids removed collection-selection APIs, JSM imports, and inline UI event handlers.

The release manifest remains **7.0–7.0.x** until a stable-version runtime matrix is validated. The presence of feature detection is not a claim that every newer stable version has been tested. Zotero 11 is currently documented as a development platform, and its documentation asks plugin authors not to declare release compatibility yet. Windows/Linux native clipboard and GUI behavior have not been exercised here.

Primary specifications checked on 2026-11-04:

- [Zotero 7 plugin/lifecycle/preferences documentation](https://www.zotero.org/support/dev/zotero_7_for_developers)
- [Zotero 8 menu API and platform changes](https://www.zotero.org/support/dev/zotero_8_for_developers)
- [Zotero 10 menu-context changes](https://www.zotero.org/support/dev/zotero_10_for_developers)
- [Zotero 11 development and credential API changes](https://www.zotero.org/support/dev/zotero_11_for_developers)
- [Owning menu API source](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/pluginAPI/menuManager.js)
- [ADS API authentication/access documentation](https://github.com/adsabs/adsabs-dev-api)
- [ADS Search API examples and response schema](https://github.com/adsabs/adsabs-dev-api/blob/master/API_documentation_UNIXshell/Search_API.ipynb)
- [ADS Export service request/response, defaults, and input-order support](https://github.com/adsabs/export_service#api)

## Project layout

```text
src/
  integration.ts      Zotero menus, lifecycle, selection snapshots, clipboard, notifications
  preferences.ts      Settings UI event handling
  credentials.ts      Credential store adapter
  identifiers.ts      Metadata extraction and identifier normalization
  resolver.ts         Exact ADS record resolution
  ads-client.ts       Official API requests, timeout, cancellation, sanitized errors
  bibtex.ts           Raw-entry boundary/key validation and safe reordering
  copy-service.ts     Deduplication, batch recovery, clipboard success policy
  errors.ts, types.ts Shared typed data and error definitions
plugin/               Manifest, bootstrap, settings markup
scripts/              Bundling, deterministic packaging, isolated runtime smoke tools
tests/                Mocked automated tests and representative BibTeX fixtures
dist/                 Installable XPI and SHA-256 checksum
```

MIT licensed. This is an independent plugin, not an official Zotero or NASA ADS product.
