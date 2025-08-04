// models/MessageV2.js
const { getFirestore } = require('../firebaseAdmin');
const { v4: uuidv4 } = require('uuid');
const AIService = require('../services/AIService'); // Import the AIService
const { logger } = require('../logger'); // Assuming logger is available

const AI_AGENT_USER_ID = process.env.AI_AGENT_USER_ID || "AI_AGENT_USER_ID";
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
      console.log(`[DEBUG] Iniciando busca de mensagens para conversationId: ${conversationId}`);
      console.log(`[DEBUG] Parâmetros: limit=${limit}, before=${before}`);
      
      // Primeiro, tentar o novo modelo
      let messages = await this.tryNewModel(conversationId, limit, before);
      if (messages.length > 0) {
        console.log(`[DEBUG] Mensagens encontradas no novo modelo: ${messages.length}`);
        return messages;
      }
      
      // Se não encontrar no novo modelo, tentar o modelo legado
      console.log(`[DEBUG] Tentando modelo legado...`);
      messages = await this.tryLegacyModel(conversationId, limit, before);
      if (messages.length > 0) {
        console.log(`[DEBUG] Mensagens encontradas no modelo legado: ${messages.length}`);
        return messages;
      }
      
      console.log(`[DEBUG] Nenhuma mensagem encontrada em nenhum modelo`);
      return [];
      
    } catch (error) {
      console.error('[ERROR] Erro ao buscar mensagens da conversa:', error);
      console.error('[ERROR] Stack trace:', error.stack);
      throw error;
    }
  }

  static async tryNewModel(conversationId, limit = 50, before = null) {
    try {
      console.log(`[DEBUG] Tentando novo modelo para conversationId: ${conversationId}`);
      
      // Verificar se o documento da conversa existe
      const conversationRef = db.collection('conversations').doc(conversationId);
      const conversationDoc = await conversationRef.get();
      
      console.log(`[DEBUG] Documento da conversa existe: ${conversationDoc.exists}`);
      if (conversationDoc.exists) {
        console.log(`[DEBUG] Dados da conversa:`, conversationDoc.data());
      }
      
      // Verificar se a subcoleção de mensagens existe
      const messagesRef = conversationRef.collection('messages');
      console.log(`[DEBUG] Caminho das mensagens: conversations/${conversationId}/messages`);
      
      let query = messagesRef.limit(limit);
      
      // Tentar primeiro sem orderBy para ver se há problemas de índice
      console.log(`[DEBUG] Executando query simples sem orderBy...`);
      let snapshot = await query.get();
      
      console.log(`[DEBUG] Query simples executada. Documentos encontrados: ${snapshot.size}`);
      
      if (!snapshot.empty) {
        // Se encontrou mensagens, agora tentar com orderBy
        try {
          query = messagesRef.orderBy('timestamp', 'desc').limit(limit);
          if (before) {
            query = query.where('timestamp', '<', before);
          }
          snapshot = await query.get();
          console.log(`[DEBUG] Query com orderBy executada. Documentos: ${snapshot.size}`);
        } catch (orderError) {
          console.log(`[DEBUG] Erro com orderBy, usando query simples:`, orderError.message);
          // Usar o snapshot simples anterior
        }
        
        // Mapear documentos para objetos de mensagem
        const messages = snapshot.docs.map(doc => {
          const data = doc.data();
          console.log(`[DEBUG] Processando mensagem ${doc.id}:`, data);
          
          return {
            id: doc.id,
            ...data,
            timestamp: data.timestamp?.toDate 
              ? data.timestamp.toDate().toISOString() 
              : new Date().toISOString(),
            status: {
              ...data.status,
              readAt: data.status?.readAt?.toDate 
                ? data.status.readAt.toDate().toISOString() 
                : null
            }
          };
        });
        
        return messages;
      }
      
      return [];
    } catch (error) {
      console.error('[ERROR] Erro no novo modelo:', error);
      return [];
    }
  }

  static async tryLegacyModel(conversationId, limit = 50, before = null) {
    try {
      console.log(`[DEBUG] Tentando modelo legado para conversationId: ${conversationId}`);
      
      // Tentar o caminho legado: mensagens/{conversationId}/msgs
      const legacyPath = `mensagens/${conversationId}/msgs`;
      console.log(`[DEBUG] Caminho legado: ${legacyPath}`);
      
      let query = db.collection(legacyPath).limit(limit);
      
      const snapshot = await query.get();
      console.log(`[DEBUG] Query legado executada. Documentos encontrados: ${snapshot.size}`);
      
      if (!snapshot.empty) {
        // Mapear documentos legados para o formato novo
        const messages = snapshot.docs.map(doc => {
          const data = doc.data();
          console.log(`[DEBUG] Processando mensagem legada ${doc.id}:`, data);
          
          // Converter formato legado para novo formato
          return {
            id: doc.id,
            content: data.texto || data.content,
            sender: data.uidRemetente || data.sender,
            type: data.tipo || 'text',
            timestamp: data.timestamp?.toDate 
              ? data.timestamp.toDate().toISOString() 
              : (data.dataEnvio?.toDate ? data.dataEnvio.toDate().toISOString() : new Date().toISOString()),
            status: {
              sent: true,
              delivered: data.entregue || false,
              read: data.lido || false,
              readAt: data.dataLeitura?.toDate ? data.dataLeitura.toDate().toISOString() : null
            }
          };
        });
        
        return messages;
      }
      
      return [];
    } catch (error) {
      console.error('[ERROR] Erro no modelo legado:', error);
      return [];
    }
  }

  /**
   * Verifica se um usuário é participante de uma conversa
   * @param {string} conversationId - ID da conversa
   * @param {string} userId - ID do usuário
   * @returns {Promise<boolean>} - true se o usuário é participante
   */
  static async isUserParticipantOfConversation(conversationId, userId) {
    try {
      console.log(`[DEBUG] Verificando participação - conversationId: ${conversationId}, userId: ${userId}`);
      
      // Verificar primeiro no novo modelo (conversations)
      const conversationRef = db.collection('conversations').doc(conversationId);
      const conversationDoc = await conversationRef.get();
      
      console.log(`[DEBUG] Documento da conversa existe: ${conversationDoc.exists}`);
      
      if (conversationDoc.exists) {
        const data = conversationDoc.data();
        console.log(`[DEBUG] Dados da conversa:`, data);
        console.log(`[DEBUG] Participantes:`, data.participants);
        
        // Verificar se o usuário está na lista de participantes
        if (data.participants && data.participants.includes(userId)) {
          console.log(`[DEBUG] Usuário ${userId} encontrado na lista de participantes`);
          return true;
        }
      }
      
      // Verificar no documento do usuário se ele tem essa conversa
      const userRef = db.collection('usuario').doc(userId);
      const userDoc = await userRef.get();
      
      console.log(`[DEBUG] Documento do usuário existe: ${userDoc.exists}`);
      
      if (userDoc.exists) {
        const userData = userDoc.data();
        console.log(`[DEBUG] Conversas do usuário:`, Object.keys(userData.conversas || {}));
        
        if (userData.conversas && userData.conversas[conversationId]) {
          console.log(`[DEBUG] Conversa ${conversationId} encontrada no documento do usuário`);
          return true;
        }
      }
      
      console.log(`[DEBUG] Usuário ${userId} NÃO é participante da conversa ${conversationId}`);
      return false;
    } catch (error) {
      console.error('[ERROR] Erro ao verificar participação na conversa:', error);
      console.error('[ERROR] Stack trace:', error.stack);
      return false;
    }
  }

  /**
   * Cria uma nova mensagem
   * @param {Object} messageData - Dados da mensagem
   * @returns {Promise<Object>} - Mensagem criada
   */
  static async createMessage(messageData) {
    try {
      let { sender, recipient, content, type = 'text' } = messageData;
      
      if (!sender || !recipient || !content) {
        throw new Error('Dados incompletos para criar mensagem');
      }
      
      // Obter ou criar ID da conversa
      const conversationId = await this.getOrCreateConversationId(sender, recipient);
      const conversationRef = db.collection('conversations').doc(conversationId);
      
      // Criar mensagem na subcoleção
      const timestamp = new Date();
      const newMessage = {
        conversationId,
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
      // await conversationRef.update({
      //   updatedAt: timestamp,
      //   lastMessage: {
      //     text: content.substring(0, 100), // Limite de caracteres para preview
      //     timestamp,
      //     sender
      //   }
      // });
      
      // // Atualizar referências nos documentos de usuário
      // await this.updateUserConversationReferences(
      //   conversationId,
      //   sender,
      //   recipient,
      //   content,
      //   timestamp
      // );
      
      newMessage.id = messageRef.id; // Add the generated message ID to the object

      // If the message is to the AI agent, process it and send a response
      if (recipient === AI_AGENT_USER_ID) {
        logger.info(`Message to AI Agent. ConvID: ${conversationId}, Sender: ${sender}`, { model: 'Message', method: 'createMessage' });
        
        // Update conversation metadata for the user's message to AI
        await this._updateConversationMetadata(conversationId, sender, content, timestamp);
        await this.updateUserConversationReferences(conversationId, sender, recipient, content, timestamp, false);


        // Get AI response with user context for personalized responses
        // Fetch recent conversation history for context
        const recentMessages = await this.getConversationMessages(conversationId, 5);
        
        // Get user context for personalized responses
        let userContext = null;
        try {
          const userDoc = await db.collection('usuario').doc(sender).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            userContext = {
              firstName: userData.nome || userData.firstName,
              roles: userData.roles || [],
              caixinhas: userData.caixinhas ? Object.values(userData.caixinhas).map(c => ({
                id: c.id,
                name: c.nome,
                balance: c.saldo || 0,
                role: c.role
              })) : []
            };
          }
        } catch (error) {
          logger.warn('Error fetching user context for AI', { userId: sender, error: error.message });
        }
        
        const aiResponseContent = await AIService.processMessage(sender, conversationId, content, recentMessages, userContext);

        const aiMessageTimestamp = new Date();
        const aiMessage = {
          conversationId,
          content: aiResponseContent,
          sender: AI_AGENT_USER_ID,
          type: 'text', // Assuming AI responds with text
          timestamp: aiMessageTimestamp,
          status: { sent: true, delivered: true, read: false, readAt: null } // AI message is delivered to user
        };
        const aiMessageRef = await conversationRef.collection('messages').add(aiMessage);
        aiMessage.id = aiMessageRef.id;

        // Update conversation metadata and user references for the AI's response
        // The recipient of AI's message is the original sender
        await this._updateConversationMetadata(conversationId, AI_AGENT_USER_ID, aiResponseContent, aiMessageTimestamp);
        await this.updateUserConversationReferences(conversationId, AI_AGENT_USER_ID, sender, aiResponseContent, aiMessageTimestamp, true);

      } else {
        // Regular P2P message
        await this._updateConversationMetadata(conversationId, sender, content, timestamp);
        await this.updateUserConversationReferences(conversationId, sender, recipient, content, timestamp, true);
      }
            
      return { // Return the original user's message that was saved
        id: messageRef.id,
        conversationId,
        ...newMessage,
        sender: newMessage.sender,
        content: newMessage.content,
        type: newMessage.type,
        timestamp: timestamp.toISOString(),
        status: newMessage.status
      };
    } catch (error) {
      logger.error('Erro ao criar mensagem:', { model: 'Message', method: 'createMessage', error: error.message, stack: error.stack, messageData });
      throw error;
    }
  }

