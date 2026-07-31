// Teste da regra de visão automática do Supervisor em Ocorrências (31/07):
// toda ocorrência escalonada pra nível 2+ (Supervisor do Setor/Gerência) ou
// vinculada a uma DAI (origem_ajuste_sistemico=true) deve entrar
// automaticamente na tela dele — ver ocApareceAutoParaSupervisor() e
// syncOcorrenciasFromSupabase() em ocorrencias.js. Um erro de comparação
// aqui (ex.: usar "nivel > 2" em vez de ">= 2") faria o Supervisor não ver
// ocorrências que já estão no nível dele, ou esconder DAIs — silencioso,
// sem exceção, só "sumindo" da tela.
//
// Também cobre a mesma regra aplicada evento a evento pelo canal Realtime
// (_ocEhRelevantePraMim) e o upsert/remove local (_ocUpsertLocal/
// _ocRemoveLocal) — sem o filtro aqui, o Realtime reviveria a poluição de
// 28/07 (ADM recebendo toda ocorrência de todo mundo, não só a relevante).
//
// Rode com: node tests/ocorrencias-supervisor.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonteOcorrencias = readFileSync(join(raiz, 'js', 'ocorrencias.js'), 'utf8');

function montar({ role = 'admin', integrados = new Set() } = {}) {
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    state: { ocorrencias: [] },
    // O arquivo registra um listener de clique pros dropdowns de filtro já
    // no carregamento (fora de qualquer função) — precisa existir pra
    // vm.runInContext não quebrar.
    document: {
      addEventListener() {},
      getElementById() { return null; },
    },
  };
  // window === global (mesmo objeto), como no navegador de verdade — o
  // arquivo faz `window.foo = function(){}` e depois `Object.assign(window,
  // {foo})` (referência solta) mais embaixo; com um `window` separado do
  // objeto global do vm, a segunda forma quebra com ReferenceError.
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.currentUser = { id: 'u-adm', role };
  // Stub do normalize.js real (fora do escopo deste teste) — só o
  // suficiente pra _ocEhRelevantePraMim funcionar isolado.
  ctx._integracoesDoAdmin = async () => integrados;
  vm.createContext(ctx);
  vm.runInContext(fonteOcorrencias, ctx);
  return ctx;
}

// Mesma montagem, mas com window.supabaseClient mockado (chain
// from().update().eq().eq()) e persist/renderOcorrencias/toast espiados —
// pra testar _ocSyncReatribuir/reatribuirOcorrencia sem rede de verdade.
function montarComSupabase({ role = 'admin', erro = null } = {}) {
  const ctx = montar({ role });
  const chamadas = { from: [], update: [], eq: [], persist: 0, render: 0, toasts: [], daiReatribuir: [] };
  ctx.persist = () => { chamadas.persist++; };
  ctx.renderOcorrencias = () => { chamadas.render++; };
  ctx.toast = (msg, tipo) => { chamadas.toasts.push({ msg, tipo }); };
  ctx._daiSyncReatribuir = async (...args) => { chamadas.daiReatribuir.push(args); return true; };
  ctx.supabaseClient = {
    from(tabela) {
      chamadas.from.push(tabela);
      return {
        update(payload) {
          chamadas.update.push(payload);
          return {
            eq(col, val) {
              chamadas.eq.push([col, val]);
              return { eq: (col2, val2) => { chamadas.eq.push([col2, val2]); return Promise.resolve({ error: erro }); } };
            },
          };
        },
      };
    },
  };
  return { ctx, chamadas };
}

const casos = [];
const teste = (nome, fn) => casos.push({ nome, fn });

const rowBase = { id: 'oc_1', user_id: 'outro-usuario', hierarquia: [], origem_ajuste_sistemico: false };

teste('ocorrência sem escalonamento e sem DAI não aparece pro supervisor', () => {
  const ctx = montar();
  assert.equal(ctx.ocApareceAutoParaSupervisor({ ...rowBase }), false);
});

teste('escalonada até Regional (nível 1) ainda não aparece', () => {
  const ctx = montar();
  const row = { ...rowBase, hierarquia: [{ nivel: 1 }] };
  assert.equal(ctx.ocApareceAutoParaSupervisor(row), false);
});

