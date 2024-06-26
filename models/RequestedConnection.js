const admin = require('firebase-admin');
const firestore = admin.firestore();

class RequestedConnection {
  constructor(data) {
    this.id = data.id;
    this.nome = data.nome;
    this.fotoDoPerfil = data.fotoDoPerfil;
    this.email = data.email;
    this.status = data.status;
    this.dataSolicitacao = data.dataSolicitacao ? new Date(data.dataSolicitacao.seconds * 1000) : new Date();
    this.dataDoAceite = data.dataDoAceite ? new Date(data.dataDoAceite.seconds * 1000) : null;
    this.dataDesfeita = data.dataDesfeita ? new Date(data.dataDesfeita.seconds * 1000) : null;
  }

  static async getById(id) {
    const doc = await firestore.collection('solicitadas').doc(id).get();
    if (!doc.exists) {
      throw new Error('Conexão solicitada não encontrada.');
    }
    return new RequestedConnection(doc.data());
  }

  static async create(data) {
    const connection = new RequestedConnection(data);
    const docRef = await firestore.collection('solicitadas').add({ ...connection });
    connection.id = docRef.id;
    return connection;
  }

  static async update(id, data) {
    const connectionRef = firestore.collection('solicitadas').doc(id);
    await connectionRef.update(data);
    const updatedDoc = await connectionRef.get();
    return new RequestedConnection(updatedDoc.data());
  }

  static async delete(id) {
    const connectionRef = firestore.collection('solicitadas').doc(id);
    await connectionRef.delete();
  }
}

module.exports = RequestedConnection;