const {getFirestore} = require('../firebaseAdmin');
const Contribuicao = require('./Contribuicao');
const User = require('./User'); 
const { logger } = require('../logger'); 
const db = getFirestore();

class Caixinha {
  constructor(data) {
    this.id = data.id || null;
    // this.groupId = data.groupId;
    this.name = data.name;
    this.description = data.description;
    this.adminId = data.adminId;
    this.members = data.members || [];
    this.contribuicaoMensal = data.contribuicaoMensal || 0;
    this.contribuicao = data.contribuicao || [];
    this.contribuicaoData = data.contribuicaoData || null;
    this.saldoTotal = data.saldoTotal || 0;
    this.diaVencimento = data.diaVencimento || 1;
    this.valorMulta = data.valorMulta || 0;
    this.valorJuros = data.valorJuros || 0;
    this.distribuicaoTipo = data.distribuicaoTipo || "padrão";
    this.duracaoMeses = data.duracaoMeses || 12;
    this.dataCriacao = data.dataCriacao ? new Date(data.dataCriacao) : new Date();
    this.bankAccountActive = data.bankAccountActive || false; //sera true quando o usuario registrar e validar os dados bancarios
    this.bankAccountData = data.bankAccountData || []; //deve conter os dados bancarios completos registrados no modelo bankAccount
  }

  static async getAll(userId) {
    logger.info('Iniciando busca de todas as caixinhas para o usuário', {
      service: 'caixinhaModel',
      method: 'getAll',
      userId,
    });
  
    try {
      // Buscar o registro do usuário
      const user = await User.getById(userId);
  
      if (!user || !user.caixinhas || user.caixinhas.length === 0) {
        logger.warn('Nenhuma caixinha associada ao usuário', {
          service: 'caixinhaModel',
          method: 'getAll',
          userId,
        });
        return [];
      }
  
      // Filtrar as caixinhas pelos IDs do usuário
      const caixinhasIds = user.caixinhas;
      const snapshot = await db.collection('caixinhas').get();
      const caixinhas = [];
  
      snapshot.forEach((doc) => {
        if (caixinhasIds.includes(doc.id)) {
          const data = doc.data();
          caixinhas.push(new Caixinha({ id: doc.id, ...data }));
        }
      });
  
      logger.info('Caixinhas recuperadas com sucesso', {
        service: 'caixinhaModel',
        method: 'getAll',
        quantidade: caixinhas.length,
        caixinhasIds: caixinhas.map((c) => c.id),
      });
  
      return caixinhas;
    } catch (error) {
      logger.error('Erro ao recuperar caixinhas para o usuário', {
        service: 'caixinhaModel',
        method: 'getAll',
        userId,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }  

  static async getById(caixinhaId) {

    if (!caixinhaId || typeof caixinhaId !== 'string' || !caixinhaId.trim()) {
      throw new Error('ID da caixinha inválido ou não fornecido.');
    }

    try {
      const doc = await db.collection('caixinhas').doc(caixinhaId).get();
      
      if (!doc.exists) {
        throw new Error('Caixinha não encontrada.');
      }

      // Buscar contribuições
      const contribuicoesSnapshot = await db
        .collection('caixinhas')
        .doc(caixinhaId)
        .collection('contribuicoes')
        .get();

      const contribuicoes = [];
      contribuicoesSnapshot.forEach(doc => {
        contribuicoes.push(new Contribuicao({ id: doc.id, ...doc.data() }));
      });

      const data = {
        id: doc.id,
        ...doc.data(),
        contribuicoes 
      };

      return new Caixinha(data);
    } catch (error) {
      logger.error('Erro ao buscar caixinha com contribuições', {
        service: 'caixinhaModel',
        method: 'getById',
        caixinhaId,
        error: error.message
      });
      throw error;
    }
  }

  static async create(data) {
    logger.info('Iniciando criação de nova caixinha', {
      service: 'caixinhaModel',
      method: 'create',
      adminId: data.adminId,
      caixinhaName: data.name
    });

    try {
      
      const caixinha = new Caixinha(data);
      const docRef = await db.collection('caixinhas').add({ 
        ...caixinha,
        members: caixinha.members || [],
        dataCriacao: caixinha.dataCriacao.toISOString() 
      });

      logger.info('Caixinha criada com sucesso', {
        service: 'caixinhaModel',
        method: 'create',
        caixinhaData: caixinha
      });

      const caixinhaId = docRef.id;

      try {
        const user = await User.getById(data.adminId);
        const updatedCaixinhas = [...(user.caixinhas || []), caixinhaId];
        await User.update(user.id, { caixinhas: updatedCaixinhas });
  
        logger.info('ID da caixinha adicionado ao cadastro do usuário', {
          service: 'caixinhaModel',
          method: 'create',
          userId: user.id,
          caixinhaId,
        });
      } catch (userError) {
        logger.error('Erro ao atualizar usuário com ID da caixinha', {
          service: 'caixinhaModel',
          method: 'create',
          userId: data.adminId,
          error: userError.message,
        });
        throw new Error('Erro ao atualizar o cadastro do usuário com o ID da caixinha');
      }
  
      return { ...caixinha, id: caixinhaId };
    } catch (error) {
      logger.error('Erro ao criar caixinha', {
        service: 'caixinhaModel',
        method: 'create',
        error: error.message,
        stack: error.stack,
        requestData: data
      });
      throw error;
    }
  }

  static async update(id, data) {
    logger.info('Iniciando atualização de caixinha', {
      service: 'caixinhaModel',
      method: 'update',
      caixinhaId: id,
      updateData: data
    });

    try {
      const caixinhaRef = db.collection('caixinhas').doc(id);
      await caixinhaRef.update(data);
      const updatedDoc = await caixinhaRef.get();
      const updatedCaixinha = new Caixinha(updatedDoc.data());

      logger.info('Caixinha atualizada com sucesso', {
        service: 'caixinhaModel',
        method: 'update',
        caixinhaId: id,
        updatedData: updatedCaixinha
      });

      return updatedCaixinha;
    } catch (error) {
      logger.error('Erro ao atualizar caixinha', {
        service: 'caixinhaModel',
        method: 'update',
        caixinhaId: id,
        error: error.message,
        stack: error.stack,
        requestData: data
      });
      throw error;
    }
  }

  async getContribuicoes() {
    const contribuicoesRef = db.collection('caixinhas').doc(this.id).collection('contribuicoes');
    const snapshot = await contribuicoesRef.get();
    return snapshot.docs.map(doc => new Contribuicao({ id: doc.id, ...doc.data() }));
  }

  async addContribuicao(contribuicaoData) {
    return await Contribuicao.create({
      ...contribuicaoData,
      caixinhaId: this.id
    });
  }

  async updateSaldo(valor, tipo) {
    const novoSaldo = tipo === 'credito' ? this.saldoTotal + valor : this.saldoTotal - valor;
    await this.update({ saldoTotal: novoSaldo });
    return novoSaldo;
  }

  static async delete(id) {
    logger.info('Iniciando exclusão de caixinha', {
      service: 'caixinhaModel',
      method: 'delete',
      caixinhaId: id
    });

    try {
      const caixinhaRef = db.collection('caixinhas').doc(id);
      await caixinhaRef.delete();

      logger.info('Caixinha excluída com sucesso', {
        service: 'caixinhaModel',
        method: 'delete',
        caixinhaId: id
      });
    } catch (error) {
      logger.error('Erro ao excluir caixinha', {
        service: 'caixinhaModel',
        method: 'delete',
        caixinhaId: id,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
}

module.exports = Caixinha;