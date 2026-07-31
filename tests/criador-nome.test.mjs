// Teste do "criado por" (31/07, pedido do usuário): card de ocorrência
// (comum e DAI) precisa mostrar quem criou o registro — sem isso ninguém
// sabe de quem é aquela ocorrência só olhando a tela. ocorrencias.criado_por_nome
// é desnormalizado (não FK) porque a RLS de profiles só libera a própria
// linha ou admin — um usuário comum nunca conseguiria resolver o nome de
// outra conta via query direta (ver _ocToDbRow).
//
// Rode com: node tests/criador-nome.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonteOcorrencias = readFileSync(join(raiz, 'js', 'ocorrencias.js'), 'utf8');

function montar() {
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    state: { ocorrencias: [] },
    document: {
      addEventListener() {},
      getElementById() { return null; },
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.currentUser = { id: 'u-1', role: 'user', nome_completo: 'Fulano de Tal', email: 'fulano@x.com' };
  ctx.escapeHtml = (s) => String(s ?? '');
  ctx.fmtDateBR = (s) => s || '';
  vm.createContext(ctx);
  vm.runInContext(fonteOcorrencias, ctx);
  return ctx;
}

const casos = [];
const teste = (nome, fn) => casos.push({ nome, fn });

teste('_ocToDbRow: mapeia criadoPorNome -> criado_por_nome', () => {
  const ctx = montar();
  const row = ctx._ocToDbRow({ id: 'oc_1', criadoPorNome: 'Marlon Coelho' });
  assert.equal(row.criado_por_nome, 'Marlon Coelho');
});

teste('_ocFromDbRow: mapeia criado_por_nome -> criadoPorNome', () => {
  const ctx = montar();
  const o = ctx._ocFromDbRow({ id: 'oc_1', criado_por_nome: 'Maycon Ramos' });
  assert.equal(o.criadoPorNome, 'Maycon Ramos');
});

teste('_renderOcLista: mostra "criado por" no card quando criadoPorNome existe', () => {
  const ctx = montar();
  const el = { innerHTML: '' };
  ctx.document.getElementById = (id) => id === 'oc-lista' ? el : null;
  ctx._renderOcLista([{ id: 'oc_1', central: 'X', criadoPorNome: 'Marlon Coelho', hierarquia: [] }]);
  assert.ok(el.innerHTML.includes('Marlon Coelho'));
});

teste('_renderOcLista: sem criadoPorNome, não quebra e não deixa span vazio estranho', () => {
  const ctx = montar();
  const el = { innerHTML: '' };
  ctx.document.getElementById = (id) => id === 'oc-lista' ? el : null;
  ctx._renderOcLista([{ id: 'oc_1', central: 'X', hierarquia: [] }]);
  assert.ok(!el.innerHTML.includes('oc-card-criador'));
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
