import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const src = join(root, 'src');
const dist = join(root, 'dist');
const targets = ['chrome', 'firefox'];

rmSync(dist, { recursive: true, force: true });

for (const target of targets) {
  const out = join(dist, target);
  mkdirSync(out, { recursive: true });
  cpSync(src, out, { recursive: true });

  const manifest = readFileSync(join(src, `manifest.${target}.json`), 'utf8');
  JSON.parse(manifest);
  writeFileSync(join(out, 'manifest.json'), manifest);

  for (const file of ['manifest.chrome.json', 'manifest.firefox.json']) {
    rmSync(join(out, file), { force: true });
  }

  for (const required of ['manifest.json', 'popup.html', 'popup.js', 'icons/icon128.png']) {
    if (!existsSync(join(out, required))) {
      console.error(`build failed: ${target}/${required} missing`);
      process.exit(1);
    }
  }
}

console.log(`built ${targets.join(', ')}`);