teste('escalonada até Supervisor do Setor (nível 2) aparece', () => {
  const ctx = montar();
  const row = { ...rowBase, hierarquia: [{ nivel: 1 }, { nivel: 2 }] };
  assert.equal(ctx.ocApareceAutoParaSupervisor(row), true);
});

teste('escalonada até Gerência (nível 3) aparece', () => {
  const ctx = montar();
  const row = { ...rowBase, hierarquia: [{ nivel: 1 }, { nivel: 2 }, { nivel: 3 }] };
  assert.equal(ctx.ocApareceAutoParaSupervisor(row), true);
});

teste('descalonada de volta pra Regional some de novo (usa só o nível ATUAL, não o histórico)', () => {
  const ctx = montar();
  const row = { ...rowBase, hierarquia: [{ nivel: 1 }, { nivel: 2 }, { nivel: 1 }] };
  assert.equal(ctx.ocApareceAutoParaSupervisor(row), false);
});

teste('DAI (origem_ajuste_sistemico=true) aparece mesmo sem nenhum escalonamento', () => {
  const ctx = montar();
  const row = { ...rowBase, origem_ajuste_sistemico: true };
  assert.equal(ctx.ocApareceAutoParaSupervisor(row), true);
});

// ── Realtime: _ocEhRelevantePraMim (31/07) ─────────────────────────────
// Mesma regra do fetch inicial, decidida evento a evento. Sem isto, o
// Realtime reviveria a poluição de 28/07 (ADM recebendo TODA ocorrência
// de TODO usuário) ou, no sentido contrário, esconderia do Supervisor uma
// ocorrência que acabou de ser escalonada/DAI enquanto a sessão dele já
// estava aberta.

teste('usuário comum: sempre relevante (confia na RLS, que já restringiu)', async () => {
  const ctx = montar({ role: 'user' });
  const row = { ...rowBase };
  assert.equal(await ctx._ocEhRelevantePraMim(row), true);
});

teste('admin: ocorrência própria é relevante mesmo sem escalonamento/DAI', async () => {
  const ctx = montar({ role: 'admin' });
  const row = { ...rowBase, user_id: 'u-adm' };
  assert.equal(await ctx._ocEhRelevantePraMim(row), true);
});

teste('admin: ocorrência de outro dono, não integrada, nível baixo, sem DAI — não relevante', async () => {
  const ctx = montar({ role: 'admin' });
  assert.equal(await ctx._ocEhRelevantePraMim({ ...rowBase }), false);
});

teste('admin: ocorrência de outro dono só entra se integrada manualmente', async () => {
  const ctx = montar({ role: 'admin', integrados: new Set(['oc_1']) });
  assert.equal(await ctx._ocEhRelevantePraMim({ ...rowBase }), true);
});

// ── _ocMotivoRelevancia (31/07) — o MOTIVO, não só se é relevante. É o que
// decide se a notificação de prioridade do Supervisor dispara: só deve
// disparar pra 'escalonamento'/'dai', nunca pra 'proprio'/'integrado'/'rls'
// (esses já têm seus próprios avisos, ou nem fazem sentido pro usuário
// comum, que nunca entra nesses dois motivos).

teste('motivo: usuário comum é sempre "rls" (confia na RLS)', async () => {
  const ctx = montar({ role: 'user' });
  assert.equal(await ctx._ocMotivoRelevancia({ ...rowBase }), 'rls');
});

teste('motivo: ocorrência própria do admin é "proprio"', async () => {
  const ctx = montar({ role: 'admin' });
  assert.equal(await ctx._ocMotivoRelevancia({ ...rowBase, user_id: 'u-adm' }), 'proprio');
});

teste('motivo: ocorrência integrada manualmente é "integrado", mesmo já escalonada (integração manual tem prioridade)', async () => {
  const ctx = montar({ role: 'admin', integrados: new Set(['oc_1']) });
  const row = { ...rowBase, hierarquia: [{ nivel: 2 }] };
  assert.equal(await ctx._ocMotivoRelevancia(row), 'integrado');
});

teste('motivo: escalonada pro nível do Supervisor, sem DAI, é "escalonamento"', async () => {
  const ctx = montar({ role: 'admin' });
  const row = { ...rowBase, hierarquia: [{ nivel: 2 }] };
  assert.equal(await ctx._ocMotivoRelevancia(row), 'escalonamento');
});

teste('motivo: origem_ajuste_sistemico=true é "dai", mesmo sem nenhum escalonamento', async () => {
  const ctx = montar({ role: 'admin' });
  const row = { ...rowBase, origem_ajuste_sistemico: true };
  assert.equal(await ctx._ocMotivoRelevancia(row), 'dai');
});

teste('motivo: nada disso (nível baixo, sem DAI, não integrada, não própria) é null', async () => {
  const ctx = montar({ role: 'admin' });
  assert.equal(await ctx._ocMotivoRelevancia({ ...rowBase }), null);
});

teste('admin: ocorrência escalonada pro nível do Supervisor entra mesmo sem integração manual', async () => {
  const ctx = montar({ role: 'admin' });
  const row = { ...rowBase, hierarquia: [{ nivel: 2 }] };
  assert.equal(await ctx._ocEhRelevantePraMim(row), true);
});

// ── Realtime: upsert/remove local ──────────────────────────────────────

teste('_ocUpsertLocal insere quando não existe e atualiza em vez de duplicar quando já existe', () => {
  const ctx = montar();
  ctx.state.ocorrencias = [];
  ctx._ocUpsertLocal({ ...rowBase, motivo: 'primeira versão' });
  ctx._ocUpsertLocal({ ...rowBase, motivo: 'versão editada' });
  assert.equal(ctx.state.ocorrencias.length, 1);
  assert.equal(ctx.state.ocorrencias[0].motivo, 'versão editada');
});

teste('_ocRemoveLocal remove só o par (id, userId) certo, não mexe em outros donos com o mesmo id', () => {
  const ctx = montar();
  ctx.state.ocorrencias = [];
  ctx._ocUpsertLocal({ ...rowBase, id: 'oc_1', user_id: 'dono-a' });
  ctx._ocUpsertLocal({ ...rowBase, id: 'oc_1', user_id: 'dono-b' });
  ctx._ocRemoveLocal('oc_1', 'dono-a');
  assert.equal(ctx.state.ocorrencias.length, 1);
  assert.equal(ctx.state.ocorrencias[0].userId, 'dono-b');
});

// BUG REAL (31/07): criei uma ocorrência → entra otimista no state com
// userId ainda vazio (round-trip não terminou) → o INSERT que o próprio
// upsert dispara chega pelo canal Realtime com user_id já resolvido pelo
// banco → _ocUpsertLocal comparava userId==userId sem fallback, não
// achava a entrada local (undefined !== uuid) e duplicava o card.
teste('_ocUpsertLocal não duplica quando o evento Realtime confirma uma ocorrência recém-criada localmente (userId ainda não resolvido)', () => {
  const ctx = montar({ role: 'user' });
  ctx.currentUser = { id: 'dono-a', role: 'user' };
  ctx.state.ocorrencias = [{ id: 'OC-HUGO-1', userId: undefined, motivo: 'criada localmente' }];
  ctx._ocUpsertLocal({ ...rowBase, id: 'OC-HUGO-1', user_id: 'dono-a', motivo: 'criada localmente' });
  assert.equal(ctx.state.ocorrencias.length, 1);
  assert.equal(ctx.state.ocorrencias[0].userId, 'dono-a');
});

// ── _ocToDbRow: user_id explícito (31/07) ──────────────────────────────
// BUG REAL: a coluna ocorrencias.user_id tem `default auth.uid()`. Sem
// mandar user_id explícito no upsert, editar a ocorrência de OUTRO dono
// (Supervisor mexendo em algo escalonado pra ele) caía no default — o
// PRÓPRIO uid de quem editou — e o onConflict:'user_id,id' passava a
// mirar (meu_id, id) em vez de (dono_real, id): sem linha existente ali,
// o upsert INSERIA uma cópia nova em vez de atualizar a original —
// duplicava pro Supervisor e a edição nunca chegava no dono de verdade.

teste('_ocToDbRow manda o user_id do DONO ORIGINAL, não do currentUser', () => {
  const ctx = montar({ role: 'admin' }); // currentUser.id = 'u-adm'
  const row = ctx._ocToDbRow({ id: 'oc_1', userId: 'dono-real' });
  assert.equal(row.user_id, 'dono-real');
});

