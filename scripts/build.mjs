import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
await rm('build', { recursive: true, force: true });
await mkdir('build', { recursive: true });
await mkdir('dist', { recursive: true });
await cp('plugin', 'build', { recursive: true });
await cp('LICENSE', 'build/LICENSE');
await build({ entryPoints: ['src/integration.ts'], outfile: 'build/plugin.js', bundle: true,
  format: 'iife', globalName: 'ADSBibTeXPlugin', target: 'firefox115', charset: 'utf8', legalComments: 'none' });
await build({ entryPoints: ['src/preferences.ts'], outfile: 'build/preferences.js', bundle: true,
  format: 'iife', target: 'firefox115', charset: 'utf8', legalComments: 'none' });
const manifest = JSON.parse(await readFile('build/manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (manifest.version !== pkg.version) throw new Error('Manifest/package version mismatch');
const name = `zotero-ads-bibtex-copier-${pkg.version}.xpi`;
// Python's standard library keeps packaging dependency-free and deterministic.
execFileSync(process.env.PYTHON || 'python3', ['-c', `
import pathlib,zipfile,json
root=pathlib.Path('build')
files=sorted(p for p in root.rglob('*') if p.is_file())
with zipfile.ZipFile('dist/${name}','w',compression=zipfile.ZIP_DEFLATED) as z:
 for p in files:
  info=zipfile.ZipInfo(p.relative_to(root).as_posix(),(2026,1,1,0,0,0))
  info.compress_type=zipfile.ZIP_DEFLATED
  info.external_attr=0o100644 << 16
  z.writestr(info,p.read_bytes())
with zipfile.ZipFile('dist/${name}') as z:
 assert z.testzip() is None
 assert set(z.namelist()) == {'manifest.json','bootstrap.js','plugin.js','preferences.js','preferences.xhtml','LICENSE'}
 assert json.loads(z.read('manifest.json'))['applications']['zotero']['id'] == 'ads-bibtex-copier@zotero-adsbib.org'
`], { stdio: 'inherit' });
const sha = createHash('sha256').update(await readFile(`dist/${name}`)).digest('hex');
await writeFile('dist/SHA256SUMS', `${sha}  ${name}\n`);
console.log(`Built dist/${name} (SHA-256 ${sha})`);
