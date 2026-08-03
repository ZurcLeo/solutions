/**
 * Migração one-shot: Firestore `usuario/` → Supabase `users`
 *
 * Execução:
 *   node backend/eloscloudapp/scripts/migrate-users-to-supabase.js
 *
 * Flags:
 *   --dry-run   Apenas lista os usuários que seriam migrados, sem gravar.
 *   --batch N   Tamanho do batch de upsert (padrão: 200).
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { getFirestore } = require('../firebaseAdmin');
const { getSupabaseClient } = require('../config/supabase');

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN   = args.includes('--dry-run');
const batchArg  = args.find(a => a.startsWith('--batch='));
const BATCH_SIZE = batchArg ? parseInt(batchArg.split('=')[1], 10) : 200;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toSupabaseRow(docId, data) {
  // email é NOT NULL no Supabase — pula docs sem email
  const email = (data.email || '').trim();
  if (!email) return null;

  return {
    id:         docId,
    email,
    full_name:  data.nome || data.displayName || null,
    avatar_url: data.fotoDoPerfil || data.photoURL || null,
    is_active:  true,
    // dataCriacao pode ser Firestore Timestamp ou Date
    created_at: data.dataCriacao
      ? (data.dataCriacao.toDate ? data.dataCriacao.toDate().toISOString() : new Date(data.dataCriacao).toISOString())
      : undefined,
  };
}

async function fetchAllFirestoreUsers(db) {
  console.log('📥  Carregando usuários do Firestore (usuario/)...');
  const snapshot = await db.collection('usuario').get();
  console.log(`   → ${snapshot.size} documentos encontrados.`);
  return snapshot.docs;
}

async function upsertBatch(supabase, rows, batchIndex) {
  const { error } = await supabase
    .from('users')
    .upsert(rows, { onConflict: 'id' });

  if (error) {
    console.error(`   ❌  Batch ${batchIndex} falhou:`, error.message);
    return { ok: 0, fail: rows.length };
  }

  return { ok: rows.length, fail: 0 };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function migrate() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Migração: Firestore usuario/ → Supabase users');
  if (DRY_RUN) console.log('  ⚠️  DRY-RUN — nenhum dado será gravado');
  console.log(`  Batch size: ${BATCH_SIZE}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // Validar conexões
  const supabase = getSupabaseClient();
  if (!supabase) {
    console.error('❌  Supabase client não disponível. Verifique SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env');
    process.exit(1);
  }

  const db = getFirestore();

  // 1. Buscar todos os docs do Firestore
  const docs = await fetchAllFirestoreUsers(db);

  // 2. Converter para linhas Supabase
  let skipped = 0;
  const rows = [];

  for (const doc of docs) {
    const row = toSupabaseRow(doc.id, doc.data());
    if (!row) {
      console.warn(`   ⚠️  Pulando doc ${doc.id} — sem email`);
      skipped++;
      continue;
    }
    rows.push(row);
  }

  console.log(`\n📊  Resumo pré-migração:`);
  console.log(`   Total no Firestore : ${docs.length}`);
  console.log(`   A migrar           : ${rows.length}`);
  console.log(`   Pulados (sem email): ${skipped}`);

  if (DRY_RUN) {
    console.log('\n🔍  DRY-RUN — primeiros 10 registros que seriam enviados:');
    rows.slice(0, 10).forEach(r => console.log('  ', JSON.stringify(r)));
    console.log('\n✅  DRY-RUN concluído. Nenhum dado foi gravado.');
    process.exit(0);
  }

  // 3. Upsert em batches
  let totalOk   = 0;
  let totalFail = 0;
  const totalBatches = Math.ceil(rows.length / BATCH_SIZE);

  console.log(`\n🚀  Iniciando upsert em ${totalBatches} batch(es) de até ${BATCH_SIZE}...`);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch     = rows.slice(i, i + BATCH_SIZE);
    const batchNum  = Math.floor(i / BATCH_SIZE) + 1;
    process.stdout.write(`   Batch ${batchNum}/${totalBatches} (${batch.length} registros)... `);

    const { ok, fail } = await upsertBatch(supabase, batch, batchNum);
    totalOk   += ok;
    totalFail += fail;

    if (fail === 0) {
      console.log(`✅`);
    } else {
      console.log(`⚠️  ${fail} falhas`);
    }
  }

  // 4. Relatório final
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Migração concluída');
  console.log(`  ✅  Migrados com sucesso : ${totalOk}`);
  console.log(`  ❌  Falhas               : ${totalFail}`);
  console.log(`  ⏭️  Pulados (sem email)  : ${skipped}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  if (totalFail > 0) {
    console.log('⚠️  Alguns registros falharam. Verifique os logs acima e reexecute o script — o upsert é idempotente.');
  } else {
    console.log('🎉  Todos os usuários foram espelhados no Supabase com sucesso!');
    console.log('   Próximo passo: verifique se as conexões (user_connections) também precisam de migração.');
  }

  process.exit(totalFail > 0 ? 1 : 0);
}

migrate().catch(err => {
  console.error('💥  Erro fatal:', err.message);
  process.exit(1);
});
