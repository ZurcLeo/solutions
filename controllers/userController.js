/**
 * @fileoverview Controller de usuários - gerencia operações CRUD de usuários e perfis
 * @module controllers/userController
 */

const userService = require('../services/userService');
const { logger } = require('../logger');
const { getSupabaseClient } = require('../config/supabase');
const gamificationService = require('../services/gamificationService');
const SecurityTicketService = require('../services/SecurityTicketService');
const emailService = require('../services/emailService');
const userPreferencesService = require('../services/userPreferencesService');
const handleService = require('../services/handleService');

/**
 * Cria perfil de usuário com dados do Firebase Auth e processa convites
 * @async
 * @function createProfile
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.userId - ID do usuário
 * @param {Object} req.user - Dados do usuário
 * @param {boolean} req.isProfileComplete - Status do perfil
 * @param {Object} req.inviteData - Dados do convite (opcional)
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Perfil criado e status da operação
 */
const createProfile = async (req, res) => {
  const { userId, user, isProfileComplete, inviteData } = req;
  
  // Se já tem perfil, não criar novamente
  if (isProfileComplete) {
    return res.status(400).json({ error: 'Usuário já possui perfil' });
  }
  
  try {
    // Buscar dados do usuário do Firebase Auth
    const userRecord = await getAuth().getUser(userId);
    
    // Preparar dados básicos do usuário
    const userData = {
      uid: userRecord.uid,
      email: userRecord.email,
      nome: userRecord.displayName || userRecord.email.split('@')[0],
      perfilPublico: false,
      dataCriacao: new Date(),
      tipoDeConta: 'Cliente',
      // Outros campos padrão...
    };
    
    // Processar convite se disponível
    if (inviteData && inviteData.inviteId) {
      try {
        const { invite } = await Invite.getById(inviteData.inviteId);
        
        if (invite && invite.status === 'used') {
          // Criar conexão entre usuários
          userData.conexoes = [{
            userId: invite.senderId,
            tipo: 'convite',
            status: 'pendente',
            dataConexao: new Date()
          }];
        }
      } catch (inviteError) {
        console.warn('Erro ao processar convite:', inviteError);
        // Continuar mesmo sem o convite
      }
    }
    
    // Criar usuário no banco de dados
    const newUser = await User.create(userData);
    
    res.status(201).json({
      success: true,
      user: newUser,
      message: 'Perfil criado com sucesso'
    });
  } catch (error) {
    console.error('Erro ao criar perfil:', error);
    res.status(500).json({ error: 'Erro ao criar perfil de usuário' });
  }
};

/**
 * Adiciona novo usuário ao sistema com validação de autenticação
 * @async
 * @function addUser
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} req.user - Usuário autenticado
 * @param {string} req.user.uid - ID do usuário
 * @param {Object} req.validatedBody - Dados validados do usuário
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Dados do usuário criado
 */
const addUser = async (req, res) => {
  logger.info('DADOS usuário com NOCONTROLADOR', req)

  try {
    
    if (!req.user || !req.user.uid || !req.uid) {

      return res.status(401).json({ 
        success: false, 
        message: 'Usuário não autenticado. Faça login antes de adicionar informações ao perfil.' 
      });
    }

    const userData = Object.fromEntries(
      Object.entries({
        ...req.validatedBody,
        uid: req.user.uid  // Adiciona o UID do token de autenticação
      }).filter(([_, v]) => v !== undefined && v !== null)
    );

    if (!userData.ja3Hash) {
      userData.ja3Hash = null;
    }
    
    logger.info('Adicionando usuário com dados completos', { 
      service: 'userController', 
      function: 'addUser', 
      userId: req.user.uid 
    });

    const user = await userService.addUser(userData);
   
    return res.status(201).json({
      success: true,
      message: 'Usuário adicionado com sucesso',
      user
    });

  } catch (error) {
    logger.error('Erro ao adicionar usuário', { 
      service: 'userController', 
      function: 'addUser', 
      error: error.message 
    });
    
    return res.status(500).json({
      success: false,
      message: 'Erro ao adicionar usuário',
      error: error.message
    });
  }
};

