/* Guards against runtime "null is not an object" breaks: every element id
   referenced from JS (and every skin sprite target selector) must exist in
   index.html. Exits non-zero if any are missing. */
import { readFileSync } from 'node:fs';
import assert from 'node:assert';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const html = read('index.html');
const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

const app = read('js/app.js');
const refs = new Set();
for (const m of app.matchAll(/\$\(['"]([^'"]+)['"]\)/g)) refs.add(m[1]);
for (const m of app.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)) refs.add(m[1]);
for (const m of read('js/equalizer.js').matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)) refs.add(m[1]);

const missingIds = [...refs].filter((id) => !htmlIds.has(id));
assert.deepEqual(missingIds, [], `JS references missing element ids: ${missingIds}`);

const skin = read('js/skin.js');
const sels = [...skin.matchAll(/sel:\s*'#([^']+)'/g)].map((m) => m[1]);
const missingSels = sels.filter((id) => !htmlIds.has(id));
assert.deepEqual(missingSels, [], `skin.js targets missing selectors: ${missingSels}`);

console.log(`ids.test.mjs — ${refs.size} ids + ${sels.length} skin selectors all resolve ✓`);
