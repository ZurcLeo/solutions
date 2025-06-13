const { getFirestore } = require('../firebaseAdmin');
const { logger } = require('../logger');
const db = getFirestore();

class Emprestimos {
  constructor(data) {
    this.id = data.id || null;
    this.caixinhaId = data.caixinhaId;
    this.memberId = data.memberId;
    this.valorSolicitado = parseFloat(data.valorSolicitado) || 0;
    this.dataSolicitacao = data.dataSolicitacao instanceof Date ? 
      data.dataSolicitacao : new Date(data.dataSolicitacao || Date.now());
    this.status = data.status || 'pendente';
    this.votos = data.votos || {};
    this.prazoMeses = parseInt(data.prazoMeses) || 12;
    this.parcelas = data.parcelas || [];
    this.valorTotal = parseFloat(data.valorTotal) || this.valorSolicitado;
    this.taxaJurosAplicada = parseFloat(data.taxaJurosAplicada) || 0;
    this.valorMultaAplicada = parseFloat(data.valorMultaAplicada) || 0;
    this.dataAprovacao = data.dataAprovacao ? new Date(data.dataAprovacao) : null;
    this.dataRejeitacao = data.dataRejeitacao ? new Date(data.dataRejeitacao) : null;
    this.motivoRejeitacao = data.motivoRejeitacao || '';
    this.dataQuitacao = data.dataQuitacao ? new Date(data.dataQuitacao) : null;
  }