/**
 * Busca lista de todos os usuários do sistema
 * @async
 * @function getUsers
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Lista de usuários
 */
const getUsers = async (req, res) => {
  try {
    const users = await userService.getUsers();
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar usuários', error: error.message });
  }
};

/**
 * Busca usuário específico por ID com monitoramento de performance
 * @async
 * @function getUserById
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.userId - ID do usuário
 * @param {Function} req.markCheckpoint - Função de monitoramento (opcional)
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Dados do usuário encontrado
 */
const getUserById = async (req, res) => {
  const { userId } = req.params;
  // Marcar início do processamento no controlador
  req.markCheckpoint('userController.getUserById.start');
  
  try {
    // Marcar antes da chamada ao serviço
    req.markCheckpoint('userController.beforeServiceCall');
    
    const user = await userService.getUserById(userId);
    logger.info('Dados do usuario no controlador: ', user);
    // Marcar após a chamada ao serviço
    req.markCheckpoint('userController.afterServiceCall');

    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Resposta final
    req.markCheckpoint('userController.beforeResponse');
    return res.status(200).json(user);
  } catch (error) {
    // Log de erro
    req.markCheckpoint('userController.error');
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

/**
 * Atualiza dados de um usuário existente
 * @async
 * @function updateUser
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.userId - ID do usuário
 * @param {Object} req.body - Dados para atualização
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Dados do usuário atualizado
 */
const updateUser = async (req, res) => {
  const { userId } = req.params;
  const updateData = req.body;

  logger.info('updateUser chamado no controlador', { userId, fields: Object.keys(updateData) });

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ error: "Nenhum dado fornecido para atualizar" });
  }

  try {
    const user = await userService.updateUser(userId, updateData);

    // [GAME-COV-005] avatar_uploaded — somente se fotoDoPerfil foi atualizado nesta chamada
    if (updateData.fotoDoPerfil || updateData.photoURL) {
      gamificationService.triggerEvent('avatar_uploaded', userId)
        .catch(err => logger.warn('Falha ao acionar gamificação em upload de avatar', {
          service: 'userController', userId, error: err.message
        }));
    }

    // [GAME-COV-005] profile_completed — perfil completo = nome + descricao + fotoDoPerfil
    const isProfileComplete = !!(user.nome || user.displayName)
      && !!(user.descricao || user.bio)
      && !!(user.fotoDoPerfil || user.photoURL);
    if (isProfileComplete) {
      gamificationService.triggerEvent('profile_completed', userId)
        .catch(err => logger.warn('Falha ao acionar gamificação em perfil completo', {
          service: 'userController', userId, error: err.message
        }));
    }

    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Faz upload da foto de perfil do usuário
 * @async
 * @function uploadProfilePicture
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} req.user - Usuário autenticado
 * @param {string} req.user.uid - ID do usuário
 * @param {Object} req.file - Arquivo da imagem enviado
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} URL pública da imagem
 */
const uploadProfilePicture = async (req, res) => {
  const userId = req.user.uid;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ message: 'Nenhum arquivo foi enviado.' });
  }

  try {
    const publicUrl = await userService.uploadProfilePicture(userId, file);

    // [GAME-COV-005] fire-and-forget
    gamificationService.triggerEvent('avatar_uploaded', userId)
      .catch(err => logger.warn('Falha ao acionar gamificação em upload de avatar', {
        service: 'userController', userId, error: err.message
      }));

    res.status(200).json({ publicUrl });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Remove usuário do sistema
 * @async
 * @function deleteUser
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.userId - ID do usuário
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<void>} Confirmação da remoção
 */
