'use strict';

// ═══════════════════════════════════════════════════════════
// NCD — Notas de Crédito/Débito (Fechamento de Inventário)
// ═══════════════════════════════════════════════════════════
// Gera, a partir das linhas do Fechamento de Inventário (ver inventario.js
// / analitico.js — Visão Inventário), um PDF único e vetorial (texto
// selecionável, via jsPDF + jspdf-autotable) contendo uma NOTA DE CRÉDITO
// e/ou uma NOTA DE DÉBITO por central presente na seleção — nunca mais de
// uma de cada por central, agregando todos os itens daquele sinal.
//
// Fonte dos itens: linhas selecionadas na tabela (modo seleção, checkboxes
// — ver _invSelected em inventario.js); se nada estiver selecionado, usa
// todas as linhas atualmente VISÍVEIS (respeitando os filtros ativos —
// invFiltered). Dentro dessas linhas:
//   • Variação positiva (varKg > 0, fora da tolerância) → item de crédito
//   • Variação negativa (varKg < 0, fora da tolerância) → item de débito
//   • Variação irrelevante (mesma tolerância ±0.01 kg do resto do
//     Inventário — ver _invVarIrrelevante) → ignorada
//   • Linha sem cadastro (semCadastro) → ignorada
//   • Linha sem justificativa FISCAL salva (invJustificativas[k].fiscal)
//     → ignorada (o texto do motivo impresso no documento vem exatamente
//     desse campo) — o usuário é avisado ao final de quantas foram puladas
//   • Central sem CNPJ cadastrado (Configurações → Cadastros → Filiais)
//     → a(s) nota(s) daquela central são puladas, com aviso
//
// Numeração: NC-<CENTRAL>-<AAAAMMDD>-<seq> (crédito) / ND-<CENTRAL>-
// <AAAAMMDD>-<seq> (débito) — sequência DIÁRIA compartilhada entre crédito
// e débito da MESMA central (fica consecutiva, ex.: ...-01 e ...-02),
// contada a partir do que já existe em state.notasAjuste para aquela
// central+dia. Não depende de nº de documento SAP (diferente do DAI, que
// usa o SAP como âncora de unicidade) porque essas notas não nascem de um
// único movimento SAP — por isso o central+data+sequência.
//
// Persistência: só um registro LEVE de metadados por nota (sem o PDF em
// si, sem anexos) em state.notasAjuste — existe só para a numeração se
// manter coerente ao longo do tempo e permitir auditoria de "o que foi
// gerado", sem pesar no armazenamento (ver decisão com Hugo, jul/2026:
// não vale a pena guardar o PDF/bytes).
// ═══════════════════════════════════════════════════════════

