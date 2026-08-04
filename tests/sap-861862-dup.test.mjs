// Teste da feature provisória de duplicidade 862 (SAP) — bug em que a
// mercadoria entra (movimento 101 ou 801, em QUALQUER data) e depois é
// transferida (movimento 862, saída) duas vezes por engano. O 862 e o 861
// (entrada na central destino, se existir) são necessariamente do mesmo dia
// — só eles comparam DT DOC/DT LANÇAMENTO/DT REGISTRO entre si. A entrada
// 101/801 só precisa bater CENTRAL, DEPOSITO, MATERIAL e PESO (módulo), sem
// exigência de data (pode ter chegado dias antes da transferência).
// Ver getSap861862DuplicateKeys em js/ui.js.
//
// Rode com: node tests/sap-861862-dup.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonteUi = readFileSync(join(raiz, 'js', 'ui.js'), 'utf8');

function montar(sap) {
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    document: { getElementById() { return null; }, querySelector() { return null; }, addEventListener() {} },
    num: (v) => typeof v === 'number' ? v : (parseFloat(String(v).replace(',', '.')) || 0),
    state: { sap },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fonteUi, ctx);
  return ctx;
}

const casos = [];
const teste = (nome, fn) => casos.push({ nome, fn });

// 101/801 e 861 (entradas) vêm positivos, 862 (saída) negativo no SAP —
// peso base é a magnitude; os testes aplicam o sinal certo por movimento.
const registro = (over) => ({
  central: 'C1', deposito: 'D1', dtDoc: '01/07/2026', dtLanc: '01/07/2026',
  dtReg: '01/07/2026', material: 'MAT1', peso: 1000, ...over,
});
const entradaNF = (over) => registro({ movimento: '101', peso: 1000, ...over });
const saida862 = (over) => registro({ movimento: '862', peso: -1000, ...over });
const entrada861 = (over) => registro({ movimento: '861', peso: 1000, ...over });

teste('flagra entrada 101 (data diferente) + dois 862 no mesmo dia, sem 861', () => {
  const ctx = montar([
    entradaNF({ ref: '000000001-1', dtDoc: '20/06/2026', dtLanc: '20/06/2026', dtReg: '20/06/2026' }),
    saida862({ ref: '000000004-2' }),
    saida862({ ref: '000000005-2' }),
  ]);
  assert.equal(ctx.getSap861862DuplicateKeys().size, 3);
});

teste('flagra entrada 801 (data diferente) + dois 862 + um 861, todos no mesmo dia entre si', () => {
  const ctx = montar([
    entradaNF({ movimento: '801', ref: '000000001-1', dtDoc: '15/06/2026', dtLanc: '15/06/2026', dtReg: '15/06/2026' }),
    saida862({ ref: '000000004-2' }),
    saida862({ ref: '000000005-2' }),
    entrada861({ ref: '000000009-1' }),
  ]);
  assert.equal(ctx.getSap861862DuplicateKeys().size, 4);
});

teste('não flagra entrada + apenas um 862 (transferência normal, sem duplicidade)', () => {
  const ctx = montar([
    entradaNF({ ref: '000000001-1' }),
    saida862({ ref: '000000004-2' }),
  ]);
  assert.equal(ctx.getSap861862DuplicateKeys().size, 0);
});

teste('não flagra dois 862 sem nenhuma entrada 101/801 correspondente', () => {
  const ctx = montar([
    saida862({ ref: '000000004-2' }),
    saida862({ ref: '000000005-2' }),
  ]);
  assert.equal(ctx.getSap861862DuplicateKeys().size, 0);
});

teste('não flagra quando os dois 862 são de dias diferentes entre si', () => {
  const ctx = montar([
    entradaNF({ ref: '000000001-1' }),
    saida862({ ref: '000000004-2', dtLanc: '01/07/2026' }),
    saida862({ ref: '000000005-2', dtLanc: '02/07/2026' }),
  ]);
  assert.equal(ctx.getSap861862DuplicateKeys().size, 0);
});

teste('não flagra quando a magnitude do peso diverge entre entrada e transferência', () => {
  const ctx = montar([
    entradaNF({ ref: '000000001-1', peso: 500 }),
    saida862({ ref: '000000004-2', peso: -1000 }),
    saida862({ ref: '000000005-2', peso: -1000 }),
  ]);
  assert.equal(ctx.getSap861862DuplicateKeys().size, 0);
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
