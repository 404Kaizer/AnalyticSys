// Teste do fix (31/07): state.ajustesSistemicos ficava incompleto pro ADM,
// diferente de state.ocorrencias — syncAjustesSistemicosFromSupabase usava
// só fetchMineOrIntegrated (mine + integrada manualmente), sem a mesma
// exceção "vejo tudo" que o ADM já tem em ocorrências. Resultado: uma DAI
// reatribuída pra outro usuário (ou vista via card/notificação) aparecia em
// state.ocorrencias mas NÃO em state.ajustesSistemicos — openOcDetailModal
// (ocorrencias.js) não achava `dai` e renderizava o modal sem a seção
// "Documento de Ajuste de Inventário" (o "modal genérico" reportado pelo
// usuário, tanto ao clicar no card quanto ao clicar na notificação).
//
// ajustes_sistemicos só é lido por id (nenhuma tela lista o array inteiro),
// então — diferente de ocorrências — não existe risco de "poluir a lista de
// trabalho do ADM" ao buscar tudo. RLS (is_admin()) já libera a leitura.
//
// Rode com: node tests/dai-sync-admin.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonteDai = readFileSync(join(raiz, 'js', 'dai.js'), 'utf8');

function montar({ role = 'admin', todasRows = [], mineRows = [] } = {}) {
  const chamadas = [];
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    state: { ajustesSistemicos: [] },
    document: {
      addEventListener() {},
      getElementById() { return null; },
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.currentUser = { id: 'u-adm', role };
  // Stubs do normalize.js real (fora do escopo deste arquivo) — só o
  // suficiente pra syncAjustesSistemicosFromSupabase escolher o caminho
  // certo e a gente registrar QUAL foi chamado.
  ctx.fetchAllRows = async (tabela) => { chamadas.push(['fetchAllRows', tabela]); return todasRows; };
  ctx.fetchMineOrIntegrated = async (tabela) => { chamadas.push(['fetchMineOrIntegrated', tabela]); return mineRows; };
  vm.createContext(ctx);
  vm.runInContext(fonteDai, ctx);
  return { ctx, chamadas };
}

const casos = [];
const teste = (nome, fn) => casos.push({ nome, fn });

const rowDai = { id: 'dai_1', user_id: 'outro-usuario', tag: 'DAI-1', numero: 'DAI-1-20260731-01' };

teste('ADM: syncAjustesSistemicosFromSupabase busca TODAS as linhas (fetchAllRows), não só mine+integrada', async () => {
  const { ctx, chamadas } = montar({ role: 'admin', todasRows: [rowDai] });
  await ctx.syncAjustesSistemicosFromSupabase();
  assert.deepEqual(chamadas, [['fetchAllRows', 'ajustes_sistemicos']]);
  assert.equal(ctx.state.ajustesSistemicos.length, 1);
  assert.equal(ctx.state.ajustesSistemicos[0].id, 'dai_1');
});

teste('usuário comum: continua restrito a fetchMineOrIntegrated (RLS já filtra dono/integrada)', async () => {
  const { ctx, chamadas } = montar({ role: 'user', mineRows: [rowDai] });
  await ctx.syncAjustesSistemicosFromSupabase();
  assert.deepEqual(chamadas, [['fetchMineOrIntegrated', 'ajustes_sistemicos']]);
  assert.equal(ctx.state.ajustesSistemicos.length, 1);
});

teste('DAI de outro dono (reatribuída/herdada) entra em state.ajustesSistemicos pro ADM — antes ficava de fora', async () => {
  const { ctx } = montar({ role: 'admin', todasRows: [rowDai] });
  await ctx.syncAjustesSistemicosFromSupabase();
  const dai = ctx.state.ajustesSistemicos.find(d => d.id === 'dai_1');
  assert.ok(dai, 'DAI de outro usuário deveria estar em state.ajustesSistemicos pro ADM');
});

// ── Realtime: _daiEhRelevantePraMim ────────────────────────────────────
// Espelha o fetch inicial acima — sem isto, o Realtime dessincronizava de
// novo logo após o primeiro DAI reatribuído/criado por outro usuário
// enquanto a sessão do ADM já estava aberta.

teste('_daiEhRelevantePraMim: ADM considera relevante qualquer DAI, mesmo de outro dono e não integrada', async () => {
  const { ctx } = montar({ role: 'admin' });
  assert.equal(await ctx._daiEhRelevantePraMim({ ...rowDai }), true);
});

teste('_daiEhRelevantePraMim: usuário comum também relevante (confia na RLS, que já restringiu)', async () => {
  const { ctx } = montar({ role: 'user' });
  assert.equal(await ctx._daiEhRelevantePraMim({ ...rowDai }), true);
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
