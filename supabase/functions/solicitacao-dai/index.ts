// ═══════════════════════════════════════════════════════════════════════
// solicitacao-dai — Edge Function do formulário público (solicitacao.html)
// ═══════════════════════════════════════════════════════════════════════
// ponytail: o slug continua "solicitacao-dai" só pra não mexer na URL já
// publicada — desde 13/11/2026 esta função NÃO gera mais DAI. Cada envio
// vira registros em public.solicitacoes (um por categoria de material,
// atribuído ao analista da categoria), tratados na tela Solicitações do
// app. Renomear = deploy com slug novo + trocar FUNCTION_URL no front.
//
// Ações (POST { action }):
//   catalogo — centrais, grupos de material por categoria, fornecedores de
//              agregados (publicados das Entradas do ADM) e fatores M3→KG
//              do ADM (pra pré-visualizar a cubagem no formulário).
//   submit   — Turnstile + rate limit por IP + validação estrita de tudo
//              (nada do cliente é confiado: catálogo conferido, cálculos
//              refeitos aqui), sobe as assinaturas pro Storage e grava.
//
// Segurança: sem SQL cru (só supabase-js), Service Role nunca sai daqui,
// verify_jwt=false de propósito (o Turnstile é o gate), toda string tem
// teto de tamanho.
// ═══════════════════════════════════════════════════════════════════════

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TURNSTILE_SECRET_KEY = Deno.env.get('TURNSTILE_SECRET_KEY') || '';
const BUCKET = 'solicitacoes-anexos';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

const LIMITES = {
  central: 200,
  grupoMaterial: 150,
  fornecedor: 200,
  nf: 30,
  descricao: 2000,
  nome: 150,
  contato: 100,
  pesoMax: 1_000_000,
  medidaMax: 100,      // metros (comprimento/largura/altura)
  valoresMax: 20,      // pesagens por item
  furosMax: 9,         // furos na caçamba por item
  anexosMax: 10,
  anexoNomeMax: 200,
  itensMax: 10,
  informantesMax: 10,
  assinaturaMaxChars: 400_000, // data URL base64 (~300 KB)
};
const RATE_LIMIT_JANELA_MIN = 10;
const RATE_LIMIT_MAX_ENVIOS = 5;

const CATEGORIAS_FIXAS = ['Aglomerante', 'Agregado Graúdo', 'Agregado Miúdo', 'Aditivo', 'Adição'];
const CATEGORIAS_AGREGADO = ['Agregado Graúdo', 'Agregado Miúdo'];
const CARGOS_VALIDOS = ['Operador', 'Regional', 'Líder Técnico'];

const CATEGORIA_TRANSFERENCIA = 'Transferência de material entre filiais';
const CATEGORIA_CANTO = 'Teste de canto';
const CATEGORIA_CUBAGEM = 'Cubagem de agregados';
const CATEGORIAS_SITUACAO_VALIDAS = [
  CATEGORIA_CANTO,
  CATEGORIA_CUBAGEM,
  'Perda de material devido a contaminação',
  'Perda de material por motivos climáticos ou de terreno',
  'Coleta de material contaminado',
  'Coleta de material para substituição',
  'Pesagem manual (fora da automação)',
  CATEGORIA_TRANSFERENCIA,
];

const UNIDADES_CANTO = ['kg', 'L'];
const CANTOS_UNICO_CATEGORIAS = ['Aditivo', 'Adição'];
const UNIDADES_NF = ['M3', 'TO', 'KG'];

function normText(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toUpperCase();
}

function isStr(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}

function numOk(v: unknown, max: number): number | null {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n <= max ? n : null;
}