// ── Catálogo de Códigos de Grupo SAP ─────────────────────────────────────
// Fornecido por Hugo (jul/2026) — usado SÓ pra preencher a coluna "Cód."
// do documento. É uma tabela de apoio interna, independente do cadastro
// de Materiais (state.materiais): não aparece em Configurações, não é
// editável pela UI, só é atualizada se Hugo pedir pra trocar este arquivo.
// Casamento por nome do GRUPO (mesmo texto do campo "alias" do cadastro
// de Materiais / campo "material" das linhas do Inventário), via
// normalizeText (acento/caixa insensível). Material sem código nesta
// tabela → coluna fica em branco no documento (não bloqueia a geração).
//
// Os códigos 47 e 49 do PDF original vieram corrompidos por uma quebra de
// página (nome "?"), e foram deliberadamente omitidos daqui.
const NCD_SAP_CODIGOS = [
  [1, 'AGLOMERANTE', 'CIMENTO'],
  [2, 'AGREGADO', 'AREIA NATURAL'],
  [3, 'AGREGADO', 'AREIA ARTIFICIAL'],
  [4, 'AGREGADO', 'BRITA 1'],
  [5, 'AGREGADO', 'BRITA 0'],
  [6, 'ADITIVO', 'POLIFUNCIONAL'],
  [7, 'ADITIVO', 'SUPERPLASTIFICANTE'],
  [8, 'ADITIVO', 'INIBIDOR DE HIDRATAÇÃO'],
  [9, 'ADITIVO', 'INCORPORADOR DE AR'],
  [10, 'AGLOMERANTE', 'POZOLANA (INATIVO)'],
  [11, 'ADIÇÃO', 'MICROFIBRA'],
  [12, 'ADIÇÃO', 'MACROFIBRA P/ CONCRETO'],
  [13, 'ADIÇÃO', 'ÁGUA'],
  [14, 'AGLOMERANTE', 'CIMENTO - BLEND'],
  [15, 'ADITIVO', 'MIDRANGE'],
  [16, 'AGREGADO', 'BRITA 2'],
  [17, 'ADIÇÃO', 'GELO'],
  [18, 'ADIÇÃO', 'MICROSSÍLICA CLIENTE (AGLOMERANTE)'],
  [19, 'ADITIVO', 'PLASTIFICANTE RA1'],
  [20, 'AGREGADO', 'AREIA ARTIFICIAL FINA'],
  [21, 'AGREGADO', 'AREIA ULTRAFINA'],
  [22, 'ADIÇÃO', 'FILLER'],
  [23, 'AGREGADO', 'BICA'],
  [24, 'AGLOMERANTE', 'CIMENTO PLUS'],
  [26, 'ADITIVO', 'CONTROLADOR DE HIDRATAÇÃO'],
  [27, 'ADITIVO', 'DESINCORPORADOR DE AR'],
  [28, 'AGREGADO', 'AREIA NATURAL FINA'],
  [29, 'ADITIVO', 'PLASTIFICANTE RA2'],
  [30, 'AGLOMERANTE', 'POZOLANA'],
  [31, 'AGLOMERANTE', 'CIMENTO - Z32'],
  [32, 'INATIVO', 'INATIVO'],
  [33, 'AGREGADO', 'BICA CORRIDA'],
  [34, 'ADIÇÃO', 'MICROSSÍLICA DO CLIENTE (ADIÇÃO)'],
  [35, 'ADIÇÃO', 'MICROFIBRA DO CLIENTE'],
  [36, 'ADIÇÃO', 'MACROFIBRA DO CLIENTE'],
  [37, 'ADIÇÃO', 'COMPENSADOR DE RETRAÇÃO DO CLIENTE'],
  [38, 'ADITIVO', 'CRISTALIZ./IMPERM. DO CLIENTE'],
  [40, 'ADITIVO', 'ESTABILIZADOR PARA ARGAMASSA'],
  [41, 'AGREGADO', 'AREIA INDUSTRIAL'],
  [42, 'ADITIVO', 'INCORPORADOR DE AR PARA ARGAMASSA'],
  [43, 'AGREGADO', 'BRITA 1/2'],
  [44, 'ADIÇÃO', 'ISOPOR DO CLIENTE (ADIÇÃO)'],
  [45, 'AGREGADO', 'ISOPOR DO CLIENTE (AGREGADO)'],
  [46, 'ADITIVO', 'MODIFICADOR DE VISCOSIDADE'],
  [48, 'AGLOMERANTE', 'MICROSSÍLICA (AGLOMERANTE)'],
  [50, 'ADIÇÃO', 'DIÓXIDO DE FERRO DO CLIENTE'],
  [51, 'ADITIVO', 'CRISTALIZANTE/IMPERMIABILIZANTE - XYPEX'],
  [52, 'ADIÇÃO', 'FIBRA DE AÇO DO CLIENTE'],
  [53, 'AGREGADO', 'AGREGADO'],
  [54, 'ADIÇÃO', 'BETONITA'],
  [55, 'AGLOMERANTE', 'SÍLICA LÍQUIDA (AGL)'],
  [56, 'ADITIVO', 'SUPERPLASTIFICANTE RA2'],
  [57, 'ADIÇÃO', 'COMPENSADOR DE RETRAÇÃO'],
  [58, 'AGREGADO', 'ARGILA DO CLIENTE'],
  [59, 'AGREGADO', 'SOLO DO CLIENTE'],
  [60, 'ADIÇÃO', 'SÍLICA LIQUIDA (ADIÇÃO)'],
  [61, 'ADIÇÃO', 'MICROSSÍLICA (ADIÇÃO)'],
  [62, 'AGREGADO', 'AGREGADO MISTO (PÁTIO)'],
  [63, 'ADITIVO', 'SUPERPLASTIFICANTE RA2 _'],
  [64, 'AGREGADO', 'BRITA 0 (ESPECIAL)'],
  [65, 'AGREGADO', 'BRITA 1 (ESPECIAL)'],
  [66, 'AGREGADO', 'AREIA ARTIFICIAL FINA (ESPECIAL)'],
  [67, 'AGLOMERANTE', 'POZOLANA (ADIÇÃO)'],
  [68, 'AGLOMERANTE', 'CIMENTO DO CLIENTE'],
  [69, 'AGREGADO', 'AREIA NATURAL (ESPECIAL)'],
  [70, 'ADITIVO', 'POLIFUNCIONAL (EXTERNO)'],
  [71, 'ADITIVO', 'SUPERPLASTIFICANTE (EXTERNO)'],
  [72, 'ADIÇÃO', 'ISOPOR (ADIÇÃO)'],
  [73, 'ADIÇÃO', 'DIÓXIDO DE FERRO'],
  [74, 'ADIÇÃO', 'FIBRA DE AÇO'],
  [75, 'AGREGADO', 'ARGILA'],
  [76, 'AGREGADO', 'SOLO'],
  [77, 'ADITIVO', 'CRISTALIZ./IMPERM. DO CLIENTE (AGL)'],
  [78, 'ADITIVO', 'INCORPORADOR DE AR P/ CONCRETO LEVE'],
  [79, 'ADITIVO', 'FIXADOR PARA CONCRETO LEVE'],
  [80, 'ADITIVO', 'SUPERPLASTIFICANTE P/ CONCRETO LEVE'],
  [81, 'ADITIVO', 'CONTROLADOR DE TEMPERATURA'],
  [82, 'ADITIVO', 'POLIFUNCIONAL RA2'],
  [83, 'ADITIVO', 'ACELERADOR DE PEGA'],
  [84, 'AGREGADO', 'BRITA 00'],
  [90, 'ADITIVO', 'ACELERADOR DE RESISTENCIA PARA CONCRETO'],
];

