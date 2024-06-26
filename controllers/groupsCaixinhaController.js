const admin = require('firebase-admin');

// Função para obter todos os grupos de caixinha
exports.getGroups = async (req, res) => {
  try {
    const snapshot = await admin.firestore().collection('groupsCaixinha').get();
    const groups = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(groups);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao obter grupos de caixinha', error: error.message });
  }
};

// Função para obter um grupo de caixinha por ID
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

// Função para criar um novo grupo de caixinha
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

// Função para atualizar um grupo de caixinha
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

// Função para deletar um grupo de caixinha
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