// "Hoje" no fuso de Brasília (o servidor roda em UTC).
function hojeBR(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function dataOk(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !isNaN(d.getTime()) && v <= hojeBR();
}

// ── Fator M3→KG (mesma regra de _lookupFatorConversao, ui.js) ──────────
// ponytail: cópia da regra do app (e de solicitacao.js) — se a regra de
// casamento mudar lá, mudar aqui também.
type Fator = { grupo: string; fornecedor: string; fator: number };
function lookupFatorM3(fatores: Fator[], material: string, fornecedor: string): Fator | null {
  const m = normText(material);
  const f = normText(fornecedor);
  const cand = fatores.filter((r) => r.grupo && m.includes(normText(r.grupo)));
  if (!cand.length) return null;
  const esp = f ? cand.filter((r) => r.fornecedor && f.includes(normText(r.fornecedor))) : [];
  const pool = esp.length ? esp : cand.filter((r) => !r.fornecedor);
  if (!pool.length) return null;
  return [...pool].sort((a, b) => b.grupo.length - a.grupo.length)[0];
}

// ── Turnstile ────────────────────────────────────────────────────────
async function verificarTurnstile(token: unknown, ip: string): Promise<boolean> {
  if (!TURNSTILE_SECRET_KEY) {
    console.error('[solicitacao] TURNSTILE_SECRET_KEY não configurada — recusando envio.');
    return false;
  }
  if (!isStr(token, 4000)) return false;
  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: token as string, remoteip: ip }),
    });
    const data = await resp.json();
    return data?.success === true;
  } catch (err) {
    console.error('[solicitacao] Falha ao verificar Turnstile:', err);
    return false;
  }
}

// ── Rate limit por IP ─────────────────────────────────────────────────
async function checarRateLimit(ip: string): Promise<boolean> {
  const desde = new Date(Date.now() - RATE_LIMIT_JANELA_MIN * 60 * 1000).toISOString();
  const { count, error } = await admin
    .from('solicitacoes_rate_limit')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('created_at', desde);
  if (error) {
    console.error('[solicitacao] Falha ao checar rate limit:', error);
    return false;
  }
  return (count ?? 0) < RATE_LIMIT_MAX_ENVIOS;
}

async function registrarTentativa(ip: string) {
  await admin.from('solicitacoes_rate_limit').insert({ ip });
}

// ── ADM (dono do catálogo) ────────────────────────────────────────────
let _adminIdCache: string | null = null;
async function obterAdminId(): Promise<string | null> {
  if (_adminIdCache) return _adminIdCache;
  const { data, error } = await admin.from('profiles').select('id').eq('role', 'admin').limit(1).maybeSingle();
  if (error || !data) return null;
  _adminIdCache = data.id;
  return data.id;
}

// Fatores M3→KG por categoria de agregado: os do analista da categoria
// primeiro, depois os do ADM (Configurações → Fatores de Conversão de
// cada um). lookupFatorM3 usa sort estável, então num empate de
// especificidade vence o do analista.
async function carregarFatoresPorCategoria(adminId: string): Promise<Record<string, Fator[]>> {
  const { data: mapa } = await admin.from('analistas_categoria')
    .select('categoria, analista_user_id').in('categoria', CATEGORIAS_AGREGADO);
  const ids = [...new Set([...(mapa || []).map((m) => m.analista_user_id as string), adminId])];
  const { data, error } = await admin.from('fatores_conversao')
    .select('user_id, grupo, fornecedor, fator, um_origem, um_destino')
    .in('user_id', ids);
  if (error) console.error('[solicitacao] Falha ao carregar fatores:', error);
  const validos = (data || []).filter((r) => r.um_origem === 'M3' && (r.um_destino || 'KG') === 'KG' && Number(r.fator) > 0);
  const out: Record<string, Fator[]> = {};
  for (const cat of CATEGORIAS_AGREGADO) {
    const analista = (mapa || []).find((m) => m.categoria === cat)?.analista_user_id as string | undefined;
    const ordem = [...new Set([analista, adminId].filter(Boolean) as string[])];
    out[cat] = ordem.flatMap((uid) => validos.filter((r) => r.user_id === uid)
      .map((r) => ({ grupo: String(r.grupo || ''), fornecedor: String(r.fornecedor || ''), fator: Number(r.fator) })));
  }
  return out;
}

// Quem entregou qual material em qual central (publicado pelo ADM a partir
// das Entradas — ver solPublicarFornecedores). Paginado: o PostgREST
// devolve no máximo 1000 linhas por chamada.
type Entrega = { f: string; c: string; m: string };
async function carregarEntregas(): Promise<Entrega[]> {
  const out: Entrega[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await admin.from('solicitacao_entregas')
      .select('fornecedor, central, material').order('fornecedor').range(de, de + 999);
    if (error) { console.error('[solicitacao] Falha ao carregar entregas:', error); return out; }
    (data || []).forEach((r) => out.push({ f: r.fornecedor as string, c: r.central as string, m: r.material as string }));
    if (!data || data.length < 1000) return out;
  }
}