const _ncdCodigoMap = new Map(
  NCD_SAP_CODIGOS.map(([cod, , grupo]) => [normalizeText(grupo), cod])
);

function _ncdCodigoMaterial(materialAlias) {
  const cod = _ncdCodigoMap.get(normalizeText(materialAlias || ''));
  return cod !== undefined ? String(cod) : '';
}

// ── Lookup de Filial (CNPJ) por central ──────────────────────────────────
// Independente do _daiFindFilial (dai.js) — este aqui casa PRIMEIRO pelo
// ALIAS, porque `row.central` nas linhas do Inventário já vem resolvido
// pra alias (ver normalizarCentral em normalize.js), nunca pelo nome
// original (origem). Fallback pra origem só por segurança.
function _ncdFindFilial(central) {
  if (!central) return null;
  const alvo = String(central).trim();
  const lista = state.filiais || [];
  return lista.find(f => (f.alias || '').trim() === alvo)
      || lista.find(f => (f.origem || '').trim() === alvo)
      || null;
}

function _ncdObterCnpjCentral(central) {
  return (_ncdFindFilial(central)?.cnpj || '').trim();
}

// ── CPF: máscara + validação (dígitos verificadores) ─────────────────────
function _ncdSomenteDigitos(v) {
  return String(v || '').replace(/\D/g, '');
}

function _ncdMaskCpf(input) {
  let d = _ncdSomenteDigitos(input.value).slice(0, 11);
  let out = d;
  if (d.length > 9) out = `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
  else if (d.length > 6) out = `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
  else if (d.length > 3) out = `${d.slice(0,3)}.${d.slice(3)}`;
  input.value = out;
}

