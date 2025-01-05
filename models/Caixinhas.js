const {getFirestore} = require('../firebaseAdmin');
const Contribuicao = require('./Contribuicao')
const { logger } = require('../logger'); // Import the logger

const db = getFirestore();

class Caixinha {
  constructor(data) {
    // this.id = data.id;
    // this.groupId = data.groupId;
    this.name = data.name;
    this.description = data.description;
    this.adminId = data.adminId;
    this.members = data.members || [];
    this.contribuicaoMensal = data.contribuicaoMensal || 0;
    this.contribuicao = data.contribuicao || [];
    this.contribuicaoData = data.contribuicaoData;
    this.saldoTotal = data.saldoTotal || 0;
    this.distribuicaoTipo = data.distribuicaoTipo || "padrão";
    this.duracaoMeses = data.duracaoMeses || 12;
    this.dataCriacao = data.dataCriacao ? new Date(data.dataCriacao) : new Date();
  }

  static async getAll() {
    logger.info('Iniciando busca de todas as caixinhas', {
      service: 'caixinhaModel',
      method: 'getAll'
    });

    try {
      const snapshot = await db.collection('caixinhas').get();
      const caixinhas = [];

      snapshot.forEach(doc => {
        const data = doc.data();
        data.id = doc.id; // Adiciona o ID do documento aos dados
        caixinhas.push(new Caixinha(data));
      });

      logger.info('Caixinhas recuperadas com sucesso', {
        service: 'caixinhaModel',
        method: 'getAll',
        quantidade: caixinhas.length,
        // Evitamos logar todos os dados para não sobrecarregar os logs
        caixinhasIds: caixinhas.map(c => c.caixinhasId)
      });

      return caixinhas;
    } catch (error) {
      logger.error('Erro ao recuperar todas as caixinhas', {
        service: 'caixinhaModel',
        method: 'getAll',
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  static async getById(caixinhaId) {
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

      return { ...caixinha, id: docRef.id };
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