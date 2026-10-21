// npm run parity            print the parity number and write catalog/PARITY.md
// node scripts/parity.ts --check          fail if the number fell below the recorded floor
// node scripts/parity.ts --update-floor   record the current number as the new floor (it only rises)

import { readFileSync, writeFileSync } from 'node:fs';
import { loadCatalog, loadFloor, markdown, parity } from '../catalog/parity.ts';

const features = loadCatalog();
const p = parity(features);
const floor = loadFloor();
console.log(`QuickBooks Desktop parity: ${p.live} / ${p.total} features (${((100 * p.live) / p.total).toFixed(1)}%), floor ${floor}`);
for (const a of p.byArea) console.log(`  ${a.area.padEnd(12)} ${a.live} / ${a.total}`);

if (p.unknownCommands.length) {
  console.error('Catalog names commands that do not exist:\n  ' + p.unknownCommands.join('\n  '));
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes('--check')) {
  if (p.live < floor) {
    console.error(`Parity fell from ${floor} to ${p.live}.`);
    process.exit(1);
  }
} else {
  const file = new URL('../catalog/PARITY.md', import.meta.url);
  writeFileSync(file, markdown(p, features));
  if (args.includes('--update-floor')) {
    const floorFile = new URL('../catalog/parity-floor.json', import.meta.url);
    const current = JSON.parse(readFileSync(floorFile, 'utf8')) as { live: number };
    if (p.live > current.live) writeFileSync(floorFile, JSON.stringify({ live: p.live }) + '\n');
  }
}
