/**
 * Script para migrar o catalogo de interesses do Firestore para o Supabase.
 *
 * Le diretamente do Firestore (via firebase-admin) e grava no Supabase.
 * Nao depende de nenhum model class — apenas das conexoes raw.
 *
 * Executar via:
 *   node backend/eloscloudapp/scripts/migrate-interests-to-supabase.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const fs = require('fs');

const { getFirestore } = require('../firebaseAdmin');
const { getSupabaseClient } = require('../config/supabase');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarize(label, count) {
  console.log(`  ${label}: ${count}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function migrate() {
  const db = getFirestore();
  const supabase = getSupabaseClient();

  if (!supabase) {
    console.error('[FATAL] Supabase client nao disponivel. Verifique SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env');
    process.exit(1);
  }

  console.log('[migrate-interests] Iniciando migracao Firestore -> Supabase...\n');

  const stats = {
    categoriesRead: 0,
    categoriesMigrated: 0,
    categoriesFailed: 0,
    interestsRead: 0,
    interestsMigrated: 0,
    interestsFailed: 0,
    usersRead: 0,
    usersMigrated: 0,
    usersFailed: 0,
    unmappedInterestIds: new Set(),
  };

  // Maps: firestoreId -> supabaseUuid
  const categoryIdMap = {}; // firestoreCategoryId -> supabaseCategoryUuid
  const interestIdMap = {}; // firestoreInterestId -> supabaseInterestUuid

  // -----------------------------------------------------------------------
  // STEP 1 — Migrate categories
  // -----------------------------------------------------------------------
  console.log('--- STEP 1: Migrating interest categories ---');

  let categoriesSnap;
  try {
    categoriesSnap = await db.collection('interests_categories').get();
  } catch (err) {
    console.error('[FATAL] Falha ao ler interests_categories do Firestore:', err.message);
    process.exit(1);
  }

  stats.categoriesRead = categoriesSnap.size;
  console.log(`  Firestore: ${stats.categoriesRead} categorias encontradas`);

  for (const doc of categoriesSnap.docs) {
    const firestoreId = doc.id;
    const data = doc.data();

    const name = data.name || firestoreId;
    const description = data.description || null;
    const icon = data.icon || null;
    const sortOrder = data.sort_order ?? data.order ?? 0;
    const active = data.active !== false; // default true

    try {
      const { data: upserted, error } = await supabase
        .from('interest_categories')
        .upsert(
          {
            name,
            description,
            icon,
            sort_order: sortOrder,
            active,
          },
          { onConflict: 'name' }
        )
        .select('id')
        .single();

      if (error) {
        console.error(`  [ERR] Categoria "${name}" (${firestoreId}): ${error.message}`);
        stats.categoriesFailed++;
        continue;
      }

      categoryIdMap[firestoreId] = upserted.id;
      stats.categoriesMigrated++;
      console.log(`  [OK] "${name}" : ${firestoreId} -> ${upserted.id}`);
    } catch (err) {
      console.error(`  [ERR] Categoria "${name}" (${firestoreId}): ${err.message}`);
      stats.categoriesFailed++;
    }
  }

  console.log(`  Categorias migradas: ${stats.categoriesMigrated}/${stats.categoriesRead}\n`);

  // -----------------------------------------------------------------------
  // STEP 2 — Migrate interests
  // -----------------------------------------------------------------------
  console.log('--- STEP 2: Migrating interests ---');

  let interestsSnap;
  try {
    interestsSnap = await db.collection('interests').get();
  } catch (err) {
    console.error('[FATAL] Falha ao ler interests do Firestore:', err.message);
    process.exit(1);
  }

  stats.interestsRead = interestsSnap.size;
  console.log(`  Firestore: ${stats.interestsRead} interesses encontrados`);

  for (const doc of interestsSnap.docs) {
    const firestoreId = doc.id;
    const data = doc.data();

    const firestoreCategoryId = data.categoryId || data.category_id || null;
    const label = data.label || data.name || firestoreId;
    const description = data.description || null;
    const active = data.active !== false;

    if (!firestoreCategoryId || !categoryIdMap[firestoreCategoryId]) {
      console.error(`  [SKIP] Interesse "${label}" (${firestoreId}): categoria "${firestoreCategoryId}" nao encontrada no mapeamento`);
      stats.interestsFailed++;
      continue;
    }

    const supabaseCategoryId = categoryIdMap[firestoreCategoryId];

    try {
      const { data: upserted, error } = await supabase
        .from('interests')
        .upsert(
          {
            category_id: supabaseCategoryId,
            label,
            description,
            active,
          },
          { onConflict: 'category_id,label' }
        )
        .select('id')
        .single();

      if (error) {
        console.error(`  [ERR] Interesse "${label}" (${firestoreId}): ${error.message}`);
        stats.interestsFailed++;
        continue;
      }

      interestIdMap[firestoreId] = upserted.id;
      stats.interestsMigrated++;
      console.log(`  [OK] "${label}" : ${firestoreId} -> ${upserted.id}`);
    } catch (err) {
      console.error(`  [ERR] Interesse "${label}" (${firestoreId}): ${err.message}`);
      stats.interestsFailed++;
    }
  }

  console.log(`  Interesses migrados: ${stats.interestsMigrated}/${stats.interestsRead}\n`);

  // -----------------------------------------------------------------------
  // STEP 3 — Migrate user interests
  // -----------------------------------------------------------------------
  console.log('--- STEP 3: Migrating user interests ---');

  let usersSnap;
  try {
    usersSnap = await db.collection('usuario').get();
  } catch (err) {
    console.error('[FATAL] Falha ao ler usuario do Firestore:', err.message);
    process.exit(1);
  }

  console.log(`  Firestore: ${usersSnap.size} documentos em "usuario"`);

  for (const doc of usersSnap.docs) {
    const userId = doc.id;
    const data = doc.data();

    // Collect all Firestore interest IDs from both possible fields
    const firestoreInterestIds = new Set();

    // Field 1: interestIds (flat array)
    if (Array.isArray(data.interestIds)) {
      data.interestIds.forEach((id) => firestoreInterestIds.add(id));
    }

    // Field 2: interesses (object { categoryId: [interestIds] })
    if (data.interesses && typeof data.interesses === 'object' && !Array.isArray(data.interesses)) {
      for (const catKey of Object.keys(data.interesses)) {
        const ids = data.interesses[catKey];
        if (Array.isArray(ids)) {
          ids.forEach((id) => firestoreInterestIds.add(id));
        }
      }
    }

    if (firestoreInterestIds.size === 0) {
      continue; // no interests for this user
    }

    stats.usersRead++;

    // Map Firestore IDs to Supabase UUIDs
    const rows = [];
    for (const fId of firestoreInterestIds) {
      const supabaseId = interestIdMap[fId];
      if (!supabaseId) {
        stats.unmappedInterestIds.add(fId);
        continue;
      }
      rows.push({ user_id: userId, interest_id: supabaseId });
    }

    if (rows.length === 0) {
      continue;
    }

    try {
      const { error } = await supabase
        .from('user_interests')
        .upsert(rows, { onConflict: 'user_id,interest_id' });

      if (error) {
        console.error(`  [ERR] User ${userId}: ${error.message}`);
        stats.usersFailed++;
        continue;
      }

      stats.usersMigrated++;
      console.log(`  [OK] User ${userId}: ${rows.length} interesses vinculados`);
    } catch (err) {
      console.error(`  [ERR] User ${userId}: ${err.message}`);
      stats.usersFailed++;
    }
  }

  console.log(`  Usuarios migrados: ${stats.usersMigrated}/${stats.usersRead}\n`);

  // -----------------------------------------------------------------------
  // STEP 4 — Save ID mapping to JSON
  // -----------------------------------------------------------------------
  const mappingPath = path.join(__dirname, 'interests-id-mapping.json');
  const mapping = {
    generatedAt: new Date().toISOString(),
    categories: categoryIdMap,
    interests: interestIdMap,
  };

  try {
    fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2), 'utf-8');
    console.log(`[mapping] Salvo em ${mappingPath}`);
  } catch (err) {
    console.error(`[mapping] Falha ao salvar mapping: ${err.message}`);
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log('\n========== RESUMO ==========');
  summarize('Categorias lidas (Firestore)', stats.categoriesRead);
  summarize('Categorias migradas (Supabase)', stats.categoriesMigrated);
  summarize('Categorias com erro', stats.categoriesFailed);
  console.log('');
  summarize('Interesses lidos (Firestore)', stats.interestsRead);
  summarize('Interesses migrados (Supabase)', stats.interestsMigrated);
  summarize('Interesses com erro', stats.interestsFailed);
  console.log('');
  summarize('Usuarios com interesses', stats.usersRead);
  summarize('Usuarios migrados', stats.usersMigrated);
  summarize('Usuarios com erro', stats.usersFailed);
  console.log('');
  summarize('IDs de interesse nao mapeados', stats.unmappedInterestIds.size);
  if (stats.unmappedInterestIds.size > 0) {
    console.log('  IDs nao mapeados:', [...stats.unmappedInterestIds].join(', '));
  }
  console.log('============================\n');

  process.exit(0);
}

migrate().catch((err) => {
  console.error('[FATAL] Erro inesperado:', err);
  process.exit(1);
});