function _ncdCpfValido(cpfDigits) {
  if (!/^\d{11}$/.test(cpfDigits)) return false;
  if (/^(\d)\1{10}$/.test(cpfDigits)) return false; // todos os dígitos iguais
  const calc = (len) => {
    let soma = 0;
    for (let i = 0; i < len; i++) soma += parseInt(cpfDigits[i], 10) * (len + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  if (calc(9) !== parseInt(cpfDigits[9], 10)) return false;
  if (calc(10) !== parseInt(cpfDigits[10], 10)) return false;
  return true;
}

// ── Formatação numérica específica do documento ──────────────────────────
// (mantém o padrão pt-BR do resto do sistema — vírgula decimal — em vez
// do formato com ponto que aparecia nas imagens de referência, que é
// inconsistente com o resto do AnalyticSys)
function _ncdNumSigned(v, decimals = 2) {
  const n = Number(v) || 0;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function _ncdMoneySigned(v) {
  const n = Number(v) || 0;
  const sign = n < 0 ? '-' : '';
  return sign + 'R$ ' + Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _ncdDataKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// ── Coleta e agrupamento das linhas ──────────────────────────────────────
// Recebe as linhas de origem (seleção do usuário, ou invFiltered se nada
// selecionado — decidido no ponto de chamada, ncdAbrirModal) e devolve os
// grupos central×tipo já prontos pra virar página no PDF, mais os
// contadores de itens ignorados (pra avisar o usuário).
function _ncdColetarGrupos(linhas, bridge) {
  const porGrupo = new Map(); // "central|||tipo" -> { central, tipo, itens: [] }
  let ignoradosSemJust = 0;
  let ignoradosIrrelevantes = 0;

  linhas.forEach(r => {
    if (r.semCadastro) return;
    if (bridge.varIrrelevante(r.varKg)) { ignoradosIrrelevantes++; return; }

    const j = bridge.justificativas[r.k] || {};
    const motivo = (j.fiscal || '').trim();
    if (!motivo) { ignoradosSemJust++; return; }

    const tipo = r.varKg > 0 ? 'credito' : 'debito';
    const key = r.central + '|||' + tipo;
    if (!porGrupo.has(key)) porGrupo.set(key, { central: r.central, tipo, itens: [] });
    porGrupo.get(key).itens.push({ row: r, motivo });
  });

  // Ordena: por central, e dentro da central crédito antes de débito —
  // garante que a numeração diária fique consecutiva (...-01 crédito,
  // ...-02 débito), igual ao padrão das imagens de referência (835/836).
  const grupos = [...porGrupo.values()].sort((a, b) => {
    const c = a.central.localeCompare(b.central, 'pt-BR');
    if (c !== 0) return c;
    return a.tipo === b.tipo ? 0 : (a.tipo === 'credito' ? -1 : 1);
  });

  return { grupos, ignoradosSemJust, ignoradosIrrelevantes };
}

// ── CNPJ: filtra os grupos cuja central não tem CNPJ cadastrado ──────────
function _ncdAplicarCnpj(grupos) {
  const validos = [];
  const centraisSemCnpj = new Set();
  grupos.forEach(g => {
    const cnpj = _ncdObterCnpjCentral(g.central);
    if (!cnpj) { centraisSemCnpj.add(g.central); return; }
    g.cnpjCentral = cnpj;
    validos.push(g);
  });
  return { grupos: validos, centraisSemCnpj: [...centraisSemCnpj] };
}

// ── Numeração ─────────────────────────────────────────────────────────────
// Sequência diária compartilhada entre crédito e débito da MESMA central,
// contando o que já existe em state.notasAjuste + o que já foi numerado
// NESTE MESMO lote (antes de persistir).
function _ncdNumerarLote(grupos) {
  const dataKey = _ncdDataKey(new Date());
  const seqPorCentral = new Map();

  grupos.forEach(g => {
    if (!seqPorCentral.has(g.central)) {
      const existentes = (state.notasAjuste || []).filter(
        n => n.central === g.central && n.dataKey === dataKey
      ).length;
      seqPorCentral.set(g.central, existentes + 1);
    }
    const seq = seqPorCentral.get(g.central);
    seqPorCentral.set(g.central, seq + 1);

    const prefixo = g.tipo === 'credito' ? 'NC' : 'ND';
    g.dataKey = dataKey;
    g.seq = seq;
    g.numero = `${prefixo}-${g.central}-${dataKey}-${String(seq).padStart(2, '0')}`;
  });

  return grupos;
}

// ── Cores por tipo ────────────────────────────────────────────────────────
const NCD_COR = {
  credito: { rgb: [15, 118, 78], claro: [232, 245, 239] },   // verde
  debito:  { rgb: [163, 39, 47], claro: [250, 233, 233] },   // vermelho
};

const NCD_DECLARACAO = 'Declaramos, para fins fiscais e contábeis, que a perda ora registrada atende aos requisitos legais de normalidade, necessidade, usualidade e comprovação, sendo dedutível na apuração do Lucro Real e da CSLL, nos termos da legislação vigente.';

const NCD_PAGE_W = 210, NCD_PAGE_H = 297;
const NCD_MARGIN_L = 18, NCD_MARGIN_R = 15;
const NCD_CONTENT_R = NCD_PAGE_W - NCD_MARGIN_R;
const NCD_CONTENT_W = NCD_CONTENT_R - NCD_MARGIN_L;

// Rótulo de seção — barra cinza clara com texto em maiúsculas, mesmo
// padrão visual das imagens de referência ("DADOS DA FILIAL / ORIGEM",
// "MATERIAIS AJUSTADOS", "JUSTIFICATIVAS / MOTIVOS DOS ITENS").
function _ncdSectionLabel(doc, texto, y) {
  doc.setFillColor(243, 243, 243);
  doc.rect(NCD_MARGIN_L, y, NCD_CONTENT_W, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 100, 100);
  doc.text(texto.toUpperCase(), NCD_MARGIN_L + 3, y + 4.8);
  return y + 7;
}

// Garante espaço vertical mínimo na página atual — se não houver,
// adiciona uma nova página e devolve o y do topo útil. Usado pelos blocos
// de conteúdo cuja altura varia (justificativas, declaração, assinatura).
function _ncdEnsureSpace(doc, y, alturaNecessaria, corTipo) {
  const limite = NCD_PAGE_H - 20; // margem inferior de segurança
  if (y + alturaNecessaria <= limite) return y;
  doc.addPage();
  _ncdDesenharContinuacao(doc, corTipo);
  return 16;
}

// Pequeno cabeçalho de continuação (páginas extras de uma mesma nota,
// quando a lista de materiais ou o texto de justificativas não cabem
// numa página só) — só a barra colorida lateral + um rótulo discreto.
function _ncdDesenharContinuacao(doc, corTipo) {
  doc.setFillColor(...corTipo.rgb);
  doc.rect(0, 0, 6, NCD_PAGE_H, 'F');
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text('(continuação)', NCD_MARGIN_L, 10);
}

// ── Cabeçalho da nota (título, nº controle, emissão, valor acumulado) ────
function _ncdDesenharCabecalho(doc, grupo, valorTotal, emissaoFmt) {
  const cor = NCD_COR[grupo.tipo];
  const titulo = grupo.tipo === 'credito' ? 'NOTA DE CRÉDITO' : 'NOTA DE DÉBITO';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.setTextColor(...cor.rgb);
  doc.text(titulo, NCD_MARGIN_L, 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(95, 95, 95);
  doc.text(`Nº CONTROLE: ${grupo.numero}`, NCD_MARGIN_L, 27);
  doc.text(`Emissão: ${emissaoFmt}`, NCD_MARGIN_L, 32.5);

  // Caixa "Valor Total Acumulado" (topo direito)
  const boxW = 58, boxH = 22, boxX = NCD_CONTENT_R - boxW, boxY = 10;
  doc.setFillColor(246, 246, 246);
  doc.roundedRect(boxX, boxY, boxW, boxH, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.text('VALOR TOTAL ACUMULADO', boxX + boxW / 2, boxY + 7, { align: 'center' });
  doc.setFontSize(14);
  doc.setTextColor(...cor.rgb);
  doc.text(_ncdMoneySigned(valorTotal), boxX + boxW / 2, boxY + 16, { align: 'center' });

  doc.setDrawColor(225, 225, 225);
  doc.setLineWidth(0.2);
  doc.line(NCD_MARGIN_L, 39, NCD_CONTENT_R, 39);

  return 44;
}

// ── Bloco "Dados da Filial / Origem" ─────────────────────────────────────
function _ncdDesenharFilial(doc, grupo, emissorEmail, y) {
  y = _ncdSectionLabel(doc, 'Dados da Filial / Origem', y);
  y += 6;

  const colW = NCD_CONTENT_W / 3;
  const campos = [
    ['Filial:', grupo.central],
    ['CNPJ:', grupo.cnpjCentral || '—'],
    ['Emissor:', emissorEmail],
  ];
  campos.forEach(([label, valor], i) => {
    const x = NCD_MARGIN_L + i * colW;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(label, x, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(30, 30, 30);
    doc.text(String(valor || '—'), x, y + 5);
  });

  return y + 12;
}

// ── Tabela de materiais (jspdf-autotable) ────────────────────────────────
function _ncdDesenharTabela(doc, grupo, y) {
  const cor = NCD_COR[grupo.tipo];
  y = _ncdSectionLabel(doc, `Materiais Ajustados (${grupo.itens.length} ${grupo.itens.length === 1 ? 'item' : 'itens'})`, y);

  const body = grupo.itens.map((it, i) => {
    const r = it.row;
    const valorTotalCell = r.custoMedio > 0 ? _ncdMoneySigned(r.custoVarBruto) : '—';
    return [
      String(i + 1),
      _ncdCodigoMaterial(r.material) || '—',
      r.material || '—',
      'KG',
      _ncdNumSigned(r.varKg),
      valorTotalCell,
    ];
  });

  doc.autoTable({
    startY: y + 2,
    margin: { left: NCD_MARGIN_L, right: NCD_MARGIN_R, top: 42 },
    head: [['#', 'Cód.', 'Descrição', 'UN', 'Qtd.', 'Valor Total']],
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: { top: 2.2, bottom: 2.2, left: 3, right: 3 },
      lineColor: [225, 225, 225],
      lineWidth: 0.2,
      textColor: [40, 40, 40],
    },
    headStyles: {
      fillColor: cor.rgb,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 9 },
      1: { halign: 'center', cellWidth: 15 },
      2: { halign: 'left' },
      3: { halign: 'center', cellWidth: 13 },
      4: { halign: 'right', cellWidth: 27 },
      5: { halign: 'right', cellWidth: 30 },
    },
    didDrawPage: (data) => {
      // Página de CONTINUAÇÃO da própria tabela (nota longa demais pra
      // caber numa página só) — desenha a barra lateral + rótulo, igual
      // ao usado pros outros blocos que podem transbordar de página.
      if (data.pageNumber > 1) _ncdDesenharContinuacao(doc, cor);
    },
  });

  return doc.lastAutoTable.finalY + 8;
}

// ── Bloco "Justificativas / Motivos dos Itens" ───────────────────────────
function _ncdDesenharJustificativas(doc, grupo, y) {
  const texto = grupo.itens
    .map((it, i) => `ITEM ${i + 1}: ${it.motivo.toUpperCase()}`)
    .join('  /  ');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const linhas = doc.splitTextToSize(texto, NCD_CONTENT_W - 10);
  const alturaTexto = linhas.length * 4;
  const alturaBox = alturaTexto + 12;

  y = _ncdEnsureSpace(doc, y, alturaBox + 10, NCD_COR[grupo.tipo]);
  y = _ncdSectionLabel(doc, 'Justificativas / Motivos dos Itens', y);

  doc.setDrawColor(230, 230, 230);
  doc.setLineWidth(0.2);
  doc.rect(NCD_MARGIN_L, y, NCD_CONTENT_W, alturaBox);

  doc.setTextColor(50, 50, 50);
  doc.text(linhas, NCD_MARGIN_L + 5, y + 7);

  return y + alturaBox + 10;
}

// ── Bloco "Declaração" + assinatura ──────────────────────────────────────
function _ncdDesenharDeclaracaoAssinatura(doc, grupo, resp, y) {
  const cor = NCD_COR[grupo.tipo];
  const centroX = NCD_PAGE_W / 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(90, 90, 90);
  const alturaDecl = 40;
  y = _ncdEnsureSpace(doc, y, alturaDecl, cor);

  doc.text('DECLARAÇÃO', centroX, y, { align: 'center' });
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(90, 90, 90);
  const linhasDecl = doc.splitTextToSize(NCD_DECLARACAO, 150);
  doc.text(linhasDecl, centroX, y, { align: 'center' });
  y += linhasDecl.length * 4 + 14;

  // Linha de assinatura
  y = _ncdEnsureSpace(doc, y, 20, cor);
  doc.setDrawColor(90, 90, 90);
  doc.setLineWidth(0.3);
  doc.line(centroX - 35, y, centroX + 35, y);
  y += 5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 30, 30);
  doc.text(resp.nome.toUpperCase(), centroX, y, { align: 'center' });
  y += 4.5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(`CPF: ${resp.cpf}`, centroX, y, { align: 'center' });

  return y + 8;
}

// ── Rodapé (aplicado numa passada final, página a página) ───────────────
function _ncdDesenharRodape(doc, corTipo, numero, paginaRel, totalRel) {
  doc.setFillColor(...corTipo.rgb);
  doc.rect(0, 0, 6, NCD_PAGE_H, 'F');

  const y = NCD_PAGE_H - 12;
  doc.setDrawColor(225, 225, 225);
  doc.setLineWidth(0.2);
  doc.line(NCD_MARGIN_L, y, NCD_CONTENT_R, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(140, 140, 140);
  doc.text('Documento gerado eletronicamente pelo sistema AnalyticSys.', NCD_MARGIN_L, y + 5);
  doc.text(`Doc ID: ${numero} - Pág ${paginaRel}/${totalRel}`, NCD_CONTENT_R, y + 5, { align: 'right' });
}

// ── Monta o PDF completo (todas as notas, um arquivo só) ─────────────────
function _ncdMontarPdf(grupos, resp) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const agora = new Date();
  const emissaoFmt = agora.toLocaleString('pt-BR');

  const paginaRanges = []; // { numero, tipo, inicio, fim }

  grupos.forEach((grupo, idx) => {
    if (idx > 0) doc.addPage();
    const paginaInicio = doc.internal.getNumberOfPages();
    const cor = NCD_COR[grupo.tipo];

    doc.setFillColor(...cor.rgb);
    doc.rect(0, 0, 6, NCD_PAGE_H, 'F');

    const valorTotal = grupo.itens.reduce((s, it) => s + (it.row.custoMedio > 0 ? it.row.custoVarBruto : 0), 0);

    let y = _ncdDesenharCabecalho(doc, grupo, valorTotal, emissaoFmt);
    y = _ncdDesenharFilial(doc, grupo, resp.email, y);
    y = _ncdDesenharTabela(doc, grupo, y);
    doc.setTextColor(0, 0, 0); // autoTable pode deixar cor de texto "suja" pro próximo bloco
    y = _ncdDesenharJustificativas(doc, grupo, y);
    _ncdDesenharDeclaracaoAssinatura(doc, grupo, resp, y);

    const paginaFim = doc.internal.getNumberOfPages();
    paginaRanges.push({ numero: grupo.numero, tipo: grupo.tipo, inicio: paginaInicio, fim: paginaFim });
    grupo.valorTotal = valorTotal;
  });

  // Passada final: rodapé + barra lateral em TODAS as páginas, com
  // numeração relativa a cada nota (Pág X/Y daquele documento, não do
  // arquivo inteiro — mesmo padrão das imagens de referência).
  const totalPaginas = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPaginas; p++) {
    doc.setPage(p);
    const range = paginaRanges.find(r => p >= r.inicio && p <= r.fim) || paginaRanges[0];
    const pagRel = p - range.inicio + 1;
    const totalRel = range.fim - range.inicio + 1;
    _ncdDesenharRodape(doc, NCD_COR[range.tipo], range.numero, pagRel, totalRel);
  }

  return doc;
}

// ── Persistência (registro leve — sem o PDF) ─────────────────────────────
function _ncdPersistirRegistros(grupos, resp) {
  if (!Array.isArray(state.notasAjuste)) state.notasAjuste = [];
  const agora = Date.now();
  const novosRegistros = [];
  grupos.forEach(g => {
    const rec = {
      id: 'ncd_' + agora + '_' + Math.random().toString(36).slice(2, 8),
      numero: g.numero,
      tipo: g.tipo,
      central: g.central,
      cnpjCentral: g.cnpjCentral,
      dataKey: g.dataKey,
      dataGeracao: agora,
      valorTotal: g.valorTotal || 0,
      responsavelNome: resp.nome,
      responsavelCpf: resp.cpf,
      responsavelEmail: resp.email,
      itens: g.itens.map(it => ({
        material: it.row.material,
        codigoSap: _ncdCodigoMaterial(it.row.material) || null,
        qtdKg: it.row.varKg,
        valorTotal: it.row.custoMedio > 0 ? it.row.custoVarBruto : null,
        motivo: it.motivo,
      })),
    };
    state.notasAjuste.push(rec);
    novosRegistros.push(rec);
  });
  persist();
  _ncdSyncToSupabase(novosRegistros);
}

// Registro é append-only (nunca editado/excluído — a numeração sequencial
// depende disso), então basta inserir os novos. Falha não bloqueia a UI
// (PDF já foi gerado e baixado antes desta chamada rodar).
function _ncdSyncToSupabase(registros) {
  if (!window.supabaseClient || !registros.length) return;
  const rows = registros.map(r => ({
    id: r.id, numero: r.numero, tipo: r.tipo, central: r.central,
    cnpj_central: r.cnpjCentral, data_key: r.dataKey, data_geracao: r.dataGeracao,
    valor_total: r.valorTotal, responsavel_nome: r.responsavelNome,
    responsavel_cpf: r.responsavelCpf, responsavel_email: r.responsavelEmail,
    itens: r.itens,
  }));
  window.supabaseClient.from('notas_ajuste').insert(rows)
    .then(({ error }) => {
      if (error) {
        console.warn('[Supabase] Falha ao sincronizar notas de crédito/débito:', error);
        toast('⚠ Nota(s) salva(s) nesta sessão, mas não foi possível sincronizar com a nuvem.', 'error');
      }
    });
}

// Busca no boot — append-only, então é só união por id (nunca há
// atualização a mesclar). Essencial pra numeração sequencial ficar
// correta entre sessões/dispositivos diferentes.
async function syncNotasAjusteFromSupabase() {
  try {
    // fetchAllRows (cursor por id) — select('*') direto tinha o mesmo risco
    // de teto de 1000 linhas já corrigido em Lançamentos/Entradas. Aqui é
    // ainda mais sensível: a numeração sequencial das notas depende de ter
    // TODOS os registros, não só os primeiros 1000.
    const data = await fetchAllRows('notas_ajuste');
    const remoto = (data || []).map(r => ({
      id: r.id, numero: r.numero, tipo: r.tipo, central: r.central,
      cnpjCentral: r.cnpj_central, dataKey: r.data_key, dataGeracao: r.data_geracao,
      valorTotal: r.valor_total, responsavelNome: r.responsavel_nome,
      responsavelCpf: r.responsavel_cpf, responsavelEmail: r.responsavel_email,
      itens: r.itens || [],
    }));
    const local = Array.isArray(state.notasAjuste) ? state.notasAjuste : [];
    const porId = new Map(local.map(n => [n.id, n]));
    remoto.forEach(n => porId.set(n.id, n));
    state.notasAjuste = [...porId.values()];

    // Corte de produção (27/07): notas geradas só local (registro é
    // append-only, então isso só cobre falha de rede na hora da geração)
    // sobem agora — reaproveita _ncdSyncToSupabase, já usada na criação.
    const idsRemotos = new Set(remoto.map(n => n.id));
    const naoSincronizadas = local.filter(n => n.id && !idsRemotos.has(n.id));
    if (naoSincronizadas.length && typeof _ncdSyncToSupabase === 'function') _ncdSyncToSupabase(naoSincronizadas);
  } catch (err) {
    console.warn('[Supabase] Falha ao buscar notas de crédito/débito — mantendo dados locais.', err);
  }
}

// ── Estado do modal (preview calculado ao abrir, reaproveitado ao gerar) ─
let _ncdPreview = null;

function ncdAbrirModal() {
  // Decisão 28/07: só o ADM pode gerar Notas de Crédito/Débito. O botão já
  // fica escondido pra quem não é admin (auth.js/updateAccountUI) e a RLS
  // de notas_ajuste bloqueia o INSERT no banco — esta guarda é só pra dar
  // uma mensagem clara caso a função seja chamada por outro caminho.
  if (window.currentUser?.role !== 'admin') {
    toast('Somente o administrador pode gerar Notas de Crédito/Débito.', 'error');
    return;
  }
  const bridge = window._invGetDadosParaNotas ? window._invGetDadosParaNotas() : null;
  if (!bridge || !bridge.invRows || !bridge.invRows.length) {
    toast('Gere o inventário antes de criar as notas.', 'error');
    return;
  }

  const fonte = bridge.selecionados.size > 0
    ? bridge.invRows.filter(r => bridge.selecionados.has(r.k))
    : bridge.invFiltered;

  if (!fonte.length) {
    toast('Nenhuma linha disponível (verifique a seleção ou os filtros ativos).', 'error');
    return;
  }

  const { grupos, ignoradosSemJust, ignoradosIrrelevantes } = _ncdColetarGrupos(fonte, bridge);
  const { grupos: gruposComCnpj, centraisSemCnpj } = _ncdAplicarCnpj(grupos);

  if (!gruposComCnpj.length) {
    const motivo = centraisSemCnpj.length
      ? `Nenhuma central com CNPJ cadastrado entre as afetadas (${centraisSemCnpj.join(', ')}).`
      : 'Nenhum item elegível — confira se as linhas têm variação relevante e justificativa Fiscal salva.';
    toast(motivo, 'error');
    return;
  }

  _ncdPreview = { grupos: gruposComCnpj, centraisSemCnpj, ignoradosSemJust, ignoradosIrrelevantes };

  const nCredito = gruposComCnpj.filter(g => g.tipo === 'credito').length;
  const nDebito = gruposComCnpj.filter(g => g.tipo === 'debito').length;
  const nCentrais = new Set(gruposComCnpj.map(g => g.central)).size;
  const nItens = gruposComCnpj.reduce((s, g) => s + g.itens.length, 0);

  const avisos = [];
  if (ignoradosSemJust) avisos.push(`${ignoradosSemJust} linha(s) sem justificativa Fiscal salva serão ignoradas.`);
  if (centraisSemCnpj.length) avisos.push(`Central(is) sem CNPJ cadastrado (não entrarão): ${centraisSemCnpj.join(', ')}.`);

  const resumoEl = document.getElementById('ncd-resumo-preview');
  if (resumoEl) {
    resumoEl.innerHTML = `
      <strong>${nCentrais}</strong> central(is) · <strong>${nCredito}</strong> nota(s) de crédito ·
      <strong>${nDebito}</strong> nota(s) de débito · <strong>${nItens}</strong> item(ns) no total.
      ${avisos.length ? '<div style="margin-top:8px;color:var(--amber)">' + avisos.map(a => `<div><i class="ti ti-alert-triangle"></i> ${escapeHtml(a)}</div>`).join('') + '</div>' : ''}
    `;
  }

  const form = document.getElementById('ncd-form-nome');
  if (form) {
    document.getElementById('ncd-form-nome').value = '';
    document.getElementById('ncd-form-cpf').value = '';
    document.getElementById('ncd-form-email').value = '';
  }

  openModal('ncd-modal');
}

async function ncdGerarPdf() {
  if (!_ncdPreview || !_ncdPreview.grupos.length) {
    toast('Nada para gerar — feche e abra o modal novamente.', 'error');
    return;
  }

  const nome = (document.getElementById('ncd-form-nome')?.value || '').trim();
  const cpfDigits = _ncdSomenteDigitos(document.getElementById('ncd-form-cpf')?.value);
  const email = (document.getElementById('ncd-form-email')?.value || '').trim();

  if (!nome) return toast('Informe o nome do responsável.', 'error');
  if (!_ncdCpfValido(cpfDigits)) return toast('CPF inválido — confira os dígitos informados.', 'error');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('E-mail inválido.', 'error');

  const cpfFmt = `${cpfDigits.slice(0,3)}.${cpfDigits.slice(3,6)}.${cpfDigits.slice(6,9)}-${cpfDigits.slice(9)}`;
  const resp = { nome, cpf: cpfFmt, email };

  const btn = document.getElementById('ncd-btn-gerar');
  if (btn?.disabled) return;
  if (typeof _setBtnLoading === 'function') _setBtnLoading(btn, true, 'Gerando...');

  try {
    const grupos = _ncdNumerarLote(_ncdPreview.grupos);
    const doc = _ncdMontarPdf(grupos, resp);

    const stamp = _ncdDataKey(new Date()) + '_' + String(Date.now()).slice(-6);
    doc.save(`Notas_Credito_Debito_${stamp}.pdf`);

    _ncdPersistirRegistros(grupos, resp);

    closeModal('ncd-modal');
    toast(`${grupos.length} nota(s) geradas com sucesso.`, 'success');
    _ncdPreview = null;
  } catch (err) {
    console.error('[NCD] Falha ao gerar o PDF:', err);
    toast('Falha ao gerar o PDF. Veja o console para detalhes.', 'error');
  } finally {
    if (typeof _setBtnLoading === 'function') _setBtnLoading(btn, false);
  }
}

Object.assign(window, {
  ncdAbrirModal,
  ncdGerarPdf,
  _ncdMaskCpf,
});