  // Método para obter a configuração de empréstimos da caixinha
  static async getConfiguracao(caixinhaId) {
    try {
      const configRef = db
        .collection('caixinhas')
        .doc(caixinhaId)
        .collection('emprestimos')
        .doc('configuracao');
      
      const doc = await configRef.get();
      
      if (!doc.exists) {
        logger.warn('Configuração de empréstimos não encontrada', {
          service: 'emprestimosModel',
          method: 'getConfiguracao',
          caixinhaId
        });
        return null;
      }
      
      return doc.data();
    } catch (error) {
      logger.error('Erro ao obter configuração de empréstimos', {
        service: 'emprestimosModel',
        method: 'getConfiguracao',
        caixinhaId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  // Método para obter um empréstimo por ID
  static async getById(caixinhaId, emprestimoId) {
    try {
      logger.info('Buscando empréstimo por ID', {
        service: 'emprestimosModel',
        method: 'getById',
        caixinhaId,
        emprestimoId
      });

      const doc = await db
        .collection('caixinhas')
        .doc(caixinhaId)
        .collection('emprestimos')
        .doc(emprestimoId)
        .get();
      
      if (!doc.exists) {
        logger.warn('Empréstimo não encontrado', {
          service: 'emprestimosModel',
          method: 'getById',
          caixinhaId,
          emprestimoId
        });
        return null;
      }
      
      return new Emprestimos({ id: doc.id, ...doc.data() });
    } catch (error) {
      logger.error('Erro ao buscar empréstimo', {
        service: 'emprestimosModel',
        method: 'getById',
        caixinhaId,
        emprestimoId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  // Método para listar todos os empréstimos de uma caixinha
  static async getAllByCaixinha(caixinhaId, filtros = {}) {
    try {
      logger.info('Buscando todos os empréstimos da caixinha', {
        service: 'emprestimosModel',
        method: 'getAllByCaixinha',
        caixinhaId,
        filtros
      });

      let query = db
        .collection('caixinhas')
        .doc(caixinhaId)
        .collection('emprestimos');
      
      // Aplicar filtros se fornecidos
      if (filtros.status) {
        query = query.where('status', '==', filtros.status);
      }
      
      if (filtros.userId) {
        query = query.where('memberId', '==', filtros.userId);
      }
      
      // Não ordenar na query para evitar problemas com índices
      // A ordenação será feita depois em memória
      
      const snapshot = await query.get();
      
      const emprestimos = [];
      snapshot.forEach(doc => {
        // Ignorar o documento de configuração
        if (doc.id !== 'configuracao') {
          emprestimos.push(new Emprestimos({ id: doc.id, ...doc.data() }));
        }
      });
      
      // Ordenar em memória por data de solicitação (mais recentes primeiro)
      emprestimos.sort((a, b) => {
        const dateA = new Date(a.dataSolicitacao);
        const dateB = new Date(b.dataSolicitacao);
        return dateB - dateA; // Ordem decrescente
      });
      
      logger.info('Empréstimos recuperados com sucesso', {
        service: 'emprestimosModel',
        method: 'getAllByCaixinha',
        caixinhaId,
        quantidade: emprestimos.length
      });
      
      return emprestimos;
    } catch (error) {
      logger.error('Erro ao buscar empréstimos da caixinha', {
        service: 'emprestimosModel',
        method: 'getAllByCaixinha',
        caixinhaId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  // Método para listar todos os empréstimos de um usuário
  static async getAllByUsuario(userId, filtros = {}) {
    try {
      logger.info('Buscando todos os empréstimos do usuário', {
        service: 'emprestimosModel',
        method: 'getAllByUsuario',
        userId,
        filtros
      });

      // Primeiro precisamos buscar todas as caixinhas do usuário
      const userDoc = await db.collection('usuario').doc(userId).get();
      
      if (!userDoc.exists || !userDoc.data().caixinhas || userDoc.data().caixinhas.length === 0) {
        logger.info('Usuário não possui caixinhas', {
          service: 'emprestimosModel',
          method: 'getAllByUsuario',
          userId
        });
        return [];
      }
      
      const caixinhasIds = userDoc.data().caixinhas;
      const emprestimos = [];
      
      // Para cada caixinha, buscar os empréstimos do usuário
      const promises = caixinhasIds.map(async caixinhaId => {
        const caixinhaEmprestimos = await this.getAllByCaixinha(caixinhaId, { userId });
        emprestimos.push(...caixinhaEmprestimos);
      });
      
      await Promise.all(promises);
      
      logger.info('Empréstimos do usuário recuperados com sucesso', {
        service: 'emprestimosModel',
        method: 'getAllByUsuario',
        userId,
        quantidade: emprestimos.length
      });
      
      return emprestimos;
    } catch (error) {
      logger.error('Erro ao buscar empréstimos do usuário', {
        service: 'emprestimosModel',
        method: 'getAllByUsuario',
        userId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  // Método para criar um novo empréstimo
  static async create(caixinhaId, data) {
    try {
      logger.info('Criando novo empréstimo', {
        service: 'emprestimosModel',
        method: 'create',
        caixinhaId,
        userId: data.userId,
        valorSolicitado: data.valorSolicitado
      });

      // Verificar se permiteEmprestimos está habilitado na caixinha
      const caixinhaDoc = await db.collection('caixinhas').doc(caixinhaId).get();
      
      if (!caixinhaDoc.exists) {
        throw new Error('Caixinha não encontrada');
      }
      
      const caixinhaData = caixinhaDoc.data();
      
      if (!caixinhaData.permiteEmprestimos) {
        throw new Error('Esta caixinha não permite empréstimos');
      }
      
      // Obter configurações de empréstimo
      const configuracao = await this.getConfiguracao(caixinhaId);
      
      if (!configuracao) {
        throw new Error('Configuração de empréstimos não encontrada');
      }
      
      // Normalizar os dados de entrada
      const valorSolicitado = parseFloat(data.valor || data.valorSolicitado);
      const prazoMeses = parseInt(data.parcelas || data.prazoMeses || 12);
      
      // Verificar limite de empréstimo
      if (configuracao.limiteEmprestimo > 0 && valorSolicitado > configuracao.limiteEmprestimo) {
        throw new Error(`O valor solicitado excede o limite de empréstimo (${configuracao.limiteEmprestimo})`);
      }
      
      // Verificar prazo máximo
      if (prazoMeses > configuracao.prazoMaximoEmprestimo) {
        throw new Error(`O prazo solicitado excede o prazo máximo permitido (${configuracao.prazoMaximoEmprestimo} meses)`);
      }
      
      // Calcular valor total com juros
      const taxaJuros = parseFloat(configuracao.taxaJuros || 0);
      const valorTotal = valorSolicitado * (1 + (taxaJuros / 100) * (prazoMeses / 12));
      
      // Criar objeto de empréstimo
      const emprestimo = new Emprestimos({
        ...data,
        memberId: data.userId,
        valorSolicitado,
        prazoMeses,
        caixinhaId,
        dataSolicitacao: new Date(),
        status: 'pendente',
        valorTotal,
        taxaJurosAplicada: taxaJuros,
        valorMultaAplicada: parseFloat(configuracao.valorMulta || 0)
      });
      
      // Salvar no Firestore
      const docRef = await db
        .collection('caixinhas')
        .doc(caixinhaId)
        .collection('emprestimos')
        .add({
          ...emprestimo,
          dataSolicitacao: emprestimo.dataSolicitacao.toISOString()
        });
      
      emprestimo.id = docRef.id;
      
      logger.info('Empréstimo criado com sucesso', {
        service: 'emprestimosModel',
        method: 'create',
        caixinhaId,
        emprestimoId: emprestimo.id,
        status: 'pendente'
      });
      
      return emprestimo;
    } catch (error) {
      logger.error('Erro ao criar empréstimo', {
        service: 'emprestimosModel',
        method: 'create',
        caixinhaId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  // Método para atualizar um empréstimo
  static async update(caixinhaId, emprestimoId, data) {
    try {
      logger.info('Atualizando empréstimo', {
        service: 'emprestimosModel',
        method: 'update',
        caixinhaId,
        emprestimoId
      });

      const emprestimoRef = db
        .collection('caixinhas')
        .doc(caixinhaId)
        .collection('emprestimos')
        .doc(emprestimoId);
      
      await emprestimoRef.update({
        ...data,
        // Converter datas para ISO String se existirem
        ...(data.dataSolicitacao && { dataSolicitacao: data.dataSolicitacao.toISOString() }),
        ...(data.dataAprovacao && { dataAprovacao: data.dataAprovacao.toISOString() }),
        ...(data.dataRejeitacao && { dataRejeitacao: data.dataRejeitacao.toISOString() }),
        ...(data.dataQuitacao && { dataQuitacao: data.dataQuitacao.toISOString() })
      });
      
      const updatedDoc = await emprestimoRef.get();
      
      logger.info('Empréstimo atualizado com sucesso', {
        service: 'emprestimosModel',
        method: 'update',
        caixinhaId,
        emprestimoId,
        status: data.status
      });
      
      return new Emprestimos({ id: updatedDoc.id, ...updatedDoc.data() });
    } catch (error) {
      logger.error('Erro ao atualizar empréstimo', {
        service: 'emprestimosModel',
        method: 'update',
        caixinhaId,
        emprestimoId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  // Método para aprovar um empréstimo
  static async aprovar(caixinhaId, emprestimoId, adminId) {
    try {
      logger.info('Aprovando empréstimo', {
        service: 'emprestimosModel',
        method: 'aprovar',
        caixinhaId,
        emprestimoId,
        adminId
      });

      const emprestimo = await this.getById(caixinhaId, emprestimoId);
      
      if (!emprestimo) {
        throw new Error('Empréstimo não encontrado');
      }
      
      if (emprestimo.status !== 'pendente') {
        throw new Error(`Empréstimo não pode ser aprovado no status atual: ${emprestimo.status}`);
      }
      
      // Atualizar empréstimo
      const emprestimoAtualizado = await this.update(caixinhaId, emprestimoId, {
        status: 'aprovado',
        dataAprovacao: new Date(),
        adminAprovador: adminId
      });
      
      logger.info('Empréstimo aprovado com sucesso', {
        service: 'emprestimosModel',
        method: 'aprovar',
        caixinhaId,
        emprestimoId
      });
      
      return emprestimoAtualizado;
    } catch (error) {
      logger.error('Erro ao aprovar empréstimo', {
        service: 'emprestimosModel',
        method: 'aprovar',
        caixinhaId,
        emprestimoId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  // Método para rejeitar um empréstimo
  static async rejeitar(caixinhaId, emprestimoId, adminId, motivo = '') {
    try {
      logger.info('Rejeitando empréstimo', {
        service: 'emprestimosModel',
        method: 'rejeitar',
        caixinhaId,
        emprestimoId,
        adminId,
        motivo
      });

      const emprestimo = await this.getById(caixinhaId, emprestimoId);
      
      if (!emprestimo) {
        throw new Error('Empréstimo não encontrado');
      }
      
      if (emprestimo.status !== 'pendente') {
        throw new Error(`Empréstimo não pode ser rejeitado no status atual: ${emprestimo.status}`);
      }
      
      // Atualizar empréstimo
      const emprestimoAtualizado = await this.update(caixinhaId, emprestimoId, {
        status: 'rejeitado',
        dataRejeitacao: new Date(),
        adminRejeitador: adminId,
        motivoRejeitacao: motivo
      });
      
      logger.info('Empréstimo rejeitado com sucesso', {
        service: 'emprestimosModel',
        method: 'rejeitar',
        caixinhaId,
        emprestimoId
      });
      
      return emprestimoAtualizado;
    } catch (error) {
      logger.error('Erro ao rejeitar empréstimo', {
        service: 'emprestimosModel',
        method: 'rejeitar',
        caixinhaId,
        emprestimoId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  // Método para registrar pagamento de parcela
  static async registrarPagamento(caixinhaId, emprestimoId, valor, observacao = '') {
    try {
      logger.info('Registrando pagamento de empréstimo', {
        service: 'emprestimosModel',
        method: 'registrarPagamento',
        caixinhaId,
        emprestimoId,
        valor
      });

      const emprestimo = await this.getById(caixinhaId, emprestimoId);
      
      if (!emprestimo) {
        throw new Error('Empréstimo não encontrado');
      }
      
      if (emprestimo.status !== 'aprovado' && emprestimo.status !== 'parcial') {
        throw new Error(`Pagamento não pode ser registrado para empréstimo no status: ${emprestimo.status}`);
      }
      
      // Calcular valor total já pago
      const valorPago = (emprestimo.parcelas || []).reduce((total, parcela) => total + parcela.valor, 0) + valor;
      
      // Verificar se quitou totalmente
      const novoStatus = valorPago >= emprestimo.valorTotal ? 'quitado' : 'parcial';
      
      // Adicionar nova parcela
      const parcelas = [...(emprestimo.parcelas || []), {
        data: new Date().toISOString(),
        valor,
        observacao
      }];
      
      // Atualizar empréstimo
      const dadosAtualizacao = {
        parcelas,
        status: novoStatus,
        valorPago
      };
      
      // Se for quitação total, registrar data
      if (novoStatus === 'quitado') {
        dadosAtualizacao.dataQuitacao = new Date();
      }
      
      const emprestimoAtualizado = await this.update(caixinhaId, emprestimoId, dadosAtualizacao);
      
      logger.info('Pagamento registrado com sucesso', {
        service: 'emprestimosModel',
        method: 'registrarPagamento',
        caixinhaId,
        emprestimoId,
        valor,
        status: novoStatus
      });
      
      return emprestimoAtualizado;
    } catch (error) {
      logger.error('Erro ao registrar pagamento', {
        service: 'emprestimosModel',
        method: 'registrarPagamento',
        caixinhaId,
        emprestimoId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  // Método para excluir um empréstimo (apenas para pendentes)
  static async delete(caixinhaId, emprestimoId) {
    try {
      logger.info('Excluindo empréstimo', {
        service: 'emprestimosModel',
        method: 'delete',
        caixinhaId,
        emprestimoId
      });

      const emprestimo = await this.getById(caixinhaId, emprestimoId);
      
      if (!emprestimo) {
        throw new Error('Empréstimo não encontrado');
      }
      
      if (emprestimo.status !== 'pendente' && emprestimo.status !== 'rejeitado') {
        throw new Error(`Apenas empréstimos pendentes ou rejeitados podem ser excluídos. Status atual: ${emprestimo.status}`);
      }
      
      await db
        .collection('caixinhas')
        .doc(caixinhaId)
        .collection('emprestimos')
        .doc(emprestimoId)
        .delete();
      
      logger.info('Empréstimo excluído com sucesso', {
        service: 'emprestimosModel',
        method: 'delete',
        caixinhaId,
        emprestimoId
      });
    } catch (error) {
      logger.error('Erro ao excluir empréstimo', {
        service: 'emprestimosModel',
        method: 'delete',
        caixinhaId,
        emprestimoId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  // Método para obter estatísticas de empréstimos por caixinha
  static async getEstatisticas(caixinhaId) {
    try {
      logger.info('Obtendo estatísticas de empréstimos', {
        service: 'emprestimosModel',
        method: 'getEstatisticas',
        caixinhaId
      });

      const emprestimos = await this.getAllByCaixinha(caixinhaId);
      
      // Calcular estatísticas
      const total = emprestimos.length;
      const pendentes = emprestimos.filter(e => e.status === 'pendente').length;
      const aprovados = emprestimos.filter(e => e.status === 'aprovado' || e.status === 'parcial').length;
      const quitados = emprestimos.filter(e => e.status === 'quitado').length;
      const rejeitados = emprestimos.filter(e => e.status === 'rejeitado').length;
      
      // Calcular valores
      const valorTotal = emprestimos
        .filter(e => e.status === 'aprovado' || e.status === 'parcial' || e.status === 'quitado')
        .reduce((total, e) => total + e.valorSolicitado, 0);
      
      const valorQuitado = emprestimos
        .filter(e => e.status === 'quitado')
        .reduce((total, e) => total + e.valorSolicitado, 0);
      
      const valorEmAberto = emprestimos
        .filter(e => e.status === 'aprovado' || e.status === 'parcial')
        .reduce((total, e) => total + e.valorSolicitado, 0);
      
      // Retornar estatísticas
      return {
        total,
        pendentes,
        aprovados,
        quitados,
        rejeitados,
        valorTotal,
        valorQuitado,
        valorEmAberto
      };
    } catch (error) {
      logger.error('Erro ao obter estatísticas de empréstimos', {
        service: 'emprestimosModel',
        method: 'getEstatisticas',
        caixinhaId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
}

module.exports = Emprestimos;