teste('_ocToDbRow cai no currentUser só quando userId ainda não foi resolvido (criação nova)', () => {
  const ctx = montar({ role: 'admin' });
  const row = ctx._ocToDbRow({ id: 'oc_1', userId: undefined });
  assert.equal(row.user_id, 'u-adm');
});

// ── _ocDetectarMudancaPrioritaria (31/07) ──────────────────────────────
// Notificação pro DONO quando o Supervisor mexe na ocorrência dele —
// precisa acertar exatamente QUAL mudança aconteceu (escalonou/concluiu/
// marcou inconclusiva/reabriu/descalonou), e não disparar nada pra edição
// "de campo" (central, descrição etc.).

const daiBase = { central: 'ABA1', numero: 'OC-HUGO-1', concluida: false, inconclusiva: false, hierarquia: [] };

teste('mudança: concluida false→true é "concluida"', () => {
  const ctx = montar();
  const r = ctx._ocDetectarMudancaPrioritaria(daiBase, { ...daiBase, concluida: true });
  assert.equal(r.tipo, 'concluida');
});

teste('mudança: inconclusiva false→true é "inconclusiva"', () => {
  const ctx = montar();
  const r = ctx._ocDetectarMudancaPrioritaria(daiBase, { ...daiBase, inconclusiva: true });
  assert.equal(r.tipo, 'inconclusiva');
});

teste('mudança: concluida true→false é "reaberta"', () => {
  const ctx = montar();
  const r = ctx._ocDetectarMudancaPrioritaria({ ...daiBase, concluida: true }, { ...daiBase, concluida: false });
  assert.equal(r.tipo, 'reaberta');
});

teste('mudança: inconclusiva true→false é "reaberta"', () => {
  const ctx = montar();
  const r = ctx._ocDetectarMudancaPrioritaria({ ...daiBase, inconclusiva: true }, { ...daiBase, inconclusiva: false });
  assert.equal(r.tipo, 'reaberta');
});

teste('mudança: nível sobe (escalonou pra Gerência) é "escalonada", com o nome do nível no título', () => {
  const ctx = montar();
  const r = ctx._ocDetectarMudancaPrioritaria(
    { ...daiBase, hierarquia: [{ nivel: 2 }] },
    { ...daiBase, hierarquia: [{ nivel: 2 }, { nivel: 3 }] },
  );
  assert.equal(r.tipo, 'escalonada');
  assert.match(r.titulo, /Gerência/);
});

teste('mudança: nível desce é "descalonada"', () => {
  const ctx = montar();
  const r = ctx._ocDetectarMudancaPrioritaria(
    { ...daiBase, hierarquia: [{ nivel: 2 }, { nivel: 3 }] },
    { ...daiBase, hierarquia: [{ nivel: 2 }] },
  );
  assert.equal(r.tipo, 'descalonada');
});

teste('sem mudança de prioridade (só editou central/descrição) devolve null', () => {
  const ctx = montar();
  const r = ctx._ocDetectarMudancaPrioritaria(daiBase, { ...daiBase, central: 'ABA2' });
  assert.equal(r, null);
});

teste('old_data ou new_data ausentes devolve null (não quebra)', () => {
  const ctx = montar();
  assert.equal(ctx._ocDetectarMudancaPrioritaria(null, daiBase), null);
  assert.equal(ctx._ocDetectarMudancaPrioritaria(daiBase, null), null);
});

// ── Atribuição (31/07) — Supervisor delegando pra um usuário comum ─────
// Mesma classe de bug que já deu dois problemas reais nesta área (upsert
// mudando a chave composta sem querer) — user_id é PARTE da PK, então
// tem que ser um UPDATE explícito filtrando pela chave ANTIGA, nunca um
// upsert com a chave nova.

