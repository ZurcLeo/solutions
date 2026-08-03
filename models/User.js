const { getAuth } = require('../firebaseAdmin');
const FirestoreService = require('../utils/firestoreService');
const dbServiceUser = FirestoreService.collection('usuario');
const {getFirestore} = require('../firebaseAdmin')
const { logger } = require('../logger');
const { getSupabaseClient } = require('../config/supabase');
const { getOptedOutUserIds } = require('../services/userPreferencesService');

// Lazy proxy — evita init eagre do Firestore no startup
const db = new Proxy({}, { get(_, k) { const d = getFirestore(); return typeof d[k] === 'function' ? d[k].bind(d) : d[k]; } });

class User {
  constructor(data) {
    this.id = data.uid;
    this.uid = data.uid;
    this.nome = data.nome;
    this.email = data.email;
    this.telefone = data.telefone;
    this.reacoes = data.reacoes || {};
    this.emailVerified = data.emailVerified || false;
    this.perfilPublico = data.perfilPublico || false;
    this.ja3Hash = data.ja3Hash;
    this.caixinhas = data.caixinhas || [];
    this.tipoDeConta = data.tipoDeConta;
    this.isOwnerOrAdmin = data.isOwnerOrAdmin || false;
    this.fotoDoPerfil = data.fotoDoPerfil;
    this.descricao = data.descricao;
    this.interesses = data.interesses || {
      lazer: [],
      bemestar: [],
      social: [],
      tecnologia: [],
      negocios: [],
      marketing: [],
      educacao: [],
      marketplace: [],
      sustentabilidade: []
    };
    this.roles = data.roles || {};
    this.amigosAutorizados = data.amigosAutorizados || [];
    this.amigos = data.amigos || [];
    this.dataCriacao = data.dataCriacao || new Date();
    this.saldoElosCoins = data.saldoElosCoins || 0;
    this.conversas = data.conversas || {};
    this.personalWishlist = data.personalWishlist || data.personal_wishlist || [];
    this.username = data.username ? data.username.toLowerCase() : null;
    this.usernameLastChangedAt = data.usernameLastChangedAt || null;
    this.dataNascimento = data.dataNascimento || data.data_nascimento || null;
    // KYC — Verificação de Identidade
    this.kycStatus = data.kycStatus || data.kyc_status || 'none';
    this.kycLevel = data.kycLevel || data.kyc_level || 'none';
    this.kycVerifiedAt = data.kycVerifiedAt || data.kyc_verified_at || null;
    // Recovery email
    this.recoveryEmail = data.recoveryEmail || data.recovery_email || null;
    this.recoveryEmailVerified = data.recoveryEmailVerified ?? data.recovery_email_verified ?? false;
    this.recoveryEmailVerifiedAt = data.recoveryEmailVerifiedAt || data.recovery_email_verified_at || null;
    // Phone verification
    this.phoneVerified = data.phoneVerified ?? data.phone_verified ?? false;
    this.phoneVerifiedAt = data.phoneVerifiedAt || data.phone_verified_at || null;
    // MFA — Autenticacao em dois fatores
    this.mfaEnabled = data.mfaEnabled ?? data.mfa_enabled ?? false;
    this.mfaMethod = data.mfaMethod || data.mfa_method || null;
    this.totpSecret = data.totpSecret || data.totp_secret || null;
    this.backupCodes = data.backupCodes || data.backup_codes || null;
    this.backupCodesCount = data.backupCodesCount ?? data.backup_codes_count ?? 0;
    this.mfaEnabledAt = data.mfaEnabledAt || data.mfa_enabled_at || null;
  }

  toPlainObject() {
    return {
      id: this.uid,
      uid: this.uid,
      nome: this.nome,
      email: this.email,
      reacoes: this.reacoes,
      telefone: this.telefone,
      perfilPublico: this.perfilPublico,
      emailVerified: this.emailVerified,
      ja3Hash: this.ja3Hash,
      caixinhas: this.caixinhas,
      tipoDeConta: this.tipoDeConta,
      isOwnerOrAdmin: this.isOwnerOrAdmin,
      fotoDoPerfil: this.fotoDoPerfil,
      descricao: this.descricao,
      interesses: this.interesses,
      roles: this.roles,
      amigosAutorizados: this.amigosAutorizados,
      amigos: this.amigos,
      dataCriacao: this.dataCriacao,
      saldoElosCoins: this.saldoElosCoins,
      conversas: this.conversas,
      personal_wishlist: this.personalWishlist,
      username: this.username,
      usernameLastChangedAt: this.usernameLastChangedAt,
      dataNascimento: this.dataNascimento,
      kycStatus: this.kycStatus,
      kycLevel: this.kycLevel,
      kycVerifiedAt: this.kycVerifiedAt,
      recoveryEmail: this.recoveryEmail,
      recoveryEmailVerified: this.recoveryEmailVerified,
      recoveryEmailVerifiedAt: this.recoveryEmailVerifiedAt,
      phoneVerified: this.phoneVerified,
      phoneVerifiedAt: this.phoneVerifiedAt,
      // MFA — apenas status publico (sem segredos)
      mfaEnabled: this.mfaEnabled,
      mfaMethod: this.mfaMethod,
      backupCodesCount: this.backupCodesCount,
      mfaEnabledAt: this.mfaEnabledAt,
    };
  }

static clearSearchCache() {
  logger.info('Cache de busca limpo', { service: 'userModel', function: 'clearSearchCache' });
}

