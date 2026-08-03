/**
 * Backfill one-shot: creditar missões de convite para usuários que já convidaram
 * pessoas antes do fix que integrou gamificação ao fluxo de aceite de convites.
 *
 * Missões contempladas:
 *   - first_invite       (60 XP + 10 EloCoins)   target=1
 *   - invite_5_friends   (150 XP + 30 EloCoins)  target=5
 *
 * Execução:
 *   node backend/eloscloudapp/scripts/backfill-invite-gamification.js
 *   node backend/eloscloudapp/scripts/backfill-invite-gamification.js --dry-run
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { getSupabaseClient } = require('../config/supabase');
const { getFirestore }      = require('../firebaseAdmin');

// ─── CLI ──────────────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg)  { console.log(`  ${msg}`); }
function ok(msg)   { console.log(`  ✅  ${msg}`); }
function skip(msg) { console.log(`  ⏭   ${msg}`); }
function warn(msg) { console.warn(`  ⚠️   ${msg}`); }
function err(msg)  { console.error(`  ❌  ${msg}`); }

async function callRpc(sb, fnName, args) {
  const { data, error } = await sb.rpc(fnName, args);
  if (error) throw new Error(`RPC ${fnName} falhou: ${error.message}`);
  return data?.[0] || data;
}

// ─── Lógica principal ─────────────────────────────────────────────────────────

async function run() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Backfill: missões de convite → gamificação');
  if (DRY_RUN) console.log('  ⚠️  DRY-RUN — nenhum dado será gravado');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  const sb = getSupabaseClient();
  if (!sb) { err('Supabase client indisponível — verifique SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

  // 1. Buscar tarefas
  log('Carregando tarefas do catálogo...');
  const { data: tasks, error: tasksErr } = await sb
    .from('gamification_tasks')
    .select('id, slug, target_count, xp_reward, coin_reward')
    .in('slug', ['first_invite', 'invite_5_friends'])
    .eq('is_active', true);

  if (tasksErr || !tasks?.length) {
    err(`Tarefas não encontradas: ${tasksErr?.message || 'resultado vazio'}`);
    process.exit(1);
  }

  const firstInviteTask  = tasks.find(t => t.slug === 'first_invite');
  const invite5Task      = tasks.find(t => t.slug === 'invite_5_friends');
  log(`first_invite   → id=${firstInviteTask.id}  XP=${firstInviteTask.xp_reward}  coins=${firstInviteTask.coin_reward}`);
  log(`invite_5_friends → id=${invite5Task.id}  XP=${invite5Task.xp_reward}  coins=${invite5Task.coin_reward}`);
  console.log('');

  // 2. Contar convites aceitos por remetente (Supabase + Firestore)
  const countBySender = {};

  log('Consultando convites aceitos no Supabase (tabela invites)...');
  const { data: sbRows, error: inviteErr } = await sb
    .from('invites')
    .select('sender_id')
    .eq('status', 'used')
    .not('sender_id', 'is', null);

  if (inviteErr) { warn(`Erro ao buscar convites no Supabase: ${inviteErr.message}`); }
  for (const r of (sbRows || [])) {
    countBySender[r.sender_id] = (countBySender[r.sender_id] || 0) + 1;
  }
  log(`Supabase: ${sbRows?.length || 0} convites aceitos encontrados.`);

  log('Consultando convites aceitos no Firestore (coleção convites)...');
  try {
    const db = getFirestore();
    const snap = await db.collection('convites').where('status', '==', 'used').get();
    log(`Firestore: ${snap.size} convites aceitos encontrados.`);
    snap.forEach(doc => {
      const d = doc.data();
      const sid = d.senderId;
      if (sid) countBySender[sid] = (countBySender[sid] || 0) + 1;
    });
  } catch (e) {
    warn(`Erro ao buscar convites no Firestore: ${e.message}`);
  }

  const total = Object.values(countBySender).reduce((a, b) => a + b, 0);
  if (!total) { log('Nenhum convite aceito encontrado em nenhuma fonte. Nada a fazer.'); return; }

  const senders = Object.entries(countBySender).map(([sender_id, count]) => ({ sender_id, count }));

  log(`Remetentes com convites aceitos: ${senders.length}`);
  log(`Convites aceitos no total: ${total}`);
  console.log('');

  // 3. Carregar progresso existente em user_tasks para não duplicar
  log('Carregando progresso existente em user_tasks...');
  const senderIds = senders.map(s => s.sender_id);

  const { data: existingProgress, error: progErr } = await sb
    .from('user_tasks')
    .select('user_id, task_id, progress, status, completions')
    .in('user_id', senderIds)
    .in('task_id', [firstInviteTask.id, invite5Task.id]);

  if (progErr) { err(`Erro ao buscar progresso existente: ${progErr.message}`); process.exit(1); }

  // Indexar por user_id+task_id
  const progressMap = {};
  for (const p of (existingProgress || [])) {
    progressMap[`${p.user_id}:${p.task_id}`] = p;
  }

  // 4. Processar cada remetente
  console.log('');
  log('Iniciando backfill...');
  console.log('');

  const stats = { firstInvite: { granted: 0, skipped: 0 }, invite5: { granted: 0, progress: 0, skipped: 0 } };

  for (const { sender_id, count } of senders) {
    const fi  = progressMap[`${sender_id}:${firstInviteTask.id}`];
    const i5  = progressMap[`${sender_id}:${invite5Task.id}`];

    // ── first_invite ──────────────────────────────────────────
    const fiAlreadyDone = fi?.completions >= 1;
    if (fiAlreadyDone) {
      skip(`[first_invite]   ${sender_id} — já concluída`);
      stats.firstInvite.skipped++;
    } else {
      if (DRY_RUN) {
        ok(`[first_invite]   ${sender_id} — WOULD GRANT ${firstInviteTask.xp_reward} XP + ${firstInviteTask.coin_reward} coins`);
      } else {
        try {
          const result = await callRpc(sb, 'complete_task', {
            p_user_id:   sender_id,
            p_task_slug: 'first_invite',
          });
          if (result?.success) {
            ok(`[first_invite]   ${sender_id} — ${firstInviteTask.xp_reward} XP + ${firstInviteTask.coin_reward} coins ${result.leveled_up ? '🆙' : ''}`);
            stats.firstInvite.granted++;
          } else {
            skip(`[first_invite]   ${sender_id} — RPC: ${result?.message}`);
            stats.firstInvite.skipped++;
          }
        } catch (e) {
          err(`[first_invite]   ${sender_id} — ${e.message}`);
          stats.firstInvite.skipped++;
        }
      }
    }

    // ── invite_5_friends ──────────────────────────────────────
    const i5AlreadyDone     = i5?.completions >= 1;
    const i5CurrentProgress = i5?.progress || 0;
    const i5NewProgress     = Math.min(count, 5);
    const i5Delta           = i5NewProgress - i5CurrentProgress;

    if (i5AlreadyDone) {
      skip(`[invite_5_friends] ${sender_id} — já concluída (${count} convites aceitos)`);
      stats.invite5.skipped++;
    } else if (i5Delta <= 0) {
      skip(`[invite_5_friends] ${sender_id} — progresso já atualizado (${i5CurrentProgress}/5)`);
      stats.invite5.skipped++;
    } else if (count >= 5) {
      // Completa a tarefa via RPC (concede XP + coins)
      if (DRY_RUN) {
        ok(`[invite_5_friends] ${sender_id} — WOULD COMPLETE (${count} convites) +${invite5Task.xp_reward} XP +${invite5Task.coin_reward} coins`);
      } else {
        try {
          const result = await callRpc(sb, 'complete_task', {
            p_user_id:   sender_id,
            p_task_slug: 'invite_5_friends',
          });
          if (result?.success) {
            ok(`[invite_5_friends] ${sender_id} — ${invite5Task.xp_reward} XP + ${invite5Task.coin_reward} coins ${result.leveled_up ? '🆙' : ''}`);
            stats.invite5.granted++;
          } else {
            skip(`[invite_5_friends] ${sender_id} — RPC: ${result?.message}`);
            stats.invite5.skipped++;
          }
        } catch (e) {
          err(`[invite_5_friends] ${sender_id} — ${e.message}`);
          stats.invite5.skipped++;
        }
      }
    } else {
      // Progresso parcial (count < 5): apenas atualiza user_tasks, sem conceder XP
      if (DRY_RUN) {
        ok(`[invite_5_friends] ${sender_id} — WOULD SET progress ${i5CurrentProgress}→${i5NewProgress}/5 (${count} convites, sem XP ainda)`);
      } else {
        try {
          const { error: upsertErr } = await sb.from('user_tasks').upsert({
            user_id:    sender_id,
            task_id:    invite5Task.id,
            progress:   i5NewProgress,
            status:     'in_progress',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id,task_id', ignoreDuplicates: false });

          if (upsertErr) throw new Error(upsertErr.message);
          ok(`[invite_5_friends] ${sender_id} — progresso ${i5CurrentProgress}→${i5NewProgress}/5`);
          stats.invite5.progress++;
        } catch (e) {
          err(`[invite_5_friends] ${sender_id} — ${e.message}`);
          stats.invite5.skipped++;
        }
      }
    }
  }

  // 5. Resumo
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Resumo do backfill');
  console.log('═══════════════════════════════════════════════════════════');
  log(`first_invite    → concedidas: ${stats.firstInvite.granted}  |  puladas: ${stats.firstInvite.skipped}`);
  log(`invite_5_friends → completas: ${stats.invite5.granted}  |  progresso atualizado: ${stats.invite5.progress}  |  puladas: ${stats.invite5.skipped}`);
  if (DRY_RUN) console.log('\n  ⚠️  DRY-RUN concluído — rode sem --dry-run para aplicar.');
  console.log('');
}

run().catch(e => { console.error('\n❌ Erro fatal:', e.message); process.exit(1); });
