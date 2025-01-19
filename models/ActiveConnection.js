const {getFirestore} = require('../firebaseAdmin');
const { logger } = require('../logger');

class ActiveConnection {
  constructor(data) {
    this.id = data.id || null;
    this.interessesPessoais = data.interessesPessoais || [];
    this.nome = data.nome || 'Desconhecido';
    this.fotoDoPerfil = data.fotoDoPerfil || '';
    this.interessesNegocios = data.interessesNegocios || [];
    this.email = data.email || '';
    this.status = data.status || 'indefinido';
    this.dataDoAceite = data.dataDoAceite 
      ? new Date(data.dataDoAceite.seconds * 1000) 
      : null;
  }  

  static async findOne(conditions) {
    const db = getFirestore();
    try {
      // Create a compound query based on conditions
      let query = db.collection('ativas');
      
      // Add conditions to query
      if (conditions.userId) {
        query = query.where('userId', '==', conditions.userId);
      }
      if (conditions.friendId) {
        query = query.where('friendId', '==', conditions.friendId);
      }

      // Execute query
      const snapshot = await query.limit(1).get();

      // If no documents found, return null
      if (snapshot.empty) {
        return null;
      }

      // Return first matching document
      const doc = snapshot.docs[0];
      return new ActiveConnection({ id: doc.id, ...doc.data() });

    } catch (error) {
      logger.error('Error in ActiveConnection.findOne', {
        service: 'ActiveConnection',
        method: 'findOne',
        conditions,
        error: error.message
      });
      throw new Error(`Failed to find connection: ${error.message}`);
    }
  }

  // Additional helper method to check if connection exists
  static async exists(userId, friendId) {
    try {
      // Check in user document's friends array
      const db = getFirestore();
      const userDoc = await db.collection('usuario').doc(userId).get();
      
      if (!userDoc.exists) {
        return false;
      }

      const userData = userDoc.data();
      const friends = userData.amigos || [];
      
      return friends.includes(friendId);

    } catch (error) {
      logger.error('Error checking connection existence', {
        service: 'ActiveConnection',
        method: 'exists',
        userId,
        friendId,
        error: error.message
      });
      throw error;
    }
  }

  static async getConnectionsByUserId(userId) {
    const db = getFirestore();
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
        if (!friendDoc.exists) {
          logger.error(`Friend document not found: ${friendId}`);
          continue;
        }
        const friendData = friendDoc.data();
        const connection = new ActiveConnection(friendData);
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
    const db = getFirestore();
    const doc = await db.collection('ativas').doc(id).get();
    if (!doc.exists) {
      throw new Error('Conexão ativa não encontrada.');
    }
    return new ActiveConnection(doc.data());
  }

  static async create(data) {
    const db = getFirestore();

    const connection = new ActiveConnection(data);
    const docRef = await db.collection('ativas').add({ ...connection });
    connection.id = docRef.id;
    return connection;
  }

  static async update(id, data) {
    const db = getFirestore();

    const connectionRef = db.collection('ativas').doc(id);
    await connectionRef.update(data);
    const updatedDoc = await connectionRef.get();
    return new ActiveConnection(updatedDoc.data());
  }

  static async delete(id) {
    const db = getFirestore();

    const connectionRef = db.collection('ativas').doc(id);
    await connectionRef.delete();
  }
}

module.exports = ActiveConnection;