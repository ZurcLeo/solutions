const { getFirestore, FieldValue } = require('../firebaseAdmin');
const { logger } = require('../logger');
const emailService = require('./emailService');
const notificationService = require('./notificationService');
const userService = require('./userService');

const COLLECTION_NAME = 'notification_jobs';

class NotificationDispatcher {
  /**
   * Despacha uma notificação, enfileirando-a para processamento atômico e com retentativas.
   *
   * @param {Object} params
   * @param {string} params.userId - O ID do usuário destinatário (in-app + rate limiting).
   * @param {string} params.type - O tipo de notificação (ex: 'loan_approved', 'caixinha_invite').
   * @param {string} params.importance - 'high' ou 'low'.
   * @param {Object} params.data - Dados dinâmicos para a notificação.
   * @param {Object} params.metadata - Metadados da chamada (ex: correlationId).
   * @param {string} [params.dedupKey] - Chave única para evitar notificações duplicadas (idempotência).
   * @param {string} [params.recipientEmail] - Email do destinatário externo (ex: convite para não-cadastrado).
   *   Quando fornecido, substitui o email resolvido via userId para o canal de email.
   * @returns {Promise<Object>} Resultado contendo o jobId.
   */
  async dispatch({ userId, type, importance, data, metadata, dedupKey, recipientEmail }) {
    logger.info('Dispatcher: Recebendo solicitação de notificação', {
      service: 'NotificationDispatcher',
      userId,
      type,
      importance,
      dedupKey,
      correlationId: metadata?.correlationId
    });

    try {
      const db = getFirestore();

      // 0. Idempotência: verificar se já existe um job com este dedupKey
      if (dedupKey) {
        const existingJobs = await db.collection(COLLECTION_NAME)
          .where('dedupKey', '==', dedupKey)
          .limit(1)
          .get();
        
        if (!existingJobs.empty) {
          const job = existingJobs.docs[0];
          logger.warn('Dispatcher: Notificação duplicada ignorada (dedupKey match)', {
            service: 'NotificationDispatcher',
            dedupKey,
            jobId: job.id
          });
          return { success: true, jobId: job.id, status: 'ignored_duplicate' };
        }
      }

      // 1. Autorização e Rate Limiting
      const triggeredBy = metadata?.triggeredBy || 'system';
      await this._authorize(userId, triggeredBy);
      await this._checkRateLimit(userId, type);

      // 2. Definir Canais baseados na importância e preferências
      const user = await this._getUserWithPreferences(userId);
      const channels = await this._decideChannels(importance, user, type);

      // 3. Renderizar conteúdo (preparar payload para in-app e email)
      const content = await this._renderContent(type, data, user);

      // 4. Criar Job no Firestore
      const jobRef = await db.collection(COLLECTION_NAME).add({
        userId,
        type,
        importance,
        channels,
        content,
        dedupKey: dedupKey || null,
        recipientEmail: recipientEmail || null,
        status: 'pending',
        attempts: [],
        triggeredBy,
        createdAt: FieldValue.serverTimestamp(),
        metadata: metadata || {}
      });

      logger.info('Dispatcher: Job de notificação criado com sucesso', {
        service: 'NotificationDispatcher',
        jobId: jobRef.id,
        channels
      });

      // 5. Acionar processamento imediato (Fase 1 - pseudo-fila)
      // Em produção, isso iria para um BullMQ. Aqui disparamos de forma assíncrona.
      this.processJob(jobRef.id).catch(err => {
        logger.error('Dispatcher: Erro no processamento assíncrono inicial', {
          service: 'NotificationDispatcher',
          jobId: jobRef.id,
          error: err.message
        });
      });

      return { success: true, jobId: jobRef.id, status: 'queued' };

    } catch (error) {
      logger.error('Dispatcher: Falha ao despachar notificação', {
        service: 'NotificationDispatcher',
        userId,
        type,
        error: error.message
      });
      throw error;
    }
  }

  async _authorize(targetUserId, triggeredBy) {
    if (triggeredBy === 'system') return true;
    
    // Se o remetente for o mesmo que o destinatário, permite (ex: auto-notificação)
    if (triggeredBy === targetUserId) return true;
    
    // No futuro: integrar com rbacService para verificar se triggeredBy tem permissão 'notify_user'
    return true;
  }

  async _checkRateLimit(userId, type) {
    // Placeholder para rate limiting. 
    // Ex: não permitir mais de 5 notificações do mesmo tipo por minuto para o mesmo usuário.
    return true;
  }

  async _getUserWithPreferences(userId) {
    try {
      const user = await userService.getUserById(userId);
      if (!user) throw new Error(`User not found: ${userId}`);
      return user;
    } catch (e) {
      // Fallback seguro se falhar ao buscar o usuário
      logger.warn(`Falha ao buscar preferencias para ${userId}, usando defaults`, { error: e.message });
      return { id: userId, email: null, preferences: {} };
    }
  }

