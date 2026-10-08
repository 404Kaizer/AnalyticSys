'use strict';

// ═══════════════════════════════════════════════════════════
// COBRANÇAS — cobrança de lançamento de NFs (setor de Insumos)
// ═══════════════════════════════════════════════════════════
// Seção própria (abaixo do Dashboard Analítico). Dados 100% nas tabelas
// cob_* do Supabase, compartilhadas entre admin e o perfil 'insumos'
// (RLS via cob_acesso()) — nada aqui lê/escreve o state local do resto
// do sistema. CNPJs sempre gravados só com dígitos.
//
// Perfil 'insumos' (Etapa 2): só enxerga Cobranças, Importar Dados e
// Configurações (ver COB_PAGINAS_INSUMOS + navigate() em ui.js); o boot
// dele pula restoreAndRender (ver init() em analitico.js) — não carrega
// entradas/saídas/SAP etc., que nem são dele. O que some na tela é
// controlado por body.role-insumos (auth.js) + CSS (modules.css).

const COB_PAGINAS_INSUMOS = new Set(['cobrancas', 'importar', 'configuracoes']);

function cobIsInsumos() {
  return window.currentUser?.role === 'insumos';
}

// Boot enxuto do perfil insumos — substitui restoreAndRender.
function cobBootInsumos() {
  // Importar/Configurações do resto do sistema não rodam pra ele (as
  // seções ficam ocultas por CSS) — só os blocos da Cobrança.
  pageRenderers.importar = () => cobRenderImports();
  pageRenderers.configuracoes = () => { _cobCarregarCentrais(); cobRenderCadastros(); };
  cobIniciar();
  navigate('importar');   // tela inicial do perfil insumos

  // Barra superior completa: os mesmos inits do topbar que o boot normal
  // faz no STEP 5 de restoreAndRender (dashboard.js) + o alerta broadcast
  // do finally. Os canais de dados do resto do sistema (ocorrências, DAI,
  // SAP, capacidades...) ficam de fora — não são dele.
  if (typeof notifSync === 'function') notifSync(null);
  if (typeof _activityRealtimeInit === 'function') _activityRealtimeInit();
  if (typeof _presenceGlobalInit === 'function') _presenceGlobalInit();
  if (typeof _msgsRealtimeInit === 'function') _msgsRealtimeInit();
  if (typeof adminAlertCheckPendente === 'function') adminAlertCheckPendente();
  if (typeof adminAlertRealtimeInit === 'function') adminAlertRealtimeInit();
}

// ── Estado em memória (espelho das tabelas cob_*) ────────────
const _cob = {
  cfop: [], fornecedores: [], centrais: [],
  imports: [],                                   // histórico (cob_imports), mais recente primeiro
  // Tela Cobrança — carregados sob demanda (_cobCarregarCobranca)
  pendentes: [], sefaz: [], justificativas: [], desconsiderar: [],
  carga: null,                                   // Promise da carga (null = nunca carregou)
  res: null,                                     // resultado de cobCalcular
  filtroCob: { regional: new Set(), central: new Set(), nivel: new Set(), texto: '' },
  mfPend: { regional: new Set(), central: new Set(), nivel: new Set() },   // seleção ainda não aplicada
  filtroAnot: { justificativas: '', desconsiderar: '' },
  detView: 'padrao',                             // Detalhamento: 'padrao' | nome do bloco à parte
  filtro: { cfop: '', fornecedores: '', centrais: '' },
  editando: { cfop: null, fornecedores: null },   // pk em edição; '' = linha nova
  canal: null,
  iniciado: false,
};

const _cobDigitos = s => String(s ?? '').replace(/\D/g, '');
function _cobFmtCnpj(c) {
  const d = _cobDigitos(c);
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : String(c ?? '');
}
// CNPJ que veio como número no Excel perde os zeros à esquerda.
function _cobCnpj(v) {
  const d = _cobDigitos(v);
  return d.length >= 12 && d.length < 14 ? d.padStart(14, '0') : d;
}

// Config dos dois cadastros editáveis — uma tabela/renderer só pros dois.
const COB_CADS = {
  cfop: {
    table: 'cob_cfop', pk: 'cfop', rotulo: 'CFOP',
    cols: [
      { k: 'cfop', rot: 'CFOP', w: '90px' },
      { k: 'resumo', rot: 'Resumo', w: '170px', lista: true },
      { k: 'descricao', rot: 'Descrição' },
    ],
    ordem: (a, b) => a.cfop.localeCompare(b.cfop),
    validar(r) {
      r.cfop = _cobDigitos(r.cfop);
      r.resumo = normalizeText(r.resumo);
      r.descricao = String(r.descricao ?? '').trim();
      if (r.cfop.length !== 4) return 'O CFOP deve ter 4 dígitos.';
      if (!r.resumo) return 'Informe o resumo (ex.: VENDA, REMESSA).';
    },
    // cabeçalho normalizado (normalizeText) → campo; casa por "começa com"
    importCols: { cfop: ['CFOP'], resumo: ['RESUMO'], descricao: ['DESCRICAO'] },
  },
  fornecedores: {
    table: 'cob_fornecedores', pk: 'cnpj', rotulo: 'Fornecedor',
    cols: [
      { k: 'nome', rot: 'Fornecedor' },
      { k: 'cnpj', rot: 'CNPJ', w: '170px', fmt: _cobFmtCnpj },
      { k: 'situacao', rot: 'Situação', w: '170px', opcoes: { cobrar: 'Cobrar', ignorar: 'Ignorar (consumo)' } },
    ],
    ordem: (a, b) => a.nome.localeCompare(b.nome, 'pt-BR'),
    validar(r) {
      r.cnpj = _cobCnpj(r.cnpj);
      r.nome = String(r.nome ?? '').trim();   // exatamente como o Excel exporta (ex.: "H & amp;H")
      r.situacao = r.situacao || 'cobrar';
      if (r.cnpj.length !== 14) return 'O CNPJ deve ter 14 dígitos.';
      if (!r.nome) return 'Informe o nome do fornecedor.';
    },
    importCols: { nome: ['FORNECEDOR', 'NOME'], cnpj: ['CNPJ'] },
  },
};

// Texto buscável (filtro da tabela + busca global) — inclui o CNPJ
// formatado e cru pra achar dos dois jeitos.
function _cobNorm(tipo, r) {
  if (tipo === 'fornecedores' || tipo === 'centrais') r.cnpj_fmt = _cobFmtCnpj(r.cnpj);
  return r;
}

// ── Carga + tempo real ───────────────────────────────────────
// ponytail: paginação por offset (range) — cadastros pequenos (centenas).
async function _cobFetchAll(table, cols, ordem) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await window.supabaseClient.from(table).select(cols).order(ordem).range(de, de + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function _cobCarregar(tipo) {
  const cfg = COB_CADS[tipo];
  try {
    const rows = await _cobFetchAll(cfg.table, '*', cfg.pk);
    _cob[tipo] = rows.map(r => _cobNorm(tipo, r)).sort(cfg.ordem);
    invalidateSearchIndex('cob_' + tipo);
    cobRenderCadastro(tipo);
    _cobRecalcular();
  } catch (err) {
    console.warn(`[Cobranças] Falha ao carregar ${cfg.table}:`, err);
  }
}

// Centrais do admin, só leitura (policy filiais_select_insumos). Recarrega
// a cada abertura de Configurações — filiais não tem canal realtime.
async function _cobCarregarCentrais() {
  if (!cobIsInsumos()) return;
  try {
    const rows = await _cobFetchAll('filiais', 'origem, alias, cnpj, regional', 'alias');
    _cob.centrais = rows.map(r => _cobNorm('centrais', r));
    invalidateSearchIndex('cob_centrais');
    cobRenderCentrais();
    _cobRecalcular();
  } catch (err) {
    console.warn('[Cobranças] Falha ao carregar centrais:', err);
  }
}

// Ponto único de entrada (admin: init() após restoreAndRender; insumos:
// cobBootInsumos). Idempotente.
function cobIniciar() {
  if (_cob.iniciado || !window.supabaseClient) return;
  _cob.iniciado = true;

  if (!cobIsInsumos()) {
    const origCfg = pageRenderers.configuracoes;
    pageRenderers.configuracoes = () => { origCfg(); cobRenderCadastros(); };
    const origImp = pageRenderers.importar;
    pageRenderers.importar = () => { origImp(); cobRenderImports(); };
  }
  _cobRegistrarBusca();
  _cobCarregar('cfop');
  _cobCarregar('fornecedores');
  _cobCarregarCentrais();
  _cobCarregarImports();

  const ch = window.supabaseClient.channel('cob_cadastros');
  Object.entries(COB_CADS).forEach(([tipo, cfg]) => {
    ch.on('postgres_changes', { event: '*', schema: 'public', table: cfg.table }, p => {
      const pkVelho = p.old?.[cfg.pk];
      _cobAplicar(tipo, pkVelho, p.eventType === 'DELETE' ? null : p.new);
      _cobAgendarRender(tipo);
    });
  });
  // Importação nova (de qualquer um dos dois perfis) chega como 1 evento em
  // cob_imports — os snapshots em si não têm realtime de propósito: a tela
  // recarrega os dois uma vez (se já tiver carregado).
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'cob_imports' }, () => {
    _cobCarregarImports();
    clearTimeout(_cob.snapTimer);
    _cob.snapTimer = setTimeout(() => { if (_cob.carga) _cobRecarregarSnapshots(); }, 300);
  });
  // Justificativas / desconsiderações: linha a linha (chave cnpj+número).
  ['justificativas', 'desconsiderar'].forEach(tipo => {
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'cob_' + tipo }, p => {
      if (!_cob.carga) return;
      _cobAplicarAnot(tipo, p.old, p.eventType === 'DELETE' ? null : p.new);
      _cobRecalcular();
    });
  });
  _cob.canal = ch.subscribe(status => {
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('[Cobranças] Canal realtime com problema:', status);
  });
}

// Troca/remoção de um registro no espelho local. Idempotente (o eco do
// realtime da própria gravação cai aqui de novo sem efeito).
function _cobAplicar(tipo, pkVelho, novo) {
  const cfg = COB_CADS[tipo];
  const pkNovo = novo?.[cfg.pk];
  const lista = _cob[tipo].filter(r => r[cfg.pk] !== pkVelho && r[cfg.pk] !== pkNovo);
  if (novo) lista.push(_cobNorm(tipo, { ...novo }));
  _cob[tipo] = lista.sort(cfg.ordem);
  invalidateSearchIndex('cob_' + tipo);
  _cobRecalcular();   // CFOP/fornecedor mudam quem entra na cobrança
}

const _cobRenderTimers = {};
function _cobAgendarRender(tipo) {
  clearTimeout(_cobRenderTimers[tipo]);
  _cobRenderTimers[tipo] = setTimeout(() => {
    // Não atropela uma linha em edição — re-renderiza ao salvar/cancelar.
    if (_cob.editando[tipo] === null) cobRenderCadastro(tipo);
  }, 150);
}

// ── Configurações: tabelas dos cadastros ─────────────────────
function cobRenderCadastros() {
  cobRenderCadastro('cfop');
  cobRenderCadastro('fornecedores');
  cobRenderCentrais();
}

// Campos visíveis de cada cadastro — filtro da tabela e busca global.
const COB_CAMPOS = {
  cfop: ['cfop', 'resumo', 'descricao'],
  fornecedores: ['nome', 'cnpj', 'cnpj_fmt', 'situacao'],
  centrais: ['alias', 'origem', 'cnpj', 'cnpj_fmt', 'regional'],
};

function _cobFiltrados(tipo) {
  const t = _cob.filtro[tipo].trim().toLowerCase();
  if (!t) return _cob[tipo];
  const ws = t.split(/\s+/);
  return _cob[tipo].filter(r => {
    const s = COB_CAMPOS[tipo].map(k => r[k] ?? '').join(' ').toLowerCase();
    return ws.every(w => s.includes(w));
  });
}

function cobCadFiltrar(tipo, v) {
  _cob.filtro[tipo] = v || '';
  tipo === 'centrais' ? cobRenderCentrais() : cobRenderCadastro(tipo);
}

