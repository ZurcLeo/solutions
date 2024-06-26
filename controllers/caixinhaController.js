const admin = require('firebase-admin');
const Caixinha = require('../models/Caixinhas');
const Contribuicao = require('../models/Contribuicao');
const Emprestimo = require('../models/Emprestimos');
const AtividadeBonus = require('../models/AtividadesBonus');
const Membro = require('../models/Membro');
const Transacao = require('../models/Transacao');

// Contribuicoes
exports.getContribuicaoById = async (req, res) => {
    const { id, contribuicaoId } = req.params;
    try {
        const contribuicao = await Contribuicao.getById(id, contribuicaoId);
        res.status(200).json(contribuicao);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar contribuição', error: error.message });
    }
};

exports.updateContribuicao = async (req, res) => {
    const { id, contribuicaoId } = req.params;
    try {
        const contribuicao = await Contribuicao.update(id, contribuicaoId, req.body);
        res.status(200).json(contribuicao);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao atualizar contribuição', error: error.message });
    }
};

exports.deleteContribuicao = async (req, res) => {
    const { id, contribuicaoId } = req.params;
    try {
        await Contribuicao.delete(id, contribuicaoId);
        res.status(200).json({ message: 'Contribuição deletada com sucesso' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao deletar contribuição', error: error.message });
    }
};

// Emprestimos
exports.getEmprestimos = async (req, res) => {
    const { id } = req.params;
    try {
        const emprestimos = await Emprestimo.getAll(id);
        res.status(200).json(emprestimos);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar empréstimos', error: error.message });
    }
};

exports.getEmprestimoById = async (req, res) => {
    const { id, emprestimoId } = req.params;
    try {
        const emprestimo = await Emprestimo.getById(id, emprestimoId);
        res.status(200).json(emprestimo);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar empréstimo', error: error.message });
    }
};

exports.updateEmprestimo = async (req, res) => {
    const { id, emprestimoId } = req.params;
    try {
        const emprestimo = await Emprestimo.update(id, emprestimoId, req.body);
        res.status(200).json(emprestimo);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao atualizar empréstimo', error: error.message });
    }
};

exports.deleteEmprestimo = async (req, res) => {
    const { id, emprestimoId } = req.params;
    try {
        await Emprestimo.delete(id, emprestimoId);
        res.status(200).json({ message: 'Empréstimo deletado com sucesso' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao deletar empréstimo', error: error.message });
    }
};

// Atividades Bonus
exports.getAtividadesBonus = async (req, res) => {
    const { id } = req.params;
    try {
        const atividadesBonus = await AtividadeBonus.getAll(id);
        res.status(200).json(atividadesBonus);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar atividades bônus', error: error.message });
    }
};

exports.getAtividadeBonusById = async (req, res) => {
    const { id, atividadeId } = req.params;
    try {
        const atividadeBonus = await AtividadeBonus.getById(id, atividadeId);
        res.status(200).json(atividadeBonus);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar atividade bônus', error: error.message });
    }
};

exports.updateAtividadeBonus = async (req, res) => {
    const { id, atividadeId } = req.params;
    try {
        const atividadeBonus = await AtividadeBonus.update(id, atividadeId, req.body);
        res.status(200).json(atividadeBonus);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao atualizar atividade bônus', error: error.message });
    }
};

exports.deleteAtividadeBonus = async (req, res) => {
    const { id, atividadeId } = req.params;
    try {
        await AtividadeBonus.delete(id, atividadeId);
        res.status(200).json({ message: 'Atividade bônus deletada com sucesso' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao deletar atividade bônus', error: error.message });
    }
};

// Relatórios
exports.getRelatorio = async (req, res) => {
    const { id } = req.params;
    try {
        const [contribuicoes, emprestimos, atividadesBonus] = await Promise.all([
            Contribuicao.getAll(id),
            Emprestimo.getAll(id),
            AtividadeBonus.getAll(id)
        ]);

        const relatorio = {
            contribuicoes,
            emprestimos,
            atividadesBonus
        };

        res.status(200).json(relatorio);
    } catch (error) {
        console.error('Erro ao gerar relatório:', error);
        res.status(500).json({ message: 'Erro ao gerar relatório', error: error.message });
    }
};

exports.getRelatorioContribuicoes = async (req, res) => {
    const { id } = req.params;
    try {
        const contribuicoes = await Contribuicao.getAll(id);
        res.status(200).json(contribuicoes);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao gerar relatório de contribuições', error: error.message });
    }
};

exports.getRelatorioEmprestimos = async (req, res) => {
    const { id } = req.params;
    try {
        const emprestimos = await Emprestimo.getAll(id);
        res.status(200).json(emprestimos);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao gerar relatório de empréstimos', error: error.message });
    }
};

exports.getRelatorioAtividadesBonus = async (req, res) => {
    const { id } = req.params;
    try {
        const atividadesBonus = await AtividadeBonus.getAll(id);
        res.status(200).json(atividadesBonus);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao gerar relatório de atividades bônus', error: error.message });
    }
};

// Membros
exports.addMembro = async (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;
    try {
        const membro = await Membro.add(id, userId);
        res.status(200).json(membro);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao adicionar membro', error: error.message });
    }
};

exports.getMembros = async (req, res) => {
    const { id } = req.params;
    try {
        const membros = await Membro.getAll(id);
        res.status(200).json(membros);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar membros', error: error.message });
    }
};

exports.getMembroById = async (req, res) => {
    const { id, membroId } = req.params;
    try {
        const membro = await Membro.getById(id, membroId);
        res.status(200).json(membro);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar membro', error: error.message });
    }
};

exports.updateMembro = async (req, res) => {
    const { id, membroId } = req.params;
    try {
        const membro = await Membro.update(id, membroId, req.body);
        res.status(200).json(membro);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao atualizar membro', error: error.message });
    }
};

exports.deleteMembro = async (req, res) => {
    const { id, membroId } = req.params;
    try {
        await Membro.delete(id, membroId);
        res.status(200).json({ message: 'Membro deletado com sucesso' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao deletar membro', error: error.message });
    }
};

// Configurações
exports.getConfiguracoes = async (req, res) => {
    const { id } = req.params;
    try {
        const caixinha = await Caixinha.getById(id);
        res.status(200).json(caixinha.configuracoes);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar configurações', error: error.message });
    }
};

exports.updateConfiguracoes = async (req, res) => {
    const { id } = req.params;
    try {
        const caixinha = await Caixinha.update(id, { configuracoes: req.body });
        res.status(200).json(caixinha.configuracoes);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao atualizar configurações', error: error.message });
    }
};

// Transações
exports.getTransacoes = async (req, res) => {
    const { id } = req.params;
    try {
        const transacoes = await Transacao.getAll(id);
        res.status(200).json(transacoes);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar transações', error: error.message });
    }
};

exports.getTransacaoById = async (req, res) => {
    const { id, transacaoId } = req.params;
    try {
        const transacao = await Transacao.getById(id, transacaoId);
        res.status(200).json(transacao);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar transação', error: error.message });
    }
};

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

exports.getContribuicoes = async (req, res) => {
    const { id } = req.params;

    try {
        // Verifica se a caixinha existe
        const caixinhaRef = firestore.collection('caixinhas').doc(id);
        const caixinhaDoc = await caixinhaRef.get();

        if (!caixinhaDoc.exists) {
            return res.status(404).json({ message: 'Caixinha não encontrada' });
        }

        // Busca todas as contribuições relacionadas à caixinha
        const contribuicoesRef = caixinhaRef.collection('contribuicoes');
        const snapshot = await contribuicoesRef.get();

        const contribuicoes = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        res.status(200).json(contribuicoes);
    } catch (error) {
        console.error('Erro ao buscar contribuições:', error);
        res.status(500).json({ message: 'Erro ao buscar contribuições', error: error.message });
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