  async _decideChannels(importance, user, type) {
    const channels = ['in_app']; // Sempre envia in_app por padrão
    
    try {
      const db = getFirestore();
      const prefDoc = await db.collection('user_notification_preferences').doc(user.id).get();
      
      if (prefDoc.exists) {
        const prefs = prefDoc.data();
        
        // 1. Checar opt-out global de e-mail
        if (prefs.global_opt_out_email) {
          return channels;
        }
        
        // 2. Checar canais específicos para este tipo
        if (prefs.channels && prefs.channels[type]) {
          return prefs.channels[type];
        }
      }
    } catch (err) {
      logger.warn('Falha ao buscar preferências de notificação, usando defaults', { userId: user.id, error: err.message });
    }

    // Lógica Default se não houver preferências customizadas
    // Se for alta importância e o usuário tiver e-mail, envia e-mail.
    if (importance === 'high' && user.email) {
      channels.push('email');
    }
    
    return channels;
  }

  async _renderContent(type, data, user) {
    // Um mapeamento básico de tipos para o formato esperado pelos serviços.
    // Isso abstrai a lógica de como "montar" a mensagem para cada canal.
    
    const baseContent = {
      in_app: {
        type: type, // ou algo mapeado
        content: `Você tem uma nova notificação sobre: ${type}`,
        url: data.url || ''
      },
      email: null
    };

    if (type === 'loan_approved') {
      baseContent.in_app.content = `Seu empréstimo de ${data.amount} foi aprovado!`;
      baseContent.email = {
        templateType: 'padrao',
        subject: 'Seu empréstimo foi aprovado!',
        data: {
          content: `Parabéns, seu empréstimo de ${data.amount} com vencimento em ${data.dueDate} foi aprovado.`
        }
      };
    } else if (type === 'loan_requested') {
        baseContent.in_app.content = `Nova solicitação de empréstimo de ${data.userName}: ${data.amount}`;
        baseContent.email = {
          templateType: 'padrao',
          subject: 'Nova Solicitação de Empréstimo',
          data: {
            content: `${data.userName} solicitou um empréstimo de ${data.amount} na caixinha ${data.caixinhaName}.`
          }
        };
    } else if (type === 'loan_rejected') {
        baseContent.in_app.content = `Sua solicitação de empréstimo de ${data.amount} foi rejeitada.`;
        baseContent.email = {
          templateType: 'padrao',
          subject: 'Atualização sobre sua solicitação de empréstimo',
          data: {
            content: `Infelizmente sua solicitação de empréstimo de ${data.amount} não pôde ser aprovada neste momento. Motivo: ${data.reason || 'Não informado'}.`
          }
        };
    } else if (type === 'payment_confirmed') {
        baseContent.in_app.content = `Pagamento de ${data.amount} confirmado!`;
        baseContent.email = {
          templateType: 'padrao',
          subject: 'Pagamento Confirmado',
          data: {
            content: `Recebemos seu pagamento de ${data.amount} referente a ${data.description}.`
          }
        };
    } else if (type === 'rifa_ticket_purchased') {
        baseContent.in_app.content = `Bilhete nº ${data.ticketNumber} comprado para a rifa ${data.rifaName}!`;
        baseContent.email = {
          templateType: 'padrao',
          subject: 'Confirmação de Compra de Bilhete',
          data: {
            content: `Você adquiriu o bilhete nº ${data.ticketNumber} para a rifa "${data.rifaName}". Boa sorte!`
          }
        };
    } else if (type === 'rifa_draw_held') {
        baseContent.in_app.content = `O sorteio da rifa ${data.rifaName} foi realizado! Número sorteado: ${data.winningNumber}.`;
        baseContent.email = {
          templateType: 'padrao',
          subject: 'Resultado do Sorteio',
          data: {
            content: `O sorteio da rifa "${data.rifaName}" foi realizado. O número sorteado foi: ${data.winningNumber}.`
          }
        };
    } else if (type === 'rifa_winner_announced') {
        baseContent.in_app.content = `Parabéns! Você ganhou o prêmio da rifa ${data.rifaName}!`;
        baseContent.email = {
          templateType: 'padrao',
          subject: '🏆 Você Ganhou!',
          data: {
            content: `Parabéns! Seu bilhete foi o sorteado na rifa "${data.rifaName}". Entre em contato para receber seu prêmio: ${data.prize}.`
          }
        };
    } else if (type === 'account_validated') {
        baseContent.in_app.content = `Sua conta bancária foi validada com sucesso!`;
        baseContent.email = {
          templateType: 'padrao',
          subject: 'Conta Bancária Validada',
          data: {
            content: `Sua conta bancária vinculada à plataforma foi validada. Você já pode solicitar saques de suas caixinhas.`
          }
        };
    } else if (type === 'caixinha_invite') {
      baseContent.in_app.content = `Você foi convidado para a caixinha ${data.caixinhaName}`;
      baseContent.email = {
        templateType: 'caixinha_invite',
        subject: `Convite para a caixinha ${data.caixinhaName}`,
        data: {
          ...data
        }
      };
    } else if (type === 'convite') {
      baseContent.in_app.content = `Convite enviado para ${data.friendName}`;
      baseContent.email = {
        templateType: 'convite',
        subject: `Você recebeu um convite de ${data.senderName} para a ElosCloud`,
        data: {
          ...data
        }
      };
    } else if (type === 'convite_aceito') {
      baseContent.in_app.content = `${data.friendName} aceitou seu convite e criou uma conta`;
      baseContent.in_app.url = data.url || `/profile/${data.newUserId}`;
      // sem email — notificação apenas in_app para o remetente
    } else if (type === 'convite_lembrete') {
      baseContent.in_app.content = `Lembrete de convite enviado para ${data.friendName}`;
      baseContent.email = {
        templateType: 'convite_lembrete',
        subject: 'Lembrete: você tem um convite pendente na ElosCloud',
        data: {
          ...data
        }
      };
    } else {
        // Fallback genérico para e-mail se necessário
        if (data.emailSubject && data.emailContent) {
            baseContent.email = {
                templateType: 'padrao',
                subject: data.emailSubject,
                data: { content: data.emailContent }
            }
        }
    }

    return baseContent;
  }