const deleteUser = async (req, res) => {
  const { userId } = req.params;
  try {
    await userService.deleteUser(userId);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Busca usuários por termo de pesquisa com exclusão opcional
 * @async
 * @function searchUsers
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.query.q - Termo de busca
 * @param {string} req.query.excludeUserId - ID do usuário a excluir (opcional)
 * @param {Object} req.user - Usuário autenticado
 * @param {Function} req.markCheckpoint - Função de monitoramento (opcional)
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Lista de usuários encontrados
 */
const searchUsers = async (req, res) => {
  // Remover prefixo '@' se o usuário buscou por '@username'
  const rawQuery = req.query.q || '';
  const searchQuery = rawQuery.startsWith('@') ? rawQuery.slice(1) : rawQuery;
  const excludeUserId = req.query.excludeUserId || req.user.uid;

  // Marcar início do processamento para monitoramento de performance
  req.markCheckpoint?.('userController.searchUsers.start');

  // Validação básica
  if (!searchQuery || searchQuery.trim() === '') {
    return res.status(400).json({ 
      success: false, 
      message: 'Parâmetro de busca não fornecido', 
      results: [] 
    });
  }

  try {
    req.markCheckpoint?.('userController.searchUsers.beforeServiceCall');
    
    // Chamar o serviço para executar a busca
    const results = await userService.searchUsers(searchQuery, excludeUserId);
    
    req.markCheckpoint?.('userController.searchUsers.afterServiceCall');
    
    // Fornecer estatísticas básicas junto com a resposta
    logger.info('Busca concluída com sucesso', {
      service: 'userController', 
      function: 'searchUsers',
      query: searchQuery, 
      resultsCount: results.length
    });
    
    req.markCheckpoint?.('userController.searchUsers.beforeResponse');
    
    return res.status(200).json({
      success: true,
      count: results.length,
      results: results
    });
  } catch (error) {
    logger.error('Erro ao buscar usuários', { 
      service: 'userController', 
      function: 'searchUsers',
      error: error.message 
    });
    
    req.markCheckpoint?.('userController.searchUsers.error');
    
    return res.status(500).json({ 
      success: false, 
      message: 'Erro ao buscar usuários', 
      error: error.message 
    });
  }
};

// ─── @username ───────────────────────────────────────────────────────────────

/** @deprecated Usar handleService.HANDLE_REGEX — mantido para referencia local */
const USERNAME_REGEX = handleService.HANDLE_REGEX;

/**
 * Verifica disponibilidade de @username. Publico (pre-registro).
 * Delegado ao handleService (namespace unificado users + sellers).
 */
const checkUsername = async (req, res) => {
  const { username } = req.params;
  const validation = handleService.validateHandle(username);
  if (!validation.valid) {
    return res.status(400).json({ success: false, message: validation.error || 'Formato de username inválido' });
  }
  try {
    const result = await handleService.checkAvailability(username.toLowerCase());
    return res.status(200).json({ success: true, available: result.available });
  } catch (error) {
    logger.error('Erro ao verificar username', { service: 'userController', function: 'checkUsername', error: error.message });
    return res.status(500).json({ success: false, message: 'Erro ao verificar username' });
  }
};

/**
 * Gera username unico com base em um prefixo. Publico.
 * Delegado ao handleService.generateFallbackHandle.
 */
const generateFallbackUsername = async (req, res) => {
  const base = req.query.base || 'elos';
  try {
    const result = await handleService.generateFallbackHandle(base);
    return res.status(200).json({ success: true, fallback: result.handle });
  } catch (error) {
    logger.error('Erro ao gerar fallback username', { service: 'userController', function: 'generateFallbackUsername', error: error.message });
    return res.status(500).json({ success: false, message: 'Não foi possível gerar um username disponível' });
  }
};

/**
 * Atualiza o @username do usuario autenticado. Requer auth.
 * Escrita: Supabase exclusivamente. Rate-limit delegado a handleService.checkRateLimit.
 */
const updateUsername = async (req, res) => {
  const uid = req.user?.uid;
  const { username } = req.body;
  if (!uid) return res.status(401).json({ success: false, message: 'Não autorizado' });

  const validation = handleService.validateHandle(username);
  if (!validation.valid) {
    return res.status(400).json({ success: false, message: 'Username inválido. Use entre 3 e 30 caracteres: letras, números ou _' });
  }
  const u = username.toLowerCase();
  const sb = getSupabaseClient();
  if (!sb) return res.status(503).json({ success: false, message: 'Serviço indisponível no momento' });

  try {
    const { data: userData, error: fetchErr } = await sb.from('users').select('username, username_last_changed_at').eq('id', uid).single();
    if (fetchErr) throw fetchErr;

    // Rate limit via handleService
    const rateCheck = handleService.checkRateLimit(userData?.username_last_changed_at);
    if (!rateCheck.allowed) {
      return res.status(429).json({ success: false, message: `Você só pode alterar o username uma vez por mês. Tente novamente em ${rateCheck.daysLeft} dia(s).`, daysLeft: rateCheck.daysLeft });
    }

    // Disponibilidade via handleService (namespace unificado)
    const availability = await handleService.checkAvailability(u, { excludeUserId: uid });
    if (!availability.available) {
      return res.status(409).json({ success: false, message: 'Este username já está em uso' });
    }

    const isFirstUsername = !userData.username_last_changed_at;

    // [HANDLE-005] Record old handle in history before changing
    if (userData?.username && userData.username !== u) {
      await handleService.recordHandleRelease(userData.username, 'user', uid);
    }

    const { error: updateErr } = await sb.from('users').update({ username: u, username_last_changed_at: new Date().toISOString() }).eq('id', uid);
    if (updateErr) throw updateErr;

    // Selo "Identidade Completa" — concedido apenas na primeira vez que o username e definido
    if (isFirstUsername) {
      gamificationService.grantSelo(uid, 'profile_complete', 'platform', 'Primeiro @username definido')
        .catch(err => logger.warn('Falha ao conceder selo profile_complete', { uid, error: err.message }));
    }

    return res.status(200).json({ success: true, username: u });
  } catch (error) {
    logger.error('Erro ao atualizar username', { service: 'userController', function: 'updateUsername', error: error.message });
    return res.status(500).json({ success: false, message: 'Erro interno' });
  }
};

/**
 * Sugere @usernames via IA quando o desejado esta ocupado. Publico.
 * Disponibilidade delegada ao handleService (namespace unificado).
 */
const suggestUsername = async (req, res) => {
  const { desiredUsername, emailHint } = req.body;
  const validation = handleService.validateHandle(desiredUsername);
  if (!desiredUsername || !validation.valid) {
    return res.status(400).json({ success: false, message: 'desiredUsername inválido' });
  }
  try {
    const AIService = require('../services/AIService');
    const aiService = new AIService();

    const candidates = await aiService.suggestUsernames(desiredUsername, emailHint || '');

    const availableChecks = await Promise.all(
      candidates.map(async (u) => {
        const result = await handleService.checkAvailability(u);
        return { username: u, available: result.available };
      })
    );

    let suggestions = availableChecks.filter(r => r.available).map(r => r.username).slice(0, 5);

    // Completa com variacoes numericas se sobrar menos de 3
    if (suggestions.length < 3) {
      const base = desiredUsername.replace(/[^a-z0-9]/g, '').substring(0, 20);
      for (let i = 0; suggestions.length < 3 && i < 20; i++) {
        const suffix = Math.floor(100 + Math.random() * 900);
        const candidate = `${base}${suffix}`.substring(0, 30);
        if (!USERNAME_REGEX.test(candidate)) continue;
        const result = await handleService.checkAvailability(candidate);
        if (result.available) suggestions.push(candidate);
      }
    }

    return res.status(200).json({ success: true, suggestions });
  } catch (error) {
    logger.error('Erro ao sugerir usernames', { service: 'userController', function: 'suggestUsername', error: error.message });
    return res.status(500).json({ success: false, message: 'Erro ao gerar sugestões' });
  }
};

// ─── Preferências de notificação ─────────────────────────────────────────────

/**
 * Retorna as preferências de notificação do usuário autenticado.
 * PREFS-004: Reads from user_preferences.notification_prefs (new system).
 * Returns legacy-shaped response for backward compatibility with NotificationsSection.
 */
const getNotificationPreferences = async (req, res) => {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ success: false, message: 'Não autorizado' });

  try {
    const prefs = await userPreferencesService.get(uid);
    const np = prefs.notification_prefs || userPreferencesService.DEFAULTS.notification_prefs;

    // Map new-system shape → legacy shape for frontend backward compat
    const emailEnabled = np.channels?.email !== false;
    const legacyChannels = {};
    const EVENT_MAP = {
      payments: 'pagamentos', invites: 'convites', caixinhas: 'caixinhas',
      messages: 'mensagens', security: 'sistema', pedidos: 'pedidos',
      entregas: 'entregas', mobilidade: 'mobilidade',
    };

    for (const [newKey, legacyKey] of Object.entries(EVENT_MAP)) {
      const ev = np.events?.[newKey];
      if (!ev) continue;
      const ch = [];
      if (ev.email && emailEnabled) ch.push('email');
      if (ev.push) ch.push('in_app');
      legacyChannels[legacyKey] = ch;
    }

    return res.status(200).json({
      success: true,
      preferences: {
        global_opt_out_email: !emailEnabled,
        channels: legacyChannels,
      },
    });
  } catch (error) {
    logger.error('Erro ao buscar preferências de notificação', {
      service: 'userController', function: 'getNotificationPreferences', userId: uid, error: error.message,
    });
    return res.status(500).json({ success: false, message: 'Erro ao buscar preferências' });
  }
};

