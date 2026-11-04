# Verification record

Executed on 2026-11-04 on macOS. No personal ADS token is included in the repository, reports, or installer.

## Automated tests and build

`pnpm check` runs TypeScript checking, the mocked test suite, and XPI packaging. **34/34 tests passed**, with zero failures, skips, or cancellations. TypeScript checking passed, including the opt-in live-check script. The packaging check verified the ZIP's integrity, manifest identity, and exact release file list. The release excludes the smoke harness and fixtures.

Evidence: [`tests/results/automated.txt`](tests/results/automated.txt), [`dist/SHA256SUMS`](dist/SHA256SUMS).

The mocked tests cover all twelve requested categories: bibcode, DOI, arXiv, multiple selections, duplicate records, missing identifiers, ambiguity, invalid authentication, rate limiting, network/timeout/server errors, partial export failures, and original formatting. They also cover canonical bibcodes, cancellation, malformed responses, unsafe/missing exports, settings credentials, menu lifecycle, unsupported selections, and clipboard preservation on complete failure.

Representative fixtures contain ADS-style keys, journal macros, braced/long author lists, escaped LaTeX, preprints, published records, CRLF, and whitespace. They are synthetic test fixtures. Exact single-export equality and unchanged reordered entry substrings are asserted.

## Live NASA ADS integration

**8/8 checks passed using 12 requests to the official ADS API**, with a user-supplied token entered through hidden stdin. The token was not stored. Requests carrying it used only `https://api.adsabs.harvard.edu`; redirects were not followed. System clipboard writes were replaced by an in-memory sink.

Verified against real responses:

- Authentication and invalid-token rejection.
- Existing bibcode, DOI-only, and arXiv-only resolution for `2015ApJS..219...21Z`.
- Exact equality of single-copy text to the JSON `export` string captured from the same live response.
- One batch export for two distinct records plus a duplicate selection, selected-order output, and unchanged individual entry bodies.
- Successful live export retained alongside an item with no identifier.

Evidence: [`tests/results/live-ads.json`](tests/results/live-ads.json).

Node's direct fetch encountered an environment DNS failure. The successful live checks therefore used `/usr/bin/curl` as the HTTP adapter for the same TypeScript ADS client and copy service. Authorization entered curl through a pipe, rather than command-line arguments or files. This validates the live API shapes and core workflow; it does **not** claim successful live Gecko fetch inside Zotero. Rate limits, service failures, and real ambiguous-result scenarios were tested with mocks, not induced on the live service.

## Zotero runtime smoke test

Installed application: **11.0-beta.3+212a7d6a5**. A disposable profile and data directory were created. The test copy used the release bundle and production bootstrap with additional test-only instrumentation; the distributed XPI has no instrumentation. No plugin was installed into the existing personal profile.

**12/12 runtime checks passed**:

- Production bootstrap and preferences registration.
- Real Mozilla credential-store save/read, replacement, and removal using dummy credentials.
- Real menu API rendering with a synthetic item-selection context.
- Settings markup and external script loading; Save Token, Test Connection, and Remove Saved Token handlers. Test Connection's API call was mocked.
- Immediate menu and preference cleanup.
- Copy workflow using real Zotero objects and notification code, mocked ADS HTTP, and a verified clipboard sink. Two mock requests completed and no error dialog was produced.

Evidence: [`tests/results/zotero-runtime.json`](tests/results/zotero-runtime.json).

This was a programmatic runtime smoke test. It does not establish manual right-click behavior, visual layout quality, or native clipboard behavior across operating systems. The newer menu API was invoked with a synthetic popup event and item-selection context.

## Compatibility limits and remaining manual checks

| Platform/version | Validation |
| --- | --- |
| Zotero 7.0.x | Release manifest target; owning API/source research and mocked lifecycle/menu/credential tests. A running Zotero 7 GUI was not available. |
| Zotero 8–10 | Current API guidance inspected; feature-detected menu and credential paths implemented. No stable runtime matrix; not declared by this initial manifest. |
| Zotero 11 beta | Twelve isolated runtime checks passed; experimental platform, not a release compatibility declaration. |
| Windows/Linux | No native GUI or clipboard run. |

Before broad distribution, run the XPI on an actual Zotero 7 profile and verify installation, right-click actions, mixed selections, multiple windows, disable/re-enable, and settings layout. Test one paper and a mixed batch with a saved token, paste into a text editor, compare against ADS output, and confirm that a complete failure retains the previous clipboard. Check native clipboard behavior on Windows/Linux as well.

Automatic updates are not hosted. The manifest includes a required HTTPS URL on the reserved `.invalid` domain, as documented in the README. Manual XPI installation works; update checks may report an unavailable update service until a distributor configures a real release host.