  static async findAll() {
    // const db = getFirestore();
    try {
      const usersCollection = await dbServiceUser.get();
      
      const users = usersCollection.docs.map(doc => {
        const userData = doc.data();
        userData.id = doc.id;
        return new User(userData);
      });

      logger.info('Usuários obtidos com sucesso', { service: 'userModel', function: 'findAll', count: users.length });
      return users;
    } catch (error) {
      logger.error('Erro ao buscar todos os usuários', { service: 'userModel', function: 'findAll', error: error.message });
      throw new Error('Erro ao buscar todos os usuários');
    }
  }

  static async getById(userId) {
    if (!userId) {
      const error = new Error('userId não fornecido');
      logger.error('Erro no getById', { service: 'userModel', function: 'getById', error: error.message });
      throw error;
    }

    try {
      // ── 1. Supabase (fonte primária) ──
      const supabase = getSupabaseClient();
      if (supabase) {
        const { data: sbUser, error: sbErr } = await supabase
          .from('users')
          .select(`
            id, email, full_name, avatar_url, descricao, telefone,
            tipo_de_conta, perfil_publico, username, username_last_changed_at,
            personal_wishlist,
            is_active, data_nascimento, kyc_status, kyc_level, kyc_verified_at, created_at,
            email_verified, email_verified_at,
            recovery_email, recovery_email_verified, recovery_email_verified_at,
            phone_verified, phone_verified_at,
            mfa_enabled, mfa_method, totp_secret, backup_codes, backup_codes_count, mfa_enabled_at,
            user_roles (
              role_id,
              validation_status,
              expires_at,
              metadata,
              roles ( id, name, description )
            )
          `)
          .eq('id', userId)
          .maybeSingle();

        if (!sbErr && sbUser) {
          // Transforma o array user_roles no mapa { roleId: {...} } esperado pelo constructor
          const rolesMap = {};
          for (const ur of sbUser.user_roles || []) {
            if (ur.validation_status === 'rejected') continue;
            if (ur.expires_at && new Date(ur.expires_at) < new Date()) continue;
            rolesMap[ur.role_id] = {
              name:             ur.roles?.name || ur.role_id,
              description:      ur.roles?.description || '',
              validationStatus: ur.validation_status,
              context:          { type: 'global' },
              metadata:         ur.metadata || {},
            };
          }

          logger.info('Usuário encontrado no Supabase', { service: 'userModel', function: 'getById', userId, rolesCount: Object.keys(rolesMap).length });
          return new User({
            uid:                   sbUser.id,
            email:                 sbUser.email || '',
            nome:                  sbUser.full_name || sbUser.username || sbUser.email?.split('@')[0] || 'Usuário',
            fotoDoPerfil:          sbUser.avatar_url || '',
            descricao:             sbUser.descricao || '',
            telefone:              sbUser.telefone || '',
            tipoDeConta:           sbUser.tipo_de_conta || 'Cliente',
            perfilPublico:         sbUser.perfil_publico || false,
            username:              sbUser.username || null,
            usernameLastChangedAt: sbUser.username_last_changed_at || null,
            dataNascimento:        sbUser.data_nascimento || null,
            kycStatus:             sbUser.kyc_status || 'none',
            kycLevel:              sbUser.kyc_level || 'none',
            kycVerifiedAt:         sbUser.kyc_verified_at || null,
            personal_wishlist:     sbUser.personal_wishlist || [],
            dataCriacao:           sbUser.created_at ? new Date(sbUser.created_at) : new Date(),
            emailVerified:           sbUser.email_verified ?? false,
            emailVerifiedAt:         sbUser.email_verified_at || null,
            recoveryEmail:           sbUser.recovery_email || null,
            recoveryEmailVerified:   sbUser.recovery_email_verified ?? false,
            recoveryEmailVerifiedAt: sbUser.recovery_email_verified_at || null,
            phoneVerified:           sbUser.phone_verified ?? false,
            phoneVerifiedAt:         sbUser.phone_verified_at || null,
            mfaEnabled:              sbUser.mfa_enabled ?? false,
            mfaMethod:               sbUser.mfa_method || null,
            totpSecret:              sbUser.totp_secret || null,
            backupCodes:             sbUser.backup_codes || null,
            backupCodesCount:        sbUser.backup_codes_count ?? 0,
            mfaEnabledAt:            sbUser.mfa_enabled_at || null,
            roles: rolesMap, caixinhas: [], amigos: [], amigosAutorizados: [],
            reacoes: {}, conversas: {}, saldoElosCoins: 0, interesses: {},
          });
        }
      }

      // ── 2. Firestore fallback (dados legados ainda não sincronizados) ──
      logger.warn('Usuário não encontrado no Supabase — tentando Firestore', { service: 'userModel', function: 'getById', userId });
      const userDoc = await dbServiceUser.doc(userId).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        userData.id = userId;
        return new User(userData);
      }

      // ── 3. Firebase Auth fallback (comportamento legado) ──────────────────
      logger.warn('Usuário não encontrado no Supabase — tentando Firebase Auth', { service: 'userModel', function: 'getById', userId });
      try {
        const auth = getAuth();
        const userRecord = await auth.getUser(userId);
        logger.info('Criando objeto User temporário com dados do Firebase', { service: 'userModel', function: 'getById', userId });
        return new User({
          uid:            userId,
          email:          userRecord.email || 'sem email',
          nome:           userRecord.displayName || userRecord.email?.split('@')[0] || 'Novo Usuário',
          fotoDoPerfil:   userRecord.photoURL || '',
          dataCriacao:    new Date(),
          telefone:       '',
          ja3Hash:        userRecord.ja3Hash || '',
          emailVerified:  userRecord.emailVerified || false,
          perfilPublico:  false,
          isFirstAccess:  true,
          tipoDeConta:    'Cliente',
          saldoElosCoins: 0,
          isOwnerOrAdmin: false,
          roles: {}, caixinhas: [], reacoes: {},
          descricao:      'Escreva algo sobre voce.',
          interesses:     {}, conversas: {}, amigos: [], amigosAutorizados: []
        });
      } catch (firebaseError) {
        logger.error('Falha ao recuperar dados básicos do Firebase', { service: 'userModel', function: 'getById', userId, error: firebaseError.message });
        return null;
      }
    } catch (error) {
      logger.error('Erro ao obter usuário por ID', { service: 'userModel', function: 'getById', userId, error: error.message });
      throw error;
    }
  }