function _cobLinhaEdicao(tipo, r) {
  const cfg = COB_CADS[tipo];
  const tds = cfg.cols.map(c => {
    const v = escapeHtml(r?.[c.k] ?? '');
    if (c.opcoes) {
      return `<td><select class="form-select" data-k="${c.k}" style="font-size:12px;padding:4px 8px">${
        Object.entries(c.opcoes).map(([val, rot]) => `<option value="${val}"${(r?.[c.k] || 'cobrar') === val ? ' selected' : ''}>${rot}</option>`).join('')
      }</select></td>`;
    }
    const lista = c.lista ? ` list="cob-dl-${tipo}-${c.k}"` : '';
    return `<td><input class="form-input" data-k="${c.k}" value="${c.fmt ? escapeHtml(c.fmt(r?.[c.k])) : v}"${lista} style="font-size:12px;padding:4px 8px;width:100%"></td>`;
  }).join('');
  const datalists = cfg.cols.filter(c => c.lista).map(c =>
    `<datalist id="cob-dl-${tipo}-${c.k}">${[...new Set(_cob[tipo].map(x => x[c.k]))].map(x => `<option value="${escapeHtml(x)}">`).join('')}</datalist>`).join('');
  return `<tr data-pk="${escapeHtml(r?.[cfg.pk] ?? '')}" onkeydown="cobCadTecla(event,'${tipo}',this)">${tds}
    <td style="white-space:nowrap">${datalists}
      <button class="btn-icon" title="Salvar (Enter)" onclick="cobCadSalvar('${tipo}',this)"><i class="ti ti-check"></i></button>
      <button class="btn-icon" title="Cancelar (Esc)" onclick="cobCadCancelar('${tipo}')"><i class="ti ti-x"></i></button>
    </td></tr>`;
}

function cobRenderCadastro(tipo) {
  const tb = document.getElementById('tb-cob-' + tipo);
  if (!tb) return;
  const cfg = COB_CADS[tipo];
  const linhas = _cobFiltrados(tipo);
  const ed = _cob.editando[tipo];
  let html = ed === '' ? _cobLinhaEdicao(tipo, null) : '';
  html += linhas.map(r => {
    if (ed !== null && r[cfg.pk] === ed) return _cobLinhaEdicao(tipo, r);
    const tds = cfg.cols.map(c => {
      if (c.opcoes) {
        return `<td><span class="badge ${r[c.k] === 'cobrar' ? 'badge-green' : 'badge-amber'}">${escapeHtml(c.opcoes[r[c.k]] || r[c.k])}</span></td>`;
      }
      return `<td${c.k === cfg.pk ? ' class="td-mono"' : ''}>${escapeHtml(c.fmt ? c.fmt(r[c.k]) : (r[c.k] ?? ''))}</td>`;
    }).join('');
    return `<tr data-pk="${escapeHtml(r[cfg.pk])}">${tds}<td style="white-space:nowrap">
      <button class="btn-icon" title="Editar" onclick="cobCadEditar('${tipo}',this)"><i class="ti ti-pencil"></i></button>
      <button class="btn-icon danger" title="Excluir" onclick="cobCadExcluir('${tipo}',this)"><i class="ti ti-trash"></i></button>
    </td></tr>`;
  }).join('');
  tb.innerHTML = html || `<tr><td colspan="${cfg.cols.length + 1}"><div class="empty-state"><i class="ti ti-database-off"></i><p>Nenhum registro${_cob.filtro[tipo] ? ' para o filtro' : ''}.</p></div></td></tr>`;
  const pi = document.getElementById('pi-cob-' + tipo);
  if (pi) pi.textContent = linhas.length === _cob[tipo].length ? `${linhas.length} registros` : `${linhas.length} de ${_cob[tipo].length} registros`;
  tb.querySelector('tr[data-pk] input')?.focus();
}

function cobRenderCentrais() {
  const tb = document.getElementById('tb-cob-centrais');
  if (!tb) return;
  const linhas = _cobFiltrados('centrais');
  tb.innerHTML = linhas.map(r => `<tr><td class="td-mono">${escapeHtml(r.alias ?? '')}</td><td>${escapeHtml(r.origem ?? '')}</td><td class="td-mono">${escapeHtml(r.cnpj_fmt)}</td><td>${escapeHtml(r.regional ?? '')}</td></tr>`).join('')
    || `<tr><td colspan="4"><div class="empty-state"><i class="ti ti-map-pin"></i><p>Nenhuma central${_cob.filtro.centrais ? ' para o filtro' : ''}.</p></div></td></tr>`;
  const pi = document.getElementById('pi-cob-centrais');
  if (pi) pi.textContent = `${linhas.length} registros`;
}

function cobCadNovo(tipo)   { _cob.editando[tipo] = ''; cobRenderCadastro(tipo); }
function cobCadEditar(tipo, btn) { _cob.editando[tipo] = btn.closest('tr').dataset.pk; cobRenderCadastro(tipo); }
function cobCadCancelar(tipo) { _cob.editando[tipo] = null; cobRenderCadastro(tipo); }
function cobCadTecla(ev, tipo, tr) {
  if (ev.key === 'Enter') { ev.preventDefault(); cobCadSalvar(tipo, tr); }
  else if (ev.key === 'Escape') { ev.stopPropagation(); cobCadCancelar(tipo); }
}

async function cobCadSalvar(tipo, el) {
  const cfg = COB_CADS[tipo];
  const tr = el.closest('tr');
  const pkVelho = tr.dataset.pk;
  const rec = {};
  tr.querySelectorAll('[data-k]').forEach(i => { rec[i.dataset.k] = i.value; });
  const erro = cfg.validar(rec);
  if (erro) { toast(erro, 'error'); return; }
  if (rec[cfg.pk] !== pkVelho && _cob[tipo].some(r => r[cfg.pk] === rec[cfg.pk])) {
    toast(`${cfg.rotulo} ${tipo === 'fornecedores' ? _cobFmtCnpj(rec.cnpj) : rec[cfg.pk]} já está cadastrado.`, 'error');
    return;
  }
  const q = window.supabaseClient.from(cfg.table);
  const { data, error } = await (pkVelho ? q.update(rec).eq(cfg.pk, pkVelho) : q.insert(rec)).select();
  if (error) { toast('Falha ao salvar: ' + error.message, 'error'); return; }
  _cobAplicar(tipo, pkVelho, data?.[0] || rec);
  _cob.editando[tipo] = null;
  cobRenderCadastro(tipo);
  toast(`${cfg.rotulo} salvo.`, 'success');
}

async function cobCadExcluir(tipo, btn) {
  const cfg = COB_CADS[tipo];
  const pk = btn.closest('tr').dataset.pk;
  const r = _cob[tipo].find(x => x[cfg.pk] === pk);
  const nome = tipo === 'fornecedores' ? `${r?.nome || ''} (${_cobFmtCnpj(pk)})` : `${pk} — ${r?.resumo || ''}`;
  if (!confirm(`Excluir ${cfg.rotulo} ${nome}?`)) return;
  const { error } = await window.supabaseClient.from(cfg.table).delete().eq(cfg.pk, pk);
  if (error) { toast('Falha ao excluir: ' + error.message, 'error'); return; }
  _cobAplicar(tipo, pk, null);
  cobRenderCadastro(tipo);
  toast(`${cfg.rotulo} excluído.`, 'success');
}

// ── Importação em lote dos cadastros ─────────────────────────
// Mesmo jeito de ler do resto do sistema (config.js): CSV como texto
// UTF-8, Excel como ArrayBuffer, sanitizeWorksheet na primeira aba.
function _cobLerArquivo(file) {
  const csv = file.name.toLowerCase().endsWith('.csv');
  return new Promise((ok, falha) => {
    const reader = new FileReader();
    reader.onerror = () => falha(new Error('Não foi possível ler o arquivo.'));
    reader.onload = e => {
      try {
        const wb = csv ? XLSX.read(String(e.target.result || ''), { type: 'string', raw: true })
                       : XLSX.read(e.target.result, { type: 'array', cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        if (!ws) throw new Error('Não foi possível localizar os dados da planilha neste arquivo.');
        ok(XLSX.utils.sheet_to_json(sanitizeWorksheet(ws), { header: 1, raw: true, defval: '' }));
      } catch (err) { falha(err); }
    };
    csv ? reader.readAsText(file, 'utf-8') : reader.readAsArrayBuffer(file);
  });
}

// Acha a linha de cabeçalho (nas 10 primeiras) que tenha todas as colunas
// esperadas (menos as `opcionais`) e devolve { campo: índiceDaColuna }.
function _cobMapearCabecalho(rows, importCols, opcionais = []) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const heads = rows[i].map(h => normalizeText(h));
    const mapa = {};
    let ok = true;
    for (const [campo, nomes] of Object.entries(importCols)) {
      const idx = heads.findIndex(h => nomes.some(n => h.startsWith(n)));
      if (idx >= 0) mapa[campo] = idx;
      else if (!opcionais.includes(campo)) { ok = false; break; }
    }
    if (ok) return { linha: i, mapa };
  }
  return null;
}

async function cobCadImportar(tipo, ev) {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file) return;
  const cfg = COB_CADS[tipo];
  let rows;
  try { rows = await _cobLerArquivo(file); }
  catch (err) { toast(err.message || 'Não foi possível ler o arquivo.', 'error'); return; }

  const cab = _cobMapearCabecalho(rows, cfg.importCols);
  if (!cab) {
    toast(`Cabeçalho não encontrado. Colunas esperadas: ${Object.values(cfg.importCols).map(n => n[0]).join(', ')}.`, 'error');
    return;
  }

  const porPk = new Map();
  let invalidas = 0;
  rows.slice(cab.linha + 1).forEach(row => {
    const rec = {};
    Object.entries(cab.mapa).forEach(([campo, idx]) => { rec[campo] = row[idx]; });
    if (Object.values(rec).every(v => String(v ?? '').trim() === '')) return;   // linha em branco
    // Import não mexe na situação de quem já existe (upsert só grava as
    // colunas enviadas); novos entram como 'cobrar' (default do banco).
    const erro = cfg.validar(rec);
    if (tipo === 'fornecedores') delete rec.situacao;
    if (erro) { invalidas++; return; }
    porPk.set(rec[cfg.pk], rec);
  });
  const recs = [...porPk.values()];
  if (!recs.length) { toast('Nenhuma linha válida no arquivo.', 'error'); return; }

  const existentes = new Set(_cob[tipo].map(r => r[cfg.pk]));
  const novos = recs.filter(r => !existentes.has(r[cfg.pk])).length;
  const msg = `Importar ${recs.length} ${tipo === 'cfop' ? 'CFOPs' : 'fornecedores'}?\n\n`
    + `• ${novos} novos\n• ${recs.length - novos} já cadastrados (serão atualizados)`
    + (invalidas ? `\n• ${invalidas} linhas inválidas serão ignoradas` : '');
  if (!confirm(msg)) return;

  for (let i = 0; i < recs.length; i += 500) {
    const { error } = await window.supabaseClient.from(cfg.table).upsert(recs.slice(i, i + 500), { onConflict: cfg.pk });
    if (error) { toast('Falha na importação: ' + error.message, 'error'); break; }
  }
  await _cobCarregar(tipo);
  toast(`Importação concluída: ${novos} novos, ${recs.length - novos} atualizados.`, 'success');
}

// ── Importações de Pendências e SEFAZ (Importar Dados) ───────
// Cada importação SUBSTITUI a anterior de uma vez (RPC cob_substituir,
// transação única no banco). Nomes/textos ficam exatamente como o Excel
// exporta — só CNPJ (dígitos), número da NF, datas e valores são
// convertidos.

// Número da NF sem série e sem zeros à esquerda: "000338332/1" → "338332".
const _cobNumero = v => String(v ?? '').split('/')[0].replace(/\D/g, '').replace(/^0+(?=\d)/, '');
const _cobSerie  = v => String(v ?? '').split('/')[1]?.trim() || null;
const _cobTxt    = v => { const s = String(v ?? '').trim(); return s || null; };

