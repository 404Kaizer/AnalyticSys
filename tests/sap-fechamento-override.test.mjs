// Teste do padrão de inclusão dos Ajustes de Fechamento Mensal SAP
// (Y11/Y12) — desde 07/08/2026 o padrão é CONSIDERAR no cálculo; só fica
// desconsiderado se (a) travado por justificativa do Inventário ou
// (b) desconsiderado manualmente via setSapFechOverrideEmLote/override.
// Ver isSapExcluidoPorFechamento em js/ui.js.
//
// Rode com: node tests/sap-fechamento-override.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonteUi = readFileSync(join(raiz, 'js', 'ui.js'), 'utf8');

function parseDateBr(str) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(str || ''));
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function montar(state) {
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    document: { getElementById() { return null; }, querySelector() { return null; }, addEventListener() {} },
    num: (v) => typeof v === 'number' ? v : (parseFloat(String(v).replace(',', '.')) || 0),
    parseDate: parseDateBr,
    normMov: (v) => String(v || '').trim().toUpperCase(),
    normalizeText: (v) => String(v || '').trim().toLowerCase(),
    toast() {},
    // setSapFechOverrideEmLote (07/08) só executa pra admin — ver guarda em
    // js/ui.js. Os testes exercitam a mecânica de override, não a
    // permissão, então o contexto já sobe como admin por padrão.
    currentUser: { role: 'admin', id: 'test-admin' },
    state,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fonteUi, ctx);
  return ctx;
}

// Bate no padrão Y11/Y12: DT DOC/DT LANÇ no mesmo mês, DT REG no mês seguinte.
const registroFechamento = (over) => ({
  movimento: 'Y11', documento: '1400012345', central: 'C1', deposito: 'D1',
  material: 'MAT1', dtDoc: '30/06/2026', dtLanc: '30/06/2026', dtReg: '01/07/2026',
  peso: -1000, ...over,
});

const casos = [];
const teste = (nome, fn) => casos.push({ nome, fn });

teste('candidato Y11/Y12 sem override nem justificativa: considerado por padrão (não excluído)', () => {
  const ctx = montar({ sap: [], sapFechamentoOverrides: [], invJustificativas: [] });
  assert.equal(ctx.isSapExcluidoPorFechamento(registroFechamento()), false);
});

teste('candidato desconsiderado manualmente via override: excluído', () => {
  const ctx = montar({ sap: [], sapFechamentoOverrides: [], invJustificativas: [] });
  const r = registroFechamento();
  ctx.setSapFechOverrideEmLote([ctx.getSapFechKey(r)], false);
  assert.equal(ctx.isSapExcluidoPorFechamento(r), true);
});

teste('override desfeito (Considerar Ajuste): volta a ser considerado', () => {
  const ctx = montar({ sap: [], sapFechamentoOverrides: [], invJustificativas: [] });
  const r = registroFechamento();
  const chave = ctx.getSapFechKey(r);
  ctx.setSapFechOverrideEmLote([chave], false);
  ctx.setSapFechOverrideEmLote([chave], true);
  assert.equal(ctx.isSapExcluidoPorFechamento(r), false);
});

teste('Documento SAP justificado no Inventário: excluído mesmo sem override manual', () => {
  const ctx = montar({
    sap: [], sapFechamentoOverrides: [],
    invJustificativas: [{ documentoSap: '1400012345' }],
  });
  assert.equal(ctx.isSapExcluidoPorFechamento(registroFechamento()), true);
});

teste('Documento SAP justificado no Inventário: trava mesmo com override manual "considerar"', () => {
  const ctx = montar({
    sap: [], sapFechamentoOverrides: [],
    invJustificativas: [{ documentoSap: '1400012345' }],
  });
  const r = registroFechamento();
  ctx.setSapFechOverrideEmLote([ctx.getSapFechKey(r)], true);
  assert.equal(ctx.isSapExcluidoPorFechamento(r), true);
});

teste('registro fora do padrão Y11/Y12 (movimento comum): sempre considerado', () => {
  const ctx = montar({ sap: [], sapFechamentoOverrides: [], invJustificativas: [] });
  assert.equal(ctx.isSapExcluidoPorFechamento(registroFechamento({ movimento: '101' })), false);
});

teste('usuário comum não consegue desconsiderar (só ADM altera)', () => {
  const ctx = montar({ sap: [], sapFechamentoOverrides: [], invJustificativas: [] });
  ctx.currentUser.role = 'user';
  const r = registroFechamento();
  ctx.setSapFechOverrideEmLote([ctx.getSapFechKey(r)], false);
  assert.equal(ctx.isSapExcluidoPorFechamento(r), false);
});

// ── Desbloqueio manual da trava do Inventário (11/08) ─────────────────────

teste('linha travada no Inventário, desbloqueada manualmente: volta a ser considerada (padrão)', () => {
  const ctx = montar({
    sap: [], sapFechamentoOverrides: [], sapFechInvUnlockOverrides: [],
    invJustificativas: [{ documentoSap: '1400012345' }],
  });
  const r = registroFechamento();
  const chave = ctx.getSapFechKey(r);
  assert.equal(ctx.isSapExcluidoPorFechamento(r), true); // travada antes de desbloquear
  ctx.setSapFechInvLockOverrideEmLote([chave], true);
  assert.equal(ctx.isSapExcluidoPorFechamento(r), false);
});

teste('linha desbloqueada continua sujeita ao override normal de Considerar/Desconsiderar', () => {
  const ctx = montar({
    sap: [], sapFechamentoOverrides: [], sapFechInvUnlockOverrides: [],
    invJustificativas: [{ documentoSap: '1400012345' }],
  });
  const r = registroFechamento();
  const chave = ctx.getSapFechKey(r);
  ctx.setSapFechInvLockOverrideEmLote([chave], true);
  ctx.setSapFechOverrideEmLote([chave], false); // desconsiderar manualmente
  assert.equal(ctx.isSapExcluidoPorFechamento(r), true);
});

teste('"Bloquear" desfaz o desbloqueio: trava do Inventário volta a valer', () => {
  const ctx = montar({
    sap: [], sapFechamentoOverrides: [], sapFechInvUnlockOverrides: [],
    invJustificativas: [{ documentoSap: '1400012345' }],
  });
  const r = registroFechamento();
  const chave = ctx.getSapFechKey(r);
  ctx.setSapFechInvLockOverrideEmLote([chave], true);
  assert.equal(ctx.isSapExcluidoPorFechamento(r), false);
  ctx.setSapFechInvLockOverrideEmLote([chave], false); // bloquear de novo
  assert.equal(ctx.isSapExcluidoPorFechamento(r), true);
});

teste('desbloqueio não afeta linhas sem justificativa no Inventário (nada a destravar)', () => {
  const ctx = montar({ sap: [], sapFechamentoOverrides: [], sapFechInvUnlockOverrides: [], invJustificativas: [] });
  const r = registroFechamento();
  const chave = ctx.getSapFechKey(r);
  ctx.setSapFechInvLockOverrideEmLote([chave], true);
  assert.equal(ctx.isSapExcluidoPorFechamento(r), false); // já não estava travada
});

teste('usuário comum não consegue desbloquear a trava do Inventário (só ADM altera)', () => {
  const ctx = montar({
    sap: [], sapFechamentoOverrides: [], sapFechInvUnlockOverrides: [],
    invJustificativas: [{ documentoSap: '1400012345' }],
  });
  ctx.currentUser.role = 'user';
  const r = registroFechamento();
  ctx.setSapFechInvLockOverrideEmLote([ctx.getSapFechKey(r)], true);
  assert.equal(ctx.isSapExcluidoPorFechamento(r), true); // continua travada
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
