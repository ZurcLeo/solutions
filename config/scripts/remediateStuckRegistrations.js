#!/usr/bin/env node
/**
 * Remediação de registros presos pelo bug TDZ em inviteService.invalidateInvite.
 *
 * Executa invalidateInvite para cada usuário que tem convite validated + user criado
 * mas sem ancestry/EloCoins/conexões (operações que nunca rodaram).
 *
 * Uso:
 *   node eloscloudapp/config/scripts/remediateStuckRegistrations.js --dry-run
 *   node eloscloudapp/config/scripts/remediateStuckRegistrations.js
 */
const path = require('path');
process.chdir(path.resolve(__dirname, '../..'));
require('dotenv').config();

const { getSupabaseClient } = require('../supabase');
const inviteService = require('../../services/inviteService');

const DRY_RUN = process.argv.includes('--dry-run');

(async () => {
  console.log('=== Remediação de Registros Presos (TDZ Bug) ===');
  console.log(`Modo: ${DRY_RUN ? 'DRY RUN' : 'EXECUÇÃO REAL'}\n`);

  const supabase = getSupabaseClient();
  if (!supabase) { console.error('Supabase indisponível'); process.exit(1); }

  // 1. Convites validated
  const { data: valInv, error: e1 } = await supabase.from('invites')
    .select('invite_id, email, friend_name, sender_name, sender_id')
    .eq('status', 'validated');

  if (e1 || !valInv?.length) {
    console.log('Nenhum convite validated encontrado.');
    process.exit(0);
  }

  const validatedEmails = valInv.map(i => i.email.toLowerCase());

  // 2. Cruzar com users que já existem
  const { data: users } = await supabase.from('users')
    .select('id, email, full_name')
    .in('email', validatedEmails);

  if (!users?.length) {
    console.log('Nenhum user corresponde aos convites validated.');
    process.exit(0);
  }

  // 3. Filtrar apenas os que não têm ancestry (não foram remediados)
  const toRemediate = [];
  for (const u of users) {
    const inv = valInv.find(i => i.email.toLowerCase() === (u.email || '').toLowerCase());
    if (!inv) continue;
    const { data: anc } = await supabase.from('user_ancestry').select('user_id').eq('user_id', u.id).limit(1);
    if (anc && anc.length > 0) continue; // Já remediado
    toRemediate.push({ userId: u.id, inviteId: inv.invite_id, email: u.email, name: u.full_name, sender: inv.sender_name });
  }

  console.log(`${toRemediate.length} usuário(s) precisam de remediação:\n`);

  let ok = 0, fail = 0;
  for (const r of toRemediate) {
    console.log(`${r.email} | ${r.name} | Padrinho: ${r.sender}`);
    console.log(`  Invite: ${r.inviteId} → User: ${r.userId}`);

    if (DRY_RUN) {
      console.log('  [DRY RUN] Pulando\n');
      continue;
    }

    try {
      await inviteService.invalidateInvite(r.inviteId, r.userId);
      console.log('  OK — ancestry, EloCoins 500, conexões, convite→used, email enviado\n');
      ok++;
    } catch (err) {
      console.error(`  ERRO: ${err.message}\n`);
      fail++;
    }
  }

  if (!DRY_RUN) {
    console.log(`\n=== Resultado: ${ok} ok, ${fail} falhas ===`);
  }
  process.exit(fail > 0 ? 1 : 0);
})();
