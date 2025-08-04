/**
 * @fileoverview Controller de grupos de caixinha - gerencia grupos para organização de caixinhas coletivas
 * @module controllers/groupsCaixinhaController
 */

const admin = require('firebase-admin');

/**
 * Busca todos os grupos de caixinha cadastrados
 * @async
 * @function getGroups
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Lista de grupos de caixinha
 */
exports.getGroups = async (req, res) => {
  try {
    const snapshot = await admin.firestore().collection('groupsCaixinha').get();
    const groups = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(groups);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao obter grupos de caixinha', error: error.message });
  }
};

/**
 * Busca um grupo de caixinha específico pelo ID
 * @async
 * @function getGroupById
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.id - ID do grupo
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Dados do grupo de caixinha
 */
exports.getGroupById = async (req, res) => {
  const { id } = req.params;
  try {
    const doc = await admin.firestore().collection('groupsCaixinha').doc(id).get();
    if (!doc.exists) {
      return res.status(404).json({ message: 'Grupo de caixinha não encontrado' });
    }
    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao obter grupo de caixinha', error: error.message });
  }
};

/**
 * Cria um novo grupo de caixinha
 * @async
 * @function createGroup
 * @param {Object} req - Objeto de requisição Express
 * @param {Object} req.body - Dados do grupo
 * @param {string} req.body.name - Nome do grupo
 * @param {string} req.body.description - Descrição do grupo
 * @param {Array} req.body.members - Lista de membros
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Grupo criado com ID
 */
exports.createGroup = async (req, res) => {
  const { name, description, members } = req.body;
  try {
    const docRef = await admin.firestore().collection('groupsCaixinha').add({
      name,
      description,
      members,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.status(201).json({ id: docRef.id, message: 'Grupo de caixinha criado com sucesso' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao criar grupo de caixinha', error: error.message });
  }
};

/**
 * Atualiza dados de um grupo de caixinha existente
 * @async
 * @function updateGroup
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.id - ID do grupo
 * @param {Object} req.body - Dados atualizados do grupo
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Confirmação da atualização
 */
exports.updateGroup = async (req, res) => {
  const { id } = req.params;
  const data = req.body;
  try {
    const docRef = admin.firestore().collection('groupsCaixinha').doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ message: 'Grupo de caixinha não encontrado' });
    }
    await docRef.update(data);
    res.status(200).json({ message: 'Grupo de caixinha atualizado com sucesso' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar grupo de caixinha', error: error.message });
  }
};

/**
 * Remove um grupo de caixinha do sistema
 * @async
 * @function deleteGroup
 * @param {Object} req - Objeto de requisição Express
 * @param {string} req.params.id - ID do grupo a ser removido
 * @param {Object} res - Objeto de resposta Express
 * @returns {Promise<Object>} Confirmação da remoção
 */
exports.deleteGroup = async (req, res) => {
  const { id } = req.params;
  try {
    const docRef = admin.firestore().collection('groupsCaixinha').doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ message: 'Grupo de caixinha não encontrado' });
    }
    await docRef.delete();
    res.status(200).json({ message: 'Grupo de caixinha deletado com sucesso' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao deletar grupo de caixinha', error: error.message });
  }
};