/**
 * Salva as preferências de notificação do usuário autenticado.
 * PREFS-004: Writes to user_preferences.notification_prefs (new system).
 * Accepts legacy-shaped payload for backward compatibility with NotificationsSection.
 * Body: { global_opt_out_email: boolean, channels: { [eventKey]: string[] } }
 */
const updateNotificationPreferences = async (req, res) => {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ success: false, message: 'Não autorizado' });

  const { global_opt_out_email, channels } = req.body;

  if (global_opt_out_email !== undefined && typeof global_opt_out_email !== 'boolean') {
    return res.status(400).json({ success: false, message: 'global_opt_out_email deve ser boolean' });
  }
  if (channels !== undefined && (typeof channels !== 'object' || Array.isArray(channels))) {
    return res.status(400).json({ success: false, message: 'channels deve ser um objeto' });
  }

  try {
    // Map legacy payload → new-system shape
    const LEGACY_TO_NEW = {
      pagamentos: 'payments', convites: 'invites', caixinhas: 'caixinhas',
      mensagens: 'messages', sistema: 'security', pedidos: 'pedidos',
      entregas: 'entregas', mobilidade: 'mobilidade',
    };

    const emailEnabled = global_opt_out_email === undefined ? true : !global_opt_out_email;

    const newChannels = { email: emailEnabled };
    const newEvents = {};

    if (channels) {
      for (const [legacyKey, channelList] of Object.entries(channels)) {
        const newKey = LEGACY_TO_NEW[legacyKey] || legacyKey;
        if (newKey === 'security') {
          newEvents[newKey] = { push: true, email: true }; // security is immutable
        } else {
          newEvents[newKey] = {
            email: Array.isArray(channelList) ? channelList.includes('email') : false,
            push:  Array.isArray(channelList) ? channelList.includes('in_app') : false,
          };
        }
      }
    }

    const updateData = { channels: newChannels };
    if (Object.keys(newEvents).length > 0) {
      updateData.events = newEvents;
    }

    // PREFS-005: Capturar IP para audit log
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;
    await userPreferencesService.update(uid, 'notification_prefs', updateData, ipAddress);

    return res.status(200).json({ success: true });
  } catch (error) {
    const status = error.statusCode || 500;
    logger.error('Erro ao salvar preferências de notificação', {
      service: 'userController', function: 'updateNotificationPreferences', userId: uid, error: error.message,
    });
    return res.status(status).json({ success: false, message: error.message || 'Erro ao salvar preferências' });
  }
};