/**
 * Adiciona uma role ao usuário
 * @param {string} userId - ID do usuário
 * @param {string} roleId - ID da role
 * @param {Object} context - Contexto da role
 * @param {Object} options - Opções adicionais
 * @returns {Promise<Object>} Dados da role adicionada
 */
static async addRole(userId, roleId, context = {}, options = {}) {
  try {
    // Obter referência do documento do usuário
    const userRef = db.collection('usuario').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      throw new Error('Usuário não encontrado');
    }
    
    // Obter definição da role do mapa fixo
    const { roles } = require('../config/data/initialData');
    const roleData = roles[roleId];
    
    if (!roleData) {
      throw new Error(`Role ${roleId} não encontrada`);
    }
    
    // Dados a serem salvos
    const userRole = {
      ...roleData,
      context: context || { type: 'global', resourceId: null },
      validationStatus: options.validationStatus || 'pending',
      assignedAt: new Date().toISOString(),
      metadata: options.metadata || {}
    };
    
    // Atualizar o documento
    await userRef.update({
      [`roles.${roleId}`]: userRole
    });
    
    logger.info('Role adicionada ao usuário com sucesso', {
      function: 'User.addRole',
      userId,
      roleId
    });
    
    return userRole;
  } catch (error) {
    logger.error('Erro ao adicionar role ao usuário', {
      function: 'User.addRole',
      userId,
      roleId,
      error: error.message
    });
    throw error;
  }
}

/**
 * Remove uma role do usuário
 * @param {string} userId - ID do usuário
 * @param {string} roleId - ID da role
 * @returns {Promise<boolean>} Sucesso da operação
 */
static async removeRole(userId, roleId) {
  try {
    const userRef = db.collection('usuario').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      throw new Error('Usuário não encontrado');
    }
    
    const userData = userDoc.data();
    const userRoles = userData.roles || {};
    
    if (!userRoles[roleId]) {
      return false; // Role não existente
    }
    
    // Remover a role
    await userRef.update({
      [`roles.${roleId}`]: firebase.db.FieldValue.delete()
    });
    
    logger.info('Role removida do usuário com sucesso', {
      function: 'User.removeRole',
      userId,
      roleId
    });
    
    return true;
  } catch (error) {
    logger.error('Erro ao remover role do usuário', {
      function: 'User.removeRole',
      userId,
      roleId,
      error: error.message
    });
    throw error;
  }
}

/**
 * Verifica se um usuário tem uma role específica
 * @param {string} userId - ID do usuário
 * @param {string} roleName - Nome da role
 * @param {string} contextType - Tipo de contexto
 * @param {string} resourceId - ID do recurso
 * @returns {Promise<boolean>} Se o usuário tem a role
 */
static async hasRole(userId, roleName, contextType = 'global', resourceId = null) {
  // Feature Toggle: Usar Supabase se configurado e ativo
  if (process.env.USE_SUPABASE_RBAC === 'true') {
    const userRoleService = require('../services/userRoleService');
    return await userRoleService.checkUserHasRole(userId, roleName, contextType, resourceId);
  }

  try {
    const userDoc = await db.collection('usuario').doc(userId).get();
    
    if (!userDoc.exists) {
      return false;
    }
    
    const userData = userDoc.data();
    const userRoles = userData.roles || {};
    
    // Buscar a role pelo nome
    const { roles } = require('../config/data/initialData');
    const targetRoleId = Object.keys(roles).find(id => 
      roles[id].name.toLowerCase() === roleName.toLowerCase()
    );
    
    if (!targetRoleId) {
      // Fallback: se o nome da role for passado como ID
      if (userRoles[roleName]) {
        const userRole = userRoles[roleName];
        if (userRole.validationStatus === 'validated') return true;
      }
      return false; 
    }
    
    // Verificar se o usuário tem a role
    const userRole = userRoles[targetRoleId];
    
    if (!userRole) {
      return false;
    }
    
    // Verificar status de validação
    if (userRole.validationStatus !== 'validated') {
      return false;
    }
    
    // Verificar contexto
    if (contextType !== 'global') {
      // Se o contexto não é global, verificar compatibilidade
      if (!userRole.context || userRole.context.type !== contextType) {
        return false;
      }
      
      // Se resourceId foi especificado, verificar
      if (resourceId && userRole.context.resourceId !== resourceId) {
        return false;
      }
    }
    
    return true;
  } catch (error) {
    logger.error('Erro ao verificar role do usuário', {
      function: 'User.hasRole',
      userId,
      roleName,
      error: error.message
    });
    return false; // Em caso de erro, retornar false por segurança
  }
}

/**
 * Verifica se um usuário tem uma permissão específica
 * @param {string} userId - ID do usuário
 * @param {string} permissionName - Nome da permissão
 * @param {string} contextType - Tipo de contexto
 * @param {string} resourceId - ID do recurso
 * @returns {Promise<boolean>} Se o usuário tem a permissão
 */
static async hasPermission(userId, permissionName, contextType = 'global', resourceId = null) {
  // Feature Toggle: Usar Supabase se configurado e ativo
  if (process.env.USE_SUPABASE_RBAC === 'true') {
    const userRoleService = require('../services/userRoleService');
    return await userRoleService.checkUserHasPermission(userId, permissionName, contextType, resourceId);
  }

  try {
    const userDoc = await db.collection('usuario').doc(userId).get();
    
    if (!userDoc.exists) {
      return false;
    }
    
    const userData = userDoc.data();
    const userRoles = userData.roles || {};
    
    // Obter mapeamentos do Firestore
    const rolePermissionsSnapshot = await db.collection('role_permissions').get();
    const rolePermissions = {};
    rolePermissionsSnapshot.forEach(doc => {
      rolePermissions[doc.id] = doc.data();
    });
    
    // Para cada role do usuário
    for (const roleId in userRoles) {
      const userRole = userRoles[roleId];
      
      // Verificar status de validação
      if (userRole.validationStatus !== 'validated') {
        continue;
      }
      
      // Verificar contexto
      if (contextType !== 'global') {
        // Se o contexto não é global, verificar compatibilidade
        if (!userRole.context || userRole.context.type !== contextType) {
          continue;
        }
        
        // Se resourceId foi especificado, verificar
        if (resourceId && userRole.context.resourceId !== resourceId) {
          continue;
        }
      }
      
      // Encontrar permissões para esta role
      const rolePerms = Object.values(rolePermissions)
        .filter(rp => rp.roleId === roleId)
        .map(rp => rp.permissionId);
      
      // Verificar se a permissão está incluída
      const hasPermission = rolePerms.includes(permissionName);
      
      if (hasPermission) {
        return true;
      }
    }
    
    // Se nenhuma role fornece a permissão
    return false;
  } catch (error) {
    logger.error('Erro ao verificar permissão do usuário', {
      function: 'User.hasPermission',
      userId,
      permissionName,
      error: error.message
    });
    return false; // Em caso de erro, retornar false por segurança
  }
}

  static async searchUsers(query, currentUserId) {
    logger.info('searchUsers chamado', { service: 'userModel', function: 'searchUsers', query, currentUserId });

    if (!query) {
      throw new Error('Query de busca não fornecida');
    }

    try {
      const supabase = getSupabaseClient();
      const queryLower = query.toLowerCase().trim();

      // ── 1. Busca no Supabase (fonte primária) ──
      if (supabase) {
        // ilike pattern para match parcial em nome, email, username e descricao
        const pattern = `%${queryLower}%`;

        // PREFS-003: buscar IDs de usuários que desativaram appear_in_searches
        const hiddenUserIds = await getOptedOutUserIds('appear_in_searches');

        let searchQuery = supabase
          .from('users')
          .select('id, email, full_name, avatar_url, descricao, telefone, perfil_publico, username, is_active')
          .neq('id', currentUserId)
          .eq('is_active', true)
          .or(`full_name.ilike.${pattern},email.ilike.${pattern},username.ilike.${pattern},descricao.ilike.${pattern}`)
          .limit(30);

        // PREFS-003: excluir usuários que desativaram appear_in_searches
        if (hiddenUserIds.length > 0) {
          searchQuery = searchQuery.not('id', 'in', `(${hiddenUserIds.join(',')})`);
        }

        const { data: rows, error: sbErr } = await searchQuery;

        if (sbErr) {
          logger.error('Erro Supabase na busca de usuários', { service: 'userModel', function: 'searchUsers', error: sbErr.message });
          throw new Error(sbErr.message);
        }

        // Buscar conexões ativas do currentUser para filtro de privacidade
        let activeConnectionIds = new Set();
        try {
          const { data: conns } = await supabase
            .from('user_connections')
            .select('friend_id')
            .eq('user_id', currentUserId)
            .eq('status', 'active');
          if (conns) {
            activeConnectionIds = new Set(conns.map(c => c.friend_id));
          }
        } catch (_) {
          // Prosseguir sem filtro de conexões
        }

        // Filtrar por privacidade: perfil_publico, conexão ativa, match de @username,
        // ou match direto de nome/email (quem busca já conhece esses dados).
        const filtered = (rows || []).filter(row => {
          if (row.perfil_publico) return true;
          if (activeConnectionIds.has(row.id)) return true;
          if (row.username && row.username.toLowerCase().includes(queryLower)) return true;
          const nameMatch = row.full_name && row.full_name.toLowerCase().includes(queryLower);
          const emailMatch = row.email && row.email.toLowerCase().includes(queryLower);
          if (nameMatch || emailMatch) return true;
          return false;
        });

        const users = filtered.slice(0, 20).map(row => new User({
          uid:           row.id,
          email:         row.email || '',
          nome:          row.full_name || row.username || row.email?.split('@')[0] || 'Usuário',
          fotoDoPerfil:  row.avatar_url || '',
          descricao:     row.descricao || '',
          telefone:      row.telefone || '',
          perfilPublico: row.perfil_publico || false,
          username:      row.username || null,
        }));

        logger.info('Busca realizada com sucesso (Supabase)', { service: 'userModel', function: 'searchUsers', resultsCount: users.length });
        return users;
      }

      // ── 2. Firestore fallback (legado) ──
      logger.warn('Supabase indisponível — fallback Firestore para searchUsers', { service: 'userModel', function: 'searchUsers' });

      const userDocs = await dbServiceUser.limit(100).get();

      // PREFS-003: buscar opted-out IDs (Supabase pode estar disponível mesmo com Firestore fallback)
      const hiddenUserIdsFb = await getOptedOutUserIds('appear_in_searches');
      const hiddenSetFb = new Set(hiddenUserIdsFb);

      let activeConnectionIds = new Set();
      try {
        const connectionsRef = db.collection('conexoes').doc(currentUserId).collection('ativas');
        const activeConnections = await connectionsRef.get();
        activeConnectionIds = new Set(activeConnections.docs.map(doc => doc.id));
      } catch (_) { /* Coleção pode não existir */ }

      const users = userDocs.docs
        .map(doc => { const data = doc.data(); data.id = doc.id; return data; })
        .filter(userData => {
          if (userData.id === currentUserId || userData.uid === currentUserId) return false;
          // PREFS-003: excluir usuários que desativaram appear_in_searches
          if (hiddenSetFb.has(userData.id)) return false;
          const nameMatch     = userData.nome      && userData.nome.toLowerCase().includes(queryLower);
          const emailMatch    = userData.email     && userData.email.toLowerCase().includes(queryLower);
          const descMatch     = userData.descricao && userData.descricao.toLowerCase().includes(queryLower);
          const usernameMatch = userData.username  && userData.username.toLowerCase().includes(queryLower);
          if (!nameMatch && !emailMatch && !descMatch && !usernameMatch) return false;
          if (userData.perfilPublico) return true;
          if (activeConnectionIds.has(userData.id)) return true;
          if (usernameMatch) return true;
          return false;
        })
        .slice(0, 20)
        .map(userData => new User(userData));

      logger.info('Busca realizada com sucesso (Firestore fallback)', { service: 'userModel', function: 'searchUsers', resultsCount: users.length });
      return users;
    } catch (error) {
      logger.error('Erro ao buscar usuários', { service: 'userModel', function: 'searchUsers', query, error: error.message });
      throw new Error('Erro ao buscar usuários');
    }
  }

  static async create(userData) {
    logger.info('create chamado', { service: 'userModel', function: 'create', userData: userData });

    if (!userData.uid) {
      logger.error('UID não fornecido na criação do usuário', { service: 'userModel', function: 'create' });
      throw new Error('UID do usuário é obrigatório para criação');
    }

    const user = new User(userData);
    let supabaseOk = false;

    // ── 1. Supabase PRIMEIRO (fonte primária de escrita) ──────────────────
    const supabase = getSupabaseClient();
    if (supabase) {
      const supabasePayload = {
        id:             userData.uid,
        email:          userData.email || null,
        full_name:      userData.nome || userData.displayName || null,
        avatar_url:     userData.fotoDoPerfil || userData.photoURL || null,
        descricao:      userData.descricao || null,
        telefone:       userData.telefone ? userData.telefone.replace(/\D/g, '') : null,
        tipo_de_conta:  userData.tipoDeConta || 'Cliente',
        perfil_publico: userData.perfilPublico || false,
        is_active:      true,
        updated_at:     new Date().toISOString(),
      };
      if (userData.username) supabasePayload.username = userData.username.toLowerCase();
      if (userData.usernameLastChangedAt) supabasePayload.username_last_changed_at = userData.usernameLastChangedAt;
      if (userData.personal_wishlist)     supabasePayload.personal_wishlist        = userData.personal_wishlist;
      if (userData.personalWishlist)     supabasePayload.personal_wishlist        = userData.personalWishlist;
      if (userData.dataNascimento)       supabasePayload.data_nascimento          = userData.dataNascimento;
      if (userData.phoneVerified) {
        supabasePayload.phone_verified    = true;
        supabasePayload.phone_verified_at = new Date().toISOString();
      }

      // ignoreDuplicates=false: se o usuário já existe no Supabase, ATUALIZAR com os dados
      // de registro. Anteriormente era true, o que causava perda silenciosa de dados de perfil
      // quando o registro era feito em dois passos (Firebase Auth cria o row primeiro,
      // depois o formulário de registro envia os dados completos via User.create).
      const { error: supaErr } = await supabase
        .from('users')
        .upsert(supabasePayload, { onConflict: 'id', ignoreDuplicates: false });

      if (supaErr) {
        logger.warn('User.create — upsert Supabase falhou', { userId: userData.uid, error: supaErr.message });
      } else {
        supabaseOk = true;
        logger.info('User.create — usuário criado/existente no Supabase (fonte primária)', { userId: userData.uid });
      }
    }

    // ── 2. Firestore (backup transitório durante migração) ────────────────
    try {
      // Filtrar undefined — Firestore rejeita valores undefined
      const plainObj = user.toPlainObject();
      const sanitized = Object.fromEntries(
        Object.entries(plainObj).filter(([, v]) => v !== undefined)
      );
      await dbServiceUser.doc(userData.uid).set(sanitized);
      logger.info('User.create — usuário salvo no Firestore (backup transitório)', { userId: userData.uid });
    } catch (firestoreErr) {
      logger.error('User.create — Firestore falhou', { userId: userData.uid, error: firestoreErr.message });
      if (!supabaseOk) {
        throw new Error('Falha ao criar usuário: Supabase e Firestore indisponíveis');
      }
    }

    return user;
  }

  static async update(userId, data) {
    if (!data.dataCriacao) delete data.dataCriacao;
    logger.info('update chamado', { service: 'userModel', function: 'update', userId, data });

    // ── 1. Supabase PRIMEIRO (fonte primária — crítica) ───────────────────
    const supabase = getSupabaseClient();
    let supabaseOk = false;

    if (supabase) {
      const supabaseUpdate = { updated_at: new Date().toISOString() };
      if (data.nome !== undefined)                    supabaseUpdate.full_name                = data.nome;
      if (data.email !== undefined)                   supabaseUpdate.email                    = data.email;
      if (data.fotoDoPerfil !== undefined)            supabaseUpdate.avatar_url               = data.fotoDoPerfil;
      if (data.descricao !== undefined)               supabaseUpdate.descricao                = data.descricao;
      if (data.telefone !== undefined)                supabaseUpdate.telefone                 = data.telefone ? data.telefone.replace(/\D/g, '') : null;
      if (data.tipoDeConta !== undefined)             supabaseUpdate.tipo_de_conta            = data.tipoDeConta;
      // perfilPublico aceita camelCase (padrão) e snake_case (enviado pelo PrivacySection)
      if (data.perfilPublico !== undefined)           supabaseUpdate.perfil_publico           = data.perfilPublico;
      if (data.perfil_publico !== undefined)          supabaseUpdate.perfil_publico           = data.perfil_publico;
      if (data.dataNascimento !== undefined)          supabaseUpdate.data_nascimento          = data.dataNascimento;
      if (data.data_nascimento !== undefined)         supabaseUpdate.data_nascimento          = data.data_nascimento;
      if (data.username !== undefined)                supabaseUpdate.username                 = data.username?.toLowerCase() || null;
      if (data.usernameLastChangedAt !== undefined)   supabaseUpdate.username_last_changed_at = data.usernameLastChangedAt;
      if (data.personal_wishlist !== undefined)       supabaseUpdate.personal_wishlist        = data.personal_wishlist;
      if (data.personalWishlist !== undefined)        supabaseUpdate.personal_wishlist        = data.personalWishlist;
      // Campos de privacidade (PrivacySection)
      if (data.aparece_na_busca !== undefined)        supabaseUpdate.aparece_na_busca         = data.aparece_na_busca;
      if (data.funcao_social !== undefined)           supabaseUpdate.funcao_social            = data.funcao_social;
      if (data.visibilidade_atividade !== undefined)  supabaseUpdate.visibilidade_atividade   = data.visibilidade_atividade;
      if (data.quem_pode_adicionar !== undefined)     supabaseUpdate.quem_pode_adicionar      = data.quem_pode_adicionar;
      // Recovery email
      if (data.recoveryEmail !== undefined)           supabaseUpdate.recovery_email            = data.recoveryEmail;
      if (data.recovery_email !== undefined)          supabaseUpdate.recovery_email            = data.recovery_email;
      if (data.recoveryEmailVerified !== undefined)   supabaseUpdate.recovery_email_verified   = data.recoveryEmailVerified;
      if (data.recovery_email_verified !== undefined) supabaseUpdate.recovery_email_verified   = data.recovery_email_verified;
      if (data.recoveryEmailVerifiedAt !== undefined)   supabaseUpdate.recovery_email_verified_at = data.recoveryEmailVerifiedAt;
      if (data.recovery_email_verified_at !== undefined) supabaseUpdate.recovery_email_verified_at = data.recovery_email_verified_at;
      // Phone verification
      if (data.phoneVerified !== undefined)           supabaseUpdate.phone_verified            = data.phoneVerified;
      if (data.phone_verified !== undefined)          supabaseUpdate.phone_verified            = data.phone_verified;
      if (data.phoneVerifiedAt !== undefined)         supabaseUpdate.phone_verified_at         = data.phoneVerifiedAt;
      if (data.phone_verified_at !== undefined)       supabaseUpdate.phone_verified_at         = data.phone_verified_at;
      // MFA fields
      if (data.mfa_enabled !== undefined)             supabaseUpdate.mfa_enabled               = data.mfa_enabled;
      if (data.mfaEnabled !== undefined)              supabaseUpdate.mfa_enabled               = data.mfaEnabled;
      if (data.mfa_method !== undefined)              supabaseUpdate.mfa_method                = data.mfa_method;
      if (data.mfaMethod !== undefined)               supabaseUpdate.mfa_method                = data.mfaMethod;
      if (data.totp_secret !== undefined)             supabaseUpdate.totp_secret               = data.totp_secret;
      if (data.totpSecret !== undefined)              supabaseUpdate.totp_secret               = data.totpSecret;
      if (data.backup_codes !== undefined)            supabaseUpdate.backup_codes              = data.backup_codes;
      if (data.backupCodes !== undefined)             supabaseUpdate.backup_codes              = data.backupCodes;
      if (data.backup_codes_count !== undefined)      supabaseUpdate.backup_codes_count        = data.backup_codes_count;
      if (data.backupCodesCount !== undefined)        supabaseUpdate.backup_codes_count        = data.backupCodesCount;
      if (data.mfa_enabled_at !== undefined)          supabaseUpdate.mfa_enabled_at            = data.mfa_enabled_at;
      if (data.mfaEnabledAt !== undefined)            supabaseUpdate.mfa_enabled_at            = data.mfaEnabledAt;

      const { error: supaErr } = await supabase
        .from('users')
        .update(supabaseUpdate)
        .eq('id', userId);

      if (supaErr) {
        // Supabase é a fonte primária — falha aqui é crítica
        logger.error('User.update — Supabase falhou (fonte primária)', { userId, error: supaErr.message });
        throw new Error('Erro ao atualizar usuário: falha no Supabase (fonte primária)');
      }

      supabaseOk = true;
      logger.info('User.update — Supabase atualizado (fonte primária)', { userId });
    }

    // ── 2. Firestore (backup transitório — fire-and-forget quando Supabase ok) ─
    const userRef = dbServiceUser.doc(userId);
    try {
      await userRef.update(data);
      logger.info('User.update — Firestore atualizado (backup)', { service: 'userModel', function: 'update', userId });
    } catch (firestoreErr) {
      if (!supabaseOk) {
        logger.error('Erro ao atualizar usuário', { service: 'userModel', function: 'update', userId, error: firestoreErr.message });
        throw new Error('Erro ao atualizar usuário');
      }
      logger.warn('User.update — Firestore falhou (não crítico, Supabase ok)', { userId, error: firestoreErr.message });
    }

    // ── 3. Retornar registro completo do Supabase (fonte de verdade) ─────
    // Nunca retornar dados fabricados — sempre buscar o registro atualizado.
    return await User.getById(userId);
  }

  static async uploadProfilePicture(userId, file) {
    if (!file || !file.buffer) {
      throw new Error('No file buffer found');
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client not available');
    }

    // Usaremos o bucket 'avatars' (padrão para fotos de perfil)
    const bucketName = 'avatars';
    const fileExt = file.originalname ? file.originalname.split('.').pop() : 'png';
    const fileName = `${userId}/profile_${Date.now()}.${fileExt}`;

    try {
      // 1. Upload para o Supabase Storage
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from(bucketName)
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: true,
        });

      if (uploadErr) {
        logger.error('Erro no upload para Supabase Storage', { userId, error: uploadErr.message });
        throw new Error(`Falha no storage: ${uploadErr.message}`);
      }

      // 2. Obter URL pública
      const { data: { publicUrl } } = supabase.storage
        .from(bucketName)
        .getPublicUrl(fileName);

      // 3. Atualizar o perfil do usuário (isso já atualiza Supabase e Firestore via static update)
      await this.update(userId, { fotoDoPerfil: publicUrl });

      logger.info('Foto de perfil atualizada com sucesso no Supabase Storage', { userId, publicUrl });
      return publicUrl;
    } catch (error) {
      logger.error('Erro ao processar foto de perfil no Supabase', { userId, error: error.message });
      throw new Error('Erro ao salvar foto de perfil no storage');
    }
  }


  static async delete(id) {
    // const db = getFirestore();

    logger.info('delete chamado', { service: 'userModel', function: 'delete', userId: id });
    const userRef = dbServiceUser.doc(id);
    try {
      await userRef.delete();
      logger.info('Usuário deletado com sucesso', { service: 'userModel', function: 'delete', userId: id });
    } catch (error) {
      logger.error('Erro ao deletar usuário', { service: 'userModel', function: 'delete', userId, error: error.message });
      throw new Error('Erro ao deletar usuário');
    }
  }
}

module.exports = User;