const { getFirestore, FieldValue } = require('../firebaseAdmin');

class Contribuicao {
  constructor(data) {
    this.id = data.id;
    this.caixinhaId = data.caixinhaId;
    // Aceita membroId (padrão do service) ou userId (legado)
    this.membroId = data.membroId || data.userId;
    // Aceita valor (padrão do service) ou contribuicao (legado)
    this.valor = data.valor ?? data.contribuicao;
    this.status = data.status || 'confirmada';
    this.dataContribuicao = data.dataContribuicao
      ? new Date(data.dataContribuicao.seconds * 1000)
      : new Date();
  }

  static async getById(caixinhaId, id) {
    const db = getFirestore();
    const doc = await db.collection('caixinhas').doc(caixinhaId).collection('contribuicoes').doc(id).get();
    if (!doc.exists) {
      throw new Error('Contribuição não encontrada.');
    }
    return new Contribuicao(doc.data());
  }

  static async create(data) {
    const db = getFirestore();
    const contribuicao = new Contribuicao(data);
    const docRef = await db.collection('caixinhas').doc(data.caixinhaId).collection('contribuicoes').add({ ...contribuicao });
    contribuicao.id = docRef.id;
    return contribuicao;
  }

  static async update(caixinhaId, id, data) {
    const db = getFirestore();
    const contribuicaoRef = db.collection('caixinhas').doc(caixinhaId).collection('contribuicoes').doc(id);
    await contribuicaoRef.update(data);
    const updatedDoc = await contribuicaoRef.get();
    return new Contribuicao(updatedDoc.data());
  }

  /**
   * Estorna uma contribuição: marca como 'estornada', cria transação de reversão
   * e decrementa o saldoTotal da caixinha — tudo em um único batch.
   * NÃO deleta o documento (auditoria preservada).
   */
  static async reverter(caixinhaId, id, adminId) {
    const db = getFirestore();
    const contribuicaoRef = db
      .collection('caixinhas')
      .doc(caixinhaId)
      .collection('contribuicoes')
      .doc(id);

    const contribuicaoDoc = await contribuicaoRef.get();
    if (!contribuicaoDoc.exists) throw new Error('Contribuição não encontrada.');

    const contribuicao = contribuicaoDoc.data();
    if (contribuicao.status === 'estornada') {
      throw new Error('Contribuição já foi estornada.');
    }

    const valor = contribuicao.valor ?? contribuicao.contribuicao;
    if (!valor || valor <= 0) throw new Error('Valor da contribuição inválido para estorno.');

    const batch = db.batch();

    // 1. Marca contribuição como estornada
    batch.update(contribuicaoRef, {
      status: 'estornada',
      estornadoEm: new Date(),
      estornadoPor: adminId || null
    });

    // 2. Cria transação de reversão auditável
    const transacaoRef = db
      .collection('caixinhas')
      .doc(caixinhaId)
      .collection('transacoes')
      .doc();
    batch.set(transacaoRef, {
      tipo: 'estorno',
      valor: -valor,
      membroId: contribuicao.membroId || contribuicao.userId,
      contribuicaoId: id,
      data: new Date(),
      createdAt: new Date()
    });

    // 3. Decrementa saldo da caixinha atomicamente
    const caixinhaRef = db.collection('caixinhas').doc(caixinhaId);
    batch.update(caixinhaRef, {
      saldoTotal: FieldValue.increment(-valor)
    });

    await batch.commit();
  }

  static async getByUserId(userId, limit = 10) {
    try {
      const db = getFirestore();
      const snapshot = await db
        .collectionGroup('contribuicoes')
        .where('membroId', '==', userId)
        .orderBy('dataContribuicao', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map(doc => new Contribuicao({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.warn('Failed to get contributions by user ID:', error.message);
      return [];
    }
  }
}

module.exports = Contribuicao;