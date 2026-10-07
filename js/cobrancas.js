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
  // cob_imports — os snapshots em si não têm realtime de propósito.
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'cob_imports' }, () => _cobCarregarImports());
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

// ── Busca global (topbar) ────────────────────────────────────
// Escopos da Cobrança entram na mesma busca do sistema (analitico.js):
// admin ganha esses escopos além dos dele; insumos fica SÓ com eles.
// Clicar num resultado leva direto ao cadastro, filtrado.
const COB_GS = [
  { scope: 'cob_cfop',         modKey: 'CFOP',       rotulo: 'CFOP',        icon: 'ti-receipt-tax',     tipo: 'cfop',
    cols: [['CFOP', 'cfop'], ['Resumo', 'resumo'], ['Descrição', 'descricao']] },
  { scope: 'cob_fornecedores', modKey: 'Fornecedor', rotulo: 'Fornecedores', icon: 'ti-truck-delivery', tipo: 'fornecedores',
    cols: [['Fornecedor', 'nome'], ['CNPJ', 'cnpj_fmt'], ['Situação', 'situacao']] },
  { scope: 'cob_centrais',     modKey: 'Central (consulta)', rotulo: 'Centrais', icon: 'ti-map-pin', tipo: 'centrais', soInsumos: true,
    cols: [['Sigla', 'alias'], ['Original', 'origem'], ['CNPJ', 'cnpj_fmt'], ['Regional', 'regional']] },
];

function _cobRegistrarBusca() {
  const insumos = cobIsInsumos();
  const sel = document.getElementById('global-search-scope');
  if (sel && insumos) [...sel.options].forEach(o => { if (o.value !== 'todos') o.remove(); });
  COB_GS.filter(s => insumos || !s.soInsumos).forEach(s => {
    _GS_SCOPES.push({ scope: s.scope, modKey: s.modKey, fonte: () => _cob[s.tipo], campos: COB_CAMPOS[s.tipo] });
    _GS_COLS[s.modKey] = s.cols;
    moduleColors[s.modKey] = { bg: 'var(--red-bg)', color: 'var(--red)', icon: s.icon, abrir: r => _cobIrParaCadastro(s.tipo, r) };
    if (sel) sel.add(new Option(s.rotulo, s.scope));
  });
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

// ── Página ───────────────────────────────────────────────────
pageRenderers.cobrancas = () => renderCobrancas();

function renderCobrancas() {
  // Etapa 2: só a estrutura. Cálculo e painéis entram na Etapa 5.
}

function cobSwitchTab(tab) {
  document.querySelectorAll('#page-cobrancas .dg-tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.cobTab === tab));
  document.querySelectorAll('#page-cobrancas .dg-tab-pane').forEach(p =>
    p.classList.toggle('active', p.id === 'cob-pane-' + tab));
}
