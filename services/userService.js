// services/UserService.js
const User = require('../models/User');
const { logger } = require('../logger');
require('dotenv').config();

const addUser = async (userData) => {
  logger.info('UserService.addUser chamado', userData);
  try {
    return await User.create(userData);
  } catch (error) {
    logger.error('Erro em UserService.addUser', { error: error.message });
    throw error;
  }
};

const getUsers = async () => {
  logger.info('UserService.getUsers chamado');
  try {
    return await User.findAll();
  } catch (error) {
    logger.error('Erro em UserService.getUsers', { error: error.message });
    throw error;
  }
};

const getUserById = async (userId) => {
  logger.info('UserService.getUserById chamado', { userId });
  try {
    return await User.getById(userId);
  } catch (error) {
    logger.error('Erro em UserService.getUserById', { userId, error: error.message });
    throw error;
  }
};

const updateUser = async (userId, updateData) => {
  logger.info('UserService.updateUser chamado', { userId, updateData });
  try {
    return await User.update(userId, updateData);
  } catch (error) {
    logger.error('Erro em UserService.updateUser', { userId, updateData, error: error.message });
    throw error;
  }
};

const deleteUser = async (userId) => {
  logger.info('UserService.deleteUser chamado', { userId });
  try {
    await User.delete(userId);
  } catch (error) {
    logger.error('Erro em UserService.deleteUser', { userId, error: error.message });
    throw error;
  }
};

const uploadProfilePicture = async (userId, file) => {
  logger.info('UserService.uploadProfilePicture chamado', { userId, file });
  try {
    return await User.uploadProfilePicture(userId, file);
  } catch (error) {
    logger.error('Erro em UserService.uploadProfilePicture', { userId, error: error.message });
    throw error;
  }
};

// Atualizar ou adicionar este método no userService.js
const searchUsers = async (searchQuery, currentUserId) => {
  logger.info('UserService.searchUsers chamado', { searchQuery, currentUserId });
  
  if (!searchQuery || searchQuery.trim() === '') {
    logger.warn('Query de busca vazia', { service: 'userService', function: 'searchUsers' });
    return [];
  }
  
  try {
    // Aplicamos uma sanitização básica na query
    const sanitizedQuery = searchQuery.trim();
    
    // Delegamos a busca ao modelo de usuário
    const results = await User.searchUsers(sanitizedQuery, currentUserId);
    
    logger.info('Resultados de busca obtidos com sucesso', { 
      service: 'userService', 
      function: 'searchUsers',
      count: results.length
    });
    
    // Retornamos apenas os dados relevantes para o frontend
    // para reduzir o volume de dados transmitidos
    return results.map(user => ({
      id: user.id,
      uid: user.uid,
      nome: user.nome,
      email: user.email,
      fotoDoPerfil: user.fotoDoPerfil,
      descricao: user.descricao,
      interesses: user.interesses || [],
    }));
    
  } catch (error) {
    logger.error('Erro em UserService.searchUsers', { 
      searchQuery, 
      currentUserId, 
      error: error.message 
    });
    throw new Error(`Falha na busca de usuários: ${error.message}`);
  }
};

module.exports = {
  addUser,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
  uploadProfilePicture,
  searchUsers,
};