function _cobDataISO(v) {
  const m = fmtDate(v).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
function _cobDataHoraISO(v) {
  const d = _cobDataISO(typeof v === 'number' ? Math.floor(v) : String(v ?? '').trim().slice(0, 10));
  if (!d) return null;
  if (typeof v === 'number') {   // serial do Excel com fração de dia
    const min = Math.round((v % 1) * 1440);
    return `${d}T${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00`;
  }
  const h = String(v).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return `${d}T${h ? `${h[1].padStart(2, '0')}:${h[2]}:${h[3] || '00'}` : '00:00:00'}`;
}

const COB_IMPORTS = {
  pendentes: {
    rotulo: 'Pendências', unidade: 'notas',
    cols: {
      cnpj_comprador: ['CNPJ COMPRADOR'], fornecedor: ['FORNECEDOR'], cnpj_fornecedor: ['CNPJ DO FORNECEDOR'],
      numero: ['DOCUMENTO'], dt_emissao: ['DATA DE EMISSAO'], valor: ['VALOR TOTAL'], status: ['STATUS'],
    },
    opcionais: ['status'],
    // linhas cruas ({campo: célula}) → registros de cob_pendentes
    montar(linhas) {
      const porNf = new Map();
      let invalidas = 0;
      linhas.forEach(c => {
        const r = {
          cnpj_comprador: _cobCnpj(c.cnpj_comprador), fornecedor: _cobTxt(c.fornecedor),
          cnpj_fornecedor: _cobCnpj(c.cnpj_fornecedor), numero: _cobNumero(c.numero),
          dt_emissao: _cobDataISO(c.dt_emissao), valor: numXls(c.valor), status: _cobTxt(c.status),
        };
        if (r.cnpj_comprador.length !== 14 || r.cnpj_fornecedor.length !== 14 || !r.numero) { invalidas++; return; }
        porNf.set(r.cnpj_fornecedor + '|' + r.numero, r);
      });
      return { rows: [...porNf.values()], invalidas };
    },
  },
  sefaz: {
    rotulo: 'SEFAZ', unidade: 'NFs',
    cols: {
      chave: ['CHAVE'], numero: ['NUMERO'], emissao: ['EMISSAO'], status: ['STATUS'], cnpj_emitente: ['CNPJ'],
      nome: ['NOME'], municipio: ['MUNICIPIO'], uf: ['UF'], valor_unit: ['VALOR UNITARIO'], valor_total: ['VALOR TOTAL'],
      volume: ['VOLUME'], cfop: ['CFOP'], evento_dest: ['EVENTO DEST'], transportador: ['TRANSPORTADOR'],
      cnpj_transportador: ['CNPJ TRANSPORTADOR'], placa: ['PLACA'], material: ['MATERIAL'],
    },
    opcionais: ['municipio', 'uf', 'valor_unit', 'evento_dest', 'transportador', 'cnpj_transportador', 'placa'],
    // Uma linha por ITEM no relatório → uma NF por chave, com os itens em lista.
    montar(linhas) {
      const porChave = new Map();
      let invalidas = 0;
      linhas.forEach(c => {
        const chave = _cobDigitos(c.chave);
        const cnpj = _cobCnpj(c.cnpj_emitente);
        const numero = _cobNumero(c.numero);
        if (!chave || cnpj.length !== 14 || !numero) { invalidas++; return; }
        let nf = porChave.get(chave);
        if (!nf) {
          nf = {
            chave, cnpj_emitente: cnpj, nome: _cobTxt(c.nome), numero, serie: _cobSerie(c.numero),
            emissao: _cobDataHoraISO(c.emissao), status: _cobTxt(c.status), municipio: _cobTxt(c.municipio),
            uf: _cobTxt(c.uf), transportador: _cobTxt(c.transportador),
            cnpj_transportador: _cobDigitos(c.cnpj_transportador) || null, placa: _cobTxt(c.placa),
            evento_dest: _cobTxt(c.evento_dest), itens: [],
          };
          porChave.set(chave, nf);
        }
        nf.itens.push({
          material: _cobTxt(c.material), cfop: _cobDigitos(c.cfop) || null,
          volume: num(c.volume),            // SEFAZ exporta volume com ponto decimal ("46.509")
          valor_unit: numXls(c.valor_unit), valor_total: numXls(c.valor_total),
        });
      });
      return { rows: [...porChave.values()], invalidas };
    },
  },
};

// ponytail: histórico limitado às 200 importações mais recentes; paginar se precisar de mais.
async function _cobCarregarImports() {
  try {
    const { data, error } = await window.supabaseClient.from('cob_imports').select('*')
      .order('data_hora', { ascending: false }).limit(200);
    if (error) throw error;
    _cob.imports = data || [];
    cobRenderImports();
  } catch (err) {
    console.warn('[Cobranças] Falha ao carregar cob_imports:', err);
  }
}

const _cobVigente = tipo => _cob.imports.find(r => r.tipo === tipo && r.vigente);
const _cobQuando  = r => new Date(r.data_hora).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
function _cobQuem(r) {
  const u = (typeof _msgsUsuariosPorId !== 'undefined' && _msgsUsuariosPorId[r.user_id]) || null;
  return u ? (u.nome_exibicao || u.email) : '';
}

function cobRenderImports() {
  const tb = document.getElementById('tb-cob-imports');
  if (!tb) return;
  tb.innerHTML = _cob.imports.map(r => {
    const total = r.total_arquivo && r.total_arquivo > r.registros
      ? `<span style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-left:4px" title="Linhas no arquivo">(de ${r.total_arquivo.toLocaleString('pt-BR')} linhas)</span>` : '';
    const status = r.vigente
      ? '<span class="badge badge-green"><i class="ti ti-circle-check"></i> Vigente</span>'
      : '<span class="badge badge-teal" title="Dados substituídos por uma importação mais recente"><i class="ti ti-history"></i> Substituída</span>';
    return `<tr>
      <td>${escapeHtml(r.arquivo || '—')}</td>
      <td><span class="badge badge-purple">${COB_IMPORTS[r.tipo]?.rotulo || r.tipo}</span></td>
      <td class="td-mono">${(r.registros ?? 0).toLocaleString('pt-BR')} ${total}</td>
      <td class="td-muted">${_cobQuando(r)}</td>
      <td class="td-muted">${escapeHtml(_cobQuem(r) || '—')}</td>
      <td>${status}</td>
      <td style="width:56px"><button class="btn-icon danger" title="${r.vigente ? 'Excluir importação e os dados dela' : 'Remover do histórico'}" onclick="cobExcluirImport(${r.id})"><i class="ti ti-trash"></i></button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="7"><div class="empty-state"><i class="ti ti-file-off"></i><p>Nenhuma importação da Cobrança ainda.</p></div></td></tr>';
  const pi = document.getElementById('pi-cob-imports');
  if (pi) pi.textContent = `${_cob.imports.length} registros`;
}

async function cobExcluirImport(id) {
  const r = _cob.imports.find(x => x.id === id);
  if (!r) return;
  const cfg = COB_IMPORTS[r.tipo];
  const msg = r.vigente
    ? `Excluir a importação vigente de ${cfg.rotulo} (${r.arquivo})?\n\nOs dados dela também serão apagados: a Cobrança fica sem ${cfg.rotulo} até a próxima importação.`
    : `Remover do histórico a importação de ${cfg.rotulo} (${r.arquivo})?\n\nOs dados atuais não mudam.`;
  if (!confirm(msg)) return;
  const { error } = await window.supabaseClient.rpc('cob_excluir_import', { p_id: id });
  if (error) { toast('Falha ao excluir: ' + error.message, 'error'); return; }
  await _cobCarregarImports();
  toast(r.vigente ? `Importação e dados de ${cfg.rotulo} excluídos.` : 'Removida do histórico.', 'success');
}

async function cobImportar(tipo, ev) {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file) return;
  const cfg = COB_IMPORTS[tipo];
  let rows;
  try { rows = await _cobLerArquivo(file); }
  catch (err) { toast(err.message || 'Não foi possível ler o arquivo.', 'error'); return; }

  const cab = _cobMapearCabecalho(rows, cfg.cols, cfg.opcionais);
  if (!cab) {
    const faltam = Object.entries(cfg.cols).filter(([k]) => !cfg.opcionais.includes(k)).map(([, n]) => n[0]);
    toast(`Este não parece o relatório de ${cfg.rotulo}. Colunas esperadas: ${faltam.join(', ')}.`, 'error');
    return;
  }
  const linhas = rows.slice(cab.linha + 1)
    .filter(row => row.some(v => String(v ?? '').trim() !== ''))
    .map(row => Object.fromEntries(Object.entries(cab.mapa).map(([campo, idx]) => [campo, row[idx]])));
  const { rows: recs, invalidas } = cfg.montar(linhas);
  if (!recs.length) { toast(`Nenhuma linha válida no relatório de ${cfg.rotulo}.`, 'error'); return; }

  const atual = _cobVigente(tipo);
  const msg = `Importar ${cfg.rotulo}: ${recs.length} ${cfg.unidade} de "${file.name}"?\n\n`
    + (atual ? `Isto SUBSTITUI a importação atual (${atual.registros} ${cfg.unidade}, ${atual.arquivo}).` : 'Primeira importação.')
    + (invalidas ? `\n${invalidas} linhas inválidas (sem CNPJ/número) serão ignoradas.` : '');
  if (!confirm(msg)) return;

  showLoadingOverlay(`Importando ${cfg.rotulo}`, `Gravando ${recs.length} ${cfg.unidade}...`);
  try {
    const { error } = await window.supabaseClient.rpc('cob_substituir', { p_tipo: tipo, p_arquivo: file.name, p_rows: recs, p_total: linhas.length });
    if (error) throw error;
    await _cobCarregarImports();
    toast(`${cfg.rotulo} importado: ${recs.length} ${cfg.unidade}.`, 'success');
  } catch (err) {
    toast(`Falha ao importar ${cfg.rotulo}: ${err.message || err}`, 'error');
  } finally {
    hideLoadingOverlay();
  }
}

// ═══════════════════════════════════════════════════════════
// TELA COBRANÇA — carga, cálculo e painéis (Etapa 5)
// ═══════════════════════════════════════════════════════════
// Regras (decididas com o Hugo, out/2026):
//   • pendente + SEFAZ ligam por CNPJ do fornecedor + número (sem série);
//   • desconsiderada manual → aba Desconsideradas; Cancelada no SEFAZ →
//     sai sozinha e aparece em Alertas;
//   • emitida hoje (D-0) ainda não entra;
//   • só CFOP com resumo VENDA/REMESSA (nota sem SEFAZ fica, marcada);
//   • só fornecedor do cadastro com situação "cobrar" (fora da lista →
//     Alertas, com Incluir/Ignorar);
//   • ADITIBRAS/DOVALLE (raiz do CNPJ) vão pra blocos à parte;
//   • criticidade em dias corridos: D-1 Atenção, D-2 Urgente, D-3+ Crítico.
// ponytail: blocos por lista fixa de raízes — se surgirem outros, virar campo no cadastro de fornecedores.
const COB_BLOCOS = { '49332665': 'Aditivos', '56910948': 'Aditivos', '14117052': 'Dovalle' };
const COB_BLOCOS_ORDEM = ['Aditivos', 'Dovalle'];
const COB_RESUMOS_COBRADOS = new Set(['VENDA', 'REMESSA']);
const COB_NIVEIS = {
  atencao: { rot: 'Atenção', h: '24h',  badge: 'badge-blue',  kpi: 'kpi-accent' },
  urgente: { rot: 'Urgente', h: '48h',  badge: 'badge-amber', kpi: 'kpi-amber' },
  critico: { rot: 'Crítico', h: '72h+', badge: 'badge-red',   kpi: 'kpi-red' },
};
const COB_MOTIVOS_DESC = ['DEVOLUÇÃO', 'RECUSADA', 'INDEVIDA', 'CANCELADA', 'NOTA MÃE', 'JUSTIFICADA'];
// Campos buscáveis (filtro das telas + busca global)
const COB_CAMPOS_NF   = ['regional', 'central', 'centralNome', 'fornecedor', 'cnpj', 'cnpj_fmt', 'numero', 'emissao_fmt', 'materiais', 'cfops', 'desviado', 'justificativa'];
const COB_CAMPOS_ANOT = ['fornecedor', 'cnpj', 'cnpj_fmt', 'numero', 'central', 'regional', 'informante', 'desviado', 'motivo', 'justificativa'];

const _cobChaveNf = r => r.cnpj_fornecedor + '|' + r.numero;
const _cobFmtData = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—';
const _cobFmtNum  = n => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const _cobBusca   = (r, campos, ws) => { const s = campos.map(k => r[k] ?? '').join(' ').toLowerCase(); return ws.every(w => s.includes(w)); };
const _cobPalavras = t => String(t || '').trim().toLowerCase().split(/\s+/).filter(Boolean);

// ── Carga (sob demanda: 1ª abertura da tela ou foco na busca global) ──
function _cobCarregarCobranca() {
  if (!_cob.carga) {
    _cob.carga = Promise.all([
      _cobRecarregarSnapshots(false),
      ...['justificativas', 'desconsiderar'].map(async t => { _cob[t] = await _cobFetchAll('cob_' + t, '*', 'numero'); }),
    ]).then(() => { _cob.pronto = true; _cobRecalcular(); })
      .catch(err => {
        _cob.carga = null;
        console.warn('[Cobranças] Falha ao carregar a cobrança:', err);
        toast('Falha ao carregar a Cobrança: ' + (err.message || err), 'error');
      });
  }
  return _cob.carga;
}

async function _cobRecarregarSnapshots(recalc = true) {
  const [p, s] = await Promise.all([_cobFetchAll('cob_pendentes', '*', 'id'), _cobFetchAll('cob_sefaz', '*', 'chave')]);
  _cob.pendentes = p;
  _cob.sefaz = s;
  if (recalc) _cobRecalcular();
}

// Troca/remoção de uma justificativa/desconsideração no espelho local (idempotente).
function _cobAplicarAnot(tipo, velho, novo) {
  const kv = velho?.numero ? _cobChaveNf(velho) : null;
  const kn = novo ? _cobChaveNf(novo) : null;
  _cob[tipo] = _cob[tipo].filter(r => { const k = _cobChaveNf(r); return k !== kv && k !== kn; });
  if (novo) _cob[tipo].push(novo);
}

function _cobRecalcular() {
  clearTimeout(_cob.calcTimer);
  _cob.calcTimer = setTimeout(() => {
    if (!_cob.pronto) return;
    _cob.res = cobCalcular({
      pendentes: _cob.pendentes, sefaz: _cob.sefaz, cfop: _cob.cfop, fornecedores: _cob.fornecedores,
      centrais: cobIsInsumos() ? _cob.centrais : (state.filiais || []),   // admin: o próprio cadastro
      justificativas: _cob.justificativas, desconsiderar: _cob.desconsiderar,
    }, new Date());
    ['cob_cobranca', 'cob_justificativas', 'cob_desconsideradas'].forEach(invalidateSearchIndex);
    cobRenderTela();
  }, 60);
}

// ── Cálculo (puro: só depende dos dados recebidos e de "hoje") ──
function cobCalcular(d, hoje) {
  const hojeISO = localISODate(hoje);
  const hojeMs = Date.parse(hojeISO);
  const sefaz = new Map(d.sefaz.map(s => [s.cnpj_emitente + '|' + s.numero, s]));
  const resumo = new Map(d.cfop.map(c => [c.cfop, c.resumo]));
  const forn = new Map(d.fornecedores.map(f => [f.cnpj, f]));
  const centrais = new Map();
  d.centrais.forEach(c => { const k = _cobDigitos(c.cnpj); if (k && !centrais.has(k)) centrais.set(k, c); });
  const just = new Map(d.justificativas.map(j => [_cobChaveNf(j), j]));
  const desc = new Set(d.desconsiderar.map(_cobChaveNf));

  const res = {
    hojeISO, porChave: new Map(), cobraveis: [], cobranca: [], blocos: {},
    canceladas: [], semSefaz: [], fornNovos: [], centraisNaoCad: [],
    justificativas: [], desconsideradas: [], fora: { hoje: 0, cfop: 0, ignorados: 0, desconsideradas: 0 },
  };
  COB_BLOCOS_ORDEM.forEach(b => { res.blocos[b] = []; });
  const fornNovos = new Map(), centraisNC = new Map();

  for (const p of d.pendentes) {
    const k = _cobChaveNf(p), s = sefaz.get(k), c = centrais.get(p.cnpj_comprador), j = just.get(k);
    const itens = s?.itens || [];
    const emissao = p.dt_emissao || (s?.emissao ? String(s.emissao).slice(0, 10) : null);
    // ponytail: sem data de emissão em nenhum dos dois arquivos → tratada como crítica (a mais antiga).
    const dias = emissao ? Math.round((hojeMs - Date.parse(emissao)) / 864e5) : null;
    const row = {
      k, regional: c?.regional || 'SEM CENTRAL CADASTRADA', central: c?.alias || '—', centralNome: c?.origem || '',
      cnpj_comprador: p.cnpj_comprador, fornecedor: p.fornecedor || s?.nome || '',
      cnpj: p.cnpj_fornecedor, cnpj_fmt: _cobFmtCnpj(p.cnpj_fornecedor), numero: p.numero,
      emissao, emissao_fmt: _cobFmtData(emissao), dias,
      nivel: dias === null || dias >= 3 ? 'critico' : dias === 2 ? 'urgente' : 'atencao',
      valor: p.valor, itens, volume: itens.reduce((t, i) => t + (Number(i.volume) || 0), 0),
      materiais: [...new Set(itens.map(i => i.material).filter(Boolean))].join(' + '),
      cfops: [...new Set(itens.map(i => i.cfop).filter(Boolean))].join(', '),
      statusSefaz: s?.status || '', semSefaz: !s, semCentral: !c,
      desviado: j?.desviado || '', justificativa: j?.motivo || '', just: j || null,
      transportador: s?.transportador || '', placa: s?.placa || '',
      bloco: COB_BLOCOS[String(p.cnpj_fornecedor).slice(0, 8)] || null,
    };
    res.porChave.set(k, row);

    if (desc.has(k)) { res.fora.desconsideradas++; continue; }
    if (s && /cancel/i.test(s.status || '')) { res.canceladas.push(row); continue; }
    if (dias !== null && dias < 1) { res.fora.hoje++; continue; }
    if (s && !itens.some(i => COB_RESUMOS_COBRADOS.has(resumo.get(i.cfop)))) { res.fora.cfop++; continue; }
    const f = forn.get(p.cnpj_fornecedor);
    if (!f) {
      const a = fornNovos.get(p.cnpj_fornecedor) || { cnpj: p.cnpj_fornecedor, cnpj_fmt: row.cnpj_fmt, nome: row.fornecedor, notas: 0 };
      a.notas++;
      fornNovos.set(p.cnpj_fornecedor, a);
      continue;
    }
    if (f.situacao === 'ignorar') { res.fora.ignorados++; continue; }
    if (!s) res.semSefaz.push(row);
    if (!c) {
      const a = centraisNC.get(p.cnpj_comprador) || { cnpj: p.cnpj_comprador, cnpj_fmt: _cobFmtCnpj(p.cnpj_comprador), notas: 0 };
      a.notas++;
      centraisNC.set(p.cnpj_comprador, a);
    }
    res.cobraveis.push(row);
    (row.bloco ? res.blocos[row.bloco] : res.cobranca).push(row);
  }
  res.fornNovos = [...fornNovos.values()].sort((a, b) => b.notas - a.notas);
  res.centraisNaoCad = [...centraisNC.values()].sort((a, b) => b.notas - a.notas);

  // Anotações com o contexto da nota (quando ela ainda está nas pendências).
  const ctx = x => {
    const r = res.porChave.get(_cobChaveNf(x));
    return {
      ...x, k: _cobChaveNf(x), cnpj: x.cnpj_fornecedor, cnpj_fmt: _cobFmtCnpj(x.cnpj_fornecedor),
      fornecedor: r?.fornecedor || forn.get(x.cnpj_fornecedor)?.nome || '', central: r?.central || '—',
      regional: r?.regional || '', emissao_fmt: r?.emissao_fmt || '—', emAberto: !!r,
    };
  };
  res.justificativas = d.justificativas.map(x => ({ ...ctx(x), dia_resp_fmt: _cobFmtData(x.dia_resp) }));
  res.desconsideradas = d.desconsiderar.map(x => ({ ...ctx(x), data_fmt: _cobFmtData(x.data) }));
  return res;
}

// ── Telas ────────────────────────────────────────────────────
pageRenderers.cobrancas = () => {
  if (_cob.pronto) { _cobRecalcular(); return; }   // recalcula ao abrir (a data de referência pode ter virado)
  const corpo = document.getElementById('cob-pane-cobranca');
  if (corpo) corpo.innerHTML = '<div class="empty-state"><i class="ti ti-loader"></i><p>Carregando a cobrança…</p></div>';
  _cobCarregarCobranca();
};

function cobRenderTela() {
  if (!_cob.res) return;
  _cobRenderCobranca();
  _cobRenderAlertas();
  _cobRenderAnot('justificativas');
  _cobRenderAnot('desconsiderar');
}

function cobSwitchTab(tab) {
  document.querySelectorAll('#page-cobrancas .dg-tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.cobTab === tab));
  document.querySelectorAll('#page-cobrancas .dg-tab-pane').forEach(p =>
    p.classList.toggle('active', p.id === 'cob-pane-' + tab));
}

const _cobKpi = (icon, label, valor, cls, sub) => `
  <div class="inv-kpi-card inv-kpi-card-featured ${cls}">
    <div class="inv-kpi-icon" style="background:var(--bg3)"><i class="ti ${icon}"></i></div>
    <div class="inv-kpi-body">
      <div class="inv-kpi-label">${escapeHtml(label)}</div>
      <div class="inv-kpi-value">${valor.toLocaleString('pt-BR')}</div>
      <div class="inv-kpi-unit">${sub || ''}</div>
    </div>
  </div>`;

const _cobVazio = (icon, txt, ncol) => `<tr><td colspan="${ncol}"><div class="empty-state"><i class="ti ${icon}"></i><p>${txt}</p></div></td></tr>`;
const _cobNumAlertas = res => res.fornNovos.length + res.canceladas.length + res.semSefaz.length + res.centraisNaoCad.length;

// ── Filtros da aba Cobrança ──────────────────────────────────
// Mesmo componente de seleção múltipla do resto do sistema (classes
// micro-filter-* da Visão Micro/Ocorrências): marca → Aplicar. Cada módulo
// tem a sua cópia enxuta do controle (ver ocToggleMicroFilter em
// ocorrencias.js) — aqui com ids cmf*.
const COB_MF = {
  regional: { rot: 'Regional',    icon: 'ti-users-group',        busca: true },
  central:  { rot: 'Central',     icon: 'ti-building-warehouse', busca: true },
  nivel:    { rot: 'Criticidade', icon: 'ti-clock-exclamation',  busca: false },
};
const _cobFiltroVazio = (texto = '') => ({ regional: new Set(), central: new Set(), nivel: new Set(), texto });
const _cobTemFiltro = () => { const f = _cob.filtroCob; return !!(f.texto || f.regional.size || f.central.size || f.nivel.size); };

function _cobMontarPaneCobranca() {
  const pane = document.getElementById('cob-pane-cobranca');
  if (pane && !pane.querySelector('#cob-f-texto')) {
    // Filtros ficam colados no Detalhamento (logo acima dele), entre o
    // resumo e a tabela — a barra é estática pra não perder o foco do input.
    pane.innerHTML = `
      <div class="cob-base" id="cob-base" style="text-align:right;margin-bottom:8px"></div>
      <div id="cob-resumo"></div>
      <div class="micro-filter-bar" id="cob-toolbar" style="margin-bottom:12px">
        <div class="oc-search-wrap">
          <i class="ti ti-search oc-search-icon"></i>
          <input id="cob-f-texto" class="oc-search-input" type="text" placeholder="Buscar fornecedor, NF, material…" value="${escapeHtml(_cob.filtroCob.texto)}" oninput="cobFiltrar('texto', this.value)">
        </div>
        <div class="micro-filter-divider"></div>
        ${Object.entries(COB_MF).map(([k, c]) => `
        <div class="micro-filter-group" id="cmfg-${k}">
          <button class="micro-filter-trigger" id="cmft-${k}" onclick="cobMfToggle('${k}')">
            <i class="ti ${c.icon}"></i><span id="cmft-${k}-label">${c.rot}</span>
            <i class="ti ti-chevron-down micro-filter-chev" id="cmfc-${k}"></i>
          </button>
          <div class="micro-filter-dropdown" id="cmfd-${k}">
            ${c.busca ? `<div class="micro-filter-search-wrap"><i class="ti ti-search"></i>
              <input class="micro-filter-search" id="cmfs-${k}" type="text" placeholder="Buscar ${c.rot.toLowerCase()}…" oninput="_cobMfLista('${k}', this.value)"></div>` : ''}
            <div class="micro-filter-options" id="cmfo-${k}"></div>
            <div class="micro-filter-footer">
              <button class="btn btn-filter-clear" onclick="cobMfLimpar('${k}')"><i class="ti ti-filter-off"></i> Limpar</button>
              <button class="btn" onclick="cobMfFechar('${k}')"><i class="ti ti-x"></i> Cancelar</button>
              <button class="btn btn-primary" onclick="cobMfAplicar('${k}')"><i class="ti ti-check"></i> Aplicar</button>
            </div>
          </div>
        </div>`).join('')}
        <button class="btn btn-filter-clear" id="cob-mf-limpar" onclick="cobLimparFiltros()" style="display:none"><i class="ti ti-filter-off"></i> Limpar filtros</button>
      </div>
      <div id="cob-det"></div>`;
  }
  return pane;
}

function _cobMfOpcoes(k) {
  const res = _cob.res;
  if (!res) return [];
  if (k === 'nivel') return Object.entries(COB_NIVEIS).map(([v, n]) => ({ v, rot: `${n.rot} (${n.h})` }));
  const reg = _cob.filtroCob.regional;
  const base = k === 'central' && reg.size ? res.cobraveis.filter(r => reg.has(r.regional)) : res.cobraveis;
  return [...new Set(base.map(r => r[k]))].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(v => ({ v, rot: v }));
}

function _cobMfLista(k, q = '') {
  const el = document.getElementById('cmfo-' + k);
  if (!el) return;
  const ql = q.toLowerCase().trim(), pend = _cob.mfPend[k];
  const ops = _cobMfOpcoes(k).filter(o => !ql || o.rot.toLowerCase().includes(ql));
  el.innerHTML = ops.map(o => `<label class="micro-filter-option">
      <input type="checkbox" value="${escapeHtml(o.v)}" ${pend.has(o.v) ? 'checked' : ''} onchange="_cobMfMarca('${k}', this)">
      <span class="micro-filter-option-label" title="${escapeHtml(o.rot)}">${escapeHtml(o.rot)}</span>
    </label>`).join('')
    || '<div style="padding:12px 10px;color:var(--text3);font-size:12px;text-align:center">Nenhum resultado</div>';
}

function _cobMfMarca(k, cb) { cb.checked ? _cob.mfPend[k].add(cb.value) : _cob.mfPend[k].delete(cb.value); }

function cobMfToggle(k) {
  Object.keys(COB_MF).filter(x => x !== k).forEach(cobMfFechar);
  const dd = document.getElementById('cmfd-' + k);
  const aberto = dd.classList.toggle('open');
  document.getElementById('cmfc-' + k)?.classList.toggle('open', aberto);
  if (aberto) {
    _cob.mfPend[k] = new Set(_cob.filtroCob[k]);
    const s = document.getElementById('cmfs-' + k);
    if (s) s.value = '';
    _cobMfLista(k);
    setTimeout(() => s?.focus(), 50);
  }
}
function cobMfFechar(k) {
  document.getElementById('cmfd-' + k)?.classList.remove('open');
  document.getElementById('cmfc-' + k)?.classList.remove('open');
}
function cobMfAplicar(k) {
  _cob.filtroCob[k] = new Set(_cob.mfPend[k]);
  if (k === 'regional') {   // descarta centrais que ficaram fora das regionais escolhidas
    const validas = new Set(_cobMfOpcoes('central').map(o => o.v));
    _cob.filtroCob.central = new Set([..._cob.filtroCob.central].filter(c => validas.has(c)));
  }
  cobMfFechar(k);
  _cobRenderCobranca();
}
function cobMfLimpar(k) { _cob.mfPend[k] = new Set(); cobMfAplicar(k); }

// Rótulo do botão: "Regional" / "Regional: X" / "Regional [3]" — igual à Visão Micro.
function _cobMfRotulos() {
  Object.entries(COB_MF).forEach(([k, c]) => {
    const btn = document.getElementById(`cmft-${k}`), label = document.getElementById(`cmft-${k}-label`);
    if (!btn || !label) return;
    const sel = _cob.filtroCob[k];
    if (!sel.size) label.innerHTML = c.rot;
    else if (sel.size === 1) {
      const v = [...sel][0], t = k === 'nivel' ? COB_NIVEIS[v]?.rot || v : v;
      label.innerHTML = `${c.rot}: <strong>${escapeHtml(t.length > 18 ? t.slice(0, 18) + '…' : t)}</strong>`;
    } else label.innerHTML = `${c.rot} <span class="micro-filter-badge">${sel.size}</span>`;
    btn.classList.toggle('active', sel.size > 0);
  });
  const limpar = document.getElementById('cob-mf-limpar');
  if (limpar) limpar.style.display = _cobTemFiltro() ? '' : 'none';
}

// Clique fora fecha o dropdown sem aplicar (mesmo comportamento da Visão Micro).
document.addEventListener('click', e => {
  Object.keys(COB_MF).forEach(k => {
    const g = document.getElementById('cmfg-' + k);
    if (g && !g.contains(e.target)) cobMfFechar(k);
  });
});

// Atalhos usados pelas tabelas (clicar na regional / no fornecedor).
function cobFiltrar(campo, v) {
  if (campo === 'texto') _cob.filtroCob.texto = v || '';
  else { _cob.mfPend[campo] = new Set(v ? [v] : []); cobMfAplicar(campo); return; }
  _cobRenderCobranca();
}
function cobFiltrarTexto(v) {
  const i = document.getElementById('cob-f-texto');
  if (i) i.value = v;
  cobFiltrar('texto', v);
}
function cobLimparFiltros() {
  _cob.filtroCob = _cobFiltroVazio();
  const i = document.getElementById('cob-f-texto');
  if (i) i.value = '';
  _cobRenderCobranca();
}

function _cobFiltrarNfs(rows) {
  const f = _cob.filtroCob, ws = _cobPalavras(f.texto);
  return rows.filter(r => (!f.regional.size || f.regional.has(r.regional)) && (!f.central.size || f.central.has(r.central))
    && (!f.nivel.size || f.nivel.has(r.nivel)) && (!ws.length || _cobBusca(r, COB_CAMPOS_NF, ws)));
}

function _cobBaseTxt(res) {
  const p = _cobVigente('pendentes'), s = _cobVigente('sefaz');
  const q = r => r ? `${r.arquivo} (${new Date(r.data_hora).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })})` : 'sem importação';
  return `Pendências: ${q(p)} · SEFAZ: ${q(s)} · Referência: ${_cobFmtData(res.hojeISO)}`;
}

function _cobRenderCobranca() {
  const res = _cob.res;
  if (!res || !_cobMontarPaneCobranca()) return;
  _cobMfRotulos();
  document.getElementById('cob-base').textContent = _cobBaseTxt(res);

  const resumo = document.getElementById('cob-resumo'), det = document.getElementById('cob-det');
  const temDados = _cob.pendentes.length > 0;
  document.getElementById('cob-toolbar').style.display = temDados ? '' : 'none';
  if (!temDados) {
    resumo.innerHTML = '<div class="empty-state"><i class="ti ti-file-alert"></i><p>Importe os relatórios de <strong>Pendências</strong> e <strong>SEFAZ</strong> em Importar Dados para montar a cobrança.</p></div>';
    det.innerHTML = '';
    return;
  }
  const padrao = _cobFiltrarNfs(res.cobranca);
  const blocos = COB_BLOCOS_ORDEM.map(b => [b, _cobFiltrarNfs(res.blocos[b])]);
  const todas = padrao.concat(...blocos.map(([, r]) => r));
  const soma = rs => rs.reduce((t, r) => t + (Number(r.valor) || 0), 0);
  const nAlertas = _cobNumAlertas(res);

  resumo.innerHTML = `
    <div class="mod-summary-cards"><div class="mod-summary-hero">
      ${_cobKpi('ti-file-alert', 'Em cobrança', padrao.length, 'kpi-teal', money(soma(padrao)))}
      ${Object.entries(COB_NIVEIS).map(([k, n]) => {
        const rs = padrao.filter(r => r.nivel === k);
        return _cobKpi('ti-clock-exclamation', `${n.rot} · ${n.h}`, rs.length, n.kpi, money(soma(rs)));
      }).join('')}
      ${blocos.map(([b, rs]) => _cobKpi('ti-package', b, rs.length, 'kpi-purple', 'cobrança à parte')).join('')}
      ${_cobKpi('ti-bell', 'Alertas', nAlertas, nAlertas ? 'kpi-red' : 'kpi-green', 'ver aba Alertas')}
    </div></div>
    <div class="cob-grid-2">${_cobRankingHtml(padrao, res.hojeISO)}${_cobPorFornecedorHtml(todas)}</div>`;
  det.innerHTML = _cobDetalhamentoHtml(padrao, blocos);
}

// Ranking por regional = os blocos "Total por regional" + "Emissão por
// data" da planilha numa tabela só: 24h/48h/72h+ são exatamente D-1, D-2 e
// D-3 para trás.
function _cobRankingHtml(rows, hojeISO) {
  const dia = n => { const t = new Date(Date.parse(hojeISO) - n * 864e5); return `${String(t.getUTCDate()).padStart(2, '0')}/${String(t.getUTCMonth() + 1).padStart(2, '0')}`; };
  const por = new Map();
  rows.forEach(r => {
    const a = por.get(r.regional) || { atencao: 0, urgente: 0, critico: 0, total: 0 };
    a[r.nivel]++; a.total++;
    por.set(r.regional, a);
  });
  const lin = [...por.entries()].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0], 'pt-BR'));
  const td = (v, cls) => `<td class="td-mono" style="text-align:right">${v ? `<span class="badge ${cls}">${v}</span>` : '<span style="color:var(--text3)">0</span>'}</td>`;
  const r = 'style="text-align:right"';
  return `<div class="table-card"><div class="table-header"><span class="table-title"><i class="ti ti-trophy"></i> Ranking por regional</span>
      <div class="table-toolbar"><span style="font-size:11px;color:var(--text3)">Relatório:</span>
        ${Object.entries(COB_NIVEIS).map(([k, n]) => `<button class="btn" onclick="cobRelatorioRanking('${k}')" title="Relatório das NFs em ${n.rot} (${n.h})"><i class="ti ti-file-text"></i> ${n.h}</button>`).join('')}
      </div></div>
    <div class="table-scroll" style="max-height:440px"><table>
      <thead><tr><th>Regional</th><th ${r}>24h · ${dia(1)}</th><th ${r}>48h · ${dia(2)}</th><th ${r}>72h+ · até ${dia(3)}</th><th ${r}>Total</th></tr></thead>
      <tbody>${lin.map(([reg, a]) => `<tr style="cursor:pointer" title="Filtrar esta regional" data-r="${escapeHtml(reg)}" onclick="cobFiltrar('regional', this.dataset.r)">
          <td>${escapeHtml(reg)}</td>${td(a.atencao, 'badge-blue')}${td(a.urgente, 'badge-amber')}${td(a.critico, 'badge-red')}<td class="td-mono" ${r}><b>${a.total}</b></td></tr>`).join('')
        || _cobVazio('ti-mood-happy', 'Nenhuma nota em cobrança.', 5)}</tbody>
    </table></div></div>`;
}

// ── Relatório do Ranking (24h / 48h / 72h+) ──────────────────
// Mesmo shell dos demais relatórios do sistema (_buildRankingShellHTML em
// relatorio.js: faixa, logos Concrelagos + AnalyticSys, KPIs, rodapé, botão
// imprimir). Usa as notas da cobrança padrão que o Ranking está mostrando
// (ou seja, respeita os filtros aplicados na tela).
const COB_REL_QUANDO = { atencao: 'há 24h', urgente: 'há 48h', critico: 'há 72h ou mais' };
const _cobRelAtraso = r => `<span class="cobr-atraso cobr-${r.nivel}">${r.dias === null ? 'sem data' : `${r.dias} dia${r.dias > 1 ? 's' : ''}`}</span>`;
const _cobRelCol = {
  central:    ['Central', r => `<span class="rk-name">${_rankEsc(r.central)}</span>${r.centralNome ? `<div class="rk-sub">${_rankEsc(r.centralNome)}</div>` : ''}`],
  fornecedor: ['Fornecedor', r => _rankEsc(r.fornecedor)],
  nf:         ['NF', r => `<span class="cobr-mono">${_rankEsc(r.numero)}</span>`],
  emissao:    ['Emissão', r => `<span class="cobr-mono">${r.emissao_fmt}</span>`],
  atraso:     ['Atraso', _cobRelAtraso],
  valor:      ['Valor', r => `<span class="cobr-mono">${money(r.valor)}</span>`, 'right'],
  peso:       ['Peso (ton)', r => `<span class="cobr-mono">${r.semSefaz ? '—' : _cobFmtNum(r.volume)}</span>`, 'right'],
  material:   ['Material', r => r.itens.length > 1
                ? r.itens.map(i => `<div>${_rankEsc(i.material || '—')} · ${_cobFmtNum(i.volume)}</div>`).join('')
                : _rankEsc(r.materiais || '—')],
  cfop:       ['CFOP', r => `<span class="cobr-mono">${_rankEsc(r.cfops || '—')}</span>`],
};

// Relatório da Cobrança no shell padrão do sistema (_buildRankingShellHTML,
// relatorio.js: faixa, logos Concrelagos + AnalyticSys, KPIs, rodapé, botão
// imprimir). Tabela agrupada por regional (linha de cabeçalho por regional),
// igual ao Detalhamento. `destaque(r)` → classe extra da linha (ex.: amarela).
function _cobGerarRelatorio({ rows, titulo, subtitulo, tabelaTitulo, periodo, cols, kpisExtra = [], kpiCor = '#ef4444', destaque, legenda }) {
  const res = _cob.res;
  const geradoEm = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const nCentrais = new Set(rows.map(r => r.cnpj_comprador)).size;
  const grupos = new Map();
  rows.forEach(r => { if (!grupos.has(r.regional)) grupos.set(r.regional, []); grupos.get(r.regional).push(r); });
  const ord = (a, b) => a.central.localeCompare(b.central, 'pt-BR') || String(a.emissao || '').localeCompare(String(b.emissao || ''));
  const th = cols.map(k => `<th${_cobRelCol[k][2] ? ' style="text-align:right"' : ''}>${_cobRelCol[k][0]}</th>`).join('');
  const corpo = [...grupos.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'pt-BR'))
    .map(([reg, rs]) => {
      const nc = new Set(rs.map(r => r.cnpj_comprador)).size;
      return `<tr class="cobr-reg"><td colspan="${cols.length}"><i class="ti ti-users-group"></i>${_rankEsc(reg)}<span>${rs.length} NF${rs.length > 1 ? 's' : ''} · ${nc} ${nc > 1 ? 'centrais' : 'central'}</span></td></tr>`
        + rs.sort(ord).map(r => `<tr${destaque?.(r) ? ` class="${destaque(r)}"` : ''}>${cols.map(k =>
            `<td${_cobRelCol[k][2] ? ' style="text-align:right"' : ''}>${_cobRelCol[k][1](r)}</td>`).join('')}</tr>`).join('');
    }).join('');

  const bodyHtml = `
    <style>
      .cobr-reg td { background:var(--dgr-card-bg, rgba(255,255,255,.045)); border-top:2px solid var(--dgr-table-border-forte, rgba(255,255,255,.14)); font-size:12.5px; font-weight:800; color:var(--dgr-text-strong, #fff); padding:10px; }
      .cobr-reg i { color:#f87171; margin-right:7px; }
      .cobr-reg span { margin-left:10px; font-size:10px; font-weight:600; color:var(--dgr-text-dim, #94a3b8); font-family:'JetBrains Mono',monospace; }
      .cobr-mono { font-family:'JetBrains Mono',monospace; white-space:nowrap; }
      .cobr-atraso { display:inline-block; padding:2px 8px; border-radius:4px; font-size:10px; font-weight:800; font-family:'JetBrains Mono',monospace; white-space:nowrap; }
      .cobr-atencao { background:rgba(59,130,246,.14); border:1px solid rgba(59,130,246,.35); color:#93c5fd; }
      .cobr-urgente { background:rgba(245,158,11,.14); border:1px solid rgba(245,158,11,.4); color:#fcd34d; }
      .cobr-critico { background:rgba(239,68,68,.14); border:1px solid rgba(239,68,68,.4); color:#fca5a5; }
      .cobr-linha-atencao td { background:rgba(59,130,246,.07); }
      .cobr-linha-urgente td { background:rgba(245,158,11,.08); }
      .cobr-linha-critico td { background:rgba(239,68,68,.08); }
      .cobr-amarela td { background:rgba(250,204,21,.13); }
      .cobr-amarela td:first-child { box-shadow:inset 3px 0 0 #facc15; }
      .cobr-legenda { display:flex; flex-wrap:wrap; align-items:center; gap:8px 20px; font-size:10.5px; color:var(--dgr-text-dim, #94a3b8); margin:0 0 12px; }
      .cobr-legenda span { display:inline-flex; align-items:center; gap:7px; }
      .cobr-legenda b { color:var(--dgr-text-dim2, #64748b); font-weight:800; text-transform:uppercase; letter-spacing:.05em; font-size:9px; }
      .cobr-legenda i { display:inline-block; width:14px; height:14px; border-radius:3px; }
      .cobr-sw-atencao { background:rgba(59,130,246,.30); border:1px solid rgba(59,130,246,.55); }
      .cobr-sw-urgente { background:rgba(245,158,11,.30); border:1px solid rgba(245,158,11,.6); }
      .cobr-sw-critico { background:rgba(239,68,68,.30); border:1px solid rgba(239,68,68,.6); }
      .cobr-sw-amarela { background:rgba(250,204,21,.25); box-shadow:inset 3px 0 0 #facc15; }
      .rk-table tr { page-break-inside:avoid; }
    </style>
    ${legenda?.length ? `<div class="cobr-legenda"><b>Legenda</b>${legenda.map(([cls, txt]) => `<span><i class="cobr-sw-${cls}"></i>${_rankEsc(txt)}</span>`).join('')}</div>` : ''}
    <div class="rk-table-wrap">
      ${tabelaTitulo ? `<div class="rk-table-head">
        <span class="rk-table-head-title">${_rankEsc(tabelaTitulo)}</span>
        <span class="rk-table-head-cap">${rows.length} NF${rows.length > 1 ? 's' : ''} · agrupadas por regional</span>
      </div>` : ''}
      <table class="rk-table"><thead><tr>${th}</tr></thead><tbody>${corpo}</tbody></table>
    </div>
    <div class="callout-regularizacao">
      <div class="callout-regularizacao-title">⚠ Lançamento imediato</div>
      <div class="callout-regularizacao-text">Lançar as notas fiscais acima no sistema ou informar ao setor de Insumos o motivo do atraso ou o desvio da carga.</div>
    </div>`;

  _openRelWindow(_buildRankingShellHTML({
    periodoBadge: `Gerado em ${geradoEm}`,
    periodo,
    now: geradoEm,
    kpis: [
      { value: rows.length, label: rows.length !== 1 ? 'NFs pendentes' : 'NF pendente', color: kpiCor },
      { value: nCentrais,   label: nCentrais !== 1 ? 'centrais' : 'central',     color: '#22c55e' },
      { value: grupos.size, label: grupos.size !== 1 ? 'regionais' : 'regional', color: '#3b82f6' },
      ...kpisExtra,
    ],
  }, {
    pageTitle: `${titulo} — ${geradoEm}`,
    badge: 'Cobrança de NFs',
    title: titulo,
    subtitle: subtitulo,
    bodyHtml,
    notaRodape: `Atraso em dias corridos desde a emissão da NF. Base — ${_cobBaseTxt(res)}.`,
  }));
}

const _cobDiaMenos = k => { const t = new Date(_cob.res.hojeISO + 'T00:00:00'); t.setDate(t.getDate() - k); return fmtPtDate(t); };

// Ranking: uma criticidade (24h / 48h / 72h+) da cobrança padrão, respeitando
// os filtros da tela (= o que o Ranking está mostrando).
function cobRelatorioRanking(nivel) {
  const res = _cob.res, n = COB_NIVEIS[nivel];
  if (!res || !n) return;
  const rows = _cobFiltrarNfs(res.cobranca).filter(r => r.nivel === nivel);
  if (!rows.length) { toast(`Nenhuma nota em ${n.rot} (${n.h}) para gerar o relatório.`, 'error'); return; }
  _cobGerarRelatorio({
    rows,
    titulo: `NFs pendentes ${COB_REL_QUANDO[nivel]}`,
    subtitulo: `Notas fiscais de insumos emitidas ${COB_REL_QUANDO[nivel]} e ainda não lançadas no sistema, agrupadas por regional.`,
    tabelaTitulo: `NFs pendentes de lançamento — ${n.rot} (${n.h})`,
    periodo: { atencao: `Emissão em ${_cobDiaMenos(1)}`, urgente: `Emissão em ${_cobDiaMenos(2)}`, critico: `Emissão até ${_cobDiaMenos(3)}` }[nivel],
    cols: ['central', 'fornecedor', 'nf', 'emissao', 'atraso'],
    kpiCor: { atencao: '#3b82f6', urgente: '#f59e0b', critico: '#ef4444' }[nivel],
  });
}

// Detalhamento: cobrança padrão + ADITIBRAS (bloco Aditivos, linhas
// amarelas), todas as criticidades, respeitando os filtros da tela.
function cobRelatorioDetalhamento() {
  const res = _cob.res;
  if (!res) return;
  const aditivos = _cobFiltrarNfs(res.blocos.Aditivos || []);
  const rows = _cobFiltrarNfs(res.cobranca).concat(aditivos);
  if (!rows.length) { toast('Nenhuma nota no detalhamento para gerar o relatório.', 'error'); return; }
  _cobGerarRelatorio({
    rows,
    titulo: 'Detalhamento de pendências',
    subtitulo: 'Notas fiscais de insumos pendentes de lançamento no sistema (cobrança padrão + ADITIBRAS), agrupadas por regional.',
    tabelaTitulo: '',   // o título do relatório já é "Detalhamento de pendências"
    periodo: `Emissão até ${_cobDiaMenos(1)}`,
    cols: ['central', 'fornecedor', 'nf', 'emissao', 'atraso', 'peso', 'material'],
    kpisExtra: [{ value: aditivos.length, label: 'ADITIBRAS', color: '#facc15' }],
    // ADITIBRAS amarela tem prioridade; as demais pintadas de leve com a cor do atraso
    destaque: r => r.bloco === 'Aditivos' ? 'cobr-amarela' : 'cobr-linha-' + r.nivel,
    // legenda: [classe da amostra, texto]
    legenda: [
      ...Object.entries(COB_NIVEIS).map(([k, n]) => [k, `${n.rot} — ${COB_REL_QUANDO[k]}`]),
      ...(aditivos.length ? [['amarela', 'ADITIBRAS (cobrança à parte)']] : []),
    ],
  });
}

function _cobPorFornecedorHtml(rows) {
  const por = new Map();
  rows.forEach(r => { const a = por.get(r.cnpj) || { nome: r.fornecedor, cnpj: r.cnpj, notas: 0 }; a.notas++; por.set(r.cnpj, a); });
  const lin = [...por.values()].sort((a, b) => b.notas - a.notas || a.nome.localeCompare(b.nome, 'pt-BR'));
  return `<div class="table-card"><div class="table-header"><span class="table-title"><i class="ti ti-truck-delivery"></i> Notas faltantes por fornecedor</span></div>
    <div class="table-scroll" style="max-height:440px"><table>
      <thead><tr><th>Fornecedor</th><th style="text-align:right">Notas</th></tr></thead>
      <tbody>${lin.map(f => `<tr style="cursor:pointer" title="Filtrar este fornecedor" onclick="cobFiltrarTexto('${f.cnpj}')"><td>${escapeHtml(f.nome)}</td><td class="td-mono" style="text-align:right"><b>${f.notas}</b></td></tr>`).join('')
        || _cobVazio('ti-mood-happy', 'Nenhuma nota em cobrança.', 2)}</tbody>
    </table></div></div>`;
}

function _cobLinhaNf(r) {
  const n = COB_NIVEIS[r.nivel];
  const material = r.itens.length > 1
    ? r.itens.map(i => `<div class="cob-item">${escapeHtml(i.material || '—')} · ${_cobFmtNum(i.volume)} · ${money(i.valor_total)}</div>`).join('')
    : escapeHtml(r.materiais || '—');
  // Clique na linha abre o detalhe da NF (dados + justificativa + ações).
  // Azul = já tem justificativa/desvio registrado pelo analista.
  return `<tr class="cob-nf${r.just ? ' cob-justificada' : ''}" onclick="cobAbrirNf('${r.k}')" title="${r.just ? 'Justificada — clique para ver' : 'Clique para ver / justificar'}">
    <td class="td-mono" title="${escapeHtml(r.centralNome)}">${escapeHtml(r.central)}${r.semCentral ? ` <span class="badge badge-red" title="CNPJ ${_cobFmtCnpj(r.cnpj_comprador)} não está no cadastro de centrais">?</span>` : ''}</td>
    <td>${escapeHtml(r.fornecedor)}</td>
    <td class="td-mono">${escapeHtml(r.numero)}${r.semSefaz ? ' <span class="badge badge-amber" title="Nota não encontrada no relatório do SEFAZ importado">sem SEFAZ</span>' : ''}</td>
    <td><span class="badge ${n.badge}" title="${r.dias === null ? 'Sem data de emissão' : `Há ${r.dias} dia(s) — ${n.rot}`}">${r.emissao_fmt}</span></td>
    <td class="td-mono" style="text-align:right">${money(r.valor)}</td>
    <td class="td-mono" style="text-align:right">${r.semSefaz ? '—' : _cobFmtNum(r.volume)}</td>
    <td>${material}</td>
    <td class="td-mono">${escapeHtml(r.cfops || '—')}</td>
  </tr>`;
}

// Clique numa notificação de justificativa/desconsideração (notifications.js):
// abre a NF se ela ainda estiver na cobrança; senão, a aba da anotação filtrada.
async function cobAbrirNfDeNotificacao(k, tabela) {
  navigate('cobrancas');
  await _cobCarregarCobranca();
  await new Promise(r => setTimeout(r, 150));   // ponytail: espera o recálculo agendado (_cobRecalcular, 60ms)
  if (_cob.res?.cobraveis.some(r => r.k === k)) { cobSwitchTab('cobranca'); cobAbrirNf(k); return; }
  _cobIrParaTela(tabela === 'cob_desconsiderar' ? 'desconsideradas' : 'justificativas', k.split('|')[1] || '');
}

// ── Detalhe da NF (modal) ────────────────────────────────────
const _cobInfo = (rot, val, full = false) => `<div${full ? ' style="grid-column:1/-1"' : ''}>
  <div class="form-label" style="margin-bottom:2px">${rot}</div><div style="font-size:13px">${val || '<span style="color:var(--text3)">—</span>'}</div></div>`;

function cobAbrirNf(k) {
  const r = _cob.res?.porChave.get(k);
  if (!r) return;
  const n = COB_NIVEIS[r.nivel], j = r.just;
  document.getElementById('cob-nf-title').innerHTML = `<i class="ti ti-file-invoice"></i> NF ${escapeHtml(r.numero)}`;
  document.getElementById('cob-nf-sub').textContent = `${r.fornecedor} · ${r.cnpj_fmt}`;
  const itens = r.itens.length
    ? `<table style="margin-top:4px"><thead><tr><th>Material</th><th>CFOP</th><th style="text-align:right">Peso</th><th style="text-align:right">Valor</th></tr></thead><tbody>
        ${r.itens.map(i => `<tr><td>${escapeHtml(i.material || '—')}</td><td class="td-mono">${escapeHtml(i.cfop || '—')}</td><td class="td-mono" style="text-align:right">${_cobFmtNum(i.volume)}</td><td class="td-mono" style="text-align:right">${money(i.valor_total)}</td></tr>`).join('')}
      </tbody></table>`
    : '<div style="color:var(--text3);font-size:12px">Nota não encontrada no relatório do SEFAZ importado.</div>';
  const grade = 'display:grid;grid-template-columns:1fr 1fr;gap:12px 16px';
  document.getElementById('cob-nf-body').innerHTML = `
    <div style="${grade}">
      ${_cobInfo('Central', `${escapeHtml(r.central)}${r.centralNome ? ` <span style="color:var(--text3)">— ${escapeHtml(r.centralNome)}</span>` : ''}`)}
      ${_cobInfo('Regional', escapeHtml(r.regional))}
      ${_cobInfo('Emissão', `<span class="badge ${n.badge}">${r.emissao_fmt}</span> ${r.dias === null ? '' : `há ${r.dias} dia(s) · ${n.rot}`}`)}
      ${_cobInfo('Valor da NF', money(r.valor))}
      ${_cobInfo('Status SEFAZ', escapeHtml(r.statusSefaz))}
      ${_cobInfo('Transportador / Placa', [r.transportador, r.placa].filter(Boolean).map(escapeHtml).join(' · '))}
      ${_cobInfo('Itens', itens, true)}
    </div>
    <div class="section-title" style="margin:18px 0 10px">Justificativa</div>
    ${j ? `<div style="${grade};padding:12px;border-radius:var(--radius);background:var(--accent-dim);border:1px solid var(--accent)">
        ${_cobInfo('Carga desviada para', escapeHtml(j.desviado || ''))}
        ${_cobInfo('Informante', escapeHtml(j.informante || ''))}
        ${_cobInfo('Motivo do atraso', escapeHtml(j.motivo || ''), true)}
        ${_cobInfo('Dia da resposta', _cobFmtData(j.dia_resp))}
      </div>`
      : '<div style="color:var(--text3);font-size:12px">Nenhuma justificativa registrada para esta nota.</div>'}`;
  document.getElementById('cob-nf-actions').innerHTML = `
    <button class="btn admin-btn-danger" onclick="closeModal('cob-nf-modal');cobAbrirAnot('desconsiderar','${k}')"><i class="ti ti-eye-off"></i> Desconsiderar</button>
    ${j ? `<button class="btn admin-btn-danger" onclick="cobExcluirJustDoModal('${k}')"><i class="ti ti-trash"></i> Excluir justificativa</button>` : ''}
    <span style="margin-right:auto"></span>
    <button class="btn" onclick="closeModal('cob-nf-modal')">Fechar</button>
    <button class="btn btn-primary" onclick="closeModal('cob-nf-modal');cobAbrirAnot('justificativas','${k}')"><i class="ti ti-message-2"></i> ${j ? 'Editar justificativa' : 'Justificar / informar desvio'}</button>`;
  openModal('cob-nf-modal');
}

function cobDetView(v) { _cob.detView = v; _cobRenderCobranca(); }

// Detalhamento: uma tabela só, alternando entre a cobrança padrão e os
// blocos à parte (Aditivos/Dovalle) pelos botões do cabeçalho. Sempre
// agrupada por regional.
function _cobDetalhamentoHtml(padrao, blocos) {
  const views = [['padrao', 'Padrão', padrao], ...blocos.map(([b, rs]) => [b, b, rs])];
  const [atual, , rows] = views.find(v => v[0] === _cob.detView) || views[0];
  const ncol = 8;
  const ord = (a, b) => a.central.localeCompare(b.central, 'pt-BR') || String(a.emissao || '').localeCompare(String(b.emissao || ''));
  const grupos = new Map();
  rows.forEach(r => { if (!grupos.has(r.regional)) grupos.set(r.regional, []); grupos.get(r.regional).push(r); });
  let body = '';
  [...grupos.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'pt-BR')).forEach(([reg, rs]) => {
    body += `<tr class="cob-grupo"><td colspan="${ncol}">${escapeHtml(reg)} <span style="color:var(--text3);font-weight:500">· ${rs.length} nota${rs.length > 1 ? 's' : ''}</span></td></tr>`;
    body += rs.sort(ord).map(_cobLinhaNf).join('');
  });
  const vazio = `Nenhuma nota${_cobTemFiltro() ? ' para o filtro' : ''}.`
    + (atual === 'padrao' && _cob.res.fora.hoje ? `<br>${_cob.res.fora.hoje} nota(s) emitida(s) hoje entram na cobrança amanhã (D-1).` : '');
  return `<div class="table-card" style="margin-bottom:16px">
    <div class="table-header">
      <span class="table-title"><i class="ti ti-list-details"></i> Detalhamento de pendências</span>
      <div class="table-toolbar">${views.map(([k, rot, rs]) =>
        `<button class="pim-month-pill${k === atual ? ' active' : ''}" type="button" onclick="cobDetView('${k}')">${rot} <b>${rs.length}</b></button>`).join('')}
        <button class="btn" onclick="cobRelatorioDetalhamento()" title="Relatório: cobrança padrão + ADITIBRAS (em amarelo)"><i class="ti ti-file-text"></i> Relatório</button></div>
    </div>
    <div class="table-scroll" style="max-height:calc(100vh - 140px)"><table>
      <thead><tr><th>Central</th><th>Fornecedor</th><th>NF</th><th>Emissão</th><th style="text-align:right">Valor</th><th style="text-align:right">Peso</th><th>Material</th><th>CFOP</th></tr></thead>
      <tbody>${body || _cobVazio('ti-circle-check', vazio, ncol)}</tbody>
    </table></div></div>`;
}

// ── Alertas ──────────────────────────────────────────────────
function _cobRenderAlertas() {
  const res = _cob.res, pane = document.getElementById('cob-pane-alertas');
  const n = _cobNumAlertas(res);
  const badge = document.getElementById('cob-alertas-count');
  if (badge) { badge.textContent = n; badge.style.display = n ? '' : 'none'; }
  if (!pane) return;
  const sec = (icon, titulo, desc, head, linhas, ncol) => `<div class="table-card" style="margin-bottom:16px">
    <div class="table-header"><span class="table-title"><i class="ti ${icon}"></i> ${titulo} <span style="color:var(--text3);font-weight:500">· ${linhas.length}</span></span></div>
    <div class="import-card-desc" style="padding:0 16px 10px;margin:0">${desc}</div>
    <div class="table-scroll" style="max-height:420px"><table><thead><tr>${head}</tr></thead>
    <tbody>${linhas.join('') || _cobVazio('ti-circle-check', 'Nada aqui.', ncol)}</tbody></table></div></div>`;
  const nfHead = '<th>Central</th><th>Fornecedor</th><th>NF</th><th>Emissão</th><th style="text-align:right">Valor</th>';
  const nfTds = r => `<td class="td-mono">${escapeHtml(r.central)}</td><td>${escapeHtml(r.fornecedor)}</td><td class="td-mono">${escapeHtml(r.numero)}</td><td>${r.emissao_fmt}</td><td class="td-mono" style="text-align:right">${money(r.valor)}</td>`;
  pane.innerHTML =
    sec('ti-truck-delivery', 'Fornecedores fora da lista de cobrança',
      'Notas de venda/remessa de fornecedores que ainda não estão no cadastro. Inclua na cobrança ou marque como consumo — a decisão fica gravada em Configurações.',
      '<th>Fornecedor</th><th>CNPJ</th><th style="text-align:right">Notas</th><th></th>',
      res.fornNovos.map(f => `<tr><td>${escapeHtml(f.nome)}</td><td class="td-mono">${f.cnpj_fmt}</td><td class="td-mono" style="text-align:right">${f.notas}</td>
        <td style="white-space:nowrap"><button class="btn" onclick="cobDecidirFornecedor('${f.cnpj}','cobrar')"><i class="ti ti-plus"></i> Incluir na cobrança</button>
        <button class="btn" onclick="cobDecidirFornecedor('${f.cnpj}','ignorar')"><i class="ti ti-ban"></i> Ignorar (consumo)</button></td></tr>`), 4)
    + sec('ti-file-x', 'Canceladas no SEFAZ', 'Desconsideradas automaticamente da cobrança.',
      nfHead + '<th>Status SEFAZ</th>', res.canceladas.map(r => `<tr>${nfTds(r)}<td><span class="badge badge-red">${escapeHtml(r.statusSefaz)}</span></td></tr>`), 6)
    + sec('ti-file-unknown', 'Sem dados do SEFAZ',
      'Pendentes que não estão no relatório do SEFAZ importado — sem CFOP para conferir. Continuam na cobrança, marcadas como "sem SEFAZ".',
      nfHead, res.semSefaz.map(r => `<tr>${nfTds(r)}</tr>`), 5)
    + sec('ti-map-pin-off', 'Centrais não cadastradas', 'CNPJs compradores das pendências que não estão no cadastro de centrais do admin.',
      '<th>CNPJ comprador</th><th style="text-align:right">Notas</th>',
      res.centraisNaoCad.map(c => `<tr><td class="td-mono">${c.cnpj_fmt}</td><td class="td-mono" style="text-align:right">${c.notas}</td></tr>`), 2);
}

async function cobDecidirFornecedor(cnpj, situacao) {
  const f = _cob.res?.fornNovos.find(x => x.cnpj === cnpj);
  if (!f) return;
  const { data, error } = await window.supabaseClient.from('cob_fornecedores')
    .upsert({ cnpj, nome: f.nome, situacao }, { onConflict: 'cnpj' }).select();
  if (error) { toast('Falha ao salvar o fornecedor: ' + error.message, 'error'); return; }
  _cobAplicar('fornecedores', cnpj, data?.[0] || { cnpj, nome: f.nome, situacao });
  cobRenderCadastro('fornecedores');
  toast(situacao === 'cobrar' ? `${f.nome} incluído na cobrança.` : `${f.nome} marcado como consumo (ignorado).`, 'success');
}

// ── Justificativas / Desconsideradas ─────────────────────────
const COB_ANOT = {
  justificativas: {
    pane: 'cob-pane-justificativas', rotulo: 'Justificativa', icon: 'ti-message-2',
    head: '<th>Fornecedor</th><th>NF</th><th>Central</th><th>Informante</th><th>Dia resp.</th><th>Desviado para</th><th>Motivo do atraso</th><th>Situação</th><th></th>',
    tds: r => `<td>${escapeHtml(r.informante || '')}</td><td>${r.dia_resp_fmt}</td><td>${escapeHtml(r.desviado || '')}</td><td class="cob-just" title="${escapeHtml(r.motivo || '')}">${escapeHtml(r.motivo || '')}</td>`,
  },
  desconsiderar: {
    pane: 'cob-pane-desconsideradas', rotulo: 'Desconsideração', icon: 'ti-eye-off',
    head: '<th>Fornecedor</th><th>NF</th><th>Central</th><th>Motivo</th><th>Data</th><th>Justificativa</th><th>Situação</th><th></th>',
    tds: r => `<td><span class="badge badge-purple">${escapeHtml(r.motivo || '—')}</span></td><td>${r.data_fmt}</td><td class="cob-just" title="${escapeHtml(r.justificativa || '')}">${escapeHtml(r.justificativa || '')}</td>`,
  },
};

function cobFiltrarAnot(tipo, v) { _cob.filtroAnot[tipo] = v || ''; _cobRenderAnot(tipo); }

function _cobRenderAnot(tipo) {
  const cfg = COB_ANOT[tipo], pane = document.getElementById(cfg.pane);
  if (!pane || !_cob.res) return;
  if (!pane.querySelector('.cob-anot-corpo')) {
    pane.innerHTML = `<div class="cob-toolbar"><input class="form-input" type="text" placeholder="Filtrar fornecedor, NF, motivo…" value="${escapeHtml(_cob.filtroAnot[tipo])}" oninput="cobFiltrarAnot('${tipo}', this.value)"></div><div class="cob-anot-corpo"></div>`;
  }
  const todas = tipo === 'justificativas' ? _cob.res.justificativas : _cob.res.desconsideradas;
  const ws = _cobPalavras(_cob.filtroAnot[tipo]);
  const lista = (ws.length ? todas.filter(r => _cobBusca(r, COB_CAMPOS_ANOT, ws)) : todas)
    .slice().sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  const ncol = (cfg.head.match(/<th/g) || []).length;
  pane.querySelector('.cob-anot-corpo').innerHTML = `<div class="table-card"><div class="table-header"><span class="table-title"><i class="ti ${cfg.icon}"></i> ${tipo === 'justificativas' ? 'Justificativas' : 'Notas desconsideradas'} <span style="color:var(--text3);font-weight:500">· ${lista.length}</span></span></div>
    <div class="table-scroll" style="max-height:640px"><table><thead><tr>${cfg.head}</tr></thead><tbody>
    ${lista.map(r => `<tr><td>${escapeHtml(r.fornecedor || r.cnpj_fmt)}</td><td class="td-mono">${escapeHtml(r.numero)}</td><td class="td-mono">${escapeHtml(r.central)}</td>${cfg.tds(r)}
      <td>${r.emAberto ? '<span class="badge badge-amber">Nas pendências</span>' : '<span class="badge badge-teal" title="A nota não está mais no relatório de pendências">Fora das pendências</span>'}</td>
      <td style="white-space:nowrap"><button class="btn-icon" title="Editar" onclick="cobAbrirAnot('${tipo}','${r.k}')"><i class="ti ti-pencil"></i></button>
      <button class="btn-icon danger" title="Excluir" onclick="cobExcluirAnot('${tipo}','${r.k}')"><i class="ti ti-trash"></i></button></td></tr>`).join('')
      || _cobVazio(cfg.icon, `Nenhum registro${ws.length ? ' para o filtro' : ''}.`, ncol)}
    </tbody></table></div></div>`;
}

// Modal único de Justificar / Desconsiderar (upsert por cnpj+número).
let _cobModal = null;
const _cobCampo = (k, rot, v, tipo = 'text', full = false, extra = '') => `<div class="form-group"${full ? ' style="grid-column:1/-1"' : ''}>
  <label class="form-label">${rot}</label>
  ${tipo === 'textarea'
    ? `<textarea class="form-input" data-k="${k}" rows="3" style="width:100%;resize:vertical">${escapeHtml(v || '')}</textarea>`
    : `<input class="form-input" type="${tipo}" data-k="${k}" value="${escapeHtml(v || '')}" style="width:100%" ${extra}>`}
</div>`;

function cobAbrirAnot(tipo, k) {
  const [cnpj, numero] = k.split('|');
  const r = _cob.res?.porChave.get(k);
  const atual = _cob[tipo].find(x => _cobChaveNf(x) === k);
  const forn = r?.fornecedor || _cob.fornecedores.find(f => f.cnpj === cnpj)?.nome || _cobFmtCnpj(cnpj);
  const hoje = localISODate(new Date());
  _cobModal = { tipo, cnpj, numero };
  document.getElementById('cob-modal-title').innerHTML = tipo === 'justificativas'
    ? '<i class="ti ti-message-2"></i> Justificar atraso / desvio' : '<i class="ti ti-eye-off"></i> Desconsiderar da cobrança';
  document.getElementById('cob-modal-sub').textContent = `NF ${numero} · ${forn}${r ? ` · ${r.central} · emissão ${r.emissao_fmt}` : ''}`;
  document.getElementById('cob-modal-fields').innerHTML = tipo === 'justificativas'
    ? _cobCampo('informante', 'Informante', atual?.informante)
      + _cobCampo('dia_resp', 'Dia da resposta', atual?.dia_resp || hoje, 'date')
      + _cobCampo('desviado', 'Carga desviada para', atual?.desviado, 'text', true, 'placeholder="ex.: IQQ — deixe vazio se não foi desviada"')
      + _cobCampo('motivo', 'Motivo do atraso', atual?.motivo, 'textarea', true)
    : _cobCampo('motivo', 'Motivo', atual?.motivo, 'text', false, 'list="cob-dl-motivos" placeholder="ex.: DEVOLUÇÃO"')
      + _cobCampo('data', 'Data', atual?.data || hoje, 'date')
      + _cobCampo('justificativa', 'Justificativa', atual?.justificativa, 'textarea', true)
      + `<datalist id="cob-dl-motivos">${COB_MOTIVOS_DESC.map(m => `<option value="${m}">`).join('')}</datalist>`;
  openModal('cob-modal');
  setTimeout(() => document.querySelector('#cob-modal-fields [data-k]')?.focus(), 50);
}

async function cobModalSalvar() {
  const m = _cobModal;
  if (!m) return;
  const rec = { cnpj_fornecedor: m.cnpj, numero: m.numero };
  document.querySelectorAll('#cob-modal-fields [data-k]').forEach(el => { rec[el.dataset.k] = el.value.trim() || null; });
  if (m.tipo === 'desconsiderar') {
    if (!rec.motivo) { toast('Informe o motivo.', 'error'); return; }
    rec.motivo = rec.motivo.toUpperCase();
  } else if (!rec.desviado && !rec.motivo) {
    toast('Informe o motivo do atraso ou para onde a carga foi desviada.', 'error');
    return;
  }
  const { data, error } = await window.supabaseClient.from('cob_' + m.tipo)
    .upsert(rec, { onConflict: 'cnpj_fornecedor,numero' }).select();
  if (error) { toast('Falha ao salvar: ' + error.message, 'error'); return; }
  _cobAplicarAnot(m.tipo, rec, data?.[0] || rec);
  closeModal('cob-modal');
  _cobRecalcular();
  toast(m.tipo === 'justificativas' ? 'Justificativa salva.' : 'Nota desconsiderada da cobrança.', 'success');
}

async function cobExcluirAnot(tipo, k) {
  const [cnpj, numero] = k.split('|');
  const msg = tipo === 'justificativas'
    ? `Excluir a justificativa da NF ${numero}?`
    : `Excluir a desconsideração da NF ${numero}?\n\nSe a nota ainda estiver nas pendências, ela volta para a cobrança.`;
  if (!confirm(msg)) return false;
  const { error } = await window.supabaseClient.from('cob_' + tipo).delete().eq('cnpj_fornecedor', cnpj).eq('numero', numero);
  if (error) { toast('Falha ao excluir: ' + error.message, 'error'); return false; }
  _cobAplicarAnot(tipo, { cnpj_fornecedor: cnpj, numero }, null);
  _cobRecalcular();
  toast(`${COB_ANOT[tipo].rotulo} excluída.`, 'success');
  return true;
}

// Botão "Excluir justificativa" do detalhe da NF — fecha o modal só se excluiu.
async function cobExcluirJustDoModal(k) {
  if (await cobExcluirAnot('justificativas', k)) closeModal('cob-nf-modal');
}

// ── Busca global (topbar) ────────────────────────────────────
// Escopos da Cobrança entram na mesma busca do sistema (analitico.js):
// admin ganha esses escopos além dos dele; insumos fica SÓ com eles.
// Clicar num resultado leva direto à tela/cadastro, já filtrado.
const COB_GS = [
  { scope: 'cob_cobranca', modKey: 'Cobrança', rotulo: 'Cobrança', icon: 'ti-file-alert',
    fonte: () => _cob.res?.cobraveis || [], campos: COB_CAMPOS_NF,
    cols: [['Regional', 'regional'], ['Central', 'central'], ['Fornecedor', 'fornecedor'], ['NF', 'numero'], ['Emissão', 'emissao_fmt'], ['Material', 'materiais'], ['Valor', 'valor', 'money']],
    abrir: r => _cobIrParaTela('cobranca', r.numero) },
  { scope: 'cob_justificativas', modKey: 'Justificativa', rotulo: 'Justificativas', icon: 'ti-message-2',
    fonte: () => _cob.res?.justificativas || [], campos: COB_CAMPOS_ANOT,
    cols: [['Fornecedor', 'fornecedor'], ['NF', 'numero'], ['Central', 'central'], ['Informante', 'informante'], ['Desviado para', 'desviado'], ['Motivo', 'motivo']],
    abrir: r => _cobIrParaTela('justificativas', r.numero) },
  { scope: 'cob_desconsideradas', modKey: 'Desconsiderada', rotulo: 'Desconsideradas', icon: 'ti-eye-off',
    fonte: () => _cob.res?.desconsideradas || [], campos: COB_CAMPOS_ANOT,
    cols: [['Fornecedor', 'fornecedor'], ['NF', 'numero'], ['Central', 'central'], ['Motivo', 'motivo'], ['Data', 'data_fmt'], ['Justificativa', 'justificativa']],
    abrir: r => _cobIrParaTela('desconsideradas', r.numero) },
  { scope: 'cob_cfop', modKey: 'CFOP', rotulo: 'CFOP', icon: 'ti-receipt-tax',
    fonte: () => _cob.cfop, campos: COB_CAMPOS.cfop,
    cols: [['CFOP', 'cfop'], ['Resumo', 'resumo'], ['Descrição', 'descricao']],
    abrir: r => _cobIrParaCadastro('cfop', r) },
  { scope: 'cob_fornecedores', modKey: 'Fornecedor', rotulo: 'Fornecedores', icon: 'ti-truck-delivery',
    fonte: () => _cob.fornecedores, campos: COB_CAMPOS.fornecedores,
    cols: [['Fornecedor', 'nome'], ['CNPJ', 'cnpj_fmt'], ['Situação', 'situacao']],
    abrir: r => _cobIrParaCadastro('fornecedores', r) },
  { scope: 'cob_centrais', modKey: 'Central (consulta)', rotulo: 'Centrais', icon: 'ti-map-pin', soInsumos: true,
    fonte: () => _cob.centrais, campos: COB_CAMPOS.centrais,
    cols: [['Sigla', 'alias'], ['Original', 'origem'], ['CNPJ', 'cnpj_fmt'], ['Regional', 'regional']],
    abrir: r => _cobIrParaCadastro('centrais', r) },
];

function _cobRegistrarBusca() {
  const insumos = cobIsInsumos();
  const sel = document.getElementById('global-search-scope');
  if (sel && insumos) [...sel.options].forEach(o => { if (o.value !== 'todos') o.remove(); });
  COB_GS.filter(s => insumos || !s.soInsumos).forEach(s => {
    _GS_SCOPES.push({ scope: s.scope, modKey: s.modKey, fonte: s.fonte, campos: s.campos });
    _GS_COLS[s.modKey] = s.cols;
    moduleColors[s.modKey] = { bg: 'var(--red-bg)', color: 'var(--red)', icon: s.icon, abrir: s.abrir };
    if (sel) sel.add(new Option(s.rotulo, s.scope));
  });
  // Os dados da Cobrança carregam sob demanda — ao focar a busca já puxa,
  // pra não buscar no vazio antes de alguém abrir a tela.
  document.getElementById('global-search-input')?.addEventListener('focus', () => _cobCarregarCobranca(), { once: true });
}

function _cobIrParaCadastro(tipo, r) {
  closeGlobalResults();
  navigate('configuracoes');
  const termo = tipo === 'cfop' ? r.cfop : tipo === 'fornecedores' ? r.cnpj : r.cnpj || r.alias;
  const tb = document.getElementById('tb-cob-' + tipo);
  const input = tb?.closest('.table-card')?.querySelector('.table-toolbar input[type="text"]');
  if (input) input.value = termo;
  cobCadFiltrar(tipo, termo);
  setTimeout(() => tb?.closest('.table-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
}

function _cobIrParaTela(tab, termo) {
  closeGlobalResults();
  navigate('cobrancas');
  cobSwitchTab(tab);
  if (tab === 'cobranca') {
    _cob.filtroCob = _cobFiltroVazio(termo);
    const i = document.getElementById('cob-f-texto');
    if (i) i.value = termo;
    _cobRenderCobranca();
  } else {
    const tipo = tab === 'justificativas' ? 'justificativas' : 'desconsiderar';
    _cob.filtroAnot[tipo] = termo;
    const i = document.querySelector(`#${COB_ANOT[tipo].pane} .cob-toolbar input`);
    if (i) i.value = termo;
    _cobRenderAnot(tipo);
  }
}
