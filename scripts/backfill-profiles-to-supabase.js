'use strict';
/**
 * backfill-profiles-to-supabase.js
 *
 * One-time script: reads all Firestore `usuario` docs and backfills
 * profile fields (full_name, avatar_url, descricao, telefone, username)
 * into Supabase `users` table where those fields are NULL.
 *
 * Usage:
 *   node backend/eloscloudapp/scripts/backfill-profiles-to-supabase.js
 *   node backend/eloscloudapp/scripts/backfill-profiles-to-supabase.js --dry-run
 *   node backend/eloscloudapp/scripts/backfill-profiles-to-supabase.js --batch=100
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { getFirestore } = require('../firebaseAdmin');
const { getSupabaseClient } = require('../config/supabase');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const BATCH_SIZE = (() => {
  const batchArg = args.find(a => a.startsWith('--batch='));
  return batchArg ? parseInt(batchArg.split('=')[1], 10) : 50;
})();

/**
 * Maps Firestore usuario doc fields to Supabase users columns.
 * Only includes fields that should be backfilled.
 */
function toBackfillUpdate(docId, data) {
  const update = { id: docId };
  let hasUpdate = false;

  if (data.nome) {
    update.full_name = data.nome;
    hasUpdate = true;
  }
  if (data.fotoDoPerfil) {
    update.avatar_url = data.fotoDoPerfil;
    hasUpdate = true;
  }
  if (data.descricao) {
    update.descricao = data.descricao;
    hasUpdate = true;
  }
  if (data.telefone) {
    update.telefone = data.telefone;
    hasUpdate = true;
  }
  if (data.username) {
    update.username = data.username;
    hasUpdate = true;
  }

  return hasUpdate ? update : null;
}

async function main() {
  console.log('=== Backfill: Firestore profiles → Supabase users ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log('');

  const supabase = getSupabaseClient();
  if (!supabase) {
    console.error('Supabase client not available. Check env vars.');
    process.exit(1);
  }

  const db = getFirestore();
  if (!db) {
    console.error('Firestore not available. Check Firebase credentials.');
    process.exit(1);
  }

  // 1. Get all users from Supabase that have NULL full_name
  console.log('Fetching Supabase users with NULL full_name...');
  const { data: nullUsers, error: nullErr } = await supabase
    .from('users')
    .select('id, full_name, username, avatar_url, descricao, telefone')
    .is('full_name', null);

  if (nullErr) {
    console.error('Error fetching Supabase users:', nullErr.message);
    process.exit(1);
  }

  // Also get users with full_name but missing other fields
  const { data: incompleteUsers, error: incErr } = await supabase
    .from('users')
    .select('id, full_name, username, avatar_url, descricao, telefone')
    .not('full_name', 'is', null);

  if (incErr) {
    console.error('Error fetching incomplete users:', incErr.message);
    process.exit(1);
  }

  const allSupabaseUsers = [...(nullUsers || []), ...(incompleteUsers || [])];
  const supabaseMap = new Map(allSupabaseUsers.map(u => [u.id, u]));

  console.log(`Found ${nullUsers?.length || 0} users with NULL full_name`);
  console.log(`Found ${allSupabaseUsers.length} total Supabase users`);

  // 2. Read all Firestore usuario docs
  console.log('Fetching Firestore usuario collection...');
  const snapshot = await db.collection('usuario').get();
  console.log(`Found ${snapshot.size} Firestore docs`);

  // 3. Build update list
  const updates = [];
  let skipped = 0;
  let noSupabaseRow = 0;

  for (const doc of snapshot.docs) {
    const docId = doc.id;
    const data = doc.data();
    const sbUser = supabaseMap.get(docId);

    if (!sbUser) {
      noSupabaseRow++;
      continue;
    }

    const backfill = toBackfillUpdate(docId, data);
    if (!backfill) {
      skipped++;
      continue;
    }

    // Only include fields that are actually NULL in Supabase
    const filteredUpdate = { id: docId };
    let hasFieldToUpdate = false;

    if (!sbUser.full_name && backfill.full_name) {
      filteredUpdate.full_name = backfill.full_name;
      hasFieldToUpdate = true;
    }
    if (!sbUser.username && backfill.username) {
      filteredUpdate.username = backfill.username;
      hasFieldToUpdate = true;
    }
    if (!sbUser.avatar_url && backfill.avatar_url) {
      filteredUpdate.avatar_url = backfill.avatar_url;
      hasFieldToUpdate = true;
    }
    if (!sbUser.descricao && backfill.descricao) {
      filteredUpdate.descricao = backfill.descricao;
      hasFieldToUpdate = true;
    }
    if (!sbUser.telefone && backfill.telefone) {
      filteredUpdate.telefone = backfill.telefone;
      hasFieldToUpdate = true;
    }

    if (hasFieldToUpdate) {
      updates.push(filteredUpdate);
    } else {
      skipped++;
    }
  }

  console.log('');
  console.log(`Updates to apply: ${updates.length}`);
  console.log(`Skipped (already complete): ${skipped}`);
  console.log(`No Supabase row found: ${noSupabaseRow}`);

  if (updates.length === 0) {
    console.log('Nothing to backfill. All profiles are up to date.');
    process.exit(0);
  }

  // Show sample
  console.log('');
  console.log('Sample updates (first 5):');
  updates.slice(0, 5).forEach(u => {
    console.log(`  ${u.id}: ${JSON.stringify(u)}`);
  });

  if (DRY_RUN) {
    console.log('');
    console.log('DRY RUN — no changes applied.');
    console.log(`Would update ${updates.length} users.`);
    process.exit(0);
  }

  // 4. Apply updates in batches
  let okCount = 0;
  let failCount = 0;

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(updates.length / BATCH_SIZE);

    console.log(`\nBatch ${batchNum}/${totalBatches} (${batch.length} rows)...`);

    const { error } = await supabase
      .from('users')
      .upsert(batch, { onConflict: 'id', ignoreDuplicates: false });

    if (error) {
      console.error(`  FAIL: ${error.message}`);
      failCount += batch.length;
    } else {
      console.log(`  OK`);
      okCount += batch.length;
    }
  }

  console.log('');
  console.log('=== Backfill Complete ===');
  console.log(`Updated: ${okCount}`);
  console.log(`Failed: ${failCount}`);

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
