"""Stage an isolated Zotero profile for runtime/GUI smoke testing. No live ADS.

Run after building. Prints a launch command; never uses your regular profile.
The test copy adds bootstrap instrumentation, absent from the release XPI.
"""
import json
import pathlib
import shutil
import tempfile
import zipfile

root = pathlib.Path(__file__).resolve().parent.parent
base = pathlib.Path(tempfile.mkdtemp(prefix="zotero-adsbib-smoke-"))
profile, data = base / "profile", base / "data"
profile.mkdir()
data.mkdir()
extension = base / "extension"
extension.mkdir()
extensions = profile / "extensions"
extensions.mkdir()
(extensions / "ads-bibtex-copier@zotero-adsbib.org").write_text(str(extension))
with zipfile.ZipFile(root / "dist/zotero-ads-bibtex-copier-1.0.0.xpi") as archive:
    archive.extractall(extension)
fixture = extension / "smoke-fixture.bib"
shutil.copyfile(root / "tests/fixtures/published.bib", fixture)
report = base / "report.json"
harness = (root / "scripts/zotero-smoke.js").read_text()
harness = harness.replace("__SMOKE_FIXTURE__", json.dumps(str(fixture))).replace("__SMOKE_REPORT__", json.dumps(str(report)))
with (extension / "bootstrap.js").open("a") as out:
    out.write("\n" + harness)
prefs = {
    "extensions.zotero.useDataDir": True,
    "extensions.zotero.dataDir": str(data),
    "extensions.zotero.firstRun2": False,
    "extensions.zotero.sync.autoSync": False,
    "extensions.autoDisableScopes": 0,
    "extensions.enabledScopes": 15,
    "extensions.startupScanScopes": 15,
    "extensions.zotero.debug.log": True,
    "datareporting.policy.dataSubmissionEnabled": False,
}
(profile / "user.js").write_text("".join(f"user_pref({json.dumps(k)}, {json.dumps(v)});\n" for k, v in prefs.items()))
print(f'Profile: {profile}')
print(f'Report: {report}')
print(f'/Applications/Zotero.app/Contents/MacOS/zotero -no-remote -profile "{profile}" -ZoteroDebugText')
