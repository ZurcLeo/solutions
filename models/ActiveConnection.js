const admin = require('firebase-admin');
const firestore = admin.firestore();

class ActiveConnection {
  constructor(data) {
    this.id = data.id;
    this.interessesPessoais = data.interessesPessoais || [];
    this.nome = data.nome;
    this.fotoDoPerfil = data.fotoDoPerfil;
    this.interessesNegocios = data.interessesNegocios || [];
    this.email = data.email;
    this.status = data.status;
    this.dataDoAceite = data.dataDoAceite ? new Date(data.dataDoAceite.seconds * 1000) : null;
  }

  static async getById(id) {
    const doc = await firestore.collection('ativas').doc(id).get();
    if (!doc.exists) {
      throw new Error('Conexão ativa não encontrada.');
    }
    return new ActiveConnection(doc.data());
  }

  static async create(data) {
    const connection = new ActiveConnection(data);
    const docRef = await firestore.collection('ativas').add({ ...connection });
    connection.id = docRef.id;
    return connection;
  }

  static async update(id, data) {
    const connectionRef = firestore.collection('ativas').doc(id);
    await connectionRef.update(data);
    const updatedDoc = await connectionRef.get();
    return new ActiveConnection(updatedDoc.data());
  }

  static async delete(id) {
    const connectionRef = firestore.collection('ativas').doc(id);
    await connectionRef.delete();
  }
}

module.exports = ActiveConnection;