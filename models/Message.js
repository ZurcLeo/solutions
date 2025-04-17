// models/MessageV2.js
const { getFirestore } = require('../firebaseAdmin');
const { v4: uuidv4 } = require('uuid');

const db = getFirestore();

/**
 * Modelo atualizado para mensagens com estrutura otimizada.
 * Implementa a nova estrutura de dados proposta no redesenho do sistema de mensagens.
 */
class Message {
  /**
   * Obtém todas as conversas de um usuário
   * @param {string} userId - ID do usuário
   * @returns {Promise<Array>} - Lista de conversas
   */
  static async getUserConversations(userId) {
    try {
      const userRef = db.collection('usuario').doc(userId);
      const userDoc = await userRef.get();
      
      if (!userDoc.exists || !userDoc.data().conversations) {
        return [];
      }
      
      // Transformar o objeto de conversas em um array
      const conversationsData = userDoc.data().conversations || {};
      const conversationsArray = Object.entries(conversationsData).map(([id, data]) => ({
        id,
        ...data,
        // Garantir que timestamp seja uma data válida
        lastMessage: {
          ...data.lastMessage,
          timestamp: data.lastMessage?.timestamp?.toDate 
            ? data.lastMessage.timestamp.toDate().toISOString() 
            : new Date().toISOString()
        }
      }));
      
      // Ordenar por timestamp da última mensagem (mais recente primeiro)
      return conversationsArray.sort((a, b) => {
        const timestampA = a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp) : new Date(0);
        const timestampB = b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp) : new Date(0);
        return timestampB - timestampA;
      });
    } catch (error) {
      console.error('Erro ao buscar conversas do usuário:', error);
      throw error;
    }
  }

  /**
   * Busca ou cria um ID de conversa entre dois usuários
   * @param {string} userId1 - ID do primeiro usuário
   * @param {string} userId2 - ID do segundo usuário
   * @returns {Promise<string>} - ID da conversa
   */
  static async getOrCreateConversationId(userId1, userId2) {
    // Ordenar IDs para garantir consistência
    const sortedIds = [userId1, userId2].sort();
    const conversationId = sortedIds.join('_');
    
    // Verificar se a conversa já existe
    const conversationRef = db.collection('conversations').doc(conversationId);
    const conversationDoc = await conversationRef.get();
    
    // Se não existir, criar a conversa
    if (!conversationDoc.exists) {
      await conversationRef.set({
        participants: sortedIds,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastMessage: null,
        type: 'private' // Para suporte futuro a conversas em grupo
      });
    }
    
    return conversationId;
  }

  /**
   * Obtém mensagens de uma conversa
   * @param {string} conversationId - ID da conversa
   * @param {number} limit - Limite de mensagens
   * @param {Date} before - Timestamp para paginação
   * @returns {Promise<Array>} - Lista de mensagens
   */
  static async getConversationMessages(conversationId, limit = 50, before = null) {
    try {
      let query = db.collection('conversations')
                    .doc(conversationId)
                    .collection('messages')
                    .orderBy('timestamp', 'desc')
                    .limit(limit);
      
      // Adicionar filtro de paginação se fornecido
      if (before) {
        query = query.where('timestamp', '<', before);
      }
      
      const snapshot = await query.get();
      
      if (snapshot.empty) {
        return [];
      }
      
      // Mapear documentos para objetos de mensagem
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate 
          ? doc.data().timestamp.toDate().toISOString() 
          : new Date().toISOString(),
        status: {
          ...doc.data().status,
          readAt: doc.data().status?.readAt?.toDate 
            ? doc.data().status.readAt.toDate().toISOString() 
            : null
        }
      }));
    } catch (error) {
      console.error('Erro ao buscar mensagens da conversa:', error);
      throw error;
    }
  }

  /**
   * Cria uma nova mensagem
   * @param {Object} messageData - Dados da mensagem
   * @returns {Promise<Object>} - Mensagem criada
   */
  static async createMessage(messageData) {
    try {
      const { sender, recipient, content, type = 'text' } = messageData;
      
      if (!sender || !recipient || !content) {
        throw new Error('Dados incompletos para criar mensagem');
      }
      
      // Obter ou criar ID da conversa
      const conversationId = await this.getOrCreateConversationId(sender, recipient);
      const conversationRef = db.collection('conversations').doc(conversationId);
      
      // Criar mensagem na subcoleção
      const timestamp = new Date();
      const newMessage = {
        content,
        sender,
        type,
        timestamp,
        status: {
          sent: true,
          delivered: false,
          read: false,
          readAt: null
        }
      };
      
      const messageRef = await conversationRef.collection('messages').add(newMessage);
      
      // Atualizar metadados da conversa
      await conversationRef.update({
        updatedAt: timestamp,
        lastMessage: {
          text: content.substring(0, 100), // Limite de caracteres para preview
          timestamp,
          sender
        }
      });
      
      // Atualizar referências nos documentos de usuário
      await this.updateUserConversationReferences(
        conversationId,
        sender,
        recipient,
        content,
        timestamp
      );
      
      return {
        id: messageRef.id,
        conversationId,
        ...newMessage,
        timestamp: timestamp.toISOString(),
      };
    } catch (error) {
      console.error('Erro ao criar mensagem:', error);
      throw error;
    }
  }

  /**
   * Atualiza as referências de conversa nos documentos de usuário
   * @private
   */
  static async updateUserConversationReferences(conversationId, sender, recipient, content, timestamp) {
    const batch = db.batch();
    
    try {
      // Buscar dados dos usuários para exibição
      const [senderDoc, recipientDoc] = await Promise.all([
        db.collection('usuario').doc(sender).get(),
        db.collection('usuario').doc(recipient).get()
      ]);
      
      const senderData = senderDoc.exists ? senderDoc.data() : {};
      const recipientData = recipientDoc.exists ? recipientDoc.data() : {};
      
      // Preparar dados para o remetente (usando campo "conversas" em português)
      const senderUpdate = {
        [`conversas.${conversationId}`]: {
          com: recipient,
          nome: recipientData.nome || recipientData.displayName || '',
          foto: recipientData.fotoDoPerfil || '',
          naoLidas: 0, // Remetente já "leu" sua própria mensagem
          ultimoAcesso: timestamp
        }
      };
      
      // Preparar dados para o destinatário (incrementar não lidas)
      const currentUnreadCount = 
        (recipientData.conversas && 
         recipientData.conversas[conversationId] && 
         recipientData.conversas[conversationId].naoLidas) || 0;
      
      const recipientUpdate = {
        [`conversas.${conversationId}`]: {
          com: sender,
          nome: senderData.nome || senderData.displayName || '',
          foto: senderData.fotoDoPerfil || '',
          naoLidas: currentUnreadCount + 1,
          ultimoAcesso: recipientData.conversas && 
                      recipientData.conversas[conversationId] && 
                      recipientData.conversas[conversationId].ultimoAcesso || null
        }
      };
      
      // Atualizar o documento de metadados da conversa com a última mensagem
      const conversationUpdate = {
        ultimaAtualizacao: timestamp,
        ultimaMensagem: {
          texto: content.substring(0, 100), // Limite de caracteres para preview
          timestamp,
          remetente: sender
        }
      };
      
      // Aplicar atualizações nos documentos de usuário
      batch.set(db.collection('usuario').doc(sender), senderUpdate, { merge: true });
      batch.set(db.collection('usuario').doc(recipient), recipientUpdate, { merge: true });
      
      // Atualizar documento de metadados da conversa
      batch.update(db.collection('conversations').doc(conversationId), conversationUpdate);
      
      await batch.commit();
    } catch (error) {
      console.error('Erro ao atualizar referências de conversa:', error);
      throw error;
    }
  }

  static async checkConversationExists(conversationId) {
    try {
      const path = `conversations/${conversationId}/messages`;
      const snapshot = await db.collection(path).limit(1).get();
      return !snapshot.empty;
    } catch (error) {
      console.error(`Erro ao verificar existência da conversa: ${error.message}`);
      return false;
    }
  }
  
  static async createEmptyConversation(conversationId, user1Id, user2Id) {
    try {
      // Verificar se os usuários existem
      const [user1Doc, user2Doc] = await Promise.all([
        db.collection('conversations').doc(user1Id).get(),
        db.collection('conversations').doc(user2Id).get()
      ]);
      
      if (!user1Doc.exists || !user2Doc.exists) {
        throw new Error('Um ou mais usuários não encontrados');
      }
      
      const user1Data = user1Doc.data();
      const user2Data = user2Doc.data();
      
      // Criar estrutura inicial da conversa (pasta para mensagens)
      const path = `conversations/${conversationId}/messages`;
      
      // Criar documento de metadados da conversa
      await db.collection('conversations').doc(conversationId).set({
        participantes: [user1Id, user2Id],
        dataCriacao: new Date(),
        ultimaAtualizacao: new Date(),
        ultimaMensagem: null
      });
      
      // Criar registros de referência nos documentos de usuário
      const batch = db.batch();
      
      // Atualizar para usuário 1
      batch.update(db.collection('usuario').doc(user1Id), {
        [`conversas.${conversationId}`]: {
          com: user2Id,
          nome: user2Data.nome || user2Data.displayName || '',
          foto: user2Data.fotoDoPerfil || '',
          naoLidas: 0,
          ultimoAcesso: new Date()
        }
      });
      
      // Atualizar para usuário 2
      batch.update(db.collection('usuario').doc(user2Id), {
        [`conversas.${conversationId}`]: {
          com: user1Id,
          nome: user1Data.nome || user1Data.displayName || '',
          foto: user1Data.fotoDoPerfil || '',
          naoLidas: 0,
          ultimoAcesso: new Date()
        }
      });
      
      await batch.commit();
      
      return true;
    } catch (error) {
      console.error(`Erro ao criar conversa vazia: ${error.message}`);
      return false;
    }
  }
  