// ─── Lista de Desejos Pessoal ─────────────────────────────────────────────────

/**
 * Retorna a lista de desejos pessoal do usuário autenticado.
 * GET /api/users/me/wishlist
 */
const getMyWishlist = async (req, res) => {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ success: false, message: 'Não autorizado' });

  try {
    const user = await userService.getUserById(uid);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'Perfil de usuário não encontrado' });
    }

    return res.status(200).json({ wishlist: user.personalWishlist || user.personal_wishlist || [] });
  } catch (error) {
    logger.error('Erro ao buscar wishlist pessoal', {
      service: 'userController', function: 'getMyWishlist', userId: uid, error: error.message,
    });
    return res.status(500).json({ success: false, message: 'Erro ao buscar lista de desejos' });
  }
};

/**
 * Atualiza a lista de desejos pessoal do usuário autenticado.
 * PATCH /api/users/me/wishlist
 * Body: { wishlist: string[] } — máximo 20 itens
 */
const updateMyWishlist = async (req, res) => {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ success: false, message: 'Não autorizado' });

  const { wishlist } = req.body;

  if (!Array.isArray(wishlist)) {
    return res.status(400).json({ success: false, message: 'wishlist deve ser um array de strings' });
  }
  if (wishlist.length > 20) {
    return res.status(400).json({ success: false, code: 'WISHLIST_TOO_LONG', message: 'Máximo de 20 itens na lista de desejos' });
  }
  // Sanitizar: apenas strings não vazias, máx 60 chars cada
  const sanitized = wishlist
    .filter((item) => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 60));

  const sb = getSupabaseClient();
  if (!sb) return res.status(503).json({ success: false, message: 'Serviço indisponível' });

  try {
    const user = await userService.updateUser(uid, { personal_wishlist: sanitized });

    return res.status(200).json({ success: true, wishlist: user.personalWishlist || user.personal_wishlist || sanitized });
  } catch (error) {
    logger.error('Erro ao atualizar wishlist pessoal', {
      service: 'userController', function: 'updateMyWishlist', userId: uid, error: error.message,
    });
    return res.status(500).json({ success: false, message: 'Erro ao salvar lista de desejos' });
  }
};

