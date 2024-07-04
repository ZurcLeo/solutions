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

  static async getConnectionsByUserId(userId) {
    const userDoc = await firestore.collection('usuario').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('Usuário não encontrado.');
    }

    const userData = userDoc.data();
    const friendIds = userData.amigos || [];
    const bestFriendIds = userData.amigosAutorizados || [];

    const friendDocs = await firestore.collection('usuario').where('uid', 'in', friendIds).get();
    const bestFriendDocs = await firestore.collection('usuario').where('uid', 'in', bestFriendIds).get();
    const friends = friendDocs.docs.map(doc => new ActiveConnection(doc.data()));
    const bestFriends = bestFriendDocs.docs.map(doc => new ActiveConnection(doc.data()));
    return {friends, bestFriends};
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