/**
   * Atualiza as referências de conversa nos documentos de usuário
   * @private
   */
static async _updateConversationMetadata(conversationId, lastMessageSenderId, lastMessageContent, timestamp) {
  const conversationRef = db.collection('conversations').doc(conversationId);
  await conversationRef.update({
    updatedAt: timestamp,
    lastMessage: {
      text: lastMessageContent.substring(0, 100),
      timestamp,
      sender: lastMessageSenderId,
    },
  });
}

static async updateUserConversationReferences(conversationId, sender, recipient, content, timestamp, incrementUnreadForRecipient = true) {
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
    // const senderUpdate = {
    //   conversas: {
    //     [conversationId]: { // Usando chaves computadas aqui
    //       com: recipient,
    //       nome: recipientData.nome || recipientData.displayName || '',
    //       foto: recipientData.fotoDoPerfil || '',
    //       naoLidas: 0, // Remetente já "leu" sua própria mensagem
    //       ultimoAcesso: timestamp
     // Update for sender
     if (sender !== AI_AGENT_USER_ID) { // Don't create conversation entries for the AI agent itself if it's not a "real" user
      const senderUpdate = {
        [`conversas.${conversationId}.com`]: recipient,
        [`conversas.${conversationId}.nome`]: recipient === AI_AGENT_USER_ID ? "Assistente Virtual" : (recipientData.nome || recipientData.displayName || ''),
        [`conversas.${conversationId}.foto`]: recipient === AI_AGENT_USER_ID ? "url_to_ai_avatar.png" : (recipientData.fotoDoPerfil || ''),
        [`conversas.${conversationId}.naoLidas`]: 0, // Sender's message is "read" by them
        [`conversas.${conversationId}.ultimoAcesso`]: timestamp,
        [`conversas.${conversationId}.lastMessage.text`]: content.substring(0, 100),
        [`conversas.${conversationId}.lastMessage.timestamp`]: timestamp,
        [`conversas.${conversationId}.lastMessage.sender`]: sender,
      };
      batch.set(db.collection('usuario').doc(sender), senderUpdate, { merge: true });
    }

    // Update for recipient
    if (recipient !== AI_AGENT_USER_ID) { // Don't create conversation entries for the AI agent itself
      const recipientConversations = recipientData.conversas || {};
      const recipientConvData = recipientConversations[conversationId] || {};
      let unreadCount = recipientConvData.naoLidas || 0;
      if (incrementUnreadForRecipient) {
        unreadCount += 1;
      }

      const recipientUpdate = {
        [`conversas.${conversationId}.com`]: sender,
        [`conversas.${conversationId}.nome`]: sender === AI_AGENT_USER_ID ? "Assistente Virtual" : (senderData.nome || senderData.displayName || ''),
        [`conversas.${conversationId}.foto`]: sender === AI_AGENT_USER_ID ? "url_to_ai_avatar.png" : (senderData.fotoDoPerfil || ''),
        [`conversas.${conversationId}.naoLidas`]: unreadCount,
        // ultimoAcesso for recipient is updated when they read, not on message receipt.
        // However, we need to ensure the conversation entry exists.
        [`conversas.${conversationId}.ultimoAcesso`]: recipientConvData.ultimoAcesso || timestamp,
        [`conversas.${conversationId}.lastMessage.text`]: content.substring(0, 100),
        [`conversas.${conversationId}.lastMessage.timestamp`]: timestamp,
        [`conversas.${conversationId}.lastMessage.sender`]: sender,
      };
      batch.set(db.collection('usuario').doc(recipient), recipientUpdate, { merge: true });
    }

    // Preparar dados para o destinatário (incrementar não lidas)
    // const currentUnreadCount =
    //   (recipientData.conversas &&
    //    recipientData.conversas[conversationId] &&
    //    recipientData.conversas[conversationId].naoLidas) || 0;

    // const recipientUpdate = {
    //   conversas: {
    //     [conversationId]: { // Usando chaves computadas aqui
    //       com: sender,
    //       nome: senderData.nome || senderData.displayName || '',
    //       foto: senderData.fotoDoPerfil || '',
    //       naoLidas: currentUnreadCount + 1,
    //       ultimoAcesso: recipientData.conversas &&
    //                   recipientData.conversas[conversationId] &&
    //                   recipientData.conversas[conversationId].ultimoAcesso || timestamp // Atualizado para usar timestamp se não existir
    //     }
    //   }
    // };

    // // Atualizar o documento de metadados da conversa com a última mensagem
    // const conversationUpdate = {
    //   ultimaAtualizacao: timestamp,
    //   ultimaMensagem: {
    //     texto: content.substring(0, 100), // Limite de caracteres para preview
    //     timestamp,
    //     remetente: sender
    //   }
    // };

    // // Aplicar atualizações nos documentos de usuário
    // batch.set(db.collection('usuario').doc(sender), senderUpdate, { merge: true });
    // batch.set(db.collection('usuario').doc(recipient), recipientUpdate, { merge: true });

    // // Atualizar documento de metadados da conversa
    // batch.update(db.collection('conversations').doc(conversationId), conversationUpdate);

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

  /**
   * Alias para createMessage para compatibilidade
   * @param {Object} messageData - Dados da mensagem
   * @returns {Promise<Object>} - Mensagem criada
   */
  static async create(messageData) {
    return this.createMessage(messageData);
  }
}

module.exports = Message;