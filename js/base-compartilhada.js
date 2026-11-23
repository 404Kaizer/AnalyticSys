'use strict';

// ═══════════════════════════════════════════════════════════════════════
// BASE COMPARTILHADA DE ENTRADAS/SAÍDAS (18/11/2026)
// ═══════════════════════════════════════════════════════════════════════
// O perfil INSUMOS (e o ADM) importa Entradas/Saídas; todo o resto só lê e
// recebe o mesmo dado, em tempo real. Cada importação vira um PACOTE:
// os registros dela (importId) em chunks JSON gzip no bucket
// `base-compartilhada` + uma linha em `base_pacotes` (índice, com versão).
// Quem sincroniza compara o índice com o local e baixa só o que mudou;
// importação excluída (excluido = true) sai do local de todo mundo.
//
// Regras:
//   • Base "ativa" = existe alguma linha em base_pacotes (o ADM publicou a
//     base dele com basePublicarMinhaBase). Antes disso nada muda em lugar
//     nenhum — cada navegador segue com a sua.
//   • Com a base ativa, o local de Entradas/Saídas de cada um é SÓ o que
//     está nos pacotes + os registros manuais (fonte 'manual', que seguem
//     a sincronização própria via Postgres).
//   • Publicar e sincronizar passam pela MESMA fila (_baseFila): um sync no
//     meio de uma publicação veria o índice pela metade e apagaria do local
//     o que ainda não subiu.
//   • Reimportação mexe em registros de pacotes antigos (o merge mantém o
//     importId original) — por isso o importador republica todo pacote que
//     teve registro tocado, não só o novo (ver processImportedRows).
//   • Fora do fechamento de período desde 18/11/2026 (ver
//     _periodoMesDoRegistro, ui.js) — por isso não há periodoPreservarFechados aqui.
// Usa as funções de gzip/hash do backup condensado (cloud-backup.js).

const BASE_BUCKET = 'base-compartilhada';
const BASE_MODULOS = ['entradas', 'saidas'];
const BASE_CHUNK = 20000;
const BASE_IMPORT_MODULO = { entradas: 'Entrada', saidas: 'Saída' };

let _baseAtiva = false;
let _baseFila = Promise.resolve();
let _baseCanal = null;
let _baseRtTimer = null;
// importIds mexidos aqui e ainda não publicados — o sync não toca neles
// (senão um sync que rode antes da publicação apagaria a importação nova
// ou traria de volta o registro recém-excluído).
const _basePendentes = new Set();

// Chave no Storage: o importId de Saídas tem acento ("imp_Saída_…") e o
// Storage recusa ("Invalid key"). Tira acento e troca o resto por "_"; a
// linha do índice continua com o importId original.
const _baseChave = (id) => String(id).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]/g, '_');

const basePodeEditar = () => ['admin', 'insumos'].includes(window.currentUser?.role);
const baseAtiva = () => _baseAtiva;

function _baseEnfileirar(fn) {
  _baseFila = _baseFila.then(fn).catch(err => console.warn('[Base] Falha:', err));
  return _baseFila;
}

// Map importId → registros (sem manuais) de um módulo, numa passada só.
function _baseAgrupar(modulo) {
  const grupos = new Map();
  for (const r of state[modulo] || []) {
    if (!r.importId || r.fonte === 'manual') continue;
    let g = grupos.get(r.importId);
    if (!g) grupos.set(r.importId, g = []);
    g.push(r);
  }
  return grupos;
}

