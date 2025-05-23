const { getFirestore } = require('../firebaseAdmin');
const { FieldValue } = require('firebase-admin/firestore');
const { logger } = require('../logger');
const db = getFirestore();

class Rifa {
  constructor(data) {
    this.id = data.id || null;
    this.caixinhaId = data.caixinhaId;
    this.nome = data.nome;
    this.descricao = data.descricao;
    this.valorBilhete = data.valorBilhete;
    this.quantidadeBilhetes = data.quantidadeBilhetes;
    this.bilhetesVendidos = data.bilhetesVendidos || [];
    this.dataInicio = data.dataInicio ? new Date(data.dataInicio) : new Date();
    this.dataFim = data.dataFim ? new Date(data.dataFim) : null;
    this.status = data.status || 'ABERTA';
    this.premio = data.premio;
    this.sorteioData = data.sorteioData ? new Date(data.sorteioData) : null;
    this.sorteioMetodo = data.sorteioMetodo || 'RANDOM_ORG';
    this.sorteioReferencia = data.sorteioReferencia || null;
    this.sorteioResultado = data.sorteioResultado || null;
    this.createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
    this.updatedAt = data.updatedAt ? new Date(data.updatedAt) : new Date();
  }

  static async getById(caixinhaId, rifaId) {
    try {
      logger.info('Buscando rifa por ID', {
        service: 'rifaModel',
        method: 'getById',
        caixinhaId,
        rifaId
      });

      if (!rifaId || typeof rifaId !== 'string' || !rifaId.trim()) {
        throw new Error('ID da rifa inválido ou não fornecido.');
      }

      const doc = await db
        .collection('caixinhas')
        .doc(caixinhaId)
        .collection('rifas')
        .doc(rifaId)
        .get();
      
      if (!doc.exists) {
        logger.warn('Rifa não encontrada', {
          service: 'rifaModel',
          method: 'getById',
          caixinhaId,
          rifaId
        });
        return null;
      }

      return new Rifa({ id: doc.id, ...doc.data() });
    } catch (error) {
      logger.error('Erro ao buscar rifa', {
        service: 'rifaModel',
        method: 'getById',
        caixinhaId,
        rifaId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  static async getByCaixinha(caixinhaId) {
    try {
      logger.info('Buscando rifas por caixinha', {
        service: 'rifaModel',
        method: 'getByCaixinha',
        caixinhaId
      });

      const snapshot = await db
        .collection('caixinhas')
        .doc(caixinhaId)
        .collection('rifas')
        .get();
      
      const rifas = [];
      snapshot.forEach(doc => {
        rifas.push(new Rifa({ id: doc.id, ...doc.data() }));
      });

      logger.info('Rifas recuperadas com sucesso', {
        service: 'rifaModel',
        method: 'getByCaixinha',
        caixinhaId,
        count: rifas.length
      });

      return rifas;
    } catch (error) {
      logger.error('Erro ao buscar rifas por caixinha', {
        service: 'rifaModel',
        method: 'getByCaixinha',
        caixinhaId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  static async create(data) {
    try {
      logger.info('Criando nova rifa', {
        service: 'rifaModel',
        method: 'create',
        caixinhaId: data.caixinhaId,
        nome: data.nome
      });

      const timestamp = new Date();
      const rifa = new Rifa({
        ...data,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      // Criar documento na subcoleção rifas da caixinha
      const rifaRef = db
        .collection('caixinhas')
        .doc(data.caixinhaId)
        .collection('rifas')
        .doc();

      const rifaId = rifaRef.id;

      await rifaRef.set({
        ...rifa,
        id: rifaId,
        dataInicio: rifa.dataInicio.toISOString(),
        dataFim: rifa.dataFim ? rifa.dataFim.toISOString() : null,
        sorteioData: rifa.sorteioData ? rifa.sorteioData.toISOString() : null,
        createdAt: rifa.createdAt.toISOString(),
        updatedAt: rifa.updatedAt.toISOString()
      });

      // Atualizar o documento da caixinha para incluir referência à rifa
      const caixinhaRef = db.collection('caixinhas').doc(data.caixinhaId);
      await caixinhaRef.update({
        totalRifas: FieldValue.increment(1)
      });

      logger.info('Rifa criada com sucesso', {
        service: 'rifaModel',
        method: 'create',
        rifaId,
        caixinhaId: data.caixinhaId
      });

      return { ...rifa, id: rifaId };
    } catch (error) {
      logger.error('Erro ao criar rifa', {
        service: 'rifaModel',
        method: 'create',
        error: error.message,
        stack: error.stack,
        requestData: data
      });
      throw error;
    }
  }

  static async update(caixinhaId, rifaId, data) {
    try {
      logger.info('Atualizando rifa', {
        service: 'rifaModel',
        method: 'update',
        caixinhaId,
        rifaId,
        updateData: data
      });

      const rifaRef = db
        .collection('caixinhas')
        .doc(caixinhaId)
        .collection('rifas')
        .doc(rifaId);

      const timestamp = new Date();
      
      const updateData = {
        ...data,
        updatedAt: timestamp.toISOString()
      };

      // Converter datas se necessário
      if (data.dataInicio) updateData.dataInicio = new Date(data.dataInicio).toISOString();
      if (data.dataFim) updateData.dataFim = new Date(data.dataFim).toISOString();
      if (data.sorteioData) updateData.sorteioData = new Date(data.sorteioData).toISOString();

      await rifaRef.update(updateData);
      const updatedDoc = await rifaRef.get();
      const updatedRifa = new Rifa({ id: updatedDoc.id, ...updatedDoc.data() });

      logger.info('Rifa atualizada com sucesso', {
        service: 'rifaModel',
        method: 'update',
        caixinhaId,
        rifaId
      });

      return updatedRifa;
    } catch (error) {
      logger.error('Erro ao atualizar rifa', {
        service: 'rifaModel',
        method: 'update',
        caixinhaId,
        rifaId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  static async delete(caixinhaId, rifaId) {
    try {
      logger.info('Excluindo rifa', {
        service: 'rifaModel',
        method: 'delete',
        caixinhaId,
        rifaId
      });

      const rifaRef = db
        .collection('caixinhas')
        .doc(caixinhaId)
        .collection('rifas')
        .doc(rifaId);

      await rifaRef.delete();

      // Atualizar o documento da caixinha para decrementar referência à rifa
      const caixinhaRef = db.collection('caixinhas').doc(caixinhaId);
      await caixinhaRef.update({
        totalRifas: FieldValue.increment(-1)
      });

      logger.info('Rifa excluída com sucesso', {
        service: 'rifaModel',
        method: 'delete',
        caixinhaId,
        rifaId
      });

      return true;
    } catch (error) {
      logger.error('Erro ao excluir rifa', {
        service: 'rifaModel',
        method: 'delete',
        caixinhaId,
        rifaId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async venderBilhete(caixinhaId, rifaId, membroId, numeroBilhete) {
    try {
      // Verificar se o bilhete está disponível
      const bilheteExistente = this.bilhetesVendidos.find(b => b.numero === numeroBilhete);
      if (bilheteExistente) {
        throw new Error('Este bilhete já foi vendido.');
      }

      // Verificar se está dentro do período da rifa
      const agora = new Date();
      if (this.dataFim && agora > this.dataFim) {
        throw new Error('Esta rifa já foi encerrada.');
      }

      // Verificar se o número está dentro do intervalo válido
      if (numeroBilhete < 1 || numeroBilhete > this.quantidadeBilhetes) {
        throw new Error(`Número de bilhete inválido. Deve estar entre 1 e ${this.quantidadeBilhetes}.`);
      }

      // Adicionar bilhete vendido
      const novoBilhete = {
        numero: numeroBilhete,
        membroId,
        dataCompra: new Date().toISOString()
      };

      // Atualizar no Firestore
      const rifaRef = db
        .collection('caixinhas')
        .doc(caixinhaId)
        .collection('rifas')
        .doc(rifaId);

      await rifaRef.update({
        bilhetesVendidos: FieldValue.arrayUnion(novoBilhete),
        updatedAt: new Date().toISOString()
      });

      // Atualizar objeto local
      this.bilhetesVendidos.push(novoBilhete);
      this.updatedAt = new Date();

      logger.info('Bilhete vendido com sucesso', {
        service: 'rifaModel',
        method: 'venderBilhete',
        caixinhaId,
        rifaId,
        membroId,
        numeroBilhete
      });

      return novoBilhete;
    } catch (error) {
      logger.error('Erro ao vender bilhete', {
        service: 'rifaModel',
        method: 'venderBilhete',
        caixinhaId,
        rifaId,
        membroId,
        numeroBilhete,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async registrarSorteio(caixinhaId, rifaId, resultado, metodo, referencia) {
    try {
      if (this.status !== 'ABERTA') {
        throw new Error('Esta rifa não está aberta para sorteio.');
      }

      // Verificar se há bilhetes vendidos
      if (this.bilhetesVendidos.length === 0) {
        throw new Error('Não há bilhetes vendidos para realizar o sorteio.');
      }

      // Registrar resultado do sorteio
      const numeroSorteado = parseInt(resultado);
      if (isNaN(numeroSorteado) || numeroSorteado < 1 || numeroSorteado > this.quantidadeBilhetes) {
        throw new Error(`Número sorteado inválido. Deve estar entre 1 e ${this.quantidadeBilhetes}.`);
      }

      // Encontrar bilhete vencedor
      const bilheteVencedor = this.bilhetesVendidos.find(b => b.numero === numeroSorteado);
      
      // Gerar hash para verificação
      const verificacaoHash = this._gerarHashVerificacao({
        caixinhaId,
        rifaId,
        numeroSorteado,
        metodo,
        referencia,
        timestamp: new Date().toISOString()
      });

      const sorteioResultado = {
        numeroSorteado,
        bilheteVencedor: bilheteVencedor || null,
        verificacaoHash,
        dataSorteio: new Date().toISOString(),
        comprovante: null // Será gerado posteriormente
      };

      // Atualizar no Firestore
      const rifaRef = db
        .collection('caixinhas')
        .doc(caixinhaId)
        .collection('rifas')
        .doc(rifaId);

      await rifaRef.update({
        status: 'FINALIZADA',
        sorteioResultado,
        sorteioMetodo: metodo,
        sorteioReferencia: referencia,
        updatedAt: new Date().toISOString()
      });

      // Atualizar objeto local
      this.status = 'FINALIZADA';
      this.sorteioResultado = sorteioResultado;
      this.sorteioMetodo = metodo;
      this.sorteioReferencia = referencia;
      this.updatedAt = new Date();

      logger.info('Sorteio realizado com sucesso', {
        service: 'rifaModel',
        method: 'registrarSorteio',
        caixinhaId,
        rifaId,
        numeroSorteado,
        vencedor: bilheteVencedor ? bilheteVencedor.membroId : 'Ninguém'
      });

      return sorteioResultado;
    } catch (error) {
      logger.error('Erro ao registrar sorteio', {
        service: 'rifaModel',
        method: 'registrarSorteio',
        caixinhaId,
        rifaId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  _gerarHashVerificacao(dados) {
    // Em um ambiente de produção, usar uma biblioteca de hash segura
    const crypto = require('crypto');
    const dadosString = JSON.stringify(dados);
    return crypto.createHash('sha256').update(dadosString).digest('hex');
  }
}

module.exports = Rifa;