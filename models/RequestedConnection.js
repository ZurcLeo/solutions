const {getFirestore} = require('../firebaseAdmin');
const User = require('../models/User')
const Notification = require('../models/Notification');
const { logger } = require('../logger');


class RequestedConnection {
  // ... previous code ...

  constructor(data) {
    this.id = data.id;
    this.userId = data.userId;
    this.friendId = data.friendId;
    this.status = data.status || 'pending';
    this.dataSolicitacao = data.dataSolicitacao || new Date();
    this.dataDoAceite = data.dataDoAceite || null;
    this.mensagem = data.mensagem || '';
    this.senderPhotoURL = data.senderPhotoURL || null;
    this.senderName = data.senderName || null;
    this.senderEmail = data.senderEmail || null;
  }

  static async findOne(conditions) {
    const db = getFirestore();

    if (!conditions.userId || !conditions.friendId) {
      logger.warn('Parâmetros incompletos para busca de solicitação', {
        service: 'RequestedConnection',
        method: 'findOne',
        conditions
      });
      return null;
    }
    
    try {
      // Create a compound query based on conditions
      const snapshot = await db
        .collection('conexoes')
        .doc(conditions.friendId)  // O receptor da solicitação
        .collection('solicitadas')
        .doc(conditions.userId)    // O solicitante
        .get();

      if (!snapshot.exists) {
        return null;
      }

      return new RequestedConnection({ 
        id: snapshot.id, 
        ...snapshot.data() 
      });

    } catch (error) {
      logger.error('Error in RequestedConnection.findOne', {
        service: 'RequestedConnection',
        method: 'findOne',
        conditions,
        error: error.message
      });
      throw new Error(`Failed to find RequestedConnection: ${error.message}`);
    }
  }

  static async create(userId, friendId, message = '') {
    const db = getFirestore();
    const batch = db.batch();

    const requestId = db.collection('_').doc().id;

    try {
      // Verificar se ambos IDs são válidos
      if (!userId || !friendId) {
        throw new Error('userId e friendId são obrigatórios');
      }
      
      // Assegurar que não estamos tentando criar uma conexão consigo mesmo
      if (userId === friendId) {
        throw new Error('Não é possível criar uma solicitação para você mesmo');
      }

      const senderData = await User.getById(userId);
      const receiverData = await User.getById(friendId);

      if (!senderData || !receiverData) {
        throw new Error('Dados de usuário não encontrados');
      }

      // Preparar dados da solicitação
      const requestData = {
        id: requestId,
        userId: userId,
        friendId: friendId,
        status: 'pending',
        dataSolicitacao: new Date(),
        mensagem: message,
        senderName: senderData.nome,
        senderEmail: senderData.email,
        senderPhotoURL: senderData.fotoDoPerfil
      };

      // Dados simplificados para salvar no perfil do requerente
      const senderRequestData = {
        requestId,
        targetId: friendId,
        targetName: receiverData.nome,
        targetEmail: receiverData.email,
        targetPhotoURL: receiverData.fotoDoPerfil,
        status: 'pending',
        timestamp: new Date(),
        message: message
      };

      // Registrar no log a criação da solicitação
      logger.info('Criando solicitação de conexão', {
        service: 'RequestedConnection',
        method: 'create',
        userId,
        friendId
      });

      // 1. Registrar solicitação na coleção do destinatário
      const receiverRef = db
        .collection('conexoes')
        .doc(friendId)
        .collection('solicitadas')
        .doc(userId);
      batch.set(receiverRef, requestData);

      // 2. Registrar solicitação na subcoleção de requisições do requerente
      const senderRequestRef = db
        .collection('usuario')
        .doc(userId)
        .collection('requests')
        .doc(requestId);
      batch.set(senderRequestRef, senderRequestData);

      // Executar todas as operações em batch
      await batch.commit();

      // Tentar criar notificação (se disponível)
      try {
        // Importação condicional do serviço de usuário e notificação
        // const User = require('./User');
        // const Notification = require('./Notification');
        
        if (Notification) {
          await Notification.create(
            friendId,
            'newFriendRequest',
            `${senderData.nome} enviou uma solicitação de amizade`,
            `/profile/${userId}`
          );
        }
      } catch (notificationError) {
        // Apenas logar o erro, não impedir a criação da solicitação
        logger.warn('Erro ao criar notificação para solicitação de amizade', {
          error: notificationError.message,
          userId,
          friendId
        });
      }

      return new RequestedConnection({
        id: userId, // Usar userId como ID do documento
        ...requestData
      });
    } catch (error) {
      logger.error('Erro ao criar solicitação de conexão', {
        service: 'RequestedConnection',
        method: 'create',
        error: error.message,
        userId,
        friendId
      });
      throw error;
    }
  }

  static async acceptConnectionRequest(receiverId, senderId) {
    const db = getFirestore();
    const batch = db.batch();
    
    try {
      // 1. Buscar a solicitação usando os IDs dos usuários
      const requestRef = db
        .collection('conexoes')
        .doc(receiverId)
        .collection('solicitadas')
        .doc(senderId);
        
      const requestSnap = await requestRef.get();
      
      if (!requestSnap.exists) {
        throw new Error('Solicitação não encontrada');
      }
      
      const requestData = requestSnap.data();
      
      if (requestData.status !== 'pending') {
        throw new Error('Esta solicitação já foi processada');
      }
      
      const timestamp = new Date();
      
      // 2. Atualizar a solicitação para aceita
      batch.update(requestRef, {
        status: 'accepted',
        dataDoAceite: timestamp
      });
      
      // 3. Atualizar o registro da solicitação no remetente (se existir)
      // Note que o ID da solicitação está dentro do documento
      const requestId = requestData.id;
      if (requestId) {
        const senderRequestRef = db
          .collection('usuario')
          .doc(senderId)
          .collection('requests')
          .doc(requestId);
          
        batch.update(senderRequestRef, {
          status: 'accepted',
          statusUpdatedAt: timestamp
        });
      }
      
      // 4. Obter dados de ambos usuários para criar as conexões
      const [receiverSnap, senderSnap] = await Promise.all([
        db.collection('usuario').doc(receiverId).get(),
        db.collection('usuario').doc(senderId).get()
      ]);
      
      if (!receiverSnap.exists || !senderSnap.exists) {
        throw new Error('Um dos usuários não foi encontrado');
      }
      
      const receiverData = receiverSnap.data();
      const senderData = senderSnap.data();
      
      // 5. Criar conexão ativa para o destinatário
      const receiverActiveConnectionRef = db
        .collection('conexoes')
        .doc(receiverId)
        .collection('ativas')
        .doc(senderId);
        
      batch.set(receiverActiveConnectionRef, {
        userId: senderId,
        friendId: receiverId,
        nome: senderData.nome,
        email: senderData.email,
        fotoDoPerfil: senderData.fotoDoPerfil,
        interesses: senderData.interesses || {},
        status: 'active',
        dataDoAceite: timestamp
      });
      
      // 6. Criar conexão ativa para o remetente
      const senderActiveConnectionRef = db
        .collection('conexoes')
        .doc(senderId)
        .collection('ativas')
        .doc(receiverId);
        
      batch.set(senderActiveConnectionRef, {
        userId: receiverId,
        friendId: senderId,
        nome: receiverData.nome,
        email: receiverData.email,
        fotoDoPerfil: receiverData.fotoDoPerfil,
        interesses: receiverData.interesses || {},
        status: 'active',
        dataDoAceite: timestamp
      });
      
      // 7. Atualizar as listas de amigos em ambos os usuários
      const receiverFriends = receiverData.amigos || [];
      const senderFriends = senderData.amigos || [];
      
      if (!receiverFriends.includes(senderId)) {
        batch.update(db.collection('usuario').doc(receiverId), {
          amigos: [...receiverFriends, senderId]
        });
      }
      
      if (!senderFriends.includes(receiverId)) {
        batch.update(db.collection('usuario').doc(senderId), {
          amigos: [...senderFriends, receiverId]
        });
      }
      
      // 8. Executar todas as operações em batch
      await batch.commit();
      
      // 9. Criar notificação para o remetente
      await Notification.create(
        senderId,
        'friendRequestAccepted',
        `${receiverData.nome} aceitou sua solicitação de amizade`,
        `/profile/${receiverId}`
      );
      
      return {
        success: true,
        receiverId,
        senderId,
        timestamp
      };
      
    } catch (error) {
      logger.error('Erro ao aceitar solicitação de conexão', {
        service: 'RequestedConnection',
        method: 'acceptConnectionRequest',
        receiverId,
        senderId,
        error: error.message
      });
      throw error;
    }
  }  

static async getRequestsSentByUser(userId) {
  try {
    if (!userId) {
      throw new Error('userId é obrigatório');
    }

    const db = getFirestore();
    const requestsRef = db
      .collection('usuario')
      .doc(userId)
      .collection('requests');
      
    const snapshot = await requestsRef.get();
    
    if (snapshot.empty) {
      return [];
    }
    
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (error) {
    logger.error('Erro ao obter requisições enviadas pelo usuário', {
      service: 'RequestedConnection',
      method: 'getRequestsSentByUser',
      error: error.message,
      userId
    });
    throw error;
  }
}

static async updateSentRequestStatus(userId, requestId, newStatus) {
  try {
    if (!userId || !requestId || !newStatus) {
      throw new Error('userId, requestId e newStatus são obrigatórios');
    }
    
    const db = getFirestore();
    const requestRef = db
      .collection('usuario')
      .doc(userId)
      .collection('requests')
      .doc(requestId);
      
    await requestRef.update({
      status: newStatus,
      statusUpdatedAt: new Date()
    });
    
    logger.info('Status da requisição enviada atualizado', {
      service: 'RequestedConnection',
      method: 'updateSentRequestStatus',
      userId,
      requestId,
      newStatus
    });
    
    return true;
  } catch (error) {
    logger.error('Erro ao atualizar status da requisição enviada', {
      service: 'RequestedConnection',
      method: 'updateSentRequestStatus',
      error: error.message,
      userId,
      requestId,
      newStatus
    });
    throw error;
  }
}

  static async reject(userId, friendId) {
    const db = getFirestore();
    try {
      const requestRef = db
        .collection('conexoes')
        .doc(userId)
        .collection('solicitadas')
        .doc(friendId);

      await requestRef.update({
        status: 'rejected',
        dataRejeicao: new Date()
      });

      const userData = await User.getById(userId);
      await Notification.create(
        friendId,
        'friendRequestRejected',
        `${userData.nome} rejeitou sua solicitação de amizade`,
        `/profile/${userId}`
      );

      return true;
    } catch (error) {
      throw error;
    }
  }

  static async block(userId, friendId) {
    const db = getFirestore();
    try {
      const batch = db.batch();

      // Deletar solicitações existentes
      const requestRef = db
        .collection('conexoes')
        .doc(userId)
        .collection('solicitadas')
        .doc(friendId);
      batch.delete(requestRef);

      // Adicionar à lista de bloqueados
      const blockedRef = db
        .collection('conexoes')
        .doc(userId)
        .collection('bloqueadas')
        .doc(friendId);
      
      const friendData = await User.getById(friendId);
      batch.set(blockedRef, {
        dataBloqueio: new Date(),
        userData: {
          nome: friendData.nome,
          email: friendData.email,
          fotoDoPerfil: friendData.fotoDoPerfil
        }
      });

      await batch.commit();
      return true;
    } catch (error) {
      throw error;
    }
  }

  static async getRequestsByStatus(userId, status) {
    const db = getFirestore();
    try {
      const snapshot = await db
        .collection('conexoes')
        .doc(userId)
        .collection('solicitadas')
        .where('status', '==', status)
        .orderBy('dataSolicitacao', 'desc')
        .get();

      return snapshot.docs.map(doc => 
        new RequestedConnection({ id: doc.id, ...doc.data() })
      );
    } catch (error) {
      throw error;
    }
  }

  static async countPendingRequests(userId) {
    const db = getFirestore();
    try {
      const snapshot = await db
        .collection('conexoes')
        .doc(userId)
        .collection('solicitadas')
        .where('status', '==', 'pending')
        .count()
        .get();

      return snapshot.data().count;
    } catch (error) {
      throw error;
    }
  }

  async updateMessage(newMessage) {
    const db = getFirestore();
    try {
      await db
        .collection('conexoes')
        .doc(this.id)
        .collection('solicitadas')
        .doc(this.solicitanteId)
        .update({
          mensagem: newMessage
        });
      
      this.mensagem = newMessage;
      return true;
    } catch (error) {
      throw error;
    }
  }

  toJSON() {
    return {
      id: this.id,
      status: this.status,
      dataSolicitacao: this.dataSolicitacao,
      dataDoAceite: this.dataDoAceite,
      solicitanteId: this.userId,
      solicitadoId: this.friendId,
      mensagem: this.mensagem,
      senderPhotoURL: this.senderPhotoURL,
      senderName: this.senderName,
      senderEmail: this.senderEmail
    };
  }

  static async getRequestHistory(userId) {
    const db = getFirestore();
    try {
      // Get all requests (sent and received)
      const sentSnapshot = await db
        .collection('conexoes')
        .doc(userId)
        .collection('solicitadas')
        .orderBy('dataSolicitacao', 'desc')
        .get();

      const receivedSnapshot = await db
        .collection('conexoes')
        .where('solicitanteId', '==', userId)
        .get();

      const requests = [...sentSnapshot.docs, ...receivedSnapshot.docs].map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          history: [
            {
              type: 'created',
              date: data.dataSolicitacao,
              description: `Solicitação de conexão ${data.solicitanteId === userId ? 'enviada' : 'recebida'}`
            },
            ...(data.dataDoAceite ? [{
              type: 'accepted',
              date: data.dataDoAceite,
              description: 'Solicitação aceita'
            }] : []),
            ...(data.dataRejeicao ? [{
              type: 'rejected',
              date: data.dataRejeicao,
              description: 'Solicitação rejeitada'
            }] : []),
            ...(data.dataBloqueio ? [{
              type: 'blocked',
              date: data.dataBloqueio,
              description: 'Usuário bloqueado'
            }] : [])
          ].sort((a, b) => b.date - a.date)
        };
      });

      // Fetch user details for each request
      const userPromises = requests.map(async (request) => {
        const userId = request.solicitanteId;
        const userData = await User.getById(userId);
        return {
          ...request,
          nome: userData.nome,
          fotoDoPerfil: userData.fotoDoPerfil,
          email: userData.email
        };
      });

      return Promise.all(userPromises);
    } catch (error) {
      throw error;
    }
  }

  static async addHistoryEvent(userId, friendId, eventType, description) {
    const db = getFirestore();
    try {
      const requestRef = db
        .collection('conexoes')
        .doc(userId)
        .collection('solicitadas')
        .doc(friendId);

      await requestRef.update({
        [`historico.${Date.now()}`]: {
          type: eventType,
          description,
          date: new Date()
        }
      });
    } catch (error) {
      throw error;
    }
  }

static async getPendingRequestsForUser(userId) {
  const db = getFirestore();
  try {
    // Buscar solicitações pendentes
    const snapshot = await db
      .collection('conexoes')
      .doc(userId)
      .collection('solicitadas')
      .where('status', '==', 'pending')
      .get();

    // Mapear documentos e enriquecer com dados do remetente
    const enrichedRequests = await Promise.all(
      snapshot.docs.map(async (doc) => {
        const requestData = doc.data();
        
        // Buscar dados do remetente (solicitanteId, não userId)
        try {
          const senderData = await User.getById(requestData.userId);
          
          // Retornar objeto enriquecido
          return new RequestedConnection({
            id: doc.id,
            ...requestData,
            senderName: senderData.nome,
            senderEmail: senderData.email,
            senderPhotoURL: senderData.fotoDoPerfil
          });
        } catch (senderError) {
          // Se não conseguir obter dados do remetente, retornar só os dados básicos
          console.warn(`Não foi possível obter dados do remetente ${requestData.friendId}`, senderError);
          return new RequestedConnection({ id: doc.id, ...requestData });
        }
      })
    );

    return enrichedRequests;
  } catch (error) {
    logger.error('Erro ao obter solicitações pendentes', {
      service: 'RequestedConnection',
      method: 'getPendingRequestsForUser',
      userId,
      error: error.message
    });
    throw error;
  }
}
}

module.exports = RequestedConnection;