// Teste da regra de "fim de mês sempre esperado" no cálculo de Ausência de
// Lançamento — mesmo materiais semanais (Agregado) devem cobrar ausência no
// último dia útil do mês (recua domingo → sábado), não só nas terças.
// Ver _ausUltimoDiaUtilMes em js/dashboard.js.
//
// Rode com: node tests/aus-fim-de-mes.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonte = readFileSync(join(raiz, 'js', 'dashboard.js'), 'utf8');

const ctx = {
  console: { info() {}, warn() {}, error() {} },
  document: { getElementById() { return null; }, querySelector() { return null; }, addEventListener() {} },
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fonte, ctx);

const casos = [];
const teste = (nome, fn) => casos.push({ nome, fn });

teste('julho/2026 termina numa sexta — fim de mês útil é o próprio dia 31', () => {
  const d = ctx._ausUltimoDiaUtilMes(2026, 7);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 6); // 0-indexado: julho
  assert.equal(d.getDate(), 31);
  assert.equal(d.getDay(), 5); // sexta
});

teste('maio/2026 termina num domingo — fim de mês útil recua pro sábado dia 30', () => {
  const d = ctx._ausUltimoDiaUtilMes(2026, 5);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 4); // 0-indexado: maio
  assert.equal(d.getDate(), 30);
  assert.equal(d.getDay(), 6); // sábado
});

let falhou = 0;
for (const { nome, fn } of casos) {
  try {
    await fn();
    console.log(`  ok  ${nome}`);
  } catch (err) {
    falhou++;
    console.error(`FALHA  ${nome}`);
    console.error(err);
  }
}
console.log(`\n${casos.length - falhou}/${casos.length} passaram`);
if (falhou) process.exit(1);
