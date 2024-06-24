const admin = require('firebase-admin');

// Função para obter todas as caixinhas
exports.getCaixinhas = async (req, res) => {
  try {
    const snapshot = await admin.firestore().collection('caixinhas').get();
    const caixinhas = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(caixinhas);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao obter caixinhas', error: error.message });
  }
};

// Função para obter uma caixinha por ID
exports.getCaixinhaById = async (req, res) => {
  const { id } = req.params;
  try {
    const doc = await admin.firestore().collection('caixinhas').doc(id).get();
    if (!doc.exists) {
      return res.status(404).json({ message: 'Caixinha não encontrada' });
    }
    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao obter caixinha', error: error.message });
  }
};

// Função para criar uma nova caixinha
exports.createCaixinha = async (req, res) => {
  const { nome, descricao, adminId, membros, contribuicaoMensal } = req.body;
  try {
    const docRef = await admin.firestore().collection('caixinhas').add({
      nome,
      descricao,
      adminId,
      membros,
      contribuicaoMensal,
      saldoTotal: 0,
      dataCriacao: admin.firestore.FieldValue.serverTimestamp()
    });
    res.status(201).json({ id: docRef.id, message: 'Caixinha criada com sucesso' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao criar caixinha', error: error.message });
  }
};

// Função para atualizar uma caixinha
exports.updateCaixinha = async (req, res) => {
  const { id } = req.params;
  const data = req.body;
  try {
    const docRef = admin.firestore().collection('caixinhas').doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ message: 'Caixinha não encontrada' });
    }
    await docRef.update(data);
    res.status(200).json({ message: 'Caixinha atualizada com sucesso' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar caixinha', error: error.message });
  }
};

// Função para deletar uma caixinha
exports.deleteCaixinha = async (req, res) => {
  const { id } = req.params;
  try {
    const docRef = admin.firestore().collection('caixinhas').doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ message: 'Caixinha não encontrada' });
    }
    await docRef.delete();
    res.status(200).json({ message: 'Caixinha deletada com sucesso' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao deletar caixinha', error: error.message });
  }
};

// Função para adicionar uma contribuição
exports.addContribuicao = async (req, res) => {
  const { caixinhaId, userId, valor } = req.body;
  try {
    const contribRef = await admin.firestore().collection('contribuicoes').add({
      caixinhaId,
      userId,
      valor,
      dataContribuicao: admin.firestore.FieldValue.serverTimestamp()
    });

    // Atualizar saldo da caixinha
    const caixinhaRef = admin.firestore().collection('caixinhas').doc(caixinhaId);
    const caixinhaDoc = await caixinhaRef.get();
    if (caixinhaDoc.exists) {
      const saldoAtual = caixinhaDoc.data().saldoTotal;
      await caixinhaRef.update({ saldoTotal: saldoAtual + valor });
    }

    res.status(201).json({ id: contribRef.id, message: 'Contribuição adicionada com sucesso' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao adicionar contribuição', error: error.message });
  }
};

// Função para solicitar um empréstimo
exports.solicitarEmprestimo = async (req, res) => {
  const { caixinhaId, userId, valorSolicitado } = req.body;
  try {
    const emprestimoRef = await admin.firestore().collection('emprestimos').add({
      caixinhaId,
      userId,
      valorSolicitado,
      dataSolicitacao: admin.firestore.FieldValue.serverTimestamp(),
      status: 'pendente',
      votos: {}
    });
    res.status(201).json({ id: emprestimoRef.id, message: 'Empréstimo solicitado com sucesso' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao solicitar empréstimo', error: error.message });
  }
};

// Função para registrar uma atividade bônus
exports.addAtividadeBonus = async (req, res) => {
  const { caixinhaId, descricao, valorArrecadado } = req.body;
  try {
    const atividadeRef = await admin.firestore().collection('atividadesBonus').add({
      caixinhaId,
      descricao,
      valorArrecadado,
      dataAtividade: admin.firestore.FieldValue.serverTimestamp()
    });

    // Atualizar saldo da caixinha
    const caixinhaRef = admin.firestore().collection('caixinhas').doc(caixinhaId);
    const caixinhaDoc = await caixinhaRef.get();
    if (caixinhaDoc.exists) {
      const saldoAtual = caixinhaDoc.data().saldoTotal;
      await caixinhaRef.update({ saldoTotal: saldoAtual + valorArrecadado });
    }

    res.status(201).json({ id: atividadeRef.id, message: 'Atividade bônus registrada com sucesso' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao registrar atividade bônus', error: error.message });
  }
};