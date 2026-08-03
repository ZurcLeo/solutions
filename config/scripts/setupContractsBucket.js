#!/usr/bin/env node
/**
 * setupContractsBucket.js
 *
 * Script de setup único: cria o bucket `contracts/` no Supabase Storage
 * com as configurações de segurança obrigatórias.
 *
 * Buckets não são criados via SQL — precisam da Storage API.
 * Execute este script UMA VEZ em cada ambiente (staging, produção).
 *
 * Uso:
 *   node backend/eloscloudapp/config/scripts/setupContractsBucket.js
 *
 * Pré-requisitos:
 *   - SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente
 *   - O Supabase projeto deve estar acessível
 *
 * Autor: infra-agent
 * Data: 2026-05-18
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { getSupabaseClient } = require('../supabase');

const BUCKET_NAME = 'contracts';
const BUCKET_CONFIG = {
  public: false,                    // NUNCA público — acesso apenas via Signed URL
  fileSizeLimit: 10 * 1024 * 1024, // 10MB por arquivo
  allowedMimeTypes: [
    'application/pdf',
    'application/octet-stream',     // PDFs criptografados (.pdf.enc)
  ],
};

async function setupContractsBucket() {
  const supabase = getSupabaseClient();

  if (!supabase) {
    console.error('[ERRO] Cliente Supabase não inicializado. Verifique SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  console.log(`[INFO] Verificando bucket '${BUCKET_NAME}'...`);

  // Verificar se o bucket já existe
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    console.error('[ERRO] Falha ao listar buckets:', listError.message);
    process.exit(1);
  }

  const exists = buckets?.some(b => b.name === BUCKET_NAME);

  if (exists) {
    console.log(`[OK] Bucket '${BUCKET_NAME}' já existe.`);

    // Atualizar configurações do bucket existente (idempotente)
    const { error: updateError } = await supabase.storage.updateBucket(BUCKET_NAME, BUCKET_CONFIG);
    if (updateError) {
      console.error('[ERRO] Falha ao atualizar configuração do bucket:', updateError.message);
      process.exit(1);
    }
    console.log('[OK] Configurações do bucket atualizadas (idempotente).');
  } else {
    // Criar bucket
    const { error: createError } = await supabase.storage.createBucket(BUCKET_NAME, BUCKET_CONFIG);
    if (createError) {
      console.error('[ERRO] Falha ao criar bucket:', createError.message);
      process.exit(1);
    }
    console.log(`[OK] Bucket '${BUCKET_NAME}' criado com sucesso.`);
  }

  // Validar configuração resultante
  const { data: bucket, error: getError } = await supabase.storage.getBucket(BUCKET_NAME);
  if (getError) {
    console.error('[ERRO] Falha ao verificar bucket criado:', getError.message);
    process.exit(1);
  }

  console.log('\n[RESULTADO] Configuração atual do bucket:');
  console.log(`  Nome:            ${bucket.name}`);
  console.log(`  Público:         ${bucket.public}  ← deve ser false`);
  console.log(`  Limite de tamanho: ${bucket.file_size_limit / 1024 / 1024}MB`);
  console.log(`  MIMEs permitidos: ${bucket.allowed_mime_types?.join(', ')}`);

  if (bucket.public) {
    console.error('\n[CRÍTICO] Bucket está público! Corrija imediatamente.');
    process.exit(1);
  }

  console.log('\n[OK] Setup concluído. Bucket contracts/ pronto para uso.');
  console.log('\n[PRÓXIMOS PASSOS]');
  console.log('  1. Aplique a migration RLS: supabase db push (20260518000001_contracts_storage_rls.sql)');
  console.log('  2. Configure o secret no Fly.io: flyctl secrets set DOCUMENT_ENCRYPTION_KEY=$(openssl rand -hex 32)');
  console.log('  3. Guarde a DOCUMENT_ENCRYPTION_KEY em local seguro — perda = documentos irrecuperáveis');
}

setupContractsBucket().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