// ─── Email de Recuperação ────────────────────────────────────────────────────

/**
 * PUT /api/users/recovery-email
 * Define ou atualiza o email de recuperação (envia OTP de verificação para o novo endereço).
 */
const setRecoveryEmail = async (req, res) => {
  const userId = req.user?.uid;
  if (!userId) return res.status(401).json({ success: false, message: 'Não autorizado' });

  const { recoveryEmail } = req.body;

  // 1. Validar formato do email
  if (!recoveryEmail || typeof recoveryEmail !== 'string') {
    return res.status(400).json({ success: false, message: 'Email de recuperação é obrigatório.' });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(recoveryEmail.trim())) {
    return res.status(400).json({ success: false, message: 'Formato de email inválido.' });
  }
  const normalizedEmail = recoveryEmail.trim().toLowerCase();

  // 2. Garantir que é diferente do email primário
  const primaryEmail = req.user?.email || '';
  if (normalizedEmail === primaryEmail.toLowerCase()) {
    return res.status(400).json({ success: false, message: 'O email de recuperação deve ser diferente do email principal.' });
  }

  const sb = getSupabaseClient();
  if (!sb) return res.status(503).json({ success: false, message: 'Serviço indisponível.' });

  try {
    // 3. Verificar se já está em uso por outro usuário (como primário ou recovery)
    const { data: conflictPrimary } = await sb
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .neq('id', userId)
      .limit(1)
      .maybeSingle();

    if (conflictPrimary) {
      return res.status(409).json({ success: false, message: 'Este email já está em uso por outra conta.' });
    }

    const { data: conflictRecovery } = await sb
      .from('users')
      .select('id')
      .eq('recovery_email', normalizedEmail)
      .neq('id', userId)
      .limit(1)
      .maybeSingle();

    if (conflictRecovery) {
      return res.status(409).json({ success: false, message: 'Este email já está em uso como email de recuperação de outra conta.' });
    }

    // 4. Salvar recovery_email (não verificado) via User.update
    await userService.updateUser(userId, {
      recoveryEmail: normalizedEmail,
      recoveryEmailVerified: false,
      recoveryEmailVerifiedAt: null,
    });

    // 5. Gerar OTP via SecurityTicketService
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;
    const { code, expiresIn } = await SecurityTicketService.generateTicket(
      userId,
      'recovery_email_verify',
      { ipAddress, metadata: { recoveryEmail: normalizedEmail } }
    );

    // 6. Enviar OTP para o email de recuperação (NÃO o primário)
    const userName = req.user?.name || req.user?.displayName || 'usuário';
    const otpResult = await emailService.sendOTP({
      to: normalizedEmail,
      userName,
      code,
      type: 'recovery_email_verify',
      expiresIn,
    });

    if (!otpResult.success) {
      logger.error('setRecoveryEmail: falha ao enviar OTP', {
        service: 'userController', function: 'setRecoveryEmail', userId, error: otpResult.error,
      });

      if (otpResult.error === 'otp_rate_limit_exceeded') {
        return res.status(429).json({
          success: false,
          message: 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.',
          retryAfterSeconds: otpResult.retryAfterSeconds || 900,
        });
      }

      if (otpResult.error === 'recipient_suppressed') {
        return res.status(422).json({
          success: false,
          message: 'Não conseguimos enviar para este email. Entre em contato com o suporte.',
        });
      }

      return res.status(500).json({ success: false, message: 'Erro ao enviar código de verificação.' });
    }

    logger.info('Recovery email definido e OTP enviado', {
      service: 'userController', function: 'setRecoveryEmail', userId,
    });

    return res.status(200).json({
      success: true,
      message: 'Código de verificação enviado para o email de recuperação.',
      expiresIn,
    });
  } catch (error) {
    logger.error('Erro ao definir recovery email', {
      service: 'userController', function: 'setRecoveryEmail', userId, error: error.message,
    });
    return res.status(500).json({ success: false, message: 'Erro ao definir email de recuperação.' });
  }
};