const nomesFornecedores = (entregas: Entrega[]) =>
  [...new Set(entregas.map((e) => e.f))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

// ── Ação: catálogo ────────────────────────────────────────────────────
async function acaoCatalogo() {
  const adminId = await obterAdminId();
  if (!adminId) return json({ error: 'Catálogo indisponível no momento.' }, 503);

  const [filiaisRes, materiaisRes, entregas, fatoresPorCategoria] = await Promise.all([
    admin.from('filiais').select('origem, alias').eq('user_id', adminId),
    admin.from('materiais').select('alias, categoria').eq('user_id', adminId),
    carregarEntregas(),
    carregarFatoresPorCategoria(adminId),
  ]);
  if (filiaisRes.error || materiaisRes.error) {
    console.error('[solicitacao] Falha ao carregar catálogo:', filiaisRes.error || materiaisRes.error);
    return json({ error: 'Falha ao carregar catálogo.' }, 500);
  }

  const centraisVistas = new Map<string, string>();
  (filiaisRes.data || []).forEach((f) => {
    const nome = (f.origem || f.alias || '').trim();
    if (!nome) return;
    const key = normText(nome);
    if (!centraisVistas.has(key)) centraisVistas.set(key, nome);
  });
  const centrais = [...centraisVistas.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const materiaisPorCategoria: Record<string, string[]> = {};
  CATEGORIAS_FIXAS.forEach((c) => (materiaisPorCategoria[c] = []));
  const gruposVistos = new Set<string>();
  (materiaisRes.data || []).forEach((m) => {
    const grupo = (m.alias || '').trim();
    const categoria = CATEGORIAS_FIXAS.includes(m.categoria) ? m.categoria : '';
    if (!grupo || !categoria) return;
    const key = categoria + '|' + normText(grupo);
    if (gruposVistos.has(key)) return;
    gruposVistos.add(key);
    materiaisPorCategoria[categoria].push(grupo);
  });
  CATEGORIAS_FIXAS.forEach((c) => materiaisPorCategoria[c].sort((a, b) => a.localeCompare(b, 'pt-BR')));

  return json({ centrais, materiaisPorCategoria, fornecedores: nomesFornecedores(entregas), entregas, fatoresPorCategoria });
}

// ── Assinaturas (data URL PNG → Storage) ──────────────────────────────
function decodeAssinatura(v: unknown): Uint8Array | null {
  if (typeof v !== 'string' || v.length > LIMITES.assinaturaMaxChars) return null;
  const m = v.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  try {
    const bin = atob(m[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // Assinatura de verdade tem traço — PNG minúsculo = quadro em branco.
    return bytes.length >= 200 ? bytes : null;
  } catch {
    return null;
  }
}

// ── Ação: submit ─────────────────────────────────────────────────────
async function acaoSubmit(payload: Record<string, unknown>, ip: string) {
  const turnstileOk = await verificarTurnstile(payload.turnstileToken, ip);
  if (!turnstileOk) return json({ error: 'Verificação de segurança falhou. Recarregue a página e tente novamente.' }, 403);

  const dentroDoLimite = await checarRateLimit(ip);
  await registrarTentativa(ip);
  if (!dentroDoLimite) return json({ error: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.' }, 429);

  const central = String(payload.central ?? '').trim();
  const dataOcorrido = String(payload.dataOcorrido ?? '').trim();
  const categoriaSituacao = String(payload.categoriaSituacao ?? '').trim();
  const filialDestino = String(payload.filialDestino ?? '').trim();
  const descricao = String(payload.descricao ?? '').trim();
  const semComprovante = payload.semComprovante === true;
  const itensIn = Array.isArray(payload.itens) ? payload.itens : [];
  const informantesIn = Array.isArray(payload.informantes) ? payload.informantes : [];
  const anexosIn = Array.isArray(payload.anexos) ? payload.anexos : [];

  const erros: string[] = [];
  if (!isStr(central, LIMITES.central)) erros.push('Central inválida.');
  // Cubagem não pede descrição (os dados da carreta já dizem tudo).
  if (descricao.length > LIMITES.descricao) erros.push('Descrição muito longa.');
  else if (!descricao && categoriaSituacao !== CATEGORIA_CUBAGEM) erros.push('Descrição do ocorrido é obrigatória.');
  if (!CATEGORIAS_SITUACAO_VALIDAS.includes(categoriaSituacao)) erros.push('Categoria de situação inválida.');
  if (categoriaSituacao === CATEGORIA_TRANSFERENCIA) {
    if (!isStr(filialDestino, LIMITES.central)) erros.push('Filial de destino é obrigatória para transferência entre filiais.');
    else if (normText(filialDestino) === normText(central)) erros.push('A filial de destino não pode ser igual à central de origem.');
  }
  if (anexosIn.length > LIMITES.anexosMax) erros.push(`Máximo de ${LIMITES.anexosMax} anexos por registro.`);
  if (!anexosIn.length && !semComprovante) erros.push('Sem anexos, é preciso confirmar a declaração de ausência de comprovante.');

  const doisAnosAtras = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (!dataOk(dataOcorrido)) erros.push('Data do ocorrido inválida ou no futuro.');
  else if (dataOcorrido < doisAnosAtras) erros.push('Data do ocorrido muito antiga — contate o administrador.');

  if (!itensIn.length) erros.push('Adicione ao menos um item.');
  if (itensIn.length > LIMITES.itensMax) erros.push(`Máximo de ${LIMITES.itensMax} itens por registro.`);

  // Informantes + assinaturas
  if (!informantesIn.length) erros.push('Informe ao menos um informante.');
  if (informantesIn.length > LIMITES.informantesMax) erros.push(`Máximo de ${LIMITES.informantesMax} informantes por registro.`);
  const informantesParsed: { nome: string; cargo: string; contato: string; png: Uint8Array }[] = [];
  for (const raw of informantesIn) {
    if (!raw || typeof raw !== 'object') { erros.push('Informante inválido.'); break; }
    const rec = raw as Record<string, unknown>;
    const nome = String(rec.nome ?? '').trim();
    const cargo = String(rec.cargo ?? '').trim();
    const contato = String(rec.contato ?? '').trim();
    if (!isStr(nome, LIMITES.nome)) { erros.push('Nome do informante é obrigatório.'); break; }
    if (!CARGOS_VALIDOS.includes(cargo)) { erros.push(`Cargo inválido para "${nome}".`); break; }
    if (contato.length > LIMITES.contato) { erros.push('Contato muito longo.'); break; }
    const png = decodeAssinatura(rec.assinatura);
    if (!png) { erros.push(`Assinatura ausente ou inválida para "${nome}".`); break; }
    informantesParsed.push({ nome, cargo, contato, png });
  }

  const anexos: { nome: string; tipo: string; tamanho: number; path: string }[] = [];
  for (const a of anexosIn) {
    if (!a || typeof a !== 'object') { erros.push('Anexo inválido.'); break; }
    const rec = a as Record<string, unknown>;
    const path = String(rec.path ?? '');
    if (!path.startsWith('publico/') || path.includes('..') || path.length > 400) { erros.push('Anexo com caminho inválido.'); break; }
    anexos.push({
      nome: String(rec.nome ?? '').slice(0, LIMITES.anexoNomeMax) || 'anexo',
      tipo: String(rec.tipo ?? '').slice(0, 100),
      tamanho: Number.isFinite(Number(rec.tamanho)) ? Number(rec.tamanho) : 0,
      path,
    });
  }

  if (erros.length) return json({ error: erros[0], erros }, 400);

  // Catálogo real do ADM
  const adminId = await obterAdminId();
  if (!adminId) return json({ error: 'Configuração do sistema incompleta — contate o administrador.' }, 503);

  const [filiaisRes, materiaisRes] = await Promise.all([
    admin.from('filiais').select('origem, alias, cnpj, regional').eq('user_id', adminId),
    admin.from('materiais').select('alias, categoria').eq('user_id', adminId),
  ]);
  if (filiaisRes.error || materiaisRes.error) return json({ error: 'Falha ao validar catálogo.' }, 500);

  const filial = (filiaisRes.data || []).find((f) => normText(f.origem || f.alias) === normText(central));
  if (!filial) return json({ error: 'Central não reconhecida. Selecione uma opção da lista.' }, 400);

  let filialDestinoValidada = '';
  if (categoriaSituacao === CATEGORIA_TRANSFERENCIA) {
    const dest = (filiaisRes.data || []).find((f) => normText(f.origem || f.alias) === normText(filialDestino));
    if (!dest) return json({ error: 'Filial de destino não reconhecida. Selecione uma opção da lista.' }, 400);
    filialDestinoValidada = dest.origem || dest.alias;
  }

  const categoriaDoGrupo = (grupo: string): string | null => {
    const cad = (materiaisRes.data || []).find((m) => normText(m.alias) === normText(grupo) && CATEGORIAS_FIXAS.includes(m.categoria));
    return cad ? (cad.categoria as string) : null;
  };

  // Itens — cada um sai com `categoria` (pra divisão por analista) e os
  // dados já recalculados aqui.
  const itens: (Record<string, unknown> & { categoria: string })[] = [];

  if (categoriaSituacao === CATEGORIA_CANTO) {
    for (const raw of itensIn) {
      const rec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const categoriaMaterial = String(rec.categoriaMaterial ?? '').trim();
      const unidade = String(rec.unidade ?? '').trim();
      const referencia = numOk(rec.referencia, LIMITES.pesoMax);
      const cantos = (Array.isArray(rec.cantos) ? rec.cantos : []).map((c) => parseFloat(String(c)));
      if (!CATEGORIAS_FIXAS.includes(categoriaMaterial)) return json({ error: 'Categoria de material inválida em um dos testes.' }, 400);
      if (!UNIDADES_CANTO.includes(unidade)) return json({ error: 'Unidade inválida em um dos testes.' }, 400);
      if (referencia === null) return json({ error: `Peso/volume de referência inválido para "${categoriaMaterial}".` }, 400);
      if (cantos.length < 1 || cantos.length > 4) return json({ error: `Quantidade de cantos inválida para "${categoriaMaterial}".` }, 400);
      if (CANTOS_UNICO_CATEGORIAS.includes(categoriaMaterial) && cantos.length !== 1) return json({ error: `"${categoriaMaterial}" deve usar sempre 1 canto.` }, 400);
      if (cantos.some((c) => !Number.isFinite(c) || c < 0 || c > LIMITES.pesoMax)) return json({ error: `Leitura de canto inválida para "${categoriaMaterial}".` }, 400);
      const media = cantos.reduce((a, b) => a + b, 0) / cantos.length;
      const variacaoAbs = media - referencia;
      itens.push({
        tipo: 'teste_canto', categoria: categoriaMaterial, categoriaMaterial, unidade, referencia, cantos,
        media, variacaoAbs, variacaoPct: (variacaoAbs / referencia) * 100,
      });
    }
  } else if (categoriaSituacao === CATEGORIA_CUBAGEM) {
    // Valida só que o fornecedor existe (qualquer central/material): o
    // formulário mostra todos quando a combinação ainda não tem entrega.
    const [entregas, fatoresPorCategoria] = await Promise.all([carregarEntregas(), carregarFatoresPorCategoria(adminId)]);
    const fornecedoresCad = nomesFornecedores(entregas);
    for (const raw of itensIn) {
      const rec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const grupoMaterial = String(rec.grupoMaterial ?? '').trim();
      const fornecedorIn = String(rec.fornecedor ?? '').trim();
      const nf = String(rec.nf ?? '').trim();
      const docTipo = rec.docTipo === 'TICKET' ? 'TICKET' : 'NF'; // NF ou ticket de pesagem
      const dataEmissao = String(rec.dataEmissao ?? '').trim();
      const dataRecebimento = String(rec.dataRecebimento ?? '').trim();
      const pesoNf = numOk(rec.pesoNf, LIMITES.pesoMax);
      const umNf = String(rec.umNf ?? '').trim();
      const metodo = String(rec.metodo ?? '').trim();

      if (!isStr(grupoMaterial, LIMITES.grupoMaterial)) return json({ error: 'Material inválido em uma das cubagens.' }, 400);
      const categoria = categoriaDoGrupo(grupoMaterial);
      if (!categoria || !CATEGORIAS_AGREGADO.includes(categoria)) return json({ error: `"${grupoMaterial}" não é um agregado cadastrado.` }, 400);
      const fornecedor = fornecedoresCad.find((f) => normText(f) === normText(fornecedorIn));
      if (!fornecedor) return json({ error: `Fornecedor "${fornecedorIn}" não reconhecido. Selecione uma opção da lista.` }, 400);
      if (!isStr(nf, LIMITES.nf)) return json({ error: `Número da NF inválido para "${grupoMaterial}".` }, 400);
      if (!dataOk(dataEmissao)) return json({ error: `Data de emissão da NF inválida para "${grupoMaterial}".` }, 400);
      if (!dataOk(dataRecebimento)) return json({ error: `Data de recebimento inválida para "${grupoMaterial}".` }, 400);
      if (dataRecebimento < dataEmissao) return json({ error: `O recebimento não pode ser antes da emissão da NF (${nf}).` }, 400);
      if (pesoNf === null) return json({ error: `Peso da NF inválido para "${grupoMaterial}".` }, 400);
      if (!UNIDADES_NF.includes(umNf)) return json({ error: `Unidade da NF inválida para "${grupoMaterial}".` }, 400);

      let pesagens: number[] | null = null;
      let comprimento: number | null = null, largura: number | null = null, alturas: number[] | null = null;
      let cones: { raio: number; altura: number }[] | null = null;
      if (metodo === 'cone') {
        const arr = Array.isArray(rec.cones) ? rec.cones : [];
        const parsed = arr.map((c) => {
          const o = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
          return { raio: numOk(o.raio, LIMITES.medidaMax), altura: numOk(o.altura, LIMITES.medidaMax) };
        });
        if (!parsed.length || parsed.length > LIMITES.valoresMax || parsed.some((c) => c.raio === null || c.altura === null)) return json({ error: `Raio/altura dos cones inválidos para a NF ${nf}.` }, 400);
        cones = parsed as { raio: number; altura: number }[];
      } else if (metodo === 'pesagem') {
        const arr = Array.isArray(rec.pesagens) ? rec.pesagens : [];
        pesagens = arr.map((v) => numOk(v, LIMITES.pesoMax)) as number[];
        if (!pesagens.length || pesagens.length > LIMITES.valoresMax || pesagens.some((v) => v === null)) return json({ error: `Pesagens inválidas para a NF ${nf}.` }, 400);
      } else if (metodo === 'volume') {
        comprimento = numOk(rec.comprimento, LIMITES.medidaMax);
        largura = numOk(rec.largura, LIMITES.medidaMax);
        const arr = Array.isArray(rec.alturas) ? rec.alturas : [];
        alturas = arr.map((v) => numOk(v, LIMITES.medidaMax)) as number[];
        if (comprimento === null || largura === null) return json({ error: `Comprimento/largura da caçamba inválidos para a NF ${nf}.` }, 400);
        if (!alturas.length || alturas.length > LIMITES.furosMax || alturas.some((v) => v === null)) return json({ error: `Alturas dos furos inválidas para a NF ${nf}.` }, 400);
      } else {
        return json({ error: `Método de cubagem inválido para a NF ${nf}.` }, 400);
      }

      // Tudo convertido pra KG. M3 depende do fator de densidade do ADM
      // (por material + fornecedor); sem fator, fica null e o analista
      // converte — nunca se inventa densidade.
      const fatorRow = lookupFatorM3(fatoresPorCategoria[categoria] || [], grupoMaterial, fornecedor);
      const fator = fatorRow ? fatorRow.fator : null;
      const nfKg = umNf === 'KG' ? pesoNf : umNf === 'TO' ? pesoNf * 1000 : (fator ? pesoNf * fator : null);
      const volumeM3 = metodo === 'volume' ? comprimento! * largura! * (alturas!.reduce((a, b) => a + b, 0) / alturas!.length)
        : metodo === 'cone' ? cones!.reduce((a, c) => a + Math.PI * c.raio ** 2 * c.altura / 3, 0) // π r² h ÷ 3 por cone
        : null;
      const aferidoKg = metodo === 'pesagem' ? pesagens!.reduce((a, b) => a + b, 0) : (fator ? volumeM3! * fator : null);
      const variacaoKg = nfKg !== null && aferidoKg !== null ? aferidoKg - nfKg : null;

      itens.push({
        tipo: 'cubagem', categoria, grupoMaterial, fornecedor, docTipo, nf, dataEmissao, dataRecebimento,
        pesoNf, umNf, metodo, pesagens, comprimento, largura, alturas, cones,
        fator, volumeM3, nfKg, aferidoKg, variacaoKg,
        variacaoPct: variacaoKg !== null && nfKg ? (variacaoKg / nfKg) * 100 : null,
      });
    }
  } else {
    for (const raw of itensIn) {
      const rec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const grupoMaterial = String(rec.grupoMaterial ?? '').trim();
      const peso = numOk(rec.peso, LIMITES.pesoMax);
      if (!isStr(grupoMaterial, LIMITES.grupoMaterial)) return json({ error: 'Material inválido em um dos itens.' }, 400);
      const categoria = categoriaDoGrupo(grupoMaterial);
      if (!categoria) return json({ error: `Material "${grupoMaterial}" não reconhecido. Selecione uma opção da lista.` }, 400);
      if (peso === null) return json({ error: `Peso inválido para "${grupoMaterial}".` }, 400);
      itens.push({ tipo: 'material', categoria, grupoMaterial, peso });
    }
  }

  // Analista de cada categoria ANTES de gravar qualquer coisa.
  const categorias = [...new Set(itens.map((i) => i.categoria))];
  const analistas = new Map<string, { id: string; nome: string }>();
  for (const categoria of categorias) {
    const { data: mapa, error } = await admin.from('analistas_categoria')
      .select('analista_user_id, analista_nome').eq('categoria', categoria).maybeSingle();
    if (error || !mapa) return json({ error: `Nenhum analista configurado para a categoria "${categoria}" — contate o administrador.` }, 409);
    analistas.set(categoria, { id: mapa.analista_user_id as string, nome: mapa.analista_nome as string });
  }

  // Protocolo do envio — comum a todos os registros gerados.
  const protocolo = `SOL-${hojeBR().replace(/-/g, '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

  // Assinaturas → Storage (Service Role; o público nunca lê o bucket).
  const informantes: { nome: string; cargo: string; contato: string; assinatura: string }[] = [];
  for (let i = 0; i < informantesParsed.length; i++) {
    const inf = informantesParsed[i];
    const path = `publico/assinaturas/${protocolo}/${i + 1}.png`;
    const { error } = await admin.storage.from(BUCKET).upload(path, inf.png, { contentType: 'image/png', upsert: false });
    if (error) {
      console.error('[solicitacao] Falha ao gravar assinatura:', error);
      return json({ error: 'Falha ao gravar as assinaturas. Tente novamente.' }, 500);
    }
    informantes.push({ nome: inf.nome, cargo: inf.cargo, contato: inf.contato, assinatura: path });
  }

  const rows = categorias.map((categoria) => ({
    protocolo,
    user_id: analistas.get(categoria)!.id,
    analista_nome: analistas.get(categoria)!.nome,
    categoria,
    central: filial.origem || filial.alias,
    cnpj_central: filial.cnpj || null,
    regional_central: filial.regional || null,
    data_ocorrido: dataOcorrido,
    categoria_situacao: categoriaSituacao,
    filial_destino: filialDestinoValidada || null,
    descricao,
    itens: itens.filter((i) => i.categoria === categoria),
    informantes,
    anexos,
    sem_comprovante: !anexos.length,
  }));

  const { error: insertErr } = await admin.from('solicitacoes').insert(rows);
  if (insertErr) {
    console.error('[solicitacao] Falha ao inserir solicitação:', insertErr);
    return json({ error: 'Falha ao gravar o registro. Tente novamente em instantes.' }, 500);
  }

  return json({ ok: true, protocolo });
}

// ── Handler ───────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Método não suportado.' }, 405);

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'desconhecido';

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'JSON inválido.' }, 400);
  }

  try {
    if (payload.action === 'catalogo') return await acaoCatalogo();
    if (payload.action === 'submit') return await acaoSubmit(payload, ip);
    return json({ error: 'Ação desconhecida.' }, 400);
  } catch (err) {
    console.error('[solicitacao] Erro inesperado:', err);
    return json({ error: 'Erro interno. Tente novamente.' }, 500);
  }
});
