const admin = require('firebase-admin');
const firestore = admin.firestore();

class InactiveConnection {
  constructor(data) {
    this.id = data.id;
    this.nome = data.nome;
    this.fotoDoPerfil = data.fotoDoPerfil;
    this.status = data.status;
    this.dataSolicitacao = data.dataSolicitacao ? new Date(data.dataSolicitacao.seconds * 1000) : new Date();
    this.dataDesfeita = data.dataDesfeita ? new Date(data.dataDesfeita.seconds * 1000) : null;
    this.dataAmizadeDesfeita = data.dataAmizadeDesfeita ? new Date(data.dataAmizadeDesfeita.seconds * 1000) : null;
  }

  static async getById(id) {
    const doc = await firestore.collection('inativas').doc(id).get();
    if (!doc.exists) {
      throw new Error('Conexão inativa não encontrada.');
    }
    return new InactiveConnection(doc.data());
  }

  static async create(data) {
    const connection = new InactiveConnection(data);
    const docRef = await firestore.collection('inativas').add({ ...connection });
    connection.id = docRef.id;
    return connection;
  }

  static async update(id, data) {
    const connectionRef = firestore.collection('inativas').doc(id);
    await connectionRef.update(data);
    const updatedDoc = await connectionRef.get();
    return new InactiveConnection(updatedDoc.data());
  }

  static async delete(id) {
    const connectionRef = firestore.collection('inativas').doc(id);
    await connectionRef.delete();
  }
}

module.exports = InactiveConnection;