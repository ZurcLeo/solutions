'use strict';
/**
 * backfill-trust-events.js
 *
 * One-time script: retroactively creates trust_events for actions
 * that happened before the trust passport system was deployed.
 *
 * Then calls calculatePassport for ALL users to generate/refresh passports.
 *
 * Events backfilled:
 *   - identity_verified (+5, account) — users with kyc_status = 'verified'
 *   - contribution_paid (+2, financial) — each paid contribution
 *   - connection_made (+1, social) — each active connection (new event type)
 *
 * Usage:
 *   node eloscloudapp/scripts/backfill-trust-events.js
 *   node eloscloudapp/scripts/backfill-trust-events.js --dry-run
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { getSupabaseClient } = require('../config/supabase');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

async function main() {
  console.log('=== Backfill: Trust Events (retroactive) ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('');

  const supabase = getSupabaseClient();
  if (!supabase) {
    console.error('Supabase client not available.');
    process.exit(1);
  }

  const eventsToInsert = [];

  // ── 1. KYC verified users → identity_verified (+5, account) ──
  console.log('1. Checking KYC verified users...');
  const { data: kycUsers, error: kycErr } = await supabase
    .from('users')
    .select('id, kyc_verified_at')
    .eq('kyc_status', 'verified');

  if (kycErr) { console.error('KYC query error:', kycErr.message); }

  for (const u of (kycUsers || [])) {
    // Check if event already exists
    const { count } = await supabase
      .from('trust_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', u.id)
      .eq('event_type', 'identity_verified');

    if ((count || 0) === 0) {
      eventsToInsert.push({
        user_id: u.id,
        domain: 'account',
        event_type: 'identity_verified',
        impact: 5,
        is_negative: false,
        metadata: { backfill: true, level: 'cpf' },
        created_at: u.kyc_verified_at || new Date().toISOString(),
      });
    }
  }
  console.log(`   KYC events to create: ${eventsToInsert.length}`);

  // ── 2. Active connections → connection_made (+1, social) ──
  console.log('2. Checking active connections...');
  const { data: connections, error: connErr } = await supabase
    .from('user_connections')
    .select('user_id, connected_user_id, created_at')
    .eq('status', 'active');

  if (connErr) { console.error('Connections query error:', connErr.message); }

  // Deduplicate: only count each unique user once per connection pair
  const connectionUsers = new Map(); // userId → count of connections
  for (const conn of (connections || [])) {
    connectionUsers.set(conn.user_id, (connectionUsers.get(conn.user_id) || 0) + 1);
  }

  let connEventsCount = 0;
  for (const [userId, count] of connectionUsers) {
    // Check if any connection events already exist for this user
    const { count: existingCount } = await supabase
      .from('trust_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('event_type', 'connection_made');

    if ((existingCount || 0) === 0) {
      // Create one event per connection (capped at 5 to avoid spam)
      const eventsNeeded = Math.min(count, 5);
      for (let i = 0; i < eventsNeeded; i++) {
        eventsToInsert.push({
          user_id: userId,
          domain: 'social',
          event_type: 'connection_made',
          impact: 1,
          is_negative: false,
          metadata: { backfill: true, connectionIndex: i + 1 },
          created_at: new Date().toISOString(),
        });
        connEventsCount++;
      }
    }
  }
  console.log(`   Connection events to create: ${connEventsCount}`);

  // ── 3. Paid contributions → contribution_paid (+2, financial) ──
  console.log('3. Checking paid contributions...');
  const { data: contributions, error: contErr } = await supabase
    .from('contribuicoes')
    .select('membro_id, created_at')
    .eq('status', 'pago');

  if (contErr) {
    console.log('   Contribuicoes table not found or error:', contErr.message);
  }

  let contribEventsCount = 0;
  if (contributions && contributions.length > 0) {
    // Group by member
    const memberContribs = new Map();
    for (const c of contributions) {
      if (!memberContribs.has(c.membro_id)) memberContribs.set(c.membro_id, 0);
      memberContribs.set(c.membro_id, memberContribs.get(c.membro_id) + 1);
    }

    for (const [membroId, count] of memberContribs) {
      const { count: existingCount } = await supabase
        .from('trust_events')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', membroId)
        .eq('event_type', 'contribution_paid');

      if ((existingCount || 0) === 0) {
        // Cap at 10 events per user
        const eventsNeeded = Math.min(count, 10);
        for (let i = 0; i < eventsNeeded; i++) {
          eventsToInsert.push({
            user_id: membroId,
            domain: 'financial',
            event_type: 'contribution_paid',
            impact: 2,
            is_negative: false,
            metadata: { backfill: true, contributionIndex: i + 1 },
            created_at: new Date().toISOString(),
          });
          contribEventsCount++;
        }
      }
    }
  }
  console.log(`   Contribution events to create: ${contribEventsCount}`);

  // ── Summary ──
  console.log('');
  console.log(`Total events to insert: ${eventsToInsert.length}`);

  if (DRY_RUN) {
    console.log('DRY RUN — no changes applied.');
    const byType = {};
    eventsToInsert.forEach(e => {
      byType[e.event_type] = (byType[e.event_type] || 0) + 1;
    });
    console.log('By type:', byType);
    const byUser = {};
    eventsToInsert.forEach(e => {
      byUser[e.user_id] = (byUser[e.user_id] || 0) + 1;
    });
    console.log('By user:', byUser);
    process.exit(0);
  }

  // ── Insert events in batches ──
  if (eventsToInsert.length > 0) {
    console.log('\nInserting events...');
    const BATCH_SIZE = 50;
    let inserted = 0;

    for (let i = 0; i < eventsToInsert.length; i += BATCH_SIZE) {
      const batch = eventsToInsert.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from('trust_events').insert(batch);
      if (error) {
        console.error(`  Batch ${Math.floor(i / BATCH_SIZE) + 1} FAILED:`, error.message);
      } else {
        inserted += batch.length;
        console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} inserted`);
      }
    }
    console.log(`Inserted: ${inserted}/${eventsToInsert.length}`);
  }

  // ── Recalculate passports for ALL users ──
  console.log('\nRecalculating passports for all users...');

  // Get ALL user IDs
  const { data: allUsers, error: allErr } = await supabase
    .from('users')
    .select('id')
    .not('email', 'like', 'pending_sync_%');

  if (allErr) {
    console.error('Error fetching users:', allErr.message);
    process.exit(1);
  }

  console.log(`Users to process: ${allUsers.length}`);

  // Import calculatePassport
  const trustPassportService = require('../services/trustPassportService');

  let success = 0;
  let failed = 0;

  for (const user of allUsers) {
    try {
      await trustPassportService.calculatePassport(user.id);
      success++;
    } catch (err) {
      console.error(`  FAIL ${user.id}: ${err.message}`);
      failed++;
    }
  }

  console.log('');
  console.log('=== Backfill Complete ===');
  console.log(`Passports calculated: ${success}`);
  console.log(`Failed: ${failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