teste('_ocSyncReatribuir manda UPDATE com o user_id NOVO, filtrando pela chave ANTIGA', async () => {
  const { ctx, chamadas } = montarComSupabase();
  const ok = await ctx._ocSyncReatribuir('oc_1', 'dono-antigo', 'dono-novo');
  assert.equal(ok, true);
  assert.deepEqual(chamadas.from, ['ocorrencias']);
  // JSON.parse(JSON.stringify(...)) normaliza pro realm de fora — o objeto
  // do payload foi criado DENTRO do vm (outro realm), deepEqual cru
  // reclama de "mesma estrutura mas não é a mesma referência de Object".
  assert.deepEqual(JSON.parse(JSON.stringify(chamadas.update)), [{ user_id: 'dono-novo' }]);
  assert.deepEqual(chamadas.eq, [['user_id', 'dono-antigo'], ['id', 'oc_1']]);
});

teste('_ocSyncReatribuir devolve false em erro (RLS etc.), sem lançar exceção', async () => {
  const { ctx } = montarComSupabase({ erro: { message: 'RLS' } });
  const ok = await ctx._ocSyncReatribuir('oc_1', 'a', 'b');
  assert.equal(ok, false);
});

teste('reatribuirOcorrencia move o dono localmente e persiste/renderiza', async () => {
  const { ctx, chamadas } = montarComSupabase();
  ctx.state.ocorrencias = [{ id: 'oc_1', userId: 'dono-antigo', origemAjusteSistemico: false }];
  await ctx.reatribuirOcorrencia('oc_1', 'dono-novo');
  assert.equal(ctx.state.ocorrencias[0].userId, 'dono-novo');
  assert.equal(chamadas.persist, 1);
  assert.equal(chamadas.render, 1);
  assert.deepEqual(chamadas.daiReatribuir, []); // não é DAI — não mexe em ajustes_sistemicos
});

teste('reatribuirOcorrencia de uma DAI também reatribui o documento vinculado (mesmo dono nos dois)', async () => {
  const { ctx, chamadas } = montarComSupabase();
  ctx.state.ocorrencias = [{ id: 'oc_1', userId: 'dono-antigo', origemAjusteSistemico: true, daiId: 'dai_1' }];
  await ctx.reatribuirOcorrencia('oc_1', 'dono-novo');
  assert.deepEqual(chamadas.daiReatribuir, [['dai_1', 'dono-antigo', 'dono-novo']]);
});

teste('reatribuirOcorrencia não faz nada se o novo dono já é o atual', async () => {
  const { ctx, chamadas } = montarComSupabase();
  ctx.state.ocorrencias = [{ id: 'oc_1', userId: 'mesmo-dono' }];
  await ctx.reatribuirOcorrencia('oc_1', 'mesmo-dono');
  assert.equal(chamadas.from.length, 0);
  assert.equal(chamadas.persist, 0);
});

teste('reatribuirOcorrencia não persiste localmente se o UPDATE falhar', async () => {
  const { ctx, chamadas } = montarComSupabase({ erro: { message: 'RLS' } });
  ctx.state.ocorrencias = [{ id: 'oc_1', userId: 'dono-antigo' }];
  await ctx.reatribuirOcorrencia('oc_1', 'dono-novo');
  assert.equal(ctx.state.ocorrencias[0].userId, 'dono-antigo'); // não mudou
  assert.equal(chamadas.persist, 0);
});

// ── Filtros no padrão Visão Micro (31/07) ──────────────────────────────
// ocStatusMatches é a mesma lógica que já existia inline no <select> antigo,
// só extraída pra dar pra checar "bate com QUALQUER status marcado" no
// multi-seleção — precisa continuar batendo exatamente igual, senão o
// filtro passa a mostrar (ou esconder) a coisa errada silenciosamente.

function amanha(dias) {
  const d = new Date(); d.setDate(d.getDate() + dias);
  return d.toISOString().split('T')[0];
}

teste('ocStatusMatches: "aberta" bate com não-concluída e não-inconclusiva', () => {
  const ctx = montar();
  assert.equal(ctx.ocStatusMatches({ concluida: false, inconclusiva: false }, 'aberta'), true);
  assert.equal(ctx.ocStatusMatches({ concluida: true, inconclusiva: false }, 'aberta'), false);
});

teste('ocStatusMatches: "vencida" exige prazo no passado e não concluída/inconclusiva', () => {
  const ctx = montar();
  const vencida = { concluida: false, inconclusiva: false, dataLimite: amanha(-3) };
  assert.equal(ctx.ocStatusMatches(vencida, 'vencida'), true);
  assert.equal(ctx.ocStatusMatches({ ...vencida, concluida: true }, 'vencida'), false);
  assert.equal(ctx.ocStatusMatches({ ...vencida, dataLimite: amanha(3) }, 'vencida'), false);
});

