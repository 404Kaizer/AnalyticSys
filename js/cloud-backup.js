'use strict';

// ═══════════════════════════════════════════════════════════════════════
// BACKUP CONDENSADO NA NUVEM (27/07)
// ═══════════════════════════════════════════════════════════════════════
// Cobre a lacuna dos 5 módulos grandes (Entradas/Saídas/Lançamentos/
// Produção/SAP): por decisão de 27/07, só o que é digitado/editado
// manualmente sincroniza linha a linha com o Supabase — o volume
// importado em lote (a esmagadora maioria do dado real) fica só no
// IndexedDB local. Se o dispositivo quebrar/for perdido/tiver o
// navegador limpo, esse volume não tem nenhuma cópia de recuperação
// além do Excel original (se ainda existir em algum lugar).
//
// Esta camada resolve isso SEM sincronizar linha a linha (inviável: são
// centenas de milhares de registros, e o teto do banco Postgres no
// plano gratuito é 500MB). Em vez disso: pega o array local de cada
// módulo, comprime (gzip nativo do navegador) e sobe como ARQUIVO pro
// Supabase Storage — que tem cota própria de 1GB, separada do banco.
//
// PRINCÍPIOS DE SEGURANÇA (dado real de produção, "nunca corromper"):
//   1. Nenhuma compactação de campos antes de comprimir — o registro
//      sobe INTEIRO, do jeito que está em memória. Rejeitamos de
//      propósito a ideia de manter uma lista de "campos essenciais"
//      (foi exatamente isso — um campo faltando nessa lista — que
//      causou o bug de duplicação do SAP nesta mesma data).
//   2. Autoteste OBRIGATÓRIO antes de subir: comprime, descomprime na
//      hora, compara byte a byte com o original. Se não bater, aborta
//      o módulo inteiro sem subir nada.
//   3. Checksum (SHA-256) de cada chunk, gravado no manifest. Na
//      restauração, todo chunk é conferido de novo contra esse hash —
//      qualquer divergência aborta a restauração inteira (dado
//      incompleto/suspeito é sempre pior que nenhum dado extra).
//   4. Manifest gravado por ÚLTIMO, só depois de todos os chunks
//      confirmados na nuvem — mesmo padrão já usado no chunking local
//      do SAP (saveSapChunks, persist.js). Uma falha no meio do
//      caminho nunca deixa o manifest apontando pra um backup parcial.
//   5. Só ESCREVE por cima de dados vazios/ausentes — nunca sobrescreve
//      dado local já existente. Restauração roda apenas quando o
//      módulo está vazio localmente (dispositivo novo ou IndexedDB
//      limpo), nunca como merge do dia a dia.
// ═══════════════════════════════════════════════════════════════════════

const CLOUD_BACKUP_BUCKET = 'backups-condensados';
const CLOUD_BACKUP_CHUNK_SIZE = 20000; // registros por chunk comprimido
const CLOUD_BACKUP_VERSION = 1;
const CLOUD_BACKUP_MODULOS = ['entradas', 'saidas', 'lancamentos', 'producao', 'sap'];

// Throttle do reforço periódico — não repete o backup do mesmo módulo em
// menos desse intervalo, mesmo que o timer de checagem rode com mais
// frequência (ver cloudBackupPeriodicoInit). Reseta a cada boot (é só um
// "não repita à toa nesta sessão", não uma trava persistida — o backup
// pós-importação e o de outra sessão/aba já cobrem o resto).
const CLOUD_BACKUP_PERIODIC_CHECK_MS = 30 * 60 * 1000;      // confere a cada 30min
const CLOUD_BACKUP_PERIODIC_MIN_INTERVAL_MS = 3 * 60 * 60 * 1000; // mínimo 3h entre backups do mesmo módulo

let _cbLastBackupAt = {};        // { entradas: timestamp, ... } — só desta sessão
let _cbUploadEmAndamento = new Set(); // evita duas execuções concorrentes do mesmo módulo
let _cbPeriodicTimer = null;

function _cbSuportado() {
  return typeof CompressionStream !== 'undefined'
    && typeof DecompressionStream !== 'undefined'
    && typeof crypto?.subtle?.digest === 'function';
}

// ── Compressão / checksum (funções puras, sem efeito colateral) ─────────

async function _cbSha256Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function _cbGzipString(str) {
  const bytes = new TextEncoder().encode(str);
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const buffer = await new Response(cs.readable).arrayBuffer();
  return new Blob([buffer], { type: 'application/gzip' });
}

async function _cbGunzipBlob(blob) {
  const ds = new DecompressionStream('gzip');
  const stream = blob.stream().pipeThrough(ds);
  const buffer = await new Response(stream).arrayBuffer();
  return new TextDecoder().decode(buffer);
}

// ── Upload de um módulo ──────────────────────────────────────────────────
// Comprime state[modulo] inteiro em chunks e sobe pro Storage. Não
// bloqueia (chamador decide se espera ou dispara em segundo plano).
// Retorna true/false — nunca lança exceção pra fora (mesmo padrão de
// "atira e esquece" das outras sincronizações do sistema, só que com
// verificação de integridade embutida antes de cada envio).
async function _cbUploadModulo(modulo) {
  if (!window.supabaseClient || !window.currentUser?.id) return false;
  if (!_cbSuportado()) {
    console.warn('[CloudBackup] Navegador sem suporte a CompressionStream/crypto.subtle — backup condensado desativado nesta sessão.');
    return false;
  }
  if (_cbUploadEmAndamento.has(modulo)) return false;

  const registros = Array.isArray(state[modulo]) ? state[modulo] : [];
  if (!registros.length) return false; // nada pra fazer backup ainda

  _cbUploadEmAndamento.add(modulo);
  const basePath = `${window.currentUser.id}/${modulo}`;

  try {
    // Manifest antigo (se existir) — só pra saber quantos chunks limpar
    // no final, caso o módulo tenha encolhido desde o último backup.
    let manifestAntigo = null;
    try {
      const { data, error } = await window.supabaseClient.storage
        .from(CLOUD_BACKUP_BUCKET).download(`${basePath}/manifest.json`);
      if (!error && data) manifestAntigo = JSON.parse(await data.text());
    } catch (_) { /* sem manifest antigo — primeira vez, normal */ }

    const totalChunks = Math.ceil(registros.length / CLOUD_BACKUP_CHUNK_SIZE);
    const chunkHashes = [];

    for (let i = 0; i < totalChunks; i++) {
      const slice = registros.slice(i * CLOUD_BACKUP_CHUNK_SIZE, (i + 1) * CLOUD_BACKUP_CHUNK_SIZE);
      const json = JSON.stringify(slice);
      const hashOriginal = await _cbSha256Hex(json);

      const blobComprimido = await _cbGzipString(json);

      // Autoteste (princípio #2 do cabeçalho) — se falhar, aborta o
      // módulo inteiro sem subir nada, mesmo os chunks já enviados
      // ficam órfãos e serão sobrescritos na próxima tentativa bem-
      // sucedida (o manifest, que é o que importa, nunca chega a
      // apontar pra cá).
      const jsonDescomprimido = await _cbGunzipBlob(blobComprimido);
      if (jsonDescomprimido !== json) {
        throw new Error(`Autoteste de compressão falhou no chunk ${i} de "${modulo}" — abortado antes de subir.`);
      }

      const { error: upErr } = await window.supabaseClient.storage
        .from(CLOUD_BACKUP_BUCKET)
        .upload(`${basePath}/chunk_${i}.json.gz`, blobComprimido, { upsert: true, contentType: 'application/gzip' });
      if (upErr) throw upErr;

      chunkHashes.push(hashOriginal);
      await yieldToUI(); // não trava a UI em bases grandes (ex.: SAP com 700k+ linhas)
    }

    // Manifest por ÚLTIMO — princípio #4 do cabeçalho.
    const manifest = {
      version: CLOUD_BACKUP_VERSION,
      modulo,
      totalRecords: registros.length,
      totalChunks,
      chunkHashes,
      savedAt: Date.now(),
    };
    const manifestBlob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    const { error: manErr } = await window.supabaseClient.storage
      .from(CLOUD_BACKUP_BUCKET)
      .upload(`${basePath}/manifest.json`, manifestBlob, { upsert: true, contentType: 'application/json' });
    if (manErr) throw manErr;

    // Limpa chunks excedentes de um backup anterior maior que este
    // (best-effort — não bloqueia nem falha o backup em si).
    if (manifestAntigo?.totalChunks > totalChunks) {
      const paths = [];
      for (let i = totalChunks; i < manifestAntigo.totalChunks; i++) paths.push(`${basePath}/chunk_${i}.json.gz`);
      window.supabaseClient.storage.from(CLOUD_BACKUP_BUCKET).remove(paths)
        .then(({ error }) => { if (error) console.warn(`[CloudBackup] Falha ao limpar chunks excedentes de "${modulo}":`, error); });
    }

    _cbLastBackupAt[modulo] = Date.now();
    console.info(`[CloudBackup] "${modulo}": ${registros.length.toLocaleString('pt-BR')} registros salvos em ${totalChunks} chunk(s) condensado(s) na nuvem.`);
    return true;
  } catch (err) {
    console.warn(`[CloudBackup] Falha ao gerar backup condensado de "${modulo}":`, err);
    return false;
  } finally {
    _cbUploadEmAndamento.delete(modulo);
  }
}

// Roda o upload dos 5 módulos em sequência (não em paralelo — evita 5
// compressões grandes disputando CPU/memória ao mesmo tempo). Usada pelo
// botão "Sincronizar dados locais" (Etapa 5).
async function _cbBackupTodosModulos() {
  for (const modulo of CLOUD_BACKUP_MODULOS) {
    await _cbUploadModulo(modulo);
    await yieldToUI();
  }
}

// ── Restauração de um módulo ─────────────────────────────────────────────
// Baixa o manifest + todos os chunks, confere cada checksum, e só retorna
// o array se TUDO bater. Qualquer divergência (chunk ausente, hash não
// bate, contagem final não bate com o manifest) aborta e retorna null —
// nunca retorna um resultado parcial/suspeito (princípio #3 do cabeçalho).
async function _cbRestaurarModulo(modulo) {
  if (!window.supabaseClient || !window.currentUser?.id) return null;
  if (!_cbSuportado()) return null;

  const basePath = `${window.currentUser.id}/${modulo}`;
  let manifest;
  try {
    const { data, error } = await window.supabaseClient.storage
      .from(CLOUD_BACKUP_BUCKET).download(`${basePath}/manifest.json`);
    if (error || !data) return null; // sem backup — normal se este módulo nunca teve importação grande
    manifest = JSON.parse(await data.text());
  } catch (_) {
    return null;
  }
  if (!manifest || !manifest.totalChunks || !Array.isArray(manifest.chunkHashes)) return null;

  const registros = [];
  for (let i = 0; i < manifest.totalChunks; i++) {
    try {
      const { data, error } = await window.supabaseClient.storage
        .from(CLOUD_BACKUP_BUCKET).download(`${basePath}/chunk_${i}.json.gz`);
      if (error || !data) {
        console.warn(`[CloudBackup] Chunk ${i} de "${modulo}" não encontrado — restauração abortada (dado incompleto é pior que nenhum).`);
        return null;
      }
      const json = await _cbGunzipBlob(data);
      const hash = await _cbSha256Hex(json);
      if (hash !== manifest.chunkHashes[i]) {
        console.warn(`[CloudBackup] Chunk ${i} de "${modulo}" falhou na verificação de integridade — restauração abortada.`);
        return null;
      }
      registros.push(...JSON.parse(json));
      await yieldToUI();
    } catch (err) {
      console.warn(`[CloudBackup] Erro lendo chunk ${i} de "${modulo}":`, err);
      return null;
    }
  }

  if (registros.length !== manifest.totalRecords) {
    console.warn(`[CloudBackup] "${modulo}": contagem final (${registros.length}) não bate com o manifest (${manifest.totalRecords}) — restauração abortada.`);
    return null;
  }

  return registros;
}

// Chamada no boot (restoreAndRender, dashboard.js), depois que o estado
// local foi carregado — só age nos módulos que estiverem VAZIOS
// localmente (dispositivo novo / IndexedDB limpo). Nunca mescla nem
// sobrescreve dado local já existente (princípio #5 do cabeçalho).
async function restaurarBackupCondensadoSeNecessario() {
  if (!window.supabaseClient || !window.currentUser?.id) return;
  for (const modulo of CLOUD_BACKUP_MODULOS) {
    if (Array.isArray(state[modulo]) && state[modulo].length > 0) continue;
    try {
      const registros = await _cbRestaurarModulo(modulo);
      if (registros && registros.length) {
        state[modulo] = registros;
        console.info(`[CloudBackup] "${modulo}": ${registros.length.toLocaleString('pt-BR')} registros restaurados da cópia condensada na nuvem.`);
        toast(`${registros.length.toLocaleString('pt-BR')} registro(s) de ${modulo} restaurados da cópia de segurança na nuvem.`, 'success');
      }
    } catch (err) {
      console.warn(`[CloudBackup] Falha ao restaurar "${modulo}":`, err);
    }
  }
}

// ── Reforço periódico silencioso (Etapa 4) ───────────────────────────────
// Cobre o que muda ENTRE importações (edição inline de um lançamento,
// exclusão manual de um registro) — o gatilho pós-importação (Etapa 3,
// em processImportedRows) já cobre o grosso do volume na hora que ele
// aparece. Só a aba ativa roda isso (mesma flag isActiveTab do controle
// de aba única em persist.js), evitando trabalho duplicado com várias
// abas abertas. Idempotente — chamar de novo não cria um segundo timer.
function cloudBackupPeriodicoInit() {
  if (_cbPeriodicTimer) return;
  _cbPeriodicTimer = setInterval(() => {
    if (typeof isActiveTab === 'undefined' || !isActiveTab) return;
    if (!window.supabaseClient || !window.currentUser?.id) return;
    const agora = Date.now();
    CLOUD_BACKUP_MODULOS.forEach(modulo => {
      const ultimaVez = _cbLastBackupAt[modulo] || 0;
      if (agora - ultimaVez < CLOUD_BACKUP_PERIODIC_MIN_INTERVAL_MS) return;
      _cbUploadModulo(modulo);
    });
  }, CLOUD_BACKUP_PERIODIC_CHECK_MS);
}

Object.assign(window, {
  _cbUploadModulo, _cbBackupTodosModulos, _cbRestaurarModulo,
  restaurarBackupCondensadoSeNecessario, cloudBackupPeriodicoInit,
  CLOUD_BACKUP_MODULOS,
});
