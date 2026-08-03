const { getFirestore } = require('../firebaseAdmin');
const { getSupabaseClient } = require('../config/supabase');
const User = require('../models/User');
const { logger } = require('../logger');

class RequestedConnection {

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

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Maps a Supabase `user_connections` row to a RequestedConnection instance.
   */
  static _fromSupabaseRow(row) {
    return new RequestedConnection({
      id: row.id,
      userId: row.user_id,
      friendId: row.connected_user_id,
      status: row.status,
      dataSolicitacao: row.created_at ? new Date(row.created_at) : new Date(),
      dataDoAceite: row.data_aceite ? new Date(row.data_aceite) : null,
      mensagem: row.mensagem || '',
      senderName: row.sender_name || null,
      senderEmail: row.sender_email || null,
      senderPhotoURL: row.sender_photo_url || null
    });
  }

  // ---------------------------------------------------------------------------
  // findOne
  // ---------------------------------------------------------------------------

  static async findOne(conditions) {
    if (!conditions.userId || !conditions.friendId) {
      logger.warn('Parâmetros incompletos para busca de solicitação', {
        service: 'RequestedConnection',
        method: 'findOne',
        conditions
      });
      return null;
    }

    const supabase = getSupabaseClient();

    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('user_connections')
          .select('*')
          .eq('user_id', conditions.userId)
          .eq('connected_user_id', conditions.friendId)
          .maybeSingle();

        if (error) throw error;

        logger.info('Supabase: RequestedConnection.findOne', {
          userId: conditions.userId,
          friendId: conditions.friendId,
          found: !!data
        });

        return data ? RequestedConnection._fromSupabaseRow(data) : null;
      } catch (supaErr) {
        logger.warn('Supabase fallback: RequestedConnection.findOne', { error: supaErr.message });
      }
    }

    // Fallback: Firestore
    const db = getFirestore();
    try {
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

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------

  static async create(userId, friendId, message = '') {
    if (!userId || !friendId) {
      throw new Error('userId e friendId são obrigatórios');
    }

    if (userId === friendId) {
      throw new Error('Não é possível criar uma solicitação para você mesmo');
    }

    const senderData = await User.getById(userId);
    const receiverData = await User.getById(friendId);

    if (!senderData || !receiverData) {
      throw new Error('Dados de usuário não encontrados');
    }

    const supabase = getSupabaseClient();

    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('user_connections')
          .insert({
            user_id: userId,
            connected_user_id: friendId,
            status: 'pending',
            mensagem: message,
            sender_name: senderData.nome,
            sender_email: senderData.email,
            sender_photo_url: senderData.fotoDoPerfil
          })
          .select()
          .single();

        if (error) throw error;

        logger.info('Supabase: RequestedConnection.create', { userId, friendId, rowId: data.id });

        // Fire-and-forget: espelha no Firestore para backward compatibility durante a transição
        const _firestoreBackfill = async () => {
          try {
            const db = getFirestore();
            const batch = db.batch();
            const requestId = data.id;

            const requestData = {
              id: requestId,
              userId,
              friendId,
              status: 'pending',
              dataSolicitacao: new Date(),
              mensagem: message,
              senderName: senderData.nome,
              senderEmail: senderData.email,
              senderPhotoURL: senderData.fotoDoPerfil
            };

            const receiverRef = db
              .collection('conexoes')
              .doc(friendId)
              .collection('solicitadas')
              .doc(userId);
            batch.set(receiverRef, requestData);

            const senderRequestRef = db
              .collection('usuario')
              .doc(userId)
              .collection('requests')
              .doc(requestId);
            batch.set(senderRequestRef, {
              requestId,
              targetId: friendId,
              targetName: receiverData.nome,
              targetEmail: receiverData.email,
              targetPhotoURL: receiverData.fotoDoPerfil,
              status: 'pending',
              timestamp: new Date(),
              message
            });

            await batch.commit();
          } catch (fsErr) {
            logger.warn('Supabase: backfill Firestore falhou em RequestedConnection.create', {
              error: fsErr.message,
              userId,
              friendId
            });
          }
        };
        _firestoreBackfill().catch(() => {});

        return RequestedConnection._fromSupabaseRow(data);
      } catch (supaErr) {
        logger.warn('Supabase fallback: RequestedConnection.create', { error: supaErr.message });
      }
    }

    // Fallback: Firestore
    const db = getFirestore();
    const batch = db.batch();
    const requestId = db.collection('_').doc().id;

    try {
      const requestData = {
        id: requestId,
        userId,
        friendId,
        status: 'pending',
        dataSolicitacao: new Date(),
        mensagem: message,
        senderName: senderData.nome,
        senderEmail: senderData.email,
        senderPhotoURL: senderData.fotoDoPerfil
      };

      const senderRequestData = {
        requestId,
        targetId: friendId,
        targetName: receiverData.nome,
        targetEmail: receiverData.email,
        targetPhotoURL: receiverData.fotoDoPerfil,
        status: 'pending',
        timestamp: new Date(),
        message
      };

      logger.info('Criando solicitação de conexão', {
        service: 'RequestedConnection',
        method: 'create',
        userId,
        friendId
      });

      const receiverRef = db
        .collection('conexoes')
        .doc(friendId)
        .collection('solicitadas')
        .doc(userId);
      batch.set(receiverRef, requestData);

      const senderRequestRef = db
        .collection('usuario')
        .doc(userId)
        .collection('requests')
        .doc(requestId);
      batch.set(senderRequestRef, senderRequestData);

      await batch.commit();

      return new RequestedConnection({
        id: userId,
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

  // ---------------------------------------------------------------------------
  // acceptConnectionRequest
  // ---------------------------------------------------------------------------

  static async acceptConnectionRequest(receiverId, senderId) {
    const timestamp = new Date();
    const supabase = getSupabaseClient();

    if (supabase) {
      try {
        const { data: existing, error: fetchErr } = await supabase
          .from('user_connections')
          .select('*')
          .eq('user_id', senderId)
          .eq('connected_user_id', receiverId)
          .eq('status', 'pending')
          .maybeSingle();

        if (fetchErr) throw fetchErr;

        if (!existing) {
          throw new Error('Solicitação não encontrada ou já processada');
        }

        const { error: updateErr } = await supabase
          .from('user_connections')
          .update({
            status: 'active',
            data_aceite: timestamp.toISOString(),
            updated_at: timestamp.toISOString()
          })
          .eq('id', existing.id);

        if (updateErr) throw updateErr;

        const { error: upsertErr } = await supabase
          .from('user_connections')
          .upsert(
            {
              user_id: receiverId,
              connected_user_id: senderId,
              status: 'active',
              data_aceite: timestamp.toISOString(),
              updated_at: timestamp.toISOString()
            },
            { onConflict: 'user_id,connected_user_id' }
          );

        if (upsertErr) throw upsertErr;

        logger.info('Supabase: RequestedConnection.acceptConnectionRequest', {
          receiverId,
          senderId,
          rowId: existing.id
        });

        const [receiverData, senderData] = await Promise.all([
          User.getById(receiverId),
          User.getById(senderId)
        ]);

        // Fire-and-forget Firestore backfill
        const _firestoreBackfill = async () => {
          try {
            const db = getFirestore();
            const batch = db.batch();

            const requestRef = db
              .collection('conexoes')
              .doc(receiverId)
              .collection('solicitadas')
              .doc(senderId);
            batch.update(requestRef, { status: 'accepted', dataDoAceite: timestamp });

            if (existing.id) {
              const senderRequestRef = db
                .collection('usuario')
                .doc(senderId)
                .collection('requests')
                .doc(existing.id);
              batch.update(senderRequestRef, { status: 'accepted', statusUpdatedAt: timestamp });
            }

            if (receiverData && senderData) {
              const receiverActiveRef = db
                .collection('conexoes')
                .doc(receiverId)
                .collection('ativas')
                .doc(senderId);
              batch.set(receiverActiveRef, {
                userId: senderId,
                friendId: receiverId,
                nome: senderData.nome,
                email: senderData.email,
                fotoDoPerfil: senderData.fotoDoPerfil,
                interesses: senderData.interesses || {},
                status: 'active',
                dataDoAceite: timestamp
              });

              const senderActiveRef = db
                .collection('conexoes')
                .doc(senderId)
                .collection('ativas')
                .doc(receiverId);
              batch.set(senderActiveRef, {
                userId: receiverId,
                friendId: senderId,
                nome: receiverData.nome,
                email: receiverData.email,
                fotoDoPerfil: receiverData.fotoDoPerfil,
                interesses: receiverData.interesses || {},
                status: 'active',
                dataDoAceite: timestamp
              });

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
            }

            await batch.commit();
          } catch (fsErr) {
            logger.warn('Supabase: backfill Firestore falhou em acceptConnectionRequest', {
              error: fsErr.message,
              receiverId,
              senderId
            });
          }
        };
        _firestoreBackfill().catch(() => {});

        return { success: true, receiverId, senderId, timestamp };
      } catch (supaErr) {
        logger.warn('Supabase fallback: RequestedConnection.acceptConnectionRequest', {
          error: supaErr.message
        });
      }
    }

    // Fallback: Firestore
    const db = getFirestore();
    const batch = db.batch();

    try {
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

      batch.update(requestRef, {
        status: 'accepted',
        dataDoAceite: timestamp
      });

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

      const [receiverSnap, senderSnap] = await Promise.all([
        db.collection('usuario').doc(receiverId).get(),
        db.collection('usuario').doc(senderId).get()
      ]);

      if (!receiverSnap.exists || !senderSnap.exists) {
        throw new Error('Um dos usuários não foi encontrado');
      }

      const receiverData = receiverSnap.data();
      const senderData = senderSnap.data();

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

      await batch.commit();

      return { success: true, receiverId, senderId, timestamp };
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

  // ---------------------------------------------------------------------------
  // getRequestsSentByUser
  // ---------------------------------------------------------------------------

  static async getRequestsSentByUser(userId) {
    if (!userId) {
      throw new Error('userId é obrigatório');
    }

    const supabase = getSupabaseClient();

    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('user_connections')
          .select('*')
          .eq('user_id', userId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false });

        if (error) throw error;

        logger.info('Supabase: RequestedConnection.getRequestsSentByUser', {
          userId,
          count: data.length
        });

        return data.map((row) => ({
          id: row.id,
          requestId: row.id,
          targetId: row.connected_user_id,
          status: row.status,
          timestamp: row.created_at,
          message: row.mensagem || ''
        }));
      } catch (supaErr) {
        logger.warn('Supabase fallback: RequestedConnection.getRequestsSentByUser', {
          error: supaErr.message
        });
      }
    }

    // Fallback: Firestore
    const db = getFirestore();
    try {
      const requestsRef = db
        .collection('usuario')
        .doc(userId)
        .collection('requests');

      const snapshot = await requestsRef.get();

      if (snapshot.empty) {
        return [];
      }

      return snapshot.docs.map((doc) => ({
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

  // ---------------------------------------------------------------------------
  // updateSentRequestStatus
  // ---------------------------------------------------------------------------

  static async updateSentRequestStatus(userId, requestId, newStatus) {
    if (!userId || !requestId || !newStatus) {
      throw new Error('userId, requestId e newStatus são obrigatórios');
    }

    const supabase = getSupabaseClient();

    if (supabase) {
      try {
        const { error } = await supabase
          .from('user_connections')
          .update({
            status: newStatus,
            updated_at: new Date().toISOString()
          })
          .eq('id', requestId)
          .eq('user_id', userId);

        if (error) throw error;

        logger.info('Supabase: RequestedConnection.updateSentRequestStatus', {
          userId,
          requestId,
          newStatus
        });

        return true;
      } catch (supaErr) {
        logger.warn('Supabase fallback: RequestedConnection.updateSentRequestStatus', {
          error: supaErr.message
        });
      }
    }

    // Fallback: Firestore
    const db = getFirestore();
    try {
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

  // ---------------------------------------------------------------------------
  // reject
  // ---------------------------------------------------------------------------

  static async reject(userId, friendId) {
    const supabase = getSupabaseClient();

    if (supabase) {
      try {
        const { error } = await supabase
          .from('user_connections')
          .update({
            status: 'rejected',
            data_rejeicao: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('user_id', friendId)
          .eq('connected_user_id', userId);

        if (error) throw error;

        logger.info('Supabase: RequestedConnection.reject', { userId, friendId });

        return true;
      } catch (supaErr) {
        logger.warn('Supabase fallback: RequestedConnection.reject', { error: supaErr.message });
      }
    }

    // Fallback: Firestore
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

      return true;
    } catch (error) {
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // block
  // ---------------------------------------------------------------------------

  static async block(userId, friendId) {
    const supabase = getSupabaseClient();

    if (supabase) {
      try {
        const { error } = await supabase
          .from('user_connections')
          .update({
            status: 'inactive',
            updated_at: new Date().toISOString()
          })
          .eq('user_id', userId)
          .eq('connected_user_id', friendId);

        if (error) throw error;

        logger.info('Supabase: RequestedConnection.block', { userId, friendId });

        return true;
      } catch (supaErr) {
        logger.warn('Supabase fallback: RequestedConnection.block', { error: supaErr.message });
      }
    }

    // Fallback: Firestore
    const db = getFirestore();
    try {
      const batch = db.batch();

      const requestRef = db
        .collection('conexoes')
        .doc(userId)
        .collection('solicitadas')
        .doc(friendId);
      batch.delete(requestRef);

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

  // ---------------------------------------------------------------------------
  // getRequestsByStatus
  // ---------------------------------------------------------------------------

  static async getRequestsByStatus(userId, status) {
    const supabase = getSupabaseClient();

    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('user_connections')
          .select('*')
          .eq('connected_user_id', userId)
          .eq('status', status)
          .order('created_at', { ascending: false });

        if (error) throw error;

        logger.info('Supabase: RequestedConnection.getRequestsByStatus', {
          userId,
          status,
          count: data.length
        });

        return data.map((row) => RequestedConnection._fromSupabaseRow(row));
      } catch (supaErr) {
        logger.warn('Supabase fallback: RequestedConnection.getRequestsByStatus', {
          error: supaErr.message
        });
      }
    }

    // Fallback: Firestore
    const db = getFirestore();
    try {
      const snapshot = await db
        .collection('conexoes')
        .doc(userId)
        .collection('solicitadas')
        .where('status', '==', status)
        .orderBy('dataSolicitacao', 'desc')
        .get();

      return snapshot.docs.map((doc) =>
        new RequestedConnection({ id: doc.id, ...doc.data() })
      );
    } catch (error) {
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // countPendingRequests
  // ---------------------------------------------------------------------------

  static async countPendingRequests(userId) {
    const supabase = getSupabaseClient();

    if (supabase) {
      try {
        const { count, error } = await supabase
          .from('user_connections')
          .select('*', { count: 'exact', head: true })
          .eq('connected_user_id', userId)
          .eq('status', 'pending');

        if (error) throw error;

        logger.info('Supabase: RequestedConnection.countPendingRequests', { userId, count });

        return count;
      } catch (supaErr) {
        logger.warn('Supabase fallback: RequestedConnection.countPendingRequests', {
          error: supaErr.message
        });
      }
    }

    // Fallback: Firestore
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

  // ---------------------------------------------------------------------------
  // getPendingRequestsForUser
  // ---------------------------------------------------------------------------

  static async getPendingRequestsForUser(userId) {
    const supabase = getSupabaseClient();

    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('user_connections')
          .select('*')
          .eq('connected_user_id', userId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false });

        if (error) throw error;

        logger.info('Supabase: RequestedConnection.getPendingRequestsForUser', {
          userId,
          count: data.length
        });

        const enrichedRequests = await Promise.all(
          data.map(async (row) => {
            try {
              const senderData = await User.getById(row.user_id);
              return new RequestedConnection({
                id: row.id,
                userId: row.user_id,
                friendId: row.connected_user_id,
                status: row.status,
                dataSolicitacao: row.created_at ? new Date(row.created_at) : new Date(),
                dataDoAceite: row.data_aceite ? new Date(row.data_aceite) : null,
                mensagem: row.mensagem || '',
                senderName: senderData ? senderData.nome : row.sender_name,
                senderEmail: senderData ? senderData.email : row.sender_email,
                senderPhotoURL: senderData ? senderData.fotoDoPerfil : row.sender_photo_url
              });
            } catch (senderError) {
              logger.warn(`Não foi possível obter dados do remetente ${row.user_id}`, {
                error: senderError.message
              });
              return RequestedConnection._fromSupabaseRow(row);
            }
          })
        );

        return enrichedRequests;
      } catch (supaErr) {
        logger.warn('Supabase fallback: RequestedConnection.getPendingRequestsForUser', {
          error: supaErr.message
        });
      }
    }

    // Fallback: Firestore
    const db = getFirestore();
    try {
      const snapshot = await db
        .collection('conexoes')
        .doc(userId)
        .collection('solicitadas')
        .where('status', '==', 'pending')
        .get();

      const enrichedRequests = await Promise.all(
        snapshot.docs.map(async (doc) => {
          const requestData = doc.data();
          try {
            const senderData = await User.getById(requestData.userId);
            return new RequestedConnection({
              id: doc.id,
              ...requestData,
              senderName: senderData.nome,
              senderEmail: senderData.email,
              senderPhotoURL: senderData.fotoDoPerfil
            });
          } catch (senderError) {
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

  // ---------------------------------------------------------------------------
  // Instance methods — unchanged structure
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // getRequestHistory — unchanged structure
  // ---------------------------------------------------------------------------

  static async getRequestHistory(userId) {
    const db = getFirestore();
    try {
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

      const requests = [...sentSnapshot.docs, ...receivedSnapshot.docs].map((doc) => {
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

      const userPromises = requests.map(async (request) => {
        const reqUserId = request.solicitanteId;
        const userData = await User.getById(reqUserId);
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

  // ---------------------------------------------------------------------------
  // addHistoryEvent — unchanged structure
  // ---------------------------------------------------------------------------

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

module.exports = RequestedConnection;
