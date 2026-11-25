// Prova do motor da aba Reposições (js/reposicoes-motor.js): 34 casos resolvidos à
// mão em reposicoes-casos.js. Rode com: node tests/reposicoes.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = vm.createContext({ console });
for (const f of ['js/reposicoes-motor.js', 'tests/reposicoes-casos.js']) vm.runInContext(readFileSync(join(raiz, f), 'utf8'), ctx, { filename: f });
const res = vm.runInContext('repProvaRodar()', ctx);
res.forEach(c => assert.ok(c.ok, `caso ${c.n} (${c.t}): esperado ${JSON.stringify(c.esp)}, obtido ${JSON.stringify(c.obt)} ${JSON.stringify(c.motivos)}`));
console.log(`ok — ${res.length} casos`);
