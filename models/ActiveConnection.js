const {db} = require('../firebaseAdmin');

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
    const userDoc = await db.collection('usuario').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('Usuário não encontrado.');
    }
  
    const userData = userDoc.data();
    const friendIds = userData.amigos || [];
    const bestFriendIds = userData.amigosAutorizados || [];
  
    const connections = {};
    const friends = [];
    const bestFriends = [];
  
    for (const friendId of friendIds) {
      if (!connections[friendId]) {
        const friendDoc = await db.collection('usuario').doc(friendId).get();
        const friendData = friendDoc.data();
        const connection = new ActiveConnection(friendData);
        connections[friendId] = connection;
        friends.push(connection);
      }
    }
  
    for (const bestFriendId of bestFriendIds) {
      if (!connections[bestFriendId]) {
        const bestFriendDoc = await db.collection('usuario').doc(bestFriendId).get();
        const bestFriendData = bestFriendDoc.data();
        const connection = new ActiveConnection(bestFriendData);
        connections[bestFriendId] = connection;
        bestFriends.push(connection);
      }
    }
  
    return { friends, bestFriends };
  }

  static async getById(id) {
    const doc = await db.collection('ativas').doc(id).get();
    if (!doc.exists) {
      throw new Error('Conexão ativa não encontrada.');
    }
    return new ActiveConnection(doc.data());
  }

  static async create(data) {
    const connection = new ActiveConnection(data);
    const docRef = await db.collection('ativas').add({ ...connection });
    connection.id = docRef.id;
    return connection;
  }

  static async update(id, data) {
    const connectionRef = db.collection('ativas').doc(id);
    await connectionRef.update(data);
    const updatedDoc = await connectionRef.get();
    return new ActiveConnection(updatedDoc.data());
  }

  static async delete(id) {
    const connectionRef = db.collection('ativas').doc(id);
    await connectionRef.delete();
  }
}

module.exports = ActiveConnection;