class RequestedConnection {
  // ... previous code ...

  constructor(data) {
    this.id = data.id;
    this.status = data.status;
    this.dataSolicitacao = data.dataSolicitacao;
    this.dataDoAceite = data.dataDoAceite;
    this.solicitanteId = data.solicitanteId;
    this.mensagem = data.mensagem;
  }

  static async create(userId, friendId, message = '') {
    const db = getFirestore();
    try {
      // Verificar se já existe uma conexão ativa
      const activeConnection = await ActiveConnection.findOne({
        userId,
        friendId
      });
      if (activeConnection) {
        throw new Error('Conexão já existe');
      }

      // Verificar se já existe uma solicitação pendente
      const existingRequest = await this.findOne({
        userId: friendId,
        friendId: userId
      });
      if (existingRequest && existingRequest.status === 'pending') {
        throw new Error('Já existe uma solicitação pendente');
      }

      const requestData = {
        status: 'pending',
        dataSolicitacao: new Date(),
        solicitanteId: userId,
        mensagem: message
      };

      await db
        .collection('conexoes')
        .doc(friendId)
        .collection('solicitadas')
        .doc(userId)
        .set(requestData);

      const userData = await User.getById(userId);
      await Notification.create(
        friendId,
        'newFriendRequest',
        `${userData.nome} enviou uma solicitação de amizade`,
        `/profile/${userId}`
      );

      return new RequestedConnection({
        id: userId,
        ...requestData
      });
    } catch (error) {
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
      solicitanteId: this.solicitanteId,
      mensagem: this.mensagem
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
}