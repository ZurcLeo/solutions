const { getFirestore } = require('../firebaseAdmin');
const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../logger');
const supabaseSyncService = require('../services/supabaseSyncService');

// Inicializar Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

/**
 * Script para migrar dados históricos de RBAC do Firestore para o Supabase
 */
async function backfillRbacToSupabase() {
  if (!supabase) {
    logger.error('Supabase não configurado. Abortando migração.');
    return { success: false, message: 'Supabase credentials missing' };
  }

  logger.info('Iniciando Backfill de RBAC para Supabase...');
  const db = getFirestore();
  const stats = {
    usersProcessed: 0,
    rolesSynced: 0,
    membersSynced: 0,
    errors: 0
  };

  try {
    // 1. Processar Usuários e Roles Globais
    const usersSnapshot = await db.collection('usuario').get();
    
    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();
      const userId = userDoc.id;
      stats.usersProcessed++;

      // Sincronizar role básica de Client se não tiver roles
      if (!userData.roles || Object.keys(userData.roles).length === 0) {
        await supabaseSyncService.syncUserRoleToSupabase(userId, 'Client', { type: 'global', resourceId: null }, 'validated');
        stats.rolesSynced++;
      } else {
        // Sincronizar roles existentes
        for (const [roleId, roleData] of Object.entries(userData.roles)) {
          // Nota: roleId no Firestore costuma ser o nome da role ou um ID que mapeia para o nome
          // No nosso sistema novo, estamos usando nomes (Admin, Client, etc)
          const roleName = roleData.roleName || roleData.name || roleId;
          await supabaseSyncService.syncUserRoleToSupabase(
            userId, 
            roleName, 
            roleData.context || { type: 'global', resourceId: null }, 
            roleData.validationStatus || 'validated'
          );
          stats.rolesSynced++;
        }
      }

      // Legado: isOwnerOrAdmin
      if (userData.isOwnerOrAdmin === true) {
        await supabaseSyncService.syncUserRoleToSupabase(userId, 'Admin', { type: 'global', resourceId: null }, 'validated');
        stats.rolesSynced++;
      }
    }

    // 2. Processar Membros de Caixinhas
    const caixinhasSnapshot = await db.collection('caixinhas').get();
    
    for (const caixinhaDoc of caixinhasSnapshot.docs) {
      const caixinhaId = caixinhaDoc.id;
      const caixinhaData = caixinhaDoc.data();
      
      // Sincronizar dados da caixinha primeiro (para evitar placeholder "Sincronizando...")
      await supabaseSyncService.syncCaixinhaToSupabase({
        id: caixinhaId,
        ...caixinhaData
      });

      // Admin da caixinha
      if (caixinhaData.adminId) {
        await supabaseSyncService.syncCaixinhaMemberToSupabase(caixinhaData.adminId, caixinhaId, 'admin', 'validated');
        stats.membersSynced++;
      }

      // Outros membros
      const membrosSnapshot = await db.collection('caixinhas').doc(caixinhaId).collection('membros').get();
      for (const membroDoc of membrosSnapshot.docs) {
        const membroData = membroDoc.data();
        if (membroData.userId && membroData.userId !== caixinhaData.adminId) {
          await supabaseSyncService.syncCaixinhaMemberToSupabase(
            membroData.userId, 
            caixinhaId, 
            membroData.role || 'membro', 
            membroData.status === 'ativo' ? 'validated' : 'pending'
          );
          stats.membersSynced++;
        }
      }
    }

    logger.info('Backfill concluído com sucesso', stats);
    return { success: true, stats };
  } catch (error) {
    logger.error('Erro durante o Backfill de RBAC', { error: error.message });
    return { success: false, error: error.message, stats };
  }
}

/**
 * Job de Reconciliação: Compara Firestore vs Supabase
 * Focado em amostragem ou auditoria de roles globais
 */
async function reconcileRbac() {
  if (!supabase) return;

  logger.info('Iniciando reconciliação de RBAC...');
  const db = getFirestore();
  const discrepancies = [];

  try {
    // Amostragem de usuários (limitado para performance)
    const usersSnapshot = await db.collection('usuario').limit(50).get();
    
    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const firestoreRoles = userDoc.data().roles || {};
      
      // Buscar roles no Supabase via RPC ou query direta
      const { data: supabaseRoles, error } = await supabase
        .from('user_roles')
        .select('*, roles(name)')
        .eq('user_id', userId);

      if (error) {
        logger.error(`Erro ao buscar roles no Supabase para ${userId}`, error);
        continue;
      }

      // Comparação simplificada: quantidade de roles
      const fsRoleCount = Object.keys(firestoreRoles).length + (userDoc.data().isOwnerOrAdmin ? 1 : 0);
      const sbRoleCount = supabaseRoles.length;

      if (fsRoleCount !== sbRoleCount) {
        discrepancies.push({
          userId,
          firestoreCount: fsRoleCount,
          supabaseCount: sbRoleCount,
          type: 'role_count_mismatch'
        });
      }
    }

    if (discrepancies.length > 0) {
      logger.warn('Divergências de RBAC detectadas!', { count: discrepancies.length, discrepancies });
      // Aqui poderíamos enviar um email ou alerta para o Sentry/Logger
    } else {
      logger.info('Reconciliação concluída: Nenhuma divergência crítica encontrada na amostragem.');
    }

    return discrepancies;
  } catch (error) {
    logger.error('Erro na reconciliação de RBAC', error);
  }
}

module.exports = {
  backfillRbacToSupabase,
  reconcileRbac
};
