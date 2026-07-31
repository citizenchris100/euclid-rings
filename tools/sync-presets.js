// tools/sync-presets.js — dev helper (run: `node tools/sync-presets.js`). Validates every
// presets/*.json against presetModel.validatePreset, rebuilds presets/index.json (preserving the
// existing order, appending any new ids), regenerates the presets block in sw.js between the
// // presets:start / // presets:end markers, and bumps the SW cache tag so a deploy propagates.
// Mirrors the songwriter notebook's tools/sync-feels.js.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validatePreset } from '../js/presetModel.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const presetsDir = join(root, 'presets');

const files = readdirSync(presetsDir).filter((f) => f.endsWith('.json') && f !== 'index.json');
const ids = [];
let bad = 0;
for (const f of files) {
  const p = JSON.parse(readFileSync(join(presetsDir, f), 'utf8'));
  const v = validatePreset(p);
  if (!v.ok) { bad++; console.error(`INVALID ${f}: ${v.errors.join('; ')}`); continue; }
  if (p.id !== f.replace(/\.json$/, '')) console.warn(`WARN ${f}: id "${p.id}" does not match filename`);
  ids.push(p.id);
}
if (bad) { console.error(`\n${bad} invalid preset(s); aborting.`); process.exit(1); }

// Rebuild index.json preserving prior order, appending new ids.
let existing = [];
try { existing = JSON.parse(readFileSync(join(presetsDir, 'index.json'), 'utf8')); } catch { /* */ }
const ordered = existing.filter((id) => ids.includes(id)).concat(ids.filter((id) => !existing.includes(id)));
writeFileSync(join(presetsDir, 'index.json'), JSON.stringify(ordered, null, 2) + '\n');

// Regenerate the sw.js presets block + bump the cache tag.
const swPath = join(root, 'sw.js');
let sw = readFileSync(swPath, 'utf8');
const block = ['  // presets:start', '  "./presets/index.json",']
  .concat(ordered.map((id) => `  "./presets/${id}.json",`))
  .concat(['  // presets:end']).join('\n');
sw = sw.replace(/ {2}\/\/ presets:start[\s\S]*? {2}\/\/ presets:end/, block);
sw = sw.replace(/const CACHE = "([a-z]+)-v(\d+)"/, (_, pre, n) => `const CACHE = "${pre}-v${Number(n) + 1}"`);
writeFileSync(swPath, sw);

const bumped = sw.match(/const CACHE = "([a-z]+-v\d+)"/);
console.log(`Synced ${ordered.length} presets. Cache -> ${bumped ? bumped[1] : '?'}.`);