// ── Publicação ───────────────────────────────────────────────────────────
// Republica os pacotes `importIds` a partir do state atual. Pacote sem
// registro = excluído. Só com a base ativa (opts.forcar = migração do ADM).
function basePublicar(modulo, importIds, opts = {}) {
  if (!BASE_MODULOS.includes(modulo) || !basePodeEditar() || !window.supabaseClient) return Promise.resolve();
  const ids = [...new Set(importIds || [])].filter(Boolean);
  if (!ids.length || (!_baseAtiva && !opts.forcar)) return Promise.resolve();
  ids.forEach(id => _basePendentes.add(id));
  return _baseEnfileirar(async () => {
    const grupos = _baseAgrupar(modulo);
    const sb = window.supabaseClient;
    const st = sb.storage.from(BASE_BUCKET);
    let falhas = 0;
    for (let n = 0; n < ids.length; n++) {
      const id = ids[n];
      try {
        if (opts.progresso) opts.progresso(n, ids.length);
        const recs = grupos.get(id) || [];
        const { data: antes } = await sb.from('base_pacotes').select('versao, chunks').eq('import_id', id).maybeSingle();
        const versao = Date.now();
        const hashes = [];
        const chunks = Math.ceil(recs.length / BASE_CHUNK);
        for (let i = 0; i < chunks; i++) {
          const json = JSON.stringify(recs.slice(i * BASE_CHUNK, (i + 1) * BASE_CHUNK));
          hashes.push(await _cbSha256Hex(json));
          const { error } = await st.upload(`${modulo}/${_baseChave(id)}/${versao}/chunk_${i}.json.gz`, await _cbGzipString(json),
            { upsert: true, contentType: 'application/gzip' });
          if (error) throw error;
          await yieldToUI();
        }
        // Linha por ÚLTIMO (mesmo princípio do manifest do backup condensado).
        // O registro de importação é lido só agora: na importação, a
        // publicação é disparada antes de processImportedRows criá-lo.
        const imp = state.imports.find(r => r.id === id);
        const { error } = await sb.from('base_pacotes').upsert({
          import_id: id, modulo, arquivo: imp?.arquivo || opts.nomes?.[id] || id,
          data_hora: imp?.dataHora || new Date().toLocaleString('pt-BR'),
          registros: recs.length, chunks, hashes, versao, excluido: !recs.length,
          atualizado_por: window.currentUser.id, atualizado_em: new Date().toISOString(),
        });
        if (error) throw error;
        if (imp) imp.baseVersao = versao;
        _baseAtiva = true;
        if (antes?.chunks) {
          const velhos = [];
          for (let i = 0; i < antes.chunks; i++) velhos.push(`${modulo}/${_baseChave(id)}/${antes.versao}/chunk_${i}.json.gz`);
          st.remove(velhos).then(({ error: e }) => { if (e) console.warn('[Base] Limpeza de versão antiga:', e); });
        }
      } catch (err) {
        falhas++;
        console.warn(`[Base] Falha ao publicar ${modulo}/${id}:`, err);
      } finally {
        _basePendentes.delete(id);
      }
    }
    persist();
    if (falhas) toast(`Falha ao publicar ${falhas} pacote(s) de ${modulo} na base compartilhada. Os outros usuários não receberam essa parte — tente de novo.`, 'error');
  });
}

// Migração (ADM): publica a base local inteira de Entradas/Saídas como a
// base compartilhada. Registro sem importId (legado) vai num pacote próprio.
async function basePublicarMinhaBase() {
  if (window.currentUser?.role !== 'admin') { toast('Só o administrador pode publicar a base.', 'error'); return; }
  const tot = BASE_MODULOS.map(m => `${(state[m] || []).length.toLocaleString('pt-BR')} ${m}`).join(' e ');
  if (!confirm(`Publicar a base deste navegador (${tot}) como base compartilhada de Entradas/Saídas?\n\n` +
    `Todos os usuários passam a ver exatamente esta base, e as importações próprias deles de Entradas/Saídas são substituídas.`)) return;

  BASE_MODULOS.forEach(modulo => {
    const legado = `legado_${modulo}`;
    let n = 0;
    for (const r of state[modulo] || []) if (!r.importId && r.fonte !== 'manual') { r.importId = legado; n++; }
    if (n && !state.imports.some(r => r.id === legado)) {
      state.imports.push({ id: legado, arquivo: 'Base anterior (sem arquivo de origem)', modulo: BASE_IMPORT_MODULO[modulo],
        registros: n, totalArquivo: n, dataHora: new Date().toLocaleString('pt-BR'), status: 'Salvo', statusTip: 'Base compartilhada', createdAt: Date.now() });
    }
  });
  persist();

  showLoadingOverlay('Publicando base compartilhada', 'Enviando Entradas/Saídas...');
  try {
    for (const modulo of BASE_MODULOS) {
      await basePublicar(modulo, [..._baseAgrupar(modulo).keys()], {
        forcar: true,
        progresso: (i, total) => updateLoadingOverlay(`${modulo}: pacote ${i + 1} de ${total}`, 'Publicando base compartilhada'),
      });
    }
  } finally {
    hideLoadingOverlay('Base publicada');
  }
  renderImports();
  toast('Base de Entradas/Saídas publicada para todos os usuários.', 'success');
}