teste('ocStatusMatches: "urgente" é prazo em até 2 dias, não vencido', () => {
  const ctx = montar();
  assert.equal(ctx.ocStatusMatches({ concluida: false, inconclusiva: false, dataLimite: amanha(1) }, 'urgente'), true);
  assert.equal(ctx.ocStatusMatches({ concluida: false, inconclusiva: false, dataLimite: amanha(5) }, 'urgente'), false);
});

teste('ocStatusMatches: "concluida"/"inconclusiva"/"ajuste_sistemico" batem no campo direto', () => {
  const ctx = montar();
  assert.equal(ctx.ocStatusMatches({ concluida: true }, 'concluida'), true);
  assert.equal(ctx.ocStatusMatches({ inconclusiva: true, concluida: false }, 'inconclusiva'), true);
  assert.equal(ctx.ocStatusMatches({ inconclusiva: true, concluida: true }, 'inconclusiva'), false); // concluída tem prioridade
  assert.equal(ctx.ocStatusMatches({ origemAjusteSistemico: true }, 'ajuste_sistemico'), true);
});

teste('getOcorrenciasFiltradas: sem nenhum filtro aplicado, mostra tudo', () => {
  const ctx = montar();
  ctx.state.ocorrencias = [{ id: 'a', central: 'ABA1' }, { id: 'b', central: 'ABA2' }];
  assert.equal(ctx.getOcorrenciasFiltradas().length, 2);
});

teste('getOcorrenciasFiltradas: filtro de central é OU entre os selecionados (multi-seleção de verdade)', () => {
  const ctx = montar();
  ctx.state.ocorrencias = [
    { id: 'a', central: 'ABA1' },
    { id: 'b', central: 'ABA2' },
    { id: 'c', central: 'ABA3' },
  ];
  ctx._ocMicroFilter.applied.central = new Set(['ABA1', 'ABA3']);
  const ids = ctx.getOcorrenciasFiltradas().map(o => o.id).sort();
  assert.deepEqual(ids, ['a', 'c']);
});

teste('getOcorrenciasFiltradas: match EXATO de central, não substring (corrige o bug do <select> antigo)', () => {
  const ctx = montar();
  ctx.state.ocorrencias = [{ id: 'a', central: 'ABA1' }, { id: 'b', central: 'ABA10' }];
  ctx._ocMicroFilter.applied.central = new Set(['ABA1']);
  const ids = ctx.getOcorrenciasFiltradas().map(o => o.id);
  assert.deepEqual(ids, ['a']); // "ABA10" não deveria bater com "ABA1"
});

teste('getOcorrenciasFiltradas: filtro de status casa com QUALQUER valor marcado', () => {
  const ctx = montar();
  ctx.state.ocorrencias = [
    { id: 'a', concluida: true, inconclusiva: false },
    { id: 'b', concluida: false, inconclusiva: true },
    { id: 'c', concluida: false, inconclusiva: false },
  ];
  ctx._ocMicroFilter.applied.status = new Set(['concluida', 'inconclusiva']);
  const ids = ctx.getOcorrenciasFiltradas().map(o => o.id).sort();
  assert.deepEqual(ids, ['a', 'b']);
});

teste('ocApplyMicroFilter: comita pending pra applied e limpa pending do outro lado (via toggle)', () => {
  const ctx = montar();
  ctx.state.ocorrencias = [];
  ctx._ocMicroFilter.pending.central = new Set(['ABA1']);
  ctx.ocApplyMicroFilter('central');
  assert.deepEqual([...ctx._ocMicroFilter.applied.central], ['ABA1']);
});

teste('ocCancelMicroFilter: descarta pending, applied não muda', () => {
  const ctx = montar();
  ctx._ocMicroFilter.applied.central = new Set(['ABA1']);
  ctx._ocMicroFilter.pending.central = new Set(['ABA1', 'ABA2']); // usuário marcou mais uma, mas não aplicou
  ctx.ocCancelMicroFilter('central');
  assert.deepEqual([...ctx._ocMicroFilter.pending.central], ['ABA1']); // voltou a copiar de applied
  assert.deepEqual([...ctx._ocMicroFilter.applied.central], ['ABA1']); // applied intacto
});

