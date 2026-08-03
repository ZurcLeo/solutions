#!/usr/bin/env node
/**
 * Completa operações pendentes para convites que ficaram em status "validated"
 * após a remediação parcial (ancestry/EloCoins/conexões já criados).
 *
 * Operações restantes:
 *   1. Marcar convites como "used"
 *   2. Enviar emails de boas-vindas (novo template)
 *   3. Disparar gamification events
 *   4. Notificar padrinhos
 *
 * Uso:
 *   node /app/config/scripts/completeStuckInvites.js --dry-run
 *   node /app/config/scripts/completeStuckInvites.js
 */
const path = require('path');
process.chdir(path.resolve(__dirname, '../..'));
require('dotenv').config();

const { getSupabaseClient } = require('../supabase');
const emailService = require('../../services/emailService');
const Invite = require('../../models/Invite');

const DRY_RUN = process.argv.includes('--dry-run');

(async () => {
  console.log(`=== Completar Convites Presos === (${DRY_RUN ? 'DRY RUN' : 'EXECUÇÃO REAL'})\n`);

  const supabase = getSupabaseClient();
  if (!supabase) { console.error('Supabase indisponível'); process.exit(1); }

  // Convites validated
  const { data: valInv } = await supabase.from('invites')
    .select('invite_id, email, friend_name, sender_name, sender_id, status')
    .eq('status', 'validated');

  if (!valInv || valInv.length === 0) {
    console.log('Nenhum convite validated encontrado.');
    process.exit(0);
  }

  const validatedEmails = valInv.map(i => i.email.toLowerCase());
  const { data: users } = await supabase.from('users')
    .select('id, email, full_name')
    .in('email', validatedEmails);

  // Filtrar apenas convites com user correspondente
  const toComplete = [];
  for (const inv of valInv) {
    const user = (users || []).find(u => (u.email || '').toLowerCase() === inv.email.toLowerCase());
    if (!user) continue;
    toComplete.push({ inv, user });
  }

  console.log(`${toComplete.length} convite(s) para completar:\n`);

  let ok = 0, fail = 0;
  for (const { inv, user } of toComplete) {
    console.log(`${inv.email} | ${user.full_name} | Padrinho: ${inv.sender_name}`);

    if (DRY_RUN) {
      console.log('  [DRY RUN] Pulando\n');
      continue;
    }

    try {
      // 1. Marcar convite como used
      await Invite.updateByInviteId(inv.invite_id, {
        status: 'used',
        usedAt: new Date(),
        usedBy: user.id
      });
      console.log('  1/4 Convite → used');

      // 2. Enviar email de boas-vindas
      const godfatherName = inv.sender_name || 'Alguém especial';
      try {
        await emailService.sendEmail({
          to: inv.email,
          subject: `${godfatherName} te trouxe para o bairro — bem-vindo à ElosCloud`,
          templateType: 'welcome',
          data: { friendName: inv.friend_name, godfatherName },
          userId: user.id,
          reference: inv.invite_id,
          referenceType: 'invite'
        });
        console.log('  2/4 Email de boas-vindas enviado');
      } catch (emailErr) {
        console.log(`  2/4 Email falhou (não-bloqueante): ${emailErr.message}`);
      }

      // 3. Gamificação
      try {
        const gamificationService = require('../../services/gamificationService');
        await gamificationService.triggerEvent('connection_made', inv.sender_id);
        await gamificationService.triggerEvent('connection_made', user.id);
        await gamificationService.triggerEvent('invite_accepted', inv.sender_id, { invitedUserId: user.id });
        console.log('  3/4 Gamificação disparada');
      } catch (gamErr) {
        console.log(`  3/4 Gamificação falhou (não-bloqueante): ${gamErr.message}`);
      }

      // 4. Notificar padrinho
      try {
        const NotificationDispatcher = require('../../services/NotificationDispatcher');
        await NotificationDispatcher.dispatch({
          userId: inv.sender_id,
          type: 'convite_aceito',
          importance: 'high',
          data: {
            friendName: inv.friend_name,
            newUserId: user.id,
            url: `/profile/${user.id}`
          },
          metadata: { triggeredBy: 'remediation', correlationId: inv.invite_id }
        });
        console.log('  4/4 Padrinho notificado');
      } catch (notifErr) {
        console.log(`  4/4 Notificação falhou (não-bloqueante): ${notifErr.message}`);
      }

      console.log('  OK\n');
      ok++;
    } catch (err) {
      console.error(`  ERRO: ${err.message}\n`);
      fail++;
    }
  }

  console.log(`\n=== Resultado: ${ok} ok, ${fail} falhas ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
