#!/usr/bin/env node
const path = require('path');
process.chdir(path.resolve(__dirname, '../..'));
require('dotenv').config();

// Usar o client do projeto (já trata ws/WebSocket)
const { getSupabaseClient } = require('../supabase');
const supabase = getSupabaseClient();

if (!supabase) {
  console.error('ERRO: Supabase client indisponível');
  process.exit(1);
}

(async () => {
  // 1. Buscar users específicos
  const uids = ['BKvhdxvx25dDwErLBxkYSWWwVZr1', '0oYJ8wetHqa9kdFJdwdFuHRZhuf1'];
  for (const uid of uids) {
    const { data } = await supabase.from('users')
      .select('id, email, full_name, created_at, username')
      .eq('id', uid).maybeSingle();
    console.log(`=== ${uid} ===`);
    console.log(data ? JSON.stringify(data) : 'NAO ENCONTRADO no Supabase');
  }

  // 2. Convites validated
  const { data: valInv } = await supabase.from('invites')
    .select('invite_id, email, friend_name, sender_name, sender_id, status')
    .eq('status', 'validated');

  const validatedEmails = (valInv || []).map(i => i.email.toLowerCase());

  // 3. Cruzar com users existentes
  const { data: matchedUsers } = await supabase.from('users')
    .select('id, email, full_name, username, created_at')
    .in('email', validatedEmails);

  console.log('\n=== Users com convite VALIDATED que JA existem no Supabase ===');
  const remediationList = [];

  for (const u of (matchedUsers || [])) {
    const inv = valInv.find(i => i.email.toLowerCase() === (u.email || '').toLowerCase());
    if (!inv) continue;

    const { data: anc } = await supabase.from('user_ancestry').select('ancestor_id').eq('user_id', u.id);
    const { data: wallet } = await supabase.from('elo_coin_wallets').select('balance').eq('user_id', u.id).maybeSingle();
    const needsRemediation = (!anc || anc.length === 0);

    console.log(`\n${u.email} | ${u.full_name || '(sem nome)'} | @${u.username || '?'}`);
    console.log(`  UID: ${u.id}`);
    console.log(`  Invite: ${inv.invite_id}`);
    console.log(`  Padrinho: ${inv.sender_name} (${inv.sender_id})`);
    console.log(`  Ancestry: ${anc?.length || 0} | Wallet: ${wallet?.balance ?? 'N/A'}`);
    console.log(`  Precisa remediar: ${needsRemediation ? 'SIM' : 'NAO'}`);

    if (needsRemediation) {
      remediationList.push({ userId: u.id, inviteId: inv.invite_id, email: u.email, senderName: inv.sender_name });
    }
  }

  // 4. Convites validated SEM user
  console.log('\n=== Convites validated SEM user no Supabase ===');
  for (const inv of (valInv || [])) {
    const found = (matchedUsers || []).find(u => (u.email || '').toLowerCase() === inv.email.toLowerCase());
    if (found) continue;
    console.log(`  ${inv.email} | ${inv.friend_name} | Padrinho: ${inv.sender_name}`);
  }

  // 5. Resumo
  console.log('\n=== RESUMO ===');
  console.log(`Convites validated: ${valInv?.length || 0}`);
  console.log(`Users criados (precisam remediar): ${remediationList.length}`);

  if (remediationList.length > 0) {
    console.log('\n=== LISTA DE REMEDIACAO ===');
    for (const r of remediationList) {
      console.log(`invalidateInvite('${r.inviteId}', '${r.userId}') // ${r.email}`);
    }
  }

  process.exit(0);
})();