teste('ocClearMicroFilter: zera pending E applied de uma chave só', () => {
  const ctx = montar();
  ctx.state.ocorrencias = [];
  ctx._ocMicroFilter.applied.central = new Set(['ABA1']);
  ctx._ocMicroFilter.applied.status = new Set(['concluida']);
  ctx.ocClearMicroFilter('central');
  assert.equal(ctx._ocMicroFilter.applied.central.size, 0);
  assert.equal(ctx._ocMicroFilter.applied.status.size, 1); // outra chave não mexida
});

teste('ocClearAllMicroFilters: zera as 4 chaves de uma vez', () => {
  const ctx = montar();
  ctx.state.ocorrencias = [];
  ctx._ocMicroFilter.applied.central = new Set(['ABA1']);
  ctx._ocMicroFilter.applied.status = new Set(['concluida']);
  ctx._ocMicroFilter.applied.material = new Set(['X']);
  ctx._ocMicroFilter.applied.regional = new Set(['Y']);
  ctx.ocClearAllMicroFilters();
  const f = ctx._ocMicroFilter.applied;
  assert.equal(f.central.size + f.status.size + f.material.size + f.regional.size, 0);
});

// ── populateOcFiltros: opções refletem só o que existe (31/07) ─────────
// Achado do usuário: Central/Material mostravam o cadastro INTEIRO
// (state.filiais/state.materiais), inclusive coisa nunca usada em nenhuma
// ocorrência. Agora é só o que já apareceu em alguma ocorrência de
// verdade — o cadastro completo continua só no formulário de Nova
// Ocorrência (mCentral/mMaterial), que é um caso de uso diferente
// (cadastrar algo novo, não filtrar o que já existe).

teste('populateOcFiltros: Central/Material só mostram valores que JÁ existem numa ocorrência, não o cadastro inteiro', () => {
  const ctx = montar();
  ctx.state.ocorrencias = [{ id: 'a', central: 'ABA1', material: 'CIMENTO', concluida: false, inconclusiva: false }];
  ctx.state.filiais = [{ alias: 'ABA1' }, { alias: 'ABA9-NUNCA-USADA' }];
  ctx.state.materiais = [{ origem: 'CIMENTO' }, { origem: 'NUNCA-USADO' }];
  ctx.populateOcFiltros();
  // JSON round-trip: os arrays vêm de .map() executado com o Array do
  // realm do vm — deepEqual cru reclama de "mesma estrutura mas não é a
  // mesma referência de Object/Array" comparando com um array literal daqui.
  const paraFora = arr => JSON.parse(JSON.stringify(arr));
  assert.deepEqual(paraFora(ctx._ocMicroFilter.options.central.map(o => o.value)), ['ABA1']);
  assert.deepEqual(paraFora(ctx._ocMicroFilter.options.material.map(o => o.value)), ['CIMENTO']);
});

teste('populateOcFiltros: Status só lista valores com pelo menos 1 ocorrência batendo agora', () => {
  const ctx = montar();
  ctx.state.filiais = [];
  ctx.state.materiais = [];
  ctx.state.ocorrencias = [{ id: 'a', central: 'X', concluida: true, inconclusiva: false }]; // só "concluida" ocorre
  ctx.populateOcFiltros();
  const statusValues = JSON.parse(JSON.stringify(ctx._ocMicroFilter.options.status.map(o => o.value)));
  assert.deepEqual(statusValues, ['concluida']);
});

teste('populateOcFiltros: sem nenhuma ocorrência registrada, os dropdowns ficam vazios (não caem no cadastro)', () => {
  const ctx = montar();
  ctx.state.ocorrencias = [];
  ctx.state.filiais = [{ alias: 'ABA1' }];
  ctx.state.materiais = [{ origem: 'CIMENTO' }];
  ctx.populateOcFiltros();
  assert.equal(ctx._ocMicroFilter.options.status.length, 0);
  assert.equal(ctx._ocMicroFilter.options.central.length, 0);
  assert.equal(ctx._ocMicroFilter.options.material.length, 0);
});

