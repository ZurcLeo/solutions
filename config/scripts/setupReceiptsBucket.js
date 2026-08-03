#!/usr/bin/env node
/**
 * setupReceiptsBucket.js
 *
 * Script de setup único: cria o bucket `contribution-receipts` no Supabase Storage
 * com as configurações de segurança obrigatórias.
 *
 * Execução: node backend/eloscloudapp/config/scripts/setupReceiptsBucket.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { getSupabaseClient } = require('../supabase');

const BUCKET_NAME = 'contribution-receipts';
const BUCKET_CONFIG = {
  public: false,
  fileSizeLimit: 10 * 1024 * 1024, // 10MB
  allowedMimeTypes: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ],
};

async function setupReceiptsBucket() {
  const supabase = getSupabaseClient();

  if (!supabase) {
    console.error('[ERRO] Cliente Supabase não inicializado. Verifique SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  console.log(`[INFO] Verificando bucket '${BUCKET_NAME}'...`);

  // Check if exists
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    console.error('[ERRO] Falha ao listar buckets:', listError.message);
    process.exit(1);
  }

  const exists = buckets?.some(b => b.name === BUCKET_NAME);

  if (exists) {
    console.log(`[OK] Bucket '${BUCKET_NAME}' já existe. Atualizando configuração...`);

    const { error: updateError } = await supabase.storage.updateBucket(BUCKET_NAME, BUCKET_CONFIG);
    if (updateError) {
      console.error('[ERRO] Falha ao atualizar:', updateError.message);
      process.exit(1);
    }
    console.log('[OK] Configuração atualizada.');
  } else {
    const { error: createError } = await supabase.storage.createBucket(BUCKET_NAME, BUCKET_CONFIG);
    if (createError) {
      console.error('[ERRO] Falha ao criar bucket:', createError.message);
      process.exit(1);
    }
    console.log(`[OK] Bucket '${BUCKET_NAME}' criado com sucesso.`);
  }

  // Validate
  const { data: bucket, error: getError } = await supabase.storage.getBucket(BUCKET_NAME);
  if (getError) {
    console.error('[ERRO] Falha ao verificar bucket:', getError.message);
    process.exit(1);
  }

  console.log('\n[RESULTADO] Configuração atual do bucket:');
  console.log(`  Nome:            ${bucket.name}`);
  console.log(`  Público:         ${bucket.public}  ← deve ser false`);
  console.log(`  Tamanho máx:     ${(bucket.file_size_limit / 1024 / 1024).toFixed(0)} MB`);
  console.log(`  MIME permitidos: ${(bucket.allowed_mime_types || []).join(', ')}`);

  if (bucket.public) {
    console.error('\n[CRÍTICO] Bucket está público! Comprovantes contêm dados sensíveis.');
    process.exit(1);
  }

  console.log('\n[OK] Setup concluído. Bucket privado com signed URLs.');
}

setupReceiptsBucket().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
