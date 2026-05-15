const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../logger');

// Inicializar cliente Supabase apenas se as credenciais estiverem presentes
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Usar service role para dual-write

let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
}

/**
 * Serviço para sincronizar dados do Firestore para o Supabase (Dual-Write)
 */
class SupabaseSyncService {
  /**
   * Sincroniza uma role de usuário para o Supabase
   * @param {string} userId - ID do usuário no Firebase
   * @param {string} roleName - Nome da role (Admin, Client, etc)
   * @param {Object} context - Contexto { type, resourceId }
   * @param {string} validationStatus - Status de validação
   */
  async syncUserRoleToSupabase(userId, roleName, context = { type: 'global', resourceId: null }, validationStatus = 'validated') {
    if (!supabase) {
      logger.warn('Sincronização Supabase ignorada: Cliente não inicializado (credenciais ausentes)');
      return null;
    }
    
    logger.info('Sincronizando role de usuário para o Supabase', {
      service: 'SupabaseSyncService',
      userId,
      roleName,
      context
    });

    try {
      // 1. Chamar RPC no Supabase para garantir idempotência e tratar lógica complexa
      // O Supabase já tem funções SQL para check_global_role, etc.
      // Precisamos de uma função para atribuir roles via API.
      
      const { data, error } = await supabase.rpc('sync_user_role', {
        p_user_id: userId,
        p_role_name: roleName,
        p_context_type: context.type,
        p_resource_id: context.resourceId,
        p_validation_status: validationStatus
      });

      if (error) throw error;

      logger.info('Role sincronizada com sucesso no Supabase', { userId, roleName });
      return data;
    } catch (error) {
      logger.error('Erro ao sincronizar role para o Supabase', {
        error: error.message,
        userId,
        roleName
      });
      // Não propagamos o erro para não quebrar o fluxo do Firestore (dual-write resiliente)
      return null;
    }
  }

  /**
   * Sincroniza um membro de caixinha para o Supabase
   * @param {string} userId - ID do usuário
   * @param {string} caixinhaId - ID da caixinha
   * @param {string} role - role no contexto da caixinha (admin, membro)
   * @param {string} validationStatus - Status de validação
   */
  async syncCaixinhaMemberToSupabase(userId, caixinhaId, role, validationStatus = 'pending') {
    if (!supabase) {
      logger.warn('Sincronização Supabase ignorada: Cliente não inicializado (credenciais ausentes)');
      return null;
    }

    logger.info('Sincronizando membro de caixinha para o Supabase', {
      service: 'SupabaseSyncService',
      userId,
      caixinhaId,
      role,
      validationStatus
    });

    try {
      const { data, error } = await supabase.rpc('sync_caixinha_member', {
        p_user_id: userId,
        p_caixinha_id: caixinhaId,
        p_role_name: role === 'admin' ? 'CaixinhaManager' : 'CaixinhaMember',
        p_validation_status: validationStatus
      });

      if (error) throw error;

      logger.info('Membro de caixinha sincronizado com sucesso no Supabase', { userId, caixinhaId });
      return data;
    } catch (error) {
      logger.error('Erro ao sincronizar membro de caixinha para o Supabase', {
        error: error.message,
        userId,
        caixinhaId
      });
      return null;
    }
  }

  /**
   * Sincroniza todas as roles de um usuário em uma única operação paralela (batch).
   * Deduplica roles por nome (case-insensitive) para evitar upserts redundantes.
   * @param {string} userId
   * @param {Array<{roleName: string, context?: Object, validationStatus?: string}>} roles
   */
  async syncUserRolesBatch(userId, roles) {
    if (!supabase) {
      logger.warn('Sincronização Supabase ignorada: Cliente não inicializado (credenciais ausentes)');
      return null;
    }

    // Deduplicar por nome (case-insensitive), último valor vence
    const dedupMap = new Map();
    for (const r of roles) {
      dedupMap.set(r.roleName.toLowerCase(), r);
    }

    const unique = Array.from(dedupMap.values());

    await Promise.all(
      unique.map(({ roleName, context, validationStatus }) =>
        this.syncUserRoleToSupabase(userId, roleName, context, validationStatus)
      )
    );

    logger.info('Roles sincronizadas em batch', {
      service: 'SupabaseSyncService',
      userId,
      count: unique.length,
      roles: unique.map(r => r.roleName)
    });
  }

  /**
   * Sincroniza um usuário completo (usado após login/registro)
   * @param {Object} user - Objeto do usuário do Firestore
   */
  async syncUserToSupabase(user) {
    if (!user || !user.uid) return null;

    try {
      // Coletar todas as roles a sincronizar
      const roles = [
        { roleName: 'Client', context: { type: 'global', resourceId: null }, validationStatus: 'validated' }
      ];

      if (user.isOwnerOrAdmin === true) {
        roles.push({ roleName: 'Admin', context: { type: 'global', resourceId: null }, validationStatus: 'validated' });
      }

      if (user.roles && typeof user.roles === 'object') {
        for (const [roleId, roleData] of Object.entries(user.roles)) {
          roles.push({
            roleName: roleData.roleName || roleData.name || roleId,
            context: roleData.context,
            validationStatus: roleData.validationStatus
          });
        }
      }

      // PERF-3: uma única operação paralela com deduplicação
      await this.syncUserRolesBatch(user.uid, roles);

      return true;
    } catch (error) {
      logger.error('Erro na sincronização completa do usuário', { userId: user.uid, error: error.message });
      return false;
    }
  }
}

module.exports = new SupabaseSyncService();
