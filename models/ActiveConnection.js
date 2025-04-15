const {getFirestore} = require('../firebaseAdmin');
const { logger } = require('../logger');

class ActiveConnection {
  constructor(data) {
    this.id = data.id || null;
    this.nome = data.nome || 'Desconhecido';
    this.fotoDoPerfil = data.fotoDoPerfil || '';
    this.interesses = data.interesses|| {};
    this.email = data.email || '';
    this.status = data.status || 'active';
    this.dataDoAceite = this.formatDate(data.dataDoAceite);
  }  

  formatDate(dateInput) {
    if (!dateInput) return null;
    
    try {
        // Se for um timestamp do Firestore
        if (dateInput._seconds || dateInput.seconds) {
            const seconds = dateInput._seconds || dateInput.seconds;
            return new Date(seconds * 1000);
        }
        
        // Se for um timestamp comum (número)
        if (typeof dateInput === 'number') {
            return new Date(dateInput);
        }
        
        // Se for uma string de data
        if (typeof dateInput === 'string') {
            return new Date(dateInput);
        }
        
        // Se já for um objeto Date
        if (dateInput instanceof Date) {
            return dateInput;
        }
        
        return null;
    } catch (error) {
        console.error("Erro ao formatar data:", error);
        return null;
    }
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
        connections[friendId] = connection; // Adicionar esta linha
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

  static async addBestFriend(userId, friendId) {
    const db = getFirestore();
    const userRef = db.collection('usuario').doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      logger.error('User not found', { service: 'ActiveConnectionService', method: 'addBestFriend', userId });
      throw new Error('Usuário não encontrado.');
    }

    const userData = userSnap.data();
    const friends = userData.amigos || [];
    const bestFriends = userData.amigosAutorizados || [];

    // 1. Confirmar que o amigo está registrado como uma conexão ativa
    const activeConnectionSnapshot = await db
      .collection('conexoes')
      .doc(userId)
      .collection('ativas')
      .where('userId', '==', friendId)
      .limit(1)
      .get();

    if (activeConnectionSnapshot.empty) {
      logger.warn('Friend is not an active connection', { service: 'ActiveConnectionService', method: 'addBestFriend', userId, friendId });
      throw new Error('Este amigo não é uma conexão ativa.');
    }

    // 2. Confirmar que o amigo está na lista de amigos do usuário
    if (!friends.includes(friendId)) {
      logger.warn('Friend is not in the user\'s friend list', { service: 'ActiveConnectionService', method: 'addBestFriend', userId, friendId });
      throw new Error('Este amigo não está na sua lista de amigos.');
    }

    if (!bestFriends.includes(friendId)) {
      // Adicionar o amigo aos melhores amigos se ainda não for
      await userRef.update({ amigosAutorizados: [...bestFriends, friendId] });
      return 'Melhor amigo adicionado com sucesso.';
    } else {
      return 'Este amigo já é um melhor amigo.';
    }
  }

  static async removeBestFriend(userId, friendId) {
    const db = getFirestore();
    const userRef = db.collection('usuario').doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      logger.error('User not found', { service: 'ActiveConnectionService', method: 'removeBestFriend', userId });
      throw new Error('Usuário não encontrado.');
    }

    const userData = userSnap.data();
    const friends = userData.amigos || [];
    const bestFriends = userData.amigosAutorizados || [];

    // 1. Confirmar que o amigo está registrado como uma conexão ativa
    const activeConnectionSnapshot = await db
      .collection('conexoes')
      .doc(userId)
      .collection('ativas')
      .where('userId', '==', friendId)
      .limit(1)
      .get();

    if (activeConnectionSnapshot.empty) {
      logger.warn('Friend is not an active connection', { service: 'ActiveConnectionService', method: 'removeBestFriend', userId, friendId });
      throw new Error('Este amigo não é uma conexão ativa.');
    }

    // 2. Confirmar que o amigo está na lista de amigos do usuário
    if (!friends.includes(friendId)) {
      logger.warn('Friend is not in the user\'s friend list', { service: 'ActiveConnectionService', method: 'removeBestFriend', userId, friendId });
      throw new Error('Este amigo não está na sua lista de amigos.');
    }

    if (bestFriends.includes(friendId)) {
      // Remover o amigo dos melhores amigos se já for
      const updatedBestFriends = bestFriends.filter(id => id !== friendId);
      await userRef.update({ amigosAutorizados: updatedBestFriends });
      return 'Melhor amigo removido com sucesso.';
    } else {
      return 'Este amigo já não é um melhor amigo.';
    }
  }

  static async getById(userId) {
    const db = getFirestore();
    const doc = await db.collection('ativas').doc(userId).get();
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