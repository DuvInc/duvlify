import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mermaid = dirname(fileURLToPath(import.meta.resolve('mermaid/package.json')));
const destination = mkdtempSync(join(tmpdir(), 'duvlify-atelier-'));

for (const name of ['astro.config.ts', 'tsconfig.json', 'content', 'src', 'public', 'LICENSE', 'NOTICE']) {
  cpSync(join(root, name), join(destination, name), { recursive: true });
}

for (const [folder, files] of [
  ['scripts', ['check-origin.mjs', 'check-redirects.mjs', 'env-file.mjs']],
  ['worker', ['redirects.ts']],
]) {
  mkdirSync(join(destination, folder));
  for (const file of files) cpSync(join(root, folder, file), join(destination, folder, file));
}

// Ship Mermaid's upstream browser modules only. Diagrams still load on demand,
// and unrelated sites never need to download this package for their builds.
const vendor = join(destination, 'src/vendor/mermaid');
const browserChunks = 'chunks/mermaid.esm.min';
mkdirSync(join(vendor, 'chunks'), { recursive: true });
cpSync(join(mermaid, 'LICENSE'), join(vendor, 'LICENSE'));
cpSync(join(mermaid, 'dist/mermaid.esm.min.mjs'), join(vendor, 'mermaid.esm.min.mjs'));
cpSync(join(mermaid, 'dist', browserChunks), join(vendor, browserChunks), {
  recursive: true,
  filter: file => !file.endsWith('.map'),
});

const { name, type, private: isPrivate, dependencies } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
delete dependencies.mermaid;
writeFileSync(join(destination, 'package.json'), JSON.stringify({
  name,
  private: isPrivate,
  type,
  scripts: { dev: 'astro dev', build: 'astro build' },
  dependencies,
}, null, 2) + '\n');
console.log(destination);