// models/Message.js - Método markMessagesAsRead corrigido
static async markMessagesAsRead(conversationId, userId) {
    try {
      // Validação dos parâmetros
      if (!conversationId || !userId) {
        console.log('Parâmetros inválidos para markMessagesAsRead:', { conversationId, userId });
        return { count: 0, updatedAt: new Date().toISOString() };
      }
  
      console.log(`Iniciando markMessagesAsRead para userId=${userId} e conversationId=${conversationId}`);
  
      // Verificações iniciais para determinar qual modelo de dados usar
      // Verificar primeiro se existe a conversa no novo modelo
      const conversationRef = db.collection('conversations').doc(conversationId);
      const conversationDoc = await conversationRef.get();
      
      let count = 0;
      const now = new Date();
      const batch = db.batch();
      
      // Tentar primeiro com o novo modelo
      if (conversationDoc.exists) {
        console.log(`Conversa ${conversationId} existe na coleção 'conversations'. Usando novo modelo.`);
        
        // Buscar mensagens não lidas destinadas a este usuário
        const unreadMessagesQuery = conversationRef.collection('messages')
          .where('sender', '!=', userId)  // Mensagens enviadas por outros usuários
          .where('status.read', '==', false);  // Não lidas
        
        const unreadSnapshot = await unreadMessagesQuery.get();
        
        // Se encontrou mensagens, atualizar o status
        if (!unreadSnapshot.empty) {
          unreadSnapshot.docs.forEach(doc => {
            const messageRef = doc.ref;
            batch.update(messageRef, {
              'status.read': true,
              'status.delivered': true,
              'status.readAt': now
            });
          });
          
          count = unreadSnapshot.size;
          console.log(`Encontradas ${count} mensagens não lidas no novo modelo`);
        }
        
        // Atualizar contador no documento de usuário (se existir)
        try {
          // // No novo modelo, o contador pode estar em diferentes lugares
          // // Verificar primeiro em user_conversations
          // const userConvRef = db.collection('conversations').doc(conversationId);
          // const userConvDoc = await userConvRef.get();
          
          // if (userConvDoc.exists) {
          //   batch.update(userConvRef, {
          //     [`conversations.${conversationId}.unreadCount`]: 0,
          //     [`conversations.${conversationId}.lastAccess`]: now
          //   });
          const userRef = db.collection('usuario').doc(userId);
          const userDoc = await userRef.get();
          
          if (userDoc.exists) {
            batch.update(userRef, {
              [`conversas.${conversationId}.naoLidas`]: 0,
              [`conversas.${conversationId}.ultimoAcesso`]: now
            });

          } else {
            // Verificar na coleção 'usuario'
          //   const userRef = db.collection('usuario').doc(userId);
          //   const userDoc = await userRef.get();
            
          //   if (userDoc.exists) {
          //     batch.update(userRef, {
          //       [`conversas.${conversationId}.naoLidas`]: 0,
          //       [`conversas.${conversationId}.ultimoAcesso`]: now
          //     });
          //   }
          }
        } catch (userDocError) {
          console.error('Erro ao atualizar documento de usuário:', userDocError);
          // Não interromper o processo se o documento de usuário falhar
        }
      } else {
        // Fallback para o modelo antigo
        console.log(`Conversa ${conversationId} não existe no novo modelo. Tentando modelo antigo.`);
        
        // Verificar se existe no modelo antigo
        const oldConversationExists = await this.checkConversationExists(conversationId);
        
        if (oldConversationExists) {
          console.log(`Conversa ${conversationId} existe no modelo antigo.`);
          // Usar o caminho antigo para as mensagens
          const path = `mensagens/${conversationId}/msgs`;
          
          // Obter mensagens não lidas enviadas para o usuário atual
          const unreadMessagesQuery = db.collection(path)
            .where('uidDestinatario', '==', userId)
            .where('lido', '==', false);
          
          const unreadSnapshot = await unreadMessagesQuery.get();
          
          if (!unreadSnapshot.empty) {
            unreadSnapshot.docs.forEach(doc => {
              batch.update(doc.ref, {
                lido: true,
                entregue: true,
                visto: true,
                dataLeitura: now
              });
            });
            
            count = unreadSnapshot.size;
            console.log(`Encontradas ${count} mensagens não lidas no modelo antigo`);
          }
          
          // Atualizar contador no documento de usuário (no modelo antigo)
          try {
            const userRef = db.collection('usuario').doc(userId);
            const userDoc = await userRef.get();
            
            if (userDoc.exists) {
              batch.update(userRef, {
                [`conversas.${conversationId}.naoLidas`]: 0,
                [`conversas.${conversationId}.ultimoAcesso`]: now
              });
            }
          } catch (userDocError) {
            console.error('Erro ao atualizar documento de usuário (modelo antigo):', userDocError);
          }
        } else {
          // Se não existir em nenhum modelo, tentar criar conversa vazia
          console.log(`Conversa ${conversationId} não existe em nenhum modelo.`);
          const [userId1, userId2] = conversationId.split('_');
          
          if (userId1 && userId2) {
            try {
              // Tentar criar conversa no novo modelo
              await conversationRef.set({
                participants: [userId1, userId2],
                createdAt: now,
                updatedAt: now,
                type: 'private'
              });
              console.log(`Conversa vazia criada no novo modelo: ${conversationId}`);
            } catch (createError) {
              console.error('Erro ao criar conversa vazia:', createError);
            }
          }
        }
      }
      
      // Executar todas as atualizações em batch
      await batch.commit();
      
      return {
        count,
        updatedAt: now.toISOString()
      };
    } catch (error) {
      console.error(`Erro ao marcar mensagens como lidas: ${error.message}`);
      throw error;
    }
  }

  /**
   * Atualiza o status de uma mensagem
   * @param {string} conversationId - ID da conversa
   * @param {string} messageId - ID da mensagem
   * @param {Object} statusUpdate - Dados de atualização
   * @returns {Promise<Object>} - Resultado da operação
   */
  static async updateMessageStatus(conversationId, messageId, statusUpdate) {
    try {
      const messageRef = db.collection('conversations')
                          .doc(conversationId)
                          .collection('messages')
                          .doc(messageId);
                          
      const messageDoc = await messageRef.get();
      
      if (!messageDoc.exists) {
        throw new Error('Mensagem não encontrada');
      }
      
      // Mesclar status atual com a atualização
      const currentStatus = messageDoc.data().status || {};
      const newStatus = {
        ...currentStatus,
        ...statusUpdate
      };
      
      // Se marcando como lido, definir readAt
      if (statusUpdate.read && !currentStatus.read) {
        newStatus.readAt = new Date();
      }
      
      await messageRef.update({ status: newStatus });
      
      return {
        id: messageId,
        status: {
          ...newStatus,
          readAt: newStatus.readAt ? newStatus.readAt.toISOString() : null
        }
      };
    } catch (error) {
      console.error('Erro ao atualizar status da mensagem:', error);
      throw error;
    }
  }

  /**
   * Exclui uma mensagem
   * @param {string} conversationId - ID da conversa
   * @param {string} messageId - ID da mensagem
   * @param {string} userId - ID do usuário solicitando a exclusão
   * @returns {Promise<Object>} - Resultado da operação
   */
  static async deleteMessage(conversationId, messageId, userId) {
    try {
      const messageRef = db.collection('conversations')
                          .doc(conversationId)
                          .collection('messages')
                          .doc(messageId);
                          
      const messageDoc = await messageRef.get();
      
      if (!messageDoc.exists) {
        throw new Error('Mensagem não encontrada');
      }
      
      const messageData = messageDoc.data();
      
      // Verificar se o usuário tem permissão para excluir a mensagem
      if (messageData.sender !== userId) {
        throw new Error('Você não tem permissão para excluir esta mensagem');
      }
      
      // Dois modos de exclusão: soft delete ou hard delete
      // Soft delete: Manter a mensagem, mas substituir o conteúdo
      await messageRef.update({
        content: 'Esta mensagem foi apagada',
        deleted: true,
        deletedAt: new Date(),
        originalContent: messageData.content
      });
      
      return {
        id: messageId,
        deleted: true
      };
    } catch (error) {
      console.error('Erro ao excluir mensagem:', error);
      throw error;
    }
  }

  /**
   * Obtém estatísticas de mensagens do usuário
   * @param {string} userId - ID do usuário
   * @returns {Promise<Object>} - Estatísticas
   */
  static async getUserMessageStats(userId) {
    try {
      const userRef = db.collection('usuario').doc(userId);
      const userDoc = await userRef.get();
      
      if (!userDoc.exists) {
        throw new Error('Usuário não encontrado');
      }
      
      const userData = userDoc.data();
      const conversations = userData.conversations || {};
      
      // Calcular estatísticas básicas
      const totalConversations = Object.keys(conversations).length;
      let totalUnread = 0;
      
      Object.values(conversations).forEach(conv => {
        totalUnread += (conv.unreadCount || 0);
      });
      
      return {
        totalConversations,
        totalUnread,
        lastActive: userData.lastActive ? userData.lastActive.toDate().toISOString() : null
      };
    } catch (error) {
      console.error('Erro ao obter estatísticas de mensagens:', error);
      throw error;
    }
  }
}

module.exports = Message;