/**
 * POST /api/users/recovery-email/verify
 * Verifica o email de recuperação com o código OTP.
 */
const verifyRecoveryEmail = async (req, res) => {
  const userId = req.user?.uid;
  if (!userId) return res.status(401).json({ success: false, message: 'Não autorizado' });

  const { code } = req.body;

  if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
    return res.status(400).json({ success: false, message: 'Código inválido. Informe os 6 dígitos.' });
  }

  try {
    // 1. Validar código via SecurityTicketService
    await SecurityTicketService.validateTicket(userId, 'recovery_email_verify', code.trim());

    // 2. Marcar como verificado
    await userService.updateUser(userId, {
      recoveryEmailVerified: true,
      recoveryEmailVerifiedAt: new Date().toISOString(),
    });

    logger.info('Recovery email verificado com sucesso', {
      service: 'userController', function: 'verifyRecoveryEmail', userId,
    });

    return res.status(200).json({
      success: true,
      message: 'Email de recuperação verificado com sucesso.',
    });
  } catch (error) {
    logger.warn('Falha na verificação do recovery email', {
      service: 'userController', function: 'verifyRecoveryEmail', userId, error: error.message,
    });

    const isBruteForce = error.message.includes('Muitas tentativas');
    return res.status(isBruteForce ? 429 : 400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * DELETE /api/users/recovery-email
 * Remove o email de recuperação.
 */
const removeRecoveryEmail = async (req, res) => {
  const userId = req.user?.uid;
  if (!userId) return res.status(401).json({ success: false, message: 'Não autorizado' });

  try {
    await userService.updateUser(userId, {
      recoveryEmail: null,
      recoveryEmailVerified: false,
      recoveryEmailVerifiedAt: null,
    });

    logger.info('Recovery email removido', {
      service: 'userController', function: 'removeRecoveryEmail', userId,
    });

    return res.status(200).json({
      success: true,
      message: 'Email de recuperação removido com sucesso.',
    });
  } catch (error) {
    logger.error('Erro ao remover recovery email', {
      service: 'userController', function: 'removeRecoveryEmail', userId, error: error.message,
    });
    return res.status(500).json({ success: false, message: 'Erro ao remover email de recuperação.' });
  }
};

/**
 * POST /api/users/recovery-email/resend
 * Reenvia o OTP de verificação para o email de recuperação já cadastrado.
 */
const resendRecoveryEmailOTP = async (req, res) => {
  const userId = req.user?.uid;
  if (!userId) return res.status(401).json({ success: false, message: 'Não autorizado' });

  const sb = getSupabaseClient();
  if (!sb) return res.status(503).json({ success: false, message: 'Serviço indisponível.' });

  try {
    // Buscar o recovery_email atual do usuário
    const { data: userData, error: fetchErr } = await sb
      .from('users')
      .select('recovery_email, recovery_email_verified')
      .eq('id', userId)
      .single();

    if (fetchErr) throw fetchErr;

    if (!userData?.recovery_email) {
      return res.status(400).json({ success: false, message: 'Nenhum email de recuperação cadastrado.' });
    }

    if (userData.recovery_email_verified) {
      return res.status(400).json({ success: false, message: 'Email de recuperação já verificado.' });
    }

    // Gerar novo OTP
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;
    const { code, expiresIn } = await SecurityTicketService.generateTicket(
      userId,
      'recovery_email_verify',
      { ipAddress, metadata: { recoveryEmail: userData.recovery_email } }
    );

    // Enviar OTP
    const userName = req.user?.name || req.user?.displayName || 'usuário';
    const otpResult = await emailService.sendOTP({
      to: userData.recovery_email,
      userName,
      code,
      type: 'recovery_email_verify',
      expiresIn,
    });

    if (!otpResult.success) {
      logger.error('resendRecoveryEmailOTP: falha ao enviar OTP', {
        service: 'userController', function: 'resendRecoveryEmailOTP', userId, error: otpResult.error,
      });

      if (otpResult.error === 'otp_rate_limit_exceeded') {
        return res.status(429).json({
          success: false,
          message: 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.',
          retryAfterSeconds: otpResult.retryAfterSeconds || 900,
        });
      }

      if (otpResult.error === 'recipient_suppressed') {
        return res.status(422).json({
          success: false,
          message: 'Não conseguimos enviar para este email. Entre em contato com o suporte.',
        });
      }

      return res.status(500).json({ success: false, message: 'Erro ao reenviar código.' });
    }

    return res.status(200).json({
      success: true,
      message: 'Código reenviado para o email de recuperação.',
      expiresIn,
    });
  } catch (error) {
    logger.error('Erro ao reenviar OTP de recovery email', {
      service: 'userController', function: 'resendRecoveryEmailOTP', userId, error: error.message,
    });
    return res.status(500).json({ success: false, message: 'Erro ao reenviar código.' });
  }
};

// ─── PREFS-005: Transparência & Exportação de Dados (LGPD Art. 18) ──────────

/**
 * GET /api/users/data-export
 * Exporta todos os dados do usuário autenticado em formato JSON (LGPD Art. 18 — Portabilidade).
 */
const getDataExport = async (req, res) => {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ success: false, message: 'Não autorizado' });

  try {
    const data = await userPreferencesService.getDataExport(uid);

    logger.info('Exportação de dados do usuário solicitada', {
      service: 'userController', function: 'getDataExport', userId: uid,
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    logger.error('Erro ao exportar dados do usuário', {
      service: 'userController', function: 'getDataExport', userId: uid, error: error.message,
    });
    return res.status(500).json({ success: false, message: 'Erro ao exportar dados' });
  }
};

/**
 * GET /api/users/preference-history
 * Retorna o histórico paginado de alterações de preferências do usuário autenticado.
 * Query params: page (default 1), limit (default 20), category (opcional)
 */
const getPreferenceHistory = async (req, res) => {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ success: false, message: 'Não autorizado' });

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const category = req.query.category || undefined;

  try {
    const result = await userPreferencesService.getAuditLog(uid, { page, limit, category });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error('Erro ao buscar histórico de preferências', {
      service: 'userController', function: 'getPreferenceHistory', userId: uid, error: error.message,
    });
    return res.status(500).json({ success: false, message: 'Erro ao buscar histórico de preferências' });
  }
};

module.exports = {
  addUser,
  getUsers,
  createProfile,
  getUserById,
  updateUser,
  deleteUser,
  uploadProfilePicture,
  searchUsers,
  checkUsername,
  generateFallbackUsername,
  updateUsername,
  suggestUsername,
  getNotificationPreferences,
  updateNotificationPreferences,
  getMyWishlist,
  updateMyWishlist,
  setRecoveryEmail,
  verifyRecoveryEmail,
  removeRecoveryEmail,
  resendRecoveryEmailOTP,
  getDataExport,
  getPreferenceHistory,
};