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
//   5. Restauração é sempre SUBSTITUIÇÃO, nunca merge — o backup condensado
//      é a fonte de verdade pro volume importado (30/07, corrigido: a regra
//      antiga de "só restaura se local vazio" deixava a restauração ser
//      pulada sempre que o dispositivo já tinha os poucos registros
//      manuais sincronizados via Postgres, mesmo sem o volume importado de
//      verdade — ver restaurarBackupCondensadoSeNecessario). Hoje a decisão
//      é por contagem: local com MENOS registros que o manifest é
//      substituído inteiro; local igual ou à frente não é tocado.
// ═══════════════════════════════════════════════════════════════════════

const CLOUD_BACKUP_BUCKET = 'backups-condensados';
const CLOUD_BACKUP_CHUNK_SIZE = 20000; // registros por chunk comprimido
const CLOUD_BACKUP_VERSION = 1;
// Custos SAP SAIU deste grupo em 05/08: virou cadastro único e
// compartilhado do time, com sincronização linha a linha de verdade (RLS +
// Realtime, ver import.js) — não é mais "volume importado que só existe
// local". Deixar aqui reintroduzia o próprio problema que esta camada
// resolve pros outros 4: restaurarBackupCondensadoSeNecessario (abaixo)
// restaurava um snapshot condensado velho toda vez que o local ficava
// vazio — inclusive depois de uma exclusão de verdade, desfazendo-a no
// boot seguinte (o SQL, fonte de verdade agora, nunca tinha essa noção).
const CLOUD_BACKUP_MODULOS = ['entradas', 'saidas', 'lancamentos', 'sap'];

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
//
// opts.permitirReducao — ver a "guarda de encolhimento" abaixo. Só os
// caminhos de EXCLUSÃO deliberada passam true.
async function _cbUploadModulo(modulo, opts = {}) {
  if (!window.supabaseClient || !window.currentUser?.id) return false;
  if (!_cbSuportado()) {
    console.warn('[CloudBackup] Navegador sem suporte a CompressionStream/crypto.subtle — backup condensado desativado nesta sessão.');
    return false;
  }
  // Trava ENTRE ABAS (F5). _cbUploadEmAndamento é por aba: sem isto, duas
  // abas subindo o mesmo módulo ao mesmo tempo podem gravar o manifest de
  // um upload junto com os chunks do outro — o hash detecta na restauração
  // e aborta, ou seja, o backup existe mas é inútil, e ninguém é avisado.
  // navigator.locks é nativo e serializa entre abas da mesma origem.
  // Se o navegador não tiver a API, segue como antes (degradar é melhor do
  // que ficar sem backup nenhum) — por isso NÃO entra em _cbSuportado().
  if (navigator.locks?.request) {
    return navigator.locks.request(`cloudbackup-${modulo}`, () => _cbUploadModuloInterno(modulo, opts));
  }
  return _cbUploadModuloInterno(modulo, opts);
}

async function _cbUploadModuloInterno(modulo, opts = {}) {
  if (_cbUploadEmAndamento.has(modulo)) return false;

  const registros = Array.isArray(state[modulo]) ? state[modulo] : [];
  if (!registros.length) return false; // nada pra fazer backup ainda

  _cbUploadEmAndamento.add(modulo);
  const basePath = `${window.currentUser.id}/${modulo}`;

  try {
    // Manifest antigo (se existir) — usado pela guarda de encolhimento
    // abaixo e pra saber quantos chunks limpar no final.
    let manifestAntigo = null;
    try {
      const { data, error } = await window.supabaseClient.storage
        .from(CLOUD_BACKUP_BUCKET).download(`${basePath}/manifest.json`);
      if (!error && data) manifestAntigo = JSON.parse(await data.text());
    } catch (_) { /* sem manifest antigo — primeira vez, normal */ }

    // ── GUARDA DE ENCOLHIMENTO (F1) ────────────────────────────────────
    // O backup é um slot único por usuário/módulo, gravado com upsert, e a
    // limpeza no fim APAGA os chunks excedentes. Sem esta guarda, um
    // dispositivo com pouco dado (recém-instalado, IndexedDB limpo, ou
    // restauração abortada no meio) sobrescreve o backup de um dispositivo
    // cheio e apaga os chunks — perda irreversível de centenas de milhares
    // de linhas, já que pro volume importado este backup é a única cópia.
    // Só passa se a redução foi PEDIDA (exclusão individual ou em lote).
    if (!opts.permitirReducao && manifestAntigo?.totalRecords > registros.length) {
      console.warn(`[CloudBackup] "${modulo}": backup ABORTADO — local tem ${registros.length} registro(s), a nuvem tem ${manifestAntigo.totalRecords}. Sobrescrever apagaria dado que só existe lá.`);
      if (typeof toast === 'function') {
        toast(`Backup de ${modulo} não enviado: este dispositivo tem menos registros que a cópia na nuvem. A cópia foi preservada.`, 'error');
      }
      return false;
    }

    // ── CÓPIA ANTERIOR ANTES DE ENCOLHER (F4) ──────────────────────────
    // Chegando aqui com o backup menor que o da nuvem, a redução é
    // deliberada (a guarda acima já barrou o resto). É exatamente o momento
    // em que dá pra querer voltar atrás — "apaguei o lote errado". Sem isto
    // o backup é um espelho: replica o engano e a versão boa some.
    // Guarda UMA geração anterior, e só quando encolhe: crescimento normal
    // não paga custo nenhum de armazenamento.
    // Usa copy() do próprio Storage (cópia no servidor, sem baixar/subir).
    if (manifestAntigo?.totalRecords > registros.length) {
      await _cbGuardarGeracaoAnterior(basePath, manifestAntigo, modulo);
    }

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
    // Avisar é obrigatório (F2): pro volume importado, este backup é a ÚNICA
    // cópia — falhar em silêncio deixa centenas de milhares de linhas
    // existindo só neste navegador sem ninguém saber. Não marcamos
    // _cbLastBackupAt aqui (só é marcado no sucesso, acima), então o reforço
    // periódico já tenta de novo sozinho — o timer é o retry, não precisa de
    // mecanismo próprio.
    console.warn(`[CloudBackup] Falha ao gerar backup condensado de "${modulo}":`, err);
    if (typeof toast === 'function') {
      toast(`Falha ao salvar a cópia de segurança de ${modulo} na nuvem. Os dados seguem neste dispositivo; nova tentativa automática em até 30 min.`, 'error');
    }
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
  return _cbLerGeracao(basePath, manifest, modulo);
}

// Lê e VERIFICA uma geração inteira a partir do seu manifest. Extraída de
// _cbRestaurarModulo pra que a restauração da geração anterior (F4) use
// exatamente a mesma verificação de integridade — duas rotas de restauração
// com regras diferentes seria justamente o tipo de divergência que corrompe
// dado. Retorna null (nunca resultado parcial) a qualquer divergência.
async function _cbLerGeracao(basePath, manifest, modulo) {
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
// local foi carregado E depois que os syncXFromSupabase já rodaram.
//
// CORRIGIDO (30/07): a checagem antiga só agia se o módulo estivesse
// "vazio" localmente — mas nesses 5 módulos o Supabase só guarda os
// registros MANUAIS (decisão de 27/07), e os syncXFromSupabase já
// rodaram antes desta função. Um dispositivo novo com só 2-3 manuais
// sincronizados já não estava "vazio", e a restauração do volume
// importado de verdade (só existe no backup condensado) era pulada
// inteira — o usuário reimportava a planilha original pra recuperar,
// gerando um segundo conjunto de ids (gerarIdRegistro() é aleatório,
// normalize.js) pro mesmo dado, que divergia entre dispositivos.
//
// CORRIGIDO DE NOVO (30/07, F3): a decisão por CONTAGEM ("local com menos
// registros que o manifest é substituído inteiro") consertava o caso acima
// mas criava outro pior: exclusão deliberada também deixa o local menor, e
// o boot seguinte trazia tudo de volta. Apagar 100 mil linhas e vê-las
// reaparecer é pior do que não restaurar.
//
// O gatilho agora é preciso em vez de heurístico: restaura quando NÃO EXISTE
// NENHUM registro importado localmente (nenhum com importId). Isso é
// exatamente o caso que a regra "só se vazio" queria pegar — dispositivo
// novo cujo array não está vazio só porque os poucos registros MANUAIS já
// vieram do Postgres — sem confundir com "o usuário apagou coisas".
// Divergência fora disso não se resolve por adivinhação: fica pro botão
// explícito de restauração (restaurarBackupCondensadoManual).
function _cbTemVolumeImportado(modulo) {
  const arr = Array.isArray(state[modulo]) ? state[modulo] : [];
  return arr.some(r => r.importId);
}

async function restaurarBackupCondensadoSeNecessario() {
  if (!window.supabaseClient || !window.currentUser?.id) return;
  for (const modulo of CLOUD_BACKUP_MODULOS) {
    try {
      // Já existe volume importado aqui — este dispositivo não está "cru".
      // Qualquer diferença de contagem é resultado do trabalho do usuário
      // (importou, excluiu), não algo a ser sobrescrito automaticamente.
      if (_cbTemVolumeImportado(modulo)) continue;

      const basePath = `${window.currentUser.id}/${modulo}`;
      const { data, error } = await window.supabaseClient.storage
        .from(CLOUD_BACKUP_BUCKET).download(`${basePath}/manifest.json`);
      if (error || !data) continue; // sem backup — nada a conferir, normal se este módulo nunca teve importação grande

      const manifest = JSON.parse(await data.text());
      if (!manifest?.totalRecords) continue;

      const registros = await _cbRestaurarModulo(modulo);
      if (registros && registros.length) {
        state[modulo] = registros;
        console.info(`[CloudBackup] "${modulo}": ${registros.length.toLocaleString('pt-BR')} registros restaurados/corrigidos da cópia condensada na nuvem.`);
        toast(`${registros.length.toLocaleString('pt-BR')} registro(s) de ${modulo} sincronizados da cópia de segurança na nuvem.`, 'success');
      }
    } catch (err) {
      console.warn(`[CloudBackup] Falha ao verificar/restaurar "${modulo}":`, err);
    }
  }
}

// ── Geração anterior (F4) ────────────────────────────────────────────────
// Copia o backup atual pra subpasta `anterior/` antes de ser encolhido.
// Best-effort de propósito: se a cópia falhar, avisa mas NÃO bloqueia o
// upload — a exclusão foi pedida pelo usuário, e travá-la porque o snapshot
// falhou seria pior do que ficar sem o snapshot. O que nunca pode acontecer
// é a exclusão ser bloqueada em silêncio.
const CB_PASTA_ANTERIOR = 'anterior';

async function _cbGuardarGeracaoAnterior(basePath, manifestAntigo, modulo) {
  const st = window.supabaseClient.storage.from(CLOUD_BACKUP_BUCKET);
  try {
    // Remove a geração anterior antiga (só guardamos UMA) antes de copiar a
    // nova por cima — copy() falha se o destino já existir.
    const antigos = [`${basePath}/${CB_PASTA_ANTERIOR}/manifest.json`];
    for (let i = 0; i < (manifestAntigo.totalChunks || 0) + 8; i++) {
      antigos.push(`${basePath}/${CB_PASTA_ANTERIOR}/chunk_${i}.json.gz`);
    }
    await st.remove(antigos);

    for (let i = 0; i < manifestAntigo.totalChunks; i++) {
      const { error } = await st.copy(`${basePath}/chunk_${i}.json.gz`, `${basePath}/${CB_PASTA_ANTERIOR}/chunk_${i}.json.gz`);
      if (error) throw error;
    }
    const { error: mErr } = await st.copy(`${basePath}/manifest.json`, `${basePath}/${CB_PASTA_ANTERIOR}/manifest.json`);
    if (mErr) throw mErr;

    console.info(`[CloudBackup] "${modulo}": geração anterior (${manifestAntigo.totalRecords} registros) guardada em ${CB_PASTA_ANTERIOR}/ antes de encolher.`);
    return true;
  } catch (err) {
    console.warn(`[CloudBackup] "${modulo}": não foi possível guardar a geração anterior — seguindo mesmo assim (a exclusão foi pedida pelo usuário).`, err);
    if (typeof toast === 'function') {
      toast(`Não foi possível guardar a cópia anterior de ${modulo}. A exclusão seguiu, mas sem opção de voltar atrás.`, 'error');
    }
    return false;
  }
}

// Restaura a geração ANTERIOR (a de antes da última redução). É o "desfazer"
// de uma exclusão que já foi parar na nuvem.
async function restaurarBackupCondensadoAnterior(modulo) {
  if (!window.supabaseClient || !window.currentUser?.id) return false;
  if (!CLOUD_BACKUP_MODULOS.includes(modulo)) return false;

  const basePath = `${window.currentUser.id}/${modulo}/${CB_PASTA_ANTERIOR}`;
  let manifest = null;
  try {
    const { data, error } = await window.supabaseClient.storage
      .from(CLOUD_BACKUP_BUCKET).download(`${basePath}/manifest.json`);
    if (!error && data) manifest = JSON.parse(await data.text());
  } catch (_) { /* tratado abaixo */ }

  if (!manifest?.totalRecords) {
    toast(`Não há geração anterior de ${modulo} guardada.`, 'error');
    return false;
  }

  const localCount = Array.isArray(state[modulo]) ? state[modulo].length : 0;
  const quando = manifest.savedAt ? new Date(manifest.savedAt).toLocaleString('pt-BR') : 'data desconhecida';
  if (!confirm(
    `Voltar ${modulo} para a cópia anterior?\n\n` +
    `Neste dispositivo agora: ${localCount.toLocaleString('pt-BR')} registro(s)\n` +
    `Cópia anterior: ${manifest.totalRecords.toLocaleString('pt-BR')} registro(s) (de ${quando})\n\n` +
    `Isto desfaz a última exclusão que chegou à nuvem e SUBSTITUI o conteúdo deste dispositivo.`
  )) return false;

  const registros = await _cbLerGeracao(basePath, manifest, modulo);
  if (!registros) {
    toast(`Cópia anterior de ${modulo} não passou na verificação de integridade. Nada foi alterado.`, 'error');
    return false;
  }
  state[modulo] = registros;
  if (typeof persist === 'function') persist();
  toast(`${registros.length.toLocaleString('pt-BR')} registro(s) de ${modulo} restaurados da cópia anterior.`, 'success');
  return true;
}

// ── Restauração MANUAL (F3) ──────────────────────────────────────────────
// A restauração automática (acima) só age em dispositivo cru. Quando o
// local e a nuvem divergem por qualquer outro motivo, quem decide é o
// usuário — não uma heurística. Mostra os dois números e exige confirmação,
// porque restaurar SUBSTITUI o local inteiro (princípio #5 do cabeçalho).
async function restaurarBackupCondensadoManual(modulo) {
  if (!window.supabaseClient || !window.currentUser?.id) return false;
  if (!CLOUD_BACKUP_MODULOS.includes(modulo)) return false;

  const basePath = `${window.currentUser.id}/${modulo}`;
  let manifest = null;
  try {
    const { data, error } = await window.supabaseClient.storage
      .from(CLOUD_BACKUP_BUCKET).download(`${basePath}/manifest.json`);
    if (!error && data) manifest = JSON.parse(await data.text());
  } catch (_) { /* tratado abaixo */ }

  if (!manifest?.totalRecords) {
    toast(`Não há cópia de segurança de ${modulo} na nuvem.`, 'error');
    return false;
  }

  const localCount = Array.isArray(state[modulo]) ? state[modulo].length : 0;
  const quando = manifest.savedAt ? new Date(manifest.savedAt).toLocaleString('pt-BR') : 'data desconhecida';
  const ok = confirm(
    `Restaurar ${modulo} da cópia de segurança?\n\n` +
    `Neste dispositivo: ${localCount.toLocaleString('pt-BR')} registro(s)\n` +
    `Na nuvem: ${manifest.totalRecords.toLocaleString('pt-BR')} registro(s) (salvos em ${quando})\n\n` +
    `A cópia da nuvem SUBSTITUI o conteúdo deste dispositivo. ` +
    `Registros que existam só aqui e ainda não tenham subido serão perdidos.`
  );
  if (!ok) return false;

  const registros = await _cbRestaurarModulo(modulo);
  if (!registros) {
    toast(`Restauração de ${modulo} abortada — a cópia não passou na verificação de integridade. Nada foi alterado.`, 'error');
    return false;
  }
  state[modulo] = registros;
  if (typeof persist === 'function') persist();
  toast(`${registros.length.toLocaleString('pt-BR')} registro(s) de ${modulo} restaurados da nuvem.`, 'success');
  return true;
}

// ── Reforço periódico silencioso (Etapa 4) ───────────────────────────────
// Cobre o que muda ENTRE importações (edição inline de um lançamento,
// exclusão manual de um registro) — o gatilho pós-importação (Etapa 3,
// em processImportedRows) já cobre o grosso do volume na hora que ele
// aparece. Roda de forma independente em cada aba aberta — a serialização
// entre abas é feita por navigator.locks dentro de _cbUploadModulo (F5).
// Idempotente — chamar de novo não cria um segundo timer.
function cloudBackupPeriodicoInit() {
  if (_cbPeriodicTimer) return;
  _cbPeriodicTimer = setInterval(() => {
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
  restaurarBackupCondensadoSeNecessario, restaurarBackupCondensadoManual,
  restaurarBackupCondensadoAnterior,
  cloudBackupPeriodicoInit, CLOUD_BACKUP_MODULOS,
});
