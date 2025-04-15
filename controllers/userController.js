// controllers/userController.js
const userService = require('../services/userService');
const { logger } = require('../logger');

// userController.js
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

const getUsers = async (req, res) => {
  try {
    const users = await userService.getUsers();
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar usuários', error: error.message });
  }
};

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
    
    // Resposta final
    req.markCheckpoint('userController.beforeResponse');
    return { status: 200, json: { success: true, message: 'Dados do usuário encontrado:', user } };
  } catch (error) {
    // Log de erro
    req.markCheckpoint('userController.error');
    return { status: 500, json: { message: 'Internal server error', error: error.message } };
  }
};

const updateUser = async (req, res) => {
  const { userId } = req.params;
  const updateData = req.body;

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ error: "Nenhum dado fornecido para atualizar" });
  }

  try {
    const user = await userService.updateUser(userId, updateData);
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const uploadProfilePicture = async (req, res) => {
  const userId = req.user.uid;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ message: 'Nenhum arquivo foi enviado.' });
  }

  try {
    const publicUrl = await userService.uploadProfilePicture(userId, file);
    res.status(200).json({ publicUrl });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const deleteUser = async (req, res) => {
  const { userId } = req.params;
  try {
    await userService.deleteUser(userId);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Atualizar ou adicionar este método no userController.js
const searchUsers = async (req, res) => {
  const { q: searchQuery } = req.query;
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

module.exports = {
  addUser,
  getUsers,
  createProfile,
  getUserById,
  updateUser,
  deleteUser,
  uploadProfilePicture,
  searchUsers
};