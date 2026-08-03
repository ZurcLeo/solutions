'use strict';
/**
 * remediatePhantomUsers.js
 *
 * Remediação: identifica e remove registros fantasma no Supabase —
 * usuários que entraram sem convite via provedor social (bug corrigido),
 * foram deletados do Firebase Auth mas não do Supabase.
 *
 * Também limpa Firebase Auth users órfãos de registros falhados.
 *
 * Usage:
 *   node backend/eloscloudapp/scripts/remediatePhantomUsers.js --dry-run
 *   node backend/eloscloudapp/scripts/remediatePhantomUsers.js --execute
 *   node backend/eloscloudapp/scripts/remediatePhantomUsers.js --execute --uid=dFRI0cH8vTNgDCxAXxdR7rngjYR2
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { getAuth } = require('../firebaseAdmin');
const { getSupabaseClient } = require('../config/supabase');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--execute');
const TARGET_UID = (() => {
  const uidArg = args.find(a => a.startsWith('--uid='));
  return uidArg ? uidArg.split('=')[1] : null;
})();

async function main() {
  const supabase = getSupabaseClient();
  const auth = getAuth();

  if (!supabase) {
    console.error('❌ Supabase client não disponível');
    process.exit(1);
  }

  console.log(`\n🔍 Modo: ${DRY_RUN ? 'DRY-RUN (sem alterações)' : '⚠️  EXECUTE (alterações reais)'}\n`);

  // ─── 1. Buscar usuários no Supabase ────────────────────────────────────
  let query = supabase.from('users').select('id, email, full_name, created_at, is_active');
  if (TARGET_UID) {
    query = query.eq('id', TARGET_UID);
  }
  const { data: supabaseUsers, error: fetchErr } = await query;

  if (fetchErr) {
    console.error('❌ Erro ao buscar usuários do Supabase:', fetchErr.message);
    process.exit(1);
  }

  console.log(`📊 Usuários no Supabase: ${supabaseUsers.length}`);

  // ─── 2. Verificar quais existem no Firebase Auth ──────────────────────
  const phantoms = [];
  const orphanedFirebase = [];

  for (const user of supabaseUsers) {
    try {
      await auth.getUser(user.id);
      // Existe no Firebase — pode ser legítimo ou órfão de registro falhado
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        phantoms.push(user);
        console.log(`👻 FANTASMA: ${user.email} (uid: ${user.id}) — no Supabase, NÃO no Firebase`);
      } else {
        console.error(`⚠️  Erro ao verificar ${user.id}:`, err.message);
      }
    }
  }

  // ─── 3. Verificar convites associados aos fantasmas ───────────────────
  for (const phantom of phantoms) {
    const { data: invites } = await supabase
      .from('invites')
      .select('invite_id, status, email, used_by')
      .eq('email', phantom.email);

    if (invites && invites.length > 0) {
      console.log(`  📩 Convites para ${phantom.email}:`, invites.map(i => `${i.invite_id} (${i.status})`).join(', '));
    } else {
      console.log(`  📩 Nenhum convite encontrado para ${phantom.email} — provável entrada sem convite`);
    }
  }

  // ─── 4. Remover fantasmas do Supabase ─────────────────────────────────
  if (phantoms.length === 0) {
    console.log('\n✅ Nenhum registro fantasma encontrado.');
  } else {
    console.log(`\n🗑️  ${phantoms.length} registro(s) fantasma para remover do Supabase:`);
    for (const phantom of phantoms) {
      console.log(`   - ${phantom.email} (uid: ${phantom.id}, criado: ${phantom.created_at})`);

      if (!DRY_RUN) {
        // Remover dependências primeiro (gamificação, trust, etc.)
        const tables = [
          'user_gamification', 'user_tasks', 'xp_events', 'user_selos',
          'trust_passports', 'trust_events',
          'push_subscriptions', 'user_preferences',
          'user_roles', 'user_sessions'
        ];
        for (const table of tables) {
          const col = table === 'user_roles' ? 'user_id' : (table === 'user_sessions' ? 'user_id' : 'user_id');
          const { error: delErr } = await supabase.from(table).delete().eq(col, phantom.id);
          if (delErr && !delErr.message.includes('does not exist')) {
            console.log(`   ⚠️  ${table}: ${delErr.message}`);
          }
        }

        // Remover o usuário
        const { error: delErr } = await supabase.from('users').delete().eq('id', phantom.id);
        if (delErr) {
          console.error(`   ❌ Falha ao deletar ${phantom.id}:`, delErr.message);
        } else {
          console.log(`   ✅ Deletado do Supabase: ${phantom.email}`);
        }
      }
    }
  }

  // ─── 5. Verificar Firebase Auth users órfãos (sem registro no Supabase) ─
  if (TARGET_UID && !phantoms.find(p => p.id === TARGET_UID)) {
    // O target UID não é um fantasma no Supabase — pode ser um Firebase órfão
    try {
      const fbUser = await auth.getUser(TARGET_UID);
      const { data: sbUser } = await supabase.from('users').select('id').eq('id', TARGET_UID).maybeSingle();

      if (!sbUser) {
        console.log(`\n🔥 Firebase órfão: ${fbUser.email} (uid: ${TARGET_UID}) — no Firebase, NÃO no Supabase`);
        if (!DRY_RUN) {
          await auth.deleteUser(TARGET_UID);
          console.log(`   ✅ Deletado do Firebase Auth: ${TARGET_UID}`);
        }
      }
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        console.log(`\nℹ️  UID ${TARGET_UID} não existe no Firebase Auth (já foi removido)`);
      }
    }
  }

  console.log(`\n${DRY_RUN ? '🔍 Dry-run concluído. Use --execute para aplicar.' : '✅ Remediação concluída.'}\n`);
}

main().catch(err => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});
