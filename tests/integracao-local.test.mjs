// Teste da poda de cache local e do filtro "meus ou integrados"
// (js/normalize.js). Sem framework — rode com:
//
//     node tests/integracao-local.test.mjs
//
// Por que existe: esta lógica já quebrou DUAS vezes em produção no mesmo
// dia. Primeiro mandando milhares de ids numa URL só (estourou o limite de
// requisição); depois quebrando em lotes de 200, o que virou +6.000
// requisições sequenciais no boot e travou o app por minutos na tela de
// carregamento. O teste "não faz requisição nenhuma" existe exatamente pra
// impedir a terceira vez.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonte = readFileSync(join(raiz, 'js', 'normalize.js'), 'utf8');

const EU = 'user-adm';
const OUTRO = 'user-outro';

// Monta o ambiente e carrega o normalize.js real.
// linhasRemotas: o que a RLS entrega ao ADM (as linhas de TODO mundo).
// integracoes: registros de outros que o ADM aceitou integrar.
function montar({ linhasRemotas = [], integracoes = [], role = 'admin' } = {}) {
  const chamadas = []; // toda ida ao supabaseClient fica registrada aqui

  const construirQuery = (tabela) => {
    const q = {
      _tabela: tabela,
      select() { return q; },
      order() { return q; },
      limit() { return q; },
      gt() { return q; },
      in() { return q; },
      neq() { return q; },
      then(resolve) {
        if (tabela === 'record_integrations') {
          return resolve({ data: integracoes, error: null });
        }
        return resolve({ data: linhasRemotas, error: null });
      },
    };
    return q;
  };

  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    state: {},
    window: {
      currentUser: { id: EU, role },
      supabaseClient: {
        from(tabela) { chamadas.push(tabela); return construirQuery(tabela); },
      },
      crypto: { randomUUID: () => 'uuid-' + Math.random() },
    },
    TextEncoder, TextDecoder,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fonte, ctx);
  return { ctx, chamadas };
}

const casos = [];
const teste = (nome, fn) => casos.push({ nome, fn });

// ── Filtro de leitura ──────────────────────────────────────────────────

teste('ADM só recebe os próprios registros e os que aceitou integrar', async () => {
  const { ctx } = montar({
    linhasRemotas: [
      { id: 'a', user_id: EU },
      { id: 'b', user_id: OUTRO },
      { id: 'c', user_id: OUTRO }, // este foi aceito
    ],
    integracoes: [{ table_name: 'lancamentos', row_id: 'c' }],
  });
  const res = await ctx.fetchMineOrIntegrated('lancamentos');
  // Array.from: o array vem de dentro do vm (outro realm) e deepEqual
  // estrito compara protótipo — sem isso a comparação falha por engano.
  assert.deepEqual(Array.from(res, r => r.id).sort(), ['a', 'c']);
});

teste('usuário comum recebe tudo que a RLS deixou passar, sem filtro extra', async () => {
  const { ctx } = montar({
    linhasRemotas: [{ id: 'a', user_id: EU }, { id: 'b', user_id: EU }],
    role: 'user',
  });
  const res = await ctx.fetchMineOrIntegrated('lancamentos');
  assert.equal(res.length, 2);
});

// ── Poda do cache local ────────────────────────────────────────────────

teste('PODA registro confirmado como de outro dono', async () => {
  const { ctx } = montar({
    linhasRemotas: [{ id: 'a', user_id: EU }, { id: 'b', user_id: OUTRO }],
  });
  await ctx.fetchMineOrIntegrated('lancamentos');
  const local = [{ id: 'a' }, { id: 'b' }];
  const res = ctx._podarPoluicaoLocal('lancamentos', local, new Set(['a']), EU);
  assert.deepEqual(res.map(r => r.id), ['a'], 'o registro do outro dono tem que sair');
});

teste('MANTÉM registro que não existe no banco (local ainda não sincronizado)', async () => {
  const { ctx } = montar({ linhasRemotas: [{ id: 'a', user_id: EU }] });
  await ctx.fetchMineOrIntegrated('lancamentos');
  const local = [{ id: 'a' }, { id: 'so-local' }];
  const res = ctx._podarPoluicaoLocal('lancamentos', local, new Set(['a']), EU);
  assert.deepEqual(res.map(r => r.id).sort(), ['a', 'so-local'],
    'nunca apagar o que pode ser trabalho local não sincronizado');
});

teste('MANTÉM volume importado (nunca vai pro Postgres, logo nunca aparece no fetch)', async () => {
  const { ctx } = montar({ linhasRemotas: [{ id: 'manual1', user_id: EU }] });
  await ctx.fetchMineOrIntegrated('saidas');
  const local = [
    { id: 'manual1' },
    ...Array.from({ length: 500 }, (_, i) => ({ id: `imp${i}`, importId: 'lote1' })),
  ];
  const res = ctx._podarPoluicaoLocal('saidas', local, new Set(['manual1']), EU);
  assert.equal(res.length, 501, 'o volume importado não pode ser podado');
});

teste('MANTÉM registro de outro dono que foi aceito (integrado)', async () => {
  const { ctx } = montar({
    linhasRemotas: [{ id: 'c', user_id: OUTRO }],
    integracoes: [{ table_name: 'lancamentos', row_id: 'c' }],
  });
  await ctx.fetchMineOrIntegrated('lancamentos');
  const res = ctx._podarPoluicaoLocal('lancamentos', [{ id: 'c' }], new Set(), EU);
  assert.deepEqual(res.map(r => r.id), ['c'], 'aceitar a integração tem que valer também na poda');
});

teste('usuário comum não sofre poda nenhuma', async () => {
  const { ctx } = montar({ linhasRemotas: [{ id: 'a', user_id: EU }], role: 'user' });
  await ctx.fetchMineOrIntegrated('lancamentos');
  const local = [{ id: 'a' }, { id: 'b' }];
  assert.equal(ctx._podarPoluicaoLocal('lancamentos', local, new Set(), EU).length, 2);
});

// ── A regressão que travou o app ───────────────────────────────────────

teste('poda NÃO faz requisição nenhuma, mesmo com cache local enorme', async () => {
  const { ctx, chamadas } = montar({
    linhasRemotas: Array.from({ length: 50 }, (_, i) => ({ id: `remoto${i}`, user_id: EU })),
  });
  await ctx.fetchMineOrIntegrated('sap');
  const antes = chamadas.length;

  // 600 mil registros locais — o cenário real do supervisor. Na 2ª versão
  // isto disparava ~3.000 requisições sequenciais e travava o boot.
  const local = Array.from({ length: 600000 }, (_, i) => ({ id: `local${i}`, importId: 'lote' }));
  const t0 = Date.now();
  const res = ctx._podarPoluicaoLocal('sap', local, new Set(), EU);
  const ms = Date.now() - t0;

  assert.equal(chamadas.length, antes, 'a poda não pode ir ao servidor nem uma vez');
  assert.equal(res.length, 600000, 'nada desse volume pode ser podado');
  assert.ok(ms < 3000, `poda demorou ${ms}ms — devia ser trabalho em memória`);
});

// ── Execução ───────────────────────────────────────────────────────────
let falhas = 0;
for (const { nome, fn } of casos) {
  try {
    await fn();
    console.log(`  ok   ${nome}`);
  } catch (err) {
    falhas++;
    console.log(`  FALHOU ${nome}`);
    console.log(`         ${err.message}`);
  }
}
console.log(`\n${casos.length - falhas}/${casos.length} passaram`);
process.exit(falhas ? 1 : 0);