// ── Sincronização ────────────────────────────────────────────────────────
async function _baseBaixar(p) {
  const st = window.supabaseClient.storage.from(BASE_BUCKET);
  const out = [];
  for (let i = 0; i < p.chunks; i++) {
    const { data, error } = await st.download(`${p.modulo}/${_baseChave(p.import_id)}/${p.versao}/chunk_${i}.json.gz`);
    if (error || !data) return null;
    const json = await _cbGunzipBlob(data);
    if (await _cbSha256Hex(json) !== p.hashes[i]) return null;
    const recs = JSON.parse(json);
    for (const r of recs) out.push(r);
    await yieldToUI();
  }
  return out.length === p.registros ? out : null;
}

// ── Fatia por dono (23/11/2026) ──────────────────────────────────────────
// Analista dono de categoria(s) em analistas_categoria (Admin → Formulário
// Público) só GUARDA as Entradas/Saídas delas — vale pro sistema todo e
// deixa o boot dele leve. Material sem categoria reconhecida fica com todos.
// ADM, INSUMOS e quem não é dono de nada: '*' (tudo).
// Assinatura gravada por pacote no registro de importação (baseFiltro, com
// baseLocal = quantos ficaram aqui) — trocar o dono refaz a fatia.
// ponytail: mudança no cadastro de materiais (categoria de um material) não
// refaz a fatia sozinha; teto = o analista reimportar/ADM republicar. Se
// precisar, incluir um hash do cadastro na assinatura.
async function _baseFiltroSig() {
  if (['admin', 'insumos'].includes(window.currentUser?.role)) return '*';
  const { data, error } = await window.supabaseClient.from('analistas_categoria')
    .select('categoria').eq('analista_user_id', window.currentUser.id);
  if (error) return null;
  const cats = [...new Set((data || []).map(d => normalizeCategoriaMaterial(d.categoria)).filter(Boolean))].sort();
  return cats.length ? cats.join('|') : '*';
}

function _baseFatia(sig) {
  if (sig === '*') return () => true;
  const minhas = new Set(sig.split('|'));
  const conhecidas = new Set(CATEGORIAS_MATERIAL);
  return r => {
    const c = normalizeCategoriaMaterial(getCategoriaPorGrupo(r.materialOriginal || r.material) || r.categoriaOriginal || r.categoria);
    return !conhecidas.has(c) || minhas.has(c);
  };
}

// ── Notas mães fora do estoque (23/11/2026, aba Acordos) ────────────────
// Nota mãe (CFOP de simples faturamento, entrega futura) não é material
// físico: quem não é ADM/INSUMOS não a guarda nas Entradas — some da lista
// e de todos os cálculos. Casa pela chave de acesso ou, nas Entradas
// importadas antes da coluna de chave, por CNPJ do fornecedor + número.
// Lista via RPC acordo_maes_ocultas (migration 20261123_acordos.sql).
// ponytail: mãe que deixa de ser mãe (CFOP corrigido no cadastro) só volta
// quando o pacote for baixado de novo (ADM republica); mãe nova entra no
// próximo sync (boot ou mudança na base), não na hora do import do SEFAZ.
const _baseNumNf = v => String(v ?? '').split('/')[0].replace(/\D/g, '').replace(/^0+(?=\d)/, '');
async function _baseMaesOcultas() {
  if (basePodeEditar()) return null;
  const ch = new Set(), nf = new Set();
  try {
    for (let de = 0; ; de += 1000) {
      const { data, error } = await window.supabaseClient.rpc('acordo_maes_ocultas').range(de, de + 999);
      if (error) throw error;
      for (const m of data) { ch.add(m.chave); nf.add(m.cnpj + '|' + m.numero); }
      if (data.length < 1000) break;
    }
  } catch (err) { console.warn('[Base] Lista de notas mães indisponível (rodou o SQL 20261123_acordos?):', err); return null; }
  return ch.size ? { ch, nf } : null;
}
const _baseEhMae = (m, r) => (r.chave && m.ch.has(r.chave)) || (r.cnpjFornecedor && m.nf.has(r.cnpjFornecedor + '|' + _baseNumNf(r.nf)));