  /**
   * Processa um job de notificação específico.
   * 
   * @param {string} jobId 
   */
  async processJob(jobId) {
    const db = getFirestore();
    const jobRef = db.collection(COLLECTION_NAME).doc(jobId);
    
    // Transação para garantir que não processemos o mesmo job duas vezes em paralelo
    const job = await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(jobRef);
        if (!doc.exists) throw new Error('Job not found');
        const data = doc.data();
        
        if (data.status !== 'pending' && data.status !== 'retrying') {
            return null; // Já foi processado ou falhou
        }
        
        transaction.update(jobRef, { status: 'processing', lastAttemptAt: FieldValue.serverTimestamp() });
        return { id: doc.id, ...data };
    });

    if (!job) return;

    logger.info('Dispatcher: Processando Job', { service: 'NotificationDispatcher', jobId });

    const results = {};
    const user = await this._getUserWithPreferences(job.userId);

    for (const channel of job.channels) {
      try {
        if (channel === 'in_app' && job.content.in_app) {
          const res = await notificationService.createNotification(
            job.userId, 
            job.content.in_app
          );
          if (!res.success) throw new Error(res.message);
          
          results[channel] = { success: true };
        } 
        else if (channel === 'email' && job.content.email && (job.recipientEmail || user.email)) {
          const res = await emailService.sendEmail({
            to: job.recipientEmail || user.email,
            subject: job.content.email.subject,
            templateType: job.content.email.templateType,
            data: job.content.email.data,
            userId: job.userId,
            reference: job.metadata?.correlationId,
            referenceType: 'dispatcher_job'
          });
          
          if (!res.success) throw new Error(res.error);
          results[channel] = { success: true, externalId: res.messageId };
        }
      } catch (err) {
        logger.warn(`Dispatcher: Falha no canal ${channel}`, { 
          service: 'NotificationDispatcher', jobId, channel, error: err.message 
        });
        results[channel] = { success: false, error: err.message };
      }
    }

    const hasFailedChannel = Object.values(results).some(r => !r.success);
    
    const updateData = {
        attempts: FieldValue.arrayUnion({
            timestamp: new Date().toISOString(),
            results
        })
    };

    if (hasFailedChannel) {
        // Logica de retry simplificada (Fase 1: apenas marca como falha se passar de X tentativas)
        // O Worker varreria jobs 'retrying'
        const attemptCount = (job.attempts || []).length + 1;
        if (attemptCount >= 3) {
            updateData.status = 'failed';
            updateData.completedAt = FieldValue.serverTimestamp();
            logger.error('Dispatcher: Job falhou permanentemente após retentativas', {
                service: 'NotificationDispatcher', jobId
            });
            // Aqui dispararia alerta pro Slack/Admin se importance === 'high'
        } else {
            updateData.status = 'retrying';
            updateData.nextRetryAt = new Date(Date.now() + 60000 * Math.pow(5, attemptCount)); // Exponencial simples
        }
    } else {
        updateData.status = 'completed';
        updateData.completedAt = FieldValue.serverTimestamp();
        logger.info('Dispatcher: Job completado com sucesso', { service: 'NotificationDispatcher', jobId });
    }

    await jobRef.update(updateData);
  }
}

module.exports = new NotificationDispatcher();