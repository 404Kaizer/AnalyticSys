// Teste da troca do token de exibição (31/07, pedido do usuário): numero
// de ocorrência e tag de DAI passam a usar o PRIMEIRO NOME inteiro do
// usuário (ex. "OC-MAYCON-1", "DAI-HUGO-55") em vez das 4 letras do
// e-mail (ex. "OC-MAYC-1") — ver _ocUserToken em ocorrencias.js e
// _nextDaiTag em dai.js (que reaproveita _ocUserToken, mesmo padrão
// carregado globalmente no navegador real, por isso os dois arquivos são
// carregados juntos no mesmo contexto aqui).
//
// Rode com: node tests/nome-token-ids.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonteOcorrencias = readFileSync(join(raiz, 'js', 'ocorrencias.js'), 'utf8');
const fonteDai = readFileSync(join(raiz, 'js', 'dai.js'), 'utf8');

function montar({ nomeCompleto, email = 'user@example.com' } = {}) {
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    state: { ocorrencias: [], ajustesSistemicos: [] },
    document: {
      addEventListener() {},
      getElementById() { return null; },
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.currentUser = { id: 'u-1', role: 'user', nome_completo: nomeCompleto, email };
  vm.createContext(ctx);
  vm.runInContext(fonteOcorrencias, ctx);
  vm.runInContext(fonteDai, ctx);
  return ctx;
}

const casos = [];
const teste = (nome, fn) => casos.push({ nome, fn });

// ── _ocUserToken ─────────────────────────────────────────────────────

teste('_ocUserToken: usa o PRIMEIRO NOME inteiro, não mais 4 letras do e-mail', () => {
  const ctx = montar({ nomeCompleto: 'Maycon Ferreira Ramos', email: 'mayconconcrelagos@gmail.com' });
  assert.equal(ctx._ocUserToken('Maycon Ferreira Ramos', 'x@x.com'), 'MAYCON');
});

teste('_ocUserToken: remove acento (NFD) do primeiro nome', () => {
  const ctx = montar();
  assert.equal(ctx._ocUserToken('Álvaro Núñez', 'x@x.com'), 'ALVARO');
});

teste('_ocUserToken: sem nome_completo, cai no e-mail (comportamento antigo preservado)', () => {
  const ctx = montar();
  assert.equal(ctx._ocUserToken('', 'contatomarlonmartineli@gmail.com'), 'CONTATOMARLONMARTINELI');
});

teste('_ocUserToken: nem nome nem e-mail resolvíveis cai em "USR"', () => {
  const ctx = montar();
  assert.equal(ctx._ocUserToken('', ''), 'USR');
});

// ── _nextOcId (numero de ocorrência) ────────────────────────────────

teste('_nextOcId: gera "OC-<PRIMEIRO NOME>-1" pro usuário logado', () => {
  const ctx = montar({ nomeCompleto: 'Marlon Douglas Martineli Coelho' });
  assert.equal(ctx._nextOcId(), 'OC-MARLON-1');
});

teste('_nextOcId: incrementa só dentro do prefixo do MESMO nome, ignora numero de outra pessoa', () => {
  const ctx = montar({ nomeCompleto: 'Hugo Picanço da Costa Rios' });
  ctx.state.ocorrencias = [
    { id: 'a', numero: 'OC-HUGO-1' },
    { id: 'b', numero: 'OC-HUGO-2' },
    { id: 'c', numero: 'OC-MAYCON-99' }, // outra pessoa, alto — não deveria influenciar
  ];
  assert.equal(ctx._nextOcId(), 'OC-HUGO-3');
});

// ── _nextDaiTag (tag de DAI) ─────────────────────────────────────────

teste('_nextDaiTag: gera "DAI-<PRIMEIRO NOME>-1" pro usuário logado (não mais "DAI-1" sem token)', () => {
  const ctx = montar({ nomeCompleto: 'Hugo Picanço da Costa Rios' });
  assert.equal(ctx._nextDaiTag(), 'DAI-HUGO-1');
});

teste('_nextDaiTag: incrementa só dentro do prefixo do MESMO nome, ignora tag de outra pessoa', () => {
  const ctx = montar({ nomeCompleto: 'Hugo Picanço da Costa Rios' });
  ctx.state.ajustesSistemicos = [
    { id: 'd1', tag: 'DAI-HUGO-1' },
    { id: 'd2', tag: 'DAI-HUGO-2' },
    { id: 'd3', tag: 'DAI-CLAUDIR-40' }, // outra pessoa, alto — não deveria influenciar
  ];
  assert.equal(ctx._nextDaiTag(), 'DAI-HUGO-3');
});

teste('_nextDaiTag: duas contas diferentes nunca geram a mesma tag (token evita a colisão "DAI-1" x "DAI-1")', () => {
  const ctxMarlon = montar({ nomeCompleto: 'Marlon Douglas Martineli Coelho' });
  const ctxMaycon = montar({ nomeCompleto: 'Maycon Ferreira Ramos' });
  assert.notEqual(ctxMarlon._nextDaiTag(), ctxMaycon._nextDaiTag());
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