// opts.boot: chamado no restoreAndRender antes da padronização/índices
// (STEP 3/4 fazem isso pra tudo) — então não reaplica nem redesenha aqui.
function baseSync(opts = {}) {
  if (!window.supabaseClient || !window.currentUser?.id) return Promise.resolve();
  return _baseEnfileirar(() => _baseSyncAgora(opts));
}

async function _baseSyncAgora({ boot = false } = {}) {
  const { data, error } = await window.supabaseClient.from('base_pacotes')
    .select('import_id, modulo, arquivo, data_hora, registros, chunks, hashes, versao, excluido');
  if (error) { console.warn('[Base] Índice indisponível:', error); return; }
  _baseAtiva = data.length > 0;
  if (!_baseAtiva) return;
  const sig = await _baseFiltroSig();
  if (sig === null) { console.warn('[Base] Donos das categorias indisponíveis — sync adiado.'); return; }
  const fatia = _baseFatia(sig);
  const maes = await _baseMaesOcultas();

  const mudaram = [];
  let baixados = 0, falhas = 0;
  // Quem publica (admin/insumos): importação local que NUNCA chegou ao índice
  // (nem ativa nem excluída — ex.: a publicação falhou) não é apagada; fica
  // como pendente e é publicada de novo ao fim deste sync.
  const conhecidos = new Set(data.map(p => p.import_id));
  const republicar = {};
  for (const modulo of BASE_MODULOS) {
    const nomeImp = BASE_IMPORT_MODULO[modulo];
    const ativos = new Map(data.filter(p => p.modulo === modulo && !p.excluido).map(p => [p.import_id, { ...p, versao: Number(p.versao) }]));
    const pend = new Set(_basePendentes);
    const tiraMae = modulo === 'entradas' && maes;
    const naFatia = tiraMae ? r => fatia(r) && !_baseEhMae(maes, r) : fatia;
    // Mãe nova num pacote já baixado: sai do local sem baixar de novo.
    let tirouMaes = false;
    if (tiraMae) {
      const tirados = new Map();
      state.entradas = (state.entradas || []).filter(r => {
        if (r.fonte === 'manual' || pend.has(r.importId) || !_baseEhMae(maes, r)) return true;
        tirados.set(r.importId, (tirados.get(r.importId) || 0) + 1);
        return false;
      });
      for (const [id, n] of tirados) {
        const rec = state.imports.find(x => x.id === id), p = ativos.get(id);
        if (rec && p) rec.baseLocal = rec.registros = (rec.baseLocal ?? p.registros) - n;
      }
      tirouMaes = tirados.size > 0;
    }
    if (basePodeEditar()) {
      const orfaos = new Set();
      for (const r of state[modulo] || []) if (r.importId && r.fonte !== 'manual' && !conhecidos.has(r.importId)) orfaos.add(r.importId);
      orfaos.forEach(id => pend.add(id));
      if (orfaos.size) republicar[modulo] = [...orfaos];
    }
    const contagem = new Map();
    let sobra = false;
    for (const r of state[modulo] || []) {
      if (r.fonte === 'manual' || pend.has(r.importId)) continue;
      if (!r.importId || !ativos.has(r.importId)) { sobra = true; continue; }
      contagem.set(r.importId, (contagem.get(r.importId) || 0) + 1);
    }
    const impPorId = new Map(state.imports.filter(r => r.modulo === nomeImp).map(r => [r.id, r]));
    // Por pacote: em dia (nada), refiltrar o que já está aqui (tinha tudo e
    // agora é fatia — sem baixar de novo) ou baixar.
    const baixar = [], refiltrar = new Set();
    for (const p of ativos.values()) {
      if (pend.has(p.import_id)) continue;
      const rec = impPorId.get(p.import_id), n = contagem.get(p.import_id) || 0;
      const filtroRec = rec?.baseFiltro ?? '*';
      const emDia = rec?.baseVersao === p.versao;
      if (emDia && filtroRec === sig && n === (rec.baseLocal ?? p.registros)) continue;
      if (emDia && filtroRec === '*' && n === p.registros) refiltrar.add(p.import_id);
      else baixar.push(p);
    }
    const impSobra = [...impPorId.keys()].some(id => !ativos.has(id) && !pend.has(id));
    if (!baixar.length && !refiltrar.size && !sobra && !impSobra) { if (tirouMaes) mudaram.push(modulo); continue; }

    const novos = new Map();
    for (const p of baixar) {
      const recs = await _baseBaixar(p);
      if (recs) { novos.set(p.import_id, recs.filter(naFatia)); baixados++; } else falhas++;
    }
    // Falhou o download → o local daquele pacote fica como está.
    const ficam = (state[modulo] || []).filter(r => r.fonte === 'manual' || pend.has(r.importId) ||
      (r.importId && ativos.has(r.importId) && !novos.has(r.importId) && (!refiltrar.has(r.importId) || naFatia(r))));
    for (const recs of novos.values()) for (const r of recs) ficam.push(r);
    state[modulo] = ficam;
    const local = new Map();
    for (const id of refiltrar) local.set(id, 0);
    for (const r of ficam) if (refiltrar.has(r.importId)) local.set(r.importId, local.get(r.importId) + 1);
    novos.forEach((recs, id) => local.set(id, recs.length));

    state.imports = state.imports.filter(r => r.modulo !== nomeImp || ativos.has(r.id) || pend.has(r.id));
    for (const p of ativos.values()) {
      let rec = state.imports.find(r => r.id === p.import_id);
      if (!rec) {
        rec = { id: p.import_id, arquivo: p.arquivo, modulo: nomeImp, registros: p.registros, totalArquivo: p.registros,
          dataHora: p.data_hora, status: 'Salvo', statusTip: 'Base compartilhada', createdAt: Date.now() };
        state.imports.push(rec);
      }
      if (novos.has(p.import_id)) rec.baseVersao = p.versao;
      if (local.has(p.import_id)) {
        rec.baseFiltro = sig;
        rec.baseLocal = rec.registros = local.get(p.import_id);
      }
    }
    mudaram.push(modulo);
  }

  Object.entries(republicar).forEach(([modulo, ids]) => basePublicar(modulo, ids));
  if (falhas) toast(`${falhas} pacote(s) da base compartilhada de Entradas/Saídas não puderam ser baixados — nova tentativa na próxima atualização.`, 'error');
  if (!mudaram.length) return;
  // Padronização do PRÓPRIO usuário sobre os registros recebidos (a partir
  // dos campos *Original). No boot, materiais ficam pro STEP 3 do
  // restoreAndRender — mas ele não refaz centrais, então elas vão aqui.
  invalidateFilialLookup();
  reaplicarPadronizacaoCentrais(mudaram);
  if (!boot) {
    reaplicarPadronizacaoMateriais(mudaram);
    invalidateSearchIndex('entradas');
    invalidateSaidasIndex();
    invalidateAllSearchIndexes();
    renderAll();
    if (baixados) toast('Entradas/Saídas atualizadas com a base compartilhada.', 'info');
  }
  persist();
}

// Tempo real: qualquer mudança no índice → sincroniza (agrupado).
function baseRealtimeInit() {
  if (_baseCanal || !window.supabaseClient) return;
  _baseCanal = window.supabaseClient.channel('base_pacotes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'base_pacotes' }, () => {
      clearTimeout(_baseRtTimer);
      _baseRtTimer = setTimeout(() => baseSync(), 1500);
    })
    .subscribe();
}

Object.assign(window, {
  BASE_MODULOS, basePodeEditar, baseAtiva, basePublicar, basePublicarMinhaBase, baseSync, baseRealtimeInit,
});