// ── Regional substituiu Operador como filtro (31/07) ───────────────────
// Ocorrências não têm campo regional próprio — só central. O filtro
// resolve via state.filiais (central → regional), igual ao resto do app
// já faz (ver agregados.js/analitico.js).

teste('_ocRegionalPorCentral: resolve pelo alias/origem da filial (mesma normalização do resto do arquivo)', () => {
  const ctx = montar();
  ctx.state.filiais = [
    { alias: 'ABA1', regional: 'Sudeste' },
    { origem: 'ABA2-SEM-ALIAS', regional: 'Sul' },
    { alias: 'ABA3', regional: '' }, // sem regional preenchido — não entra
  ];
  const mapa = ctx._ocRegionalPorCentral();
  assert.equal(mapa.get('ABA1'), 'Sudeste');
  assert.equal(mapa.get('ABA2-SEM-ALIAS'), 'Sul');
  assert.equal(mapa.has('ABA3'), false);
});

teste('getOcorrenciasFiltradas: filtro de regional resolve via central e é OU entre os selecionados', () => {
  const ctx = montar();
  ctx.state.filiais = [
    { alias: 'ABA1', regional: 'Sudeste' },
    { alias: 'ABA2', regional: 'Sul' },
    { alias: 'ABA3', regional: 'Norte' },
  ];
  ctx.state.ocorrencias = [
    { id: 'a', central: 'ABA1' },
    { id: 'b', central: 'ABA2' },
    { id: 'c', central: 'ABA3' },
  ];
  ctx._ocMicroFilter.applied.regional = new Set(['Sudeste', 'Norte']);
  const ids = ctx.getOcorrenciasFiltradas().map(o => o.id).sort();
  assert.deepEqual(ids, ['a', 'c']);
});

teste('getOcorrenciasFiltradas: central sem filial cadastrada (ou sem regional) não bate com nenhum filtro de regional', () => {
  const ctx = montar();
  ctx.state.filiais = []; // nenhuma filial cadastrada
  ctx.state.ocorrencias = [{ id: 'a', central: 'CENTRAL-DESCONHECIDA' }];
  ctx._ocMicroFilter.applied.regional = new Set(['Sudeste']);
  assert.equal(ctx.getOcorrenciasFiltradas().length, 0);
});

teste('populateOcFiltros: opções de Regional só incluem regionais de centrais que já têm ocorrência', () => {
  const ctx = montar();
  ctx.state.filiais = [
    { alias: 'ABA1', regional: 'Sudeste' },
    { alias: 'ABA9-NUNCA-USADA', regional: 'Nordeste' }, // sem ocorrência nenhuma
  ];
  ctx.state.materiais = [];
  ctx.state.ocorrencias = [{ id: 'a', central: 'ABA1', concluida: false, inconclusiva: false }];
  ctx.populateOcFiltros();
  const paraFora = arr => JSON.parse(JSON.stringify(arr));
  assert.deepEqual(paraFora(ctx._ocMicroFilter.options.regional.map(o => o.value)), ['Sudeste']);
});

// ── Material do formulário de Nova Ocorrência: só o cadastrado (31/07) ─

teste('populateOcFiltros: campo Material do formulário mostra só o CADASTRADO, não o que foi digitado em ocorrências antigas', () => {
  const ctx = montar();
  const fakeSelect = { innerHTML: '' };
  ctx.document.getElementById = (id) => id === 'oc-form-material' ? fakeSelect : null;
  // escapeHtml é de format.js (fora do escopo deste arquivo) — só entra em
  // jogo agora porque este é o primeiro teste em que mMaterial existe de
  // verdade (os outros usam o stub que devolve null pra tudo).
  ctx.escapeHtml = (s) => String(s ?? '');
  ctx.state.filiais = [];
  ctx.state.materiais = [{ origem: 'CIMENTO' }];
  ctx.state.ocorrencias = [{ id: 'a', central: 'X', material: 'MATERIAL-FORA-DO-CADASTRO' }];
  ctx.populateOcFiltros();
  assert.ok(fakeSelect.innerHTML.includes('CIMENTO'));
  assert.ok(!fakeSelect.innerHTML.includes('MATERIAL-FORA-DO-CADASTRO'));
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
