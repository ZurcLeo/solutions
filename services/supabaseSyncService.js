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
   * Sincroniza os dados de uma caixinha para o Supabase
   * @param {Object} caixinha - Objeto da caixinha (do Firestore ou Model)
   */
  async syncCaixinhaToSupabase(caixinha) {
    if (!supabase) return null;
    if (!caixinha || !caixinha.id) return null;

    logger.info('Sincronizando caixinha para o Supabase', {
      service: 'SupabaseSyncService',
      caixinhaId: caixinha.id,
      name: caixinha.name || caixinha.nome
    });

    try {
      // Mapeamento para snake_case do Supabase
      const payload = {
        id: caixinha.id,
        name: caixinha.name || caixinha.nome || 'Sem nome',
        description: caixinha.description || caixinha.descricao || null,
        admin_id: caixinha.adminId,
        contribuicao_mensal: Number(caixinha.contribuicaoMensal || 0),
        saldo_total: Number(caixinha.saldoTotal || 0),
        permite_emprestimos: caixinha.permiteEmprestimos || false,
        dia_vencimento: Number(caixinha.diaVencimento || 1),
        valor_multa: Number(caixinha.valorMulta || 0),
        valor_juros: Number(caixinha.valorJuros || 0),
        distribuicao_tipo: caixinha.distribuicaoTipo || 'padrão',
        duracao_meses: Number(caixinha.duracaoMeses || 12),
        bank_account_active: caixinha.bankAccountActive || false,
        updated_at: new Date().toISOString()
      };

      if (caixinha.governanceModel) {
        payload.governance_model = caixinha.governanceModel;
      }

      const { data, error } = await supabase
        .from('caixinhas')
        .upsert(payload, { onConflict: 'id' });

      if (error) throw error;

      logger.info('Caixinha sincronizada com sucesso no Supabase', { caixinhaId: caixinha.id });
      return data;
    } catch (error) {
      logger.error('Erro ao sincronizar caixinha para o Supabase', {
        error: error.message,
        caixinhaId: caixinha.id
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
      // ── Upsert do perfil na tabela users ─────────────────────────────
      // IMPORTANTE: ignoreDuplicates=true para NÃO sobrescrever dados já existentes no Supabase.
      // Supabase é a fonte de verdade — o sync só cria o registro se ele ainda não existir.
      // Campos editáveis (full_name, avatar_url, etc.) são atualizados exclusivamente via User.update().
      if (supabase) {
        const profilePayload = {
          id:            user.uid,
          email:         user.email || null,
          full_name:     user.nome || user.displayName || null,
          avatar_url:    user.fotoDoPerfil || user.photoURL || null,
          descricao:     user.descricao || null,
          telefone:      user.telefone || null,
          tipo_de_conta: user.tipoDeConta || 'Cliente',
          perfil_publico: user.perfilPublico || false,
          is_active:     true,
          updated_at:    new Date().toISOString(),
        };
        if (user.username) profilePayload.username = user.username.toLowerCase();
        if (user.usernameLastChangedAt) profilePayload.username_last_changed_at = user.usernameLastChangedAt;
        if (user.dataNascimento) profilePayload.data_nascimento = user.dataNascimento;
        const { error: upsertErr } = await supabase
          .from('users')
          .upsert(profilePayload, { onConflict: 'id', ignoreDuplicates: true });
        if (upsertErr) {
          logger.warn('Falha no upsert de perfil para Supabase', { userId: user.uid, error: upsertErr.message });
        }
      }

      // ── Sync de roles ─────────────────────────────────────────────────
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
