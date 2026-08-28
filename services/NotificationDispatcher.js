const { logger } = require('../logger');
const { getSupabaseClient } = require('../config/supabase');
const emailService = require('./emailService');
const notificationService = require('./notificationService');
const pushService = require('./pushService');
const userService = require('./userService');
const userPreferencesService = require('./userPreferencesService');
const webhookOutboundService = require('./webhookOutboundService');

const sb = () => getSupabaseClient();

class NotificationDispatcher {
  /**
   * Despacha uma notificação, enfileirando-a para processamento atômico e com retentativas.
   *
   * @param {Object} params
   * @param {string} params.userId - O ID do usuário destinatário.
   * @param {string} params.type - O tipo de notificação.
   * @param {string} params.importance - 'high' ou 'low'.
   * @param {Object} params.data - Dados dinâmicos para a notificação.
   * @param {Object} params.metadata - Metadados da chamada.
   * @param {string} [params.dedupKey] - Chave de idempotência.
   * @param {string} [params.recipientEmail] - Email externo (convite para não-cadastrado).
   * @returns {Promise<Object>} Resultado com jobId.
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
      const supabase = sb();

      // 0. Idempotência: verificar se já existe um job com este dedupKey
      if (dedupKey && supabase) {
        const { data: existing } = await supabase
          .from('notification_jobs')
          .select('id')
          .eq('dedup_key', dedupKey)
          .limit(1);

        if (existing && existing.length > 0) {
          logger.warn('Dispatcher: Notificação duplicada ignorada (dedupKey match)', {
            service: 'NotificationDispatcher',
            dedupKey,
            jobId: existing[0].id
          });
          return { success: true, jobId: existing[0].id, status: 'ignored_duplicate' };
        }
      }

      // 1. Autorização e Rate Limiting
      const triggeredBy = metadata?.triggeredBy || 'system';
      await this._authorize(userId, triggeredBy);
      await this._checkRateLimit(userId, type);

      // 2. Definir Canais baseados na importância e preferências
      // Stash data for _decideChannels webhook check
      this._lastDispatchData = data || {};
      const user = await this._getUserWithPreferences(userId);
      const channels = await this._decideChannels(importance, user, type);

      // 3. Renderizar conteúdo
      const content = await this._renderContent(type, data, user);

      // 4. Criar Job no Supabase
      let jobId;
      if (supabase) {
        const { data: job, error } = await supabase
          .from('notification_jobs')
          .insert({
            user_id: userId,
            type,
            importance,
            channels,
            content,
            dedup_key: dedupKey || null,
            recipient_email: recipientEmail || null,
            status: 'pending',
            attempts: [],
            triggered_by: triggeredBy,
            metadata: metadata || {}
          })
          .select('id')
          .single();

        if (error) throw new Error(`Supabase notification_jobs insert: ${error.message}`);
        jobId = job.id;
      } else {
        // Sem Supabase: processa diretamente sem persistir o job
        jobId = `direct-${Date.now()}`;
        logger.warn('Dispatcher: Supabase indisponível, processando sem persistência', {
          service: 'NotificationDispatcher', jobId
        });
      }

      logger.info('Dispatcher: Job de notificação criado com sucesso', {
        service: 'NotificationDispatcher',
        jobId,
        channels
      });

      // 5. Acionar processamento imediato (assíncrono)
      const jobPayload = {
        id: jobId,
        userId,
        type,
        channels,
        content,
        recipientEmail: recipientEmail || null,
        attempts: [],
        metadata: metadata || {}
      };

      this.processJob(jobId, jobPayload).catch(err => {
        logger.error('Dispatcher: Erro no processamento assíncrono inicial', {
          service: 'NotificationDispatcher',
          jobId,
          error: err.message
        });
      });

      return { success: true, jobId, status: 'queued' };

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
    if (triggeredBy === targetUserId) return true;
    return true;
  }

  async _checkRateLimit(userId, type) {
    // Placeholder para rate limiting futuro
    return true;
  }

  async _getUserWithPreferences(userId) {
    try {
      const user = await userService.getUserById(userId);
      if (!user) throw new Error(`User not found: ${userId}`);
      return user;
    } catch (e) {
      logger.warn(`Falha ao buscar preferências para ${userId}, usando defaults`, { error: e.message });
      return { id: userId, email: null, preferences: {} };
    }
  }

  async _decideChannels(importance, user, type) {
    const channels = ['in_app']; // Sempre envia in_app

    // PREFS-004: unified channel decisions via userPreferencesService.canSend()
    // Email: high importance + email disponível + preferência permite
    if (importance === 'high' && user.email) {
      try {
        const canEmail = await userPreferencesService.canSend(user.id, 'email', type);
        if (canEmail) channels.push('email');
      } catch (emailErr) {
        // Falha silenciosa — assume permitido em caso de erro
        logger.debug('Falha ao verificar preferência de email', { userId: user.id, error: emailErr.message });
        channels.push('email');
      }
    }

    // Push: verificar preferências do usuário
    try {
      const canPush = await userPreferencesService.canSend(user.id, 'push', type);
      if (canPush) channels.push('push');
    } catch (pushErr) {
      // Falha silenciosa — push é best-effort
      logger.debug('Falha ao verificar preferência de push', { userId: user.id, error: pushErr.message });
    }

    // Webhook: verificar se há subscription ativa para o seller deste evento
    if (this._lastDispatchData?.sellerId) {
      try {
        const canWebhook = await userPreferencesService.canSend(user.id, 'webhook', type).catch(() => true);
        if (canWebhook) {
          const webhookSub = await webhookOutboundService.getActiveSubscription(this._lastDispatchData.sellerId);
          if (webhookSub) {
            const webhookEvent = this._mapToWebhookEvent(type);
            if (webhookEvent && (webhookSub.events_enabled.length === 0 || webhookSub.events_enabled.includes(webhookEvent))) {
              channels.push('webhook');
            }
          }
        }
      } catch (e) {
        logger.debug('Falha ao verificar webhook subscription', { error: e.message });
      }
    }

    return channels;
  }

  async _renderContent(type, data, user) {
    const baseContent = {
      in_app: {
        type,
        content: `Você tem uma nova notificação sobre: ${type}`,
        url: data.url || ''
      },
      email: null,
      push: {
        title: 'ElosCloud',
        body: 'Você tem uma nova notificação',
        url: data.url || '/'
      }
    };

    if (type === 'loan_approved') {
      baseContent.in_app.content = `Seu empréstimo de ${data.amount} foi aprovado!`;
      baseContent.email = { templateType: 'padrao', subject: 'Seu empréstimo foi aprovado!', data: { content: `Parabéns, seu empréstimo de ${data.amount} com vencimento em ${data.dueDate} foi aprovado.` } };
    } else if (type === 'loan_requested') {
      baseContent.in_app.content = `Nova solicitação de empréstimo de ${data.userName}: ${data.amount}`;
      baseContent.email = { templateType: 'padrao', subject: 'Nova Solicitação de Empréstimo', data: { content: `${data.userName} solicitou um empréstimo de ${data.amount} na caixinha ${data.caixinhaName}.` } };
    } else if (type === 'loan_rejected') {
      baseContent.in_app.content = `Sua solicitação de empréstimo de ${data.amount} foi rejeitada.`;
      baseContent.email = { templateType: 'padrao', subject: 'Atualização sobre sua solicitação de empréstimo', data: { content: `Infelizmente sua solicitação de empréstimo de ${data.amount} não pôde ser aprovada. Motivo: ${data.reason || 'Não informado'}.` } };
    } else if (type === 'payment_confirmed') {
      baseContent.in_app.content = `Pagamento de ${data.amount} confirmado!`;
      baseContent.email = { templateType: 'padrao', subject: 'Pagamento Confirmado', data: { content: `Recebemos seu pagamento de ${data.amount} referente a ${data.description}.` } };
    } else if (type === 'rifa_ticket_purchased') {
      baseContent.in_app.content = `Bilhete nº ${data.ticketNumber} comprado para a rifa ${data.rifaName}!`;
      baseContent.email = { templateType: 'padrao', subject: 'Confirmação de Compra de Bilhete', data: { content: `Você adquiriu o bilhete nº ${data.ticketNumber} para a rifa "${data.rifaName}". Boa sorte!` } };
    } else if (type === 'rifa_draw_held') {
      baseContent.in_app.content = `O sorteio da rifa ${data.rifaName} foi realizado! Número sorteado: ${data.winningNumber}.`;
      baseContent.email = { templateType: 'padrao', subject: 'Resultado do Sorteio', data: { content: `O sorteio da rifa "${data.rifaName}" foi realizado. Número sorteado: ${data.winningNumber}.` } };
    } else if (type === 'rifa_winner_announced') {
      baseContent.in_app.content = `Parabéns! Você ganhou o prêmio da rifa ${data.rifaName}!`;
      baseContent.email = { templateType: 'padrao', subject: 'Você Ganhou!', data: { content: `Parabéns! Seu bilhete foi o sorteado na rifa "${data.rifaName}". Entre em contato para receber: ${data.prize}.` } };
    } else if (type === 'kyc_verified') {
      const docType = data.documentType || 'documento';
      baseContent.in_app.content = `Sua verificação de ${docType} foi concluída com sucesso! Seu perfil agora é verificado.`;
      baseContent.in_app.url = '/configuracoes';
      baseContent.email = { templateType: 'padrao', subject: `Verificação de ${docType} aprovada`, data: { content: `Parabéns! Sua verificação de ${docType} na ElosCloud foi aprovada com sucesso. Seu perfil agora possui status verificado.` } };
    } else if (type === 'kyc_failed') {
      const docType = data.documentType || 'documento';
      const reason  = data.reason || 'Verifique os dados informados';
      baseContent.in_app.content = `A verificação do seu ${docType} não pôde ser concluída. ${reason}.`;
      baseContent.in_app.url = '/configuracoes';
      baseContent.email = { templateType: 'padrao', subject: `Verificação de ${docType} não aprovada`, data: { content: `Infelizmente sua verificação de ${docType} não foi aprovada. Motivo: ${reason}. Você pode tentar novamente nas configurações do seu perfil.` } };
      if (data.sellerId) baseContent.webhook = { event_type: 'kyc.rejected', sellerId: data.sellerId, payload: { userId: data.userId, userName: data.userName, reason: data.reason || reason, clientPhone: data.clientPhone } };
    } else if (type === 'kyc_pending_review') {
      const docType = data.documentType || 'documento';
      baseContent.in_app.content = `Sua verificação de ${docType} está em análise. Você será notificado quando for concluída.`;
      baseContent.in_app.url = '/configuracoes';
    } else if (type === 'account_validated') {
      baseContent.in_app.content = 'Sua conta bancária foi validada com sucesso!';
      baseContent.email = { templateType: 'padrao', subject: 'Conta Bancária Validada', data: { content: 'Sua conta bancária vinculada à plataforma foi validada. Você já pode solicitar saques.' } };
    } else if (type === 'caixinha_invite') {
      const caixinhaName = data.caixinhaName || 'uma caixinha';
      baseContent.in_app.content = `Você foi convidado para a caixinha ${caixinhaName}`;
      baseContent.in_app.url = data.caixinhaId ? `/caixinhas/${data.caixinhaId}/convite` : '/caixinhas';
      baseContent.email = { templateType: 'caixinha_invite', subject: `Convite para a caixinha ${caixinhaName}`, data: { ...data } };
    } else if (type === 'convite') {
      baseContent.in_app.content = `Convite enviado para ${data.friendName}`;
      baseContent.email = { templateType: 'convite', subject: `Olá, ${data.friendName} — você foi convidado para a ElosCloud por ${data.senderName}`, data: { ...data } };
    } else if (type === 'convite_aceito') {
      baseContent.in_app.content = `${data.friendName} aceitou seu convite e criou uma conta`;
      baseContent.in_app.url = data.url || `/profile/${data.newUserId}`;
    } else if (type === 'connection_requested') {
      baseContent.in_app.content = `${data.senderName} enviou um pedido de amizade para você!`;
      baseContent.in_app.url = `/profile/${data.senderId}`;
      baseContent.push = { title: 'ElosCloud', body: 'Você recebeu um pedido de amizade!', url: `/profile/${data.senderId}` };
    } else if (type === 'connection_accepted') {
      baseContent.in_app.content = `${data.receiverName} aceitou seu pedido de amizade! Agora vocês estão conectados.`;
      baseContent.in_app.url = `/profile/${data.receiverId}`;
      baseContent.push = { title: 'ElosCloud', body: 'Seu pedido de amizade foi aceito!', url: `/profile/${data.receiverId}` };
    } else if (type === 'new_selo') {
      const seloName = data.seloName || data.seloSlug || 'novo selo';
      baseContent.in_app.content = `Selo conquistado: ${seloName}`;
      baseContent.in_app.url = `selo:${data.seloSlug}`;
    } else if (type === 'mission_completed') {
      baseContent.in_app.content = `Missão cumprida! Você completou "${data.taskName}" e ganhou ${data.xpGranted} XP!`;
      baseContent.in_app.url = '/gamification';
    } else if (type === 'level_up') {
      baseContent.in_app.content = `Parabéns! Você subiu para o nível ${data.newLevel}: ${data.levelName}!`;
      baseContent.in_app.url = '/gamification';
    } else if (type === 'convite_lembrete') {
      baseContent.in_app.content = `Lembrete de convite enviado para ${data.friendName}`;
      baseContent.email = { templateType: 'convite_lembrete', subject: `Lembrete: ${data.senderName} ainda espera por você na ElosCloud`, data: { ...data } };
    } else if (type === 'waitlist_match') {
      const nome = data.waitlistNome;
      const count = data.matchCount;
      if (nome) {
        baseContent.in_app.content = `${nome} quer entrar na ElosCloud e você está na agenda dele. Que tal enviar um convite?`;
      } else if (count > 1) {
        baseContent.in_app.content = `${count} pessoas da sua agenda querem entrar na ElosCloud. Veja quem está esperando por um convite!`;
      } else {
        baseContent.in_app.content = 'Alguém da sua agenda quer entrar na ElosCloud. Que tal enviar um convite?';
      }
      baseContent.in_app.url = '/configuracoes/convites';
      baseContent.push = { title: 'ElosCloud', body: nome ? `${nome} quer entrar na ElosCloud — envie um convite!` : 'Alguém da sua agenda quer entrar na ElosCloud!', url: '/configuracoes/convites' };
      baseContent.email = { templateType: 'waitlist_match', subject: nome ? `${nome} quer entrar na ElosCloud — e você pode convidar` : 'Alguém da sua agenda quer entrar na ElosCloud', data: { ...data } };
    } else if (type === 'gift_received') {
      baseContent.in_app.content = `Você recebeu "${data.stickerName}" e ganhou ${data.eloCoinsReceived} EloCoins na sua postagem!`;
      baseContent.in_app.url = data.postId ? `/posts?post=${data.postId}` : '/posts';
      // gift é notificação de baixa importância — apenas in-app, sem email
    } else if (type === 'reaction_received') {
      const who = data.senderName || 'Alguém';
      baseContent.in_app.content = `${who} curtiu sua publicação!`;
      baseContent.in_app.url = data.postId ? `/posts?post=${data.postId}` : '/posts';
    } else if (type === 'comment_received') {
      const who = data.senderName || 'Alguém';
      baseContent.in_app.content = `${who} comentou na sua publicação!`;
      baseContent.in_app.url = data.postId ? `/posts?post=${data.postId}` : '/posts';
    } else if (type === 'comment_reply_received') {
      const who = data.senderName || 'Alguém';
      baseContent.in_app.content = `${who} respondeu ao seu comentário!`;
      baseContent.in_app.url = data.postId ? `/posts?post=${data.postId}` : '/posts';
    } else if (type === 'comment_liked') {
      const who = data.senderName || 'Alguém';
      baseContent.in_app.content = `${who} curtiu seu comentário!`;
      baseContent.in_app.url = data.postId ? `/posts?post=${data.postId}` : '/posts';
    } else if (type === 'marketplace_order_paid') {
      baseContent.in_app.content = 'Seu pedido foi confirmado e está sendo preparado!';
      baseContent.in_app.url = data.orderId ? `/mercado/pedidos/${data.orderId}` : '/mercado/pedidos';
      baseContent.push.body = 'Seu pedido foi confirmado!';
      baseContent.push.url = data.orderId ? `/mercado/pedidos/${data.orderId}` : '/mercado/pedidos';
      baseContent.email = { templateType: 'padrao', subject: 'Pedido Confirmado', data: { content: 'Seu pedido no Mercado ElosCloud foi confirmado! Acompanhe o status na plataforma.' } };
    } else if (type === 'marketplace_new_order') {
      baseContent.in_app.content = 'Você recebeu um novo pedido! Confira os detalhes.';
      baseContent.in_app.url = data.orderId ? `/mercado/pedidos/${data.orderId}` : '/mercado/vendedor';
      baseContent.push.body = 'Você recebeu um novo pedido!';
      baseContent.push.url = data.orderId ? `/mercado/pedidos/${data.orderId}` : '/mercado/vendedor';
      baseContent.email = { templateType: 'padrao', subject: 'Novo Pedido Recebido', data: { content: 'Você recebeu um novo pedido no Mercado ElosCloud. Acesse a plataforma para processar.' } };
      if (data.sellerId) baseContent.webhook = { event_type: 'order.created', sellerId: data.sellerId, payload: { orderId: data.orderId, clientName: data.clientName || data.guestName, clientPhone: data.clientPhone, buyerId: data.buyerId } };
    } else if (type === 'shipping_label_ready') {
      const carrier = data.carrierName || 'transportadora';
      const service = data.serviceName || '';
      baseContent.in_app.content = `Etiqueta de envio ${service} (${carrier}) pronta! Imprima e envie o pedido.`;
      baseContent.in_app.url = `/mercado/pedidos/${data.orderId}`;
      baseContent.push.body = 'Etiqueta de envio pronta! Imprima e despache o pedido.';
      baseContent.push.url = `/mercado/pedidos/${data.orderId}`;
      baseContent.email = {
        templateType: 'padrao',
        subject: 'Etiqueta de Envio Pronta',
        data: { content: `A etiqueta de envio do seu pedido via ${carrier} está pronta. Acesse a plataforma para imprimir e despachar.` },
      };
    } else if (type === 'shipping_status_changed') {
      const statusLabels = {
        posted: 'Objeto postado na transportadora',
        in_transit: 'Em trânsito',
        delivered: 'Entregue',
        cancelled: 'Devolvido ao remetente',
      };
      const label = statusLabels[data.status] || data.status;
      const loc = data.location ? ` — ${data.location}` : '';
      baseContent.in_app.content = `Rastreio: ${label}${loc}`;
      baseContent.in_app.url = `/mercado/pedidos/${data.orderId}`;
      baseContent.push.body = `${label}${loc}`;
      baseContent.push.url = `/mercado/pedidos/${data.orderId}`;
      baseContent.email = {
        templateType: 'padrao',
        subject: `Seu pedido: ${label}`,
        data: { content: `Atualização do seu pedido: ${label}${loc}. Acompanhe na plataforma.` },
      };
    } else if (type === 'marketplace_order_status') {
      const statusLabels = { in_progress: 'em preparo', completed: 'concluído', cancelled: 'cancelado' };
      const label = statusLabels[data.newStatus] || data.newStatus;
      baseContent.in_app.content = `Seu pedido foi atualizado para: ${label}.`;
      baseContent.in_app.url = data.orderId ? `/mercado/pedidos/${data.orderId}` : '/mercado/pedidos';
    } else if (type === 'stay_new_booking') {
      baseContent.in_app.content = `Nova reserva recebida! Check-in: ${data.checkIn}, Check-out: ${data.checkOut}.`;
      baseContent.in_app.url = '/mercado/vendedor';
      baseContent.email = { templateType: 'padrao', subject: 'Nova Reserva de Temporada', data: { content: `Você recebeu uma nova reserva de temporada. Check-in: ${data.checkIn}, Check-out: ${data.checkOut}. Acesse a plataforma para detalhes.` } };
    } else if (type === 'stay_cancelled') {
      const by = data.cancelledBy === 'guest' ? 'O hóspede cancelou' : 'O anfitrião cancelou';
      baseContent.in_app.content = `${by} a reserva de temporada.`;
      baseContent.in_app.url = '/mercado/vendedor';
      baseContent.email = { templateType: 'padrao', subject: 'Reserva Cancelada', data: { content: `${by} uma reserva de temporada. Acesse a plataforma para mais detalhes.` } };
    } else if (type === 'stay_completed') {
      baseContent.in_app.content = 'Sua estadia foi concluída! Que tal deixar uma avaliação?';
      baseContent.in_app.url = data.stayId ? `/mercado/minhas-estadias` : '/mercado';
    } else if (type === 'delivery_matched') {
      baseContent.in_app.content = 'Um entregador aceitou sua solicitação de entrega!';
      baseContent.in_app.url = '/mercado/pedidos';
      baseContent.push.body = 'Um entregador aceitou seu pedido!';
      baseContent.push.url = '/mercado/pedidos';
    } else if (type === 'delivery_completed') {
      baseContent.in_app.content = 'A entrega foi concluída com sucesso!';
      baseContent.in_app.url = '/mercado/pedidos';
      baseContent.push.body = 'Entrega concluída com sucesso!';
      baseContent.push.url = '/mercado/pedidos';
    } else if (type === 'delivery_no_deliverer') {
      baseContent.in_app.content = 'Não foi possível encontrar um entregador disponível. Tente novamente mais tarde.';
      baseContent.in_app.url = '/mercado/vendedor';
    // --- Carona Solidária ---
    } else if (type === 'carona_driver_verified') {
      baseContent.in_app.content = 'Seu cadastro de motorista foi aprovado! Você já pode oferecer caronas.';
      baseContent.in_app.url = '/carona/dashboard';
      baseContent.push.body = 'Seu cadastro de motorista foi aprovado!';
      baseContent.push.url = '/carona/dashboard';
      baseContent.email = { templateType: 'padrao', subject: 'Cadastro de motorista aprovado', data: { content: 'Seu cadastro de motorista na Carona Solidária foi aprovado. Acesse a plataforma para oferecer suas primeiras caronas.' } };
    } else if (type === 'carona_driver_rejected') {
      const reason = data.reason || 'Verifique os dados do veículo';
      baseContent.in_app.content = `Cadastro de motorista requer atenção: ${reason}.`;
      baseContent.in_app.url = '/carona/motorista';
      baseContent.push.body = 'Cadastro de motorista requer atenção';
      baseContent.push.url = '/carona/motorista';
    } else if (type === 'carona_seat_booked') {
      baseContent.in_app.content = 'Nova reserva na sua carona! Um passageiro confirmou vaga.';
      baseContent.in_app.url = data.rideId ? `/carona/viagem/${data.rideId}` : '/carona/dashboard';
      baseContent.push.body = 'Nova reserva na sua carona!';
      baseContent.push.url = data.rideId ? `/carona/viagem/${data.rideId}` : '/carona/dashboard';
    } else if (type === 'carona_seat_cancelled') {
      baseContent.in_app.content = 'Uma reserva na sua carona foi cancelada.';
      baseContent.in_app.url = data.rideId ? `/carona/viagem/${data.rideId}` : '/carona/dashboard';
      baseContent.push.body = 'Uma reserva foi cancelada';
      baseContent.push.url = data.rideId ? `/carona/viagem/${data.rideId}` : '/carona/dashboard';
    } else if (type === 'carona_ride_cancelled') {
      baseContent.in_app.content = 'A carona foi cancelada pelo motorista.';
      baseContent.in_app.url = '/carona/minhas-viagens';
      baseContent.push.body = 'Carona cancelada pelo motorista';
      baseContent.push.url = '/carona/minhas-viagens';
      baseContent.email = { templateType: 'padrao', subject: 'Carona cancelada', data: { content: 'A carona que você reservou foi cancelada pelo motorista. Acesse a plataforma para buscar alternativas.' } };
    } else if (type === 'carona_ride_departed') {
      baseContent.in_app.content = 'Sua carona partiu! Acompanhe ao vivo.';
      baseContent.in_app.url = data.rideId ? `/carona/ativa/${data.rideId}` : '/carona/minhas-viagens';
      baseContent.push.body = 'Sua carona partiu! Acompanhe ao vivo';
      baseContent.push.url = data.rideId ? `/carona/ativa/${data.rideId}` : '/carona/minhas-viagens';
    } else if (type === 'carona_rating_requested') {
      baseContent.in_app.content = 'Como foi sua viagem? Avalie agora!';
      baseContent.in_app.url = data.rideId ? `/carona/avaliar/${data.rideId}` : '/carona/minhas-viagens';
      baseContent.push.body = 'Como foi sua viagem? Avalie agora';
      baseContent.push.url = data.rideId ? `/carona/avaliar/${data.rideId}` : '/carona/minhas-viagens';
    } else if (type === 'carona_rating_received') {
      baseContent.in_app.content = 'Você recebeu uma avaliação de viagem!';
      baseContent.in_app.url = '/carona/dashboard';
      baseContent.push.body = 'Você recebeu uma avaliação de viagem';
      baseContent.push.url = '/carona/dashboard';

    // ── Fiscal [FISCAL-001] ──
    } else if (type === 'fiscal_prazo_7d') {
      baseContent.in_app.content = `Pendência "${data.titulo}" vence em 7 dias`;
      baseContent.in_app.url = '/mercado/vendedor';
      baseContent.push.body = `Prazo em 7 dias: ${data.titulo}`;
      baseContent.push.url = '/mercado/vendedor';
      if (data.sellerId) baseContent.webhook = { event_type: 'pendencia.deadline_approaching', sellerId: data.sellerId, payload: { pendenciaId: data.pendenciaId, titulo: data.titulo, diasRestantes: 7, clientPhone: data.clientPhone, clientName: data.clientName } };
    } else if (type === 'fiscal_prazo_3d') {
      baseContent.in_app.content = `URGENTE: "${data.titulo}" vence em 3 dias`;
      baseContent.in_app.url = '/mercado/vendedor';
      baseContent.push.body = `Prazo em 3 dias: ${data.titulo}`;
      baseContent.push.url = '/mercado/vendedor';
      baseContent.email = { templateType: 'padrao', subject: `Prazo em 3 dias — ${data.titulo}`, data: { content: `A pendência "${data.titulo}" vence em 3 dias. Acesse a plataforma para acompanhar.` } };
      if (data.sellerId) baseContent.webhook = { event_type: 'pendencia.deadline_approaching', sellerId: data.sellerId, payload: { pendenciaId: data.pendenciaId, titulo: data.titulo, diasRestantes: 3, clientPhone: data.clientPhone, clientName: data.clientName } };
    } else if (type === 'fiscal_prazo_1d') {
      baseContent.in_app.content = `URGENTE: "${data.titulo}" vence AMANHÃ`;
      baseContent.in_app.url = '/mercado/vendedor';
      baseContent.push.body = `Vence AMANHÃ: ${data.titulo}`;
      baseContent.push.url = '/mercado/vendedor';
      baseContent.email = { templateType: 'padrao', subject: `Vence amanhã — ${data.titulo}`, data: { content: `A pendência "${data.titulo}" vence amanhã! Ação imediata necessária.` } };
      if (data.sellerId) baseContent.webhook = { event_type: 'pendencia.deadline_approaching', sellerId: data.sellerId, payload: { pendenciaId: data.pendenciaId, titulo: data.titulo, diasRestantes: 1, clientPhone: data.clientPhone, clientName: data.clientName } };
    } else if (type === 'fiscal_pendencia_vencida') {
      baseContent.in_app.content = `Pendência VENCIDA: "${data.titulo}"`;
      baseContent.in_app.url = '/mercado/vendedor';
      baseContent.push.body = `VENCIDA: ${data.titulo}`;
      baseContent.push.url = '/mercado/vendedor';
      baseContent.email = { templateType: 'padrao', subject: `Pendência vencida — ${data.titulo}`, data: { content: `A pendência "${data.titulo}" venceu. Acesse a plataforma para verificar e tomar providências.` } };
      if (data.sellerId) baseContent.webhook = { event_type: 'pendencia.overdue', sellerId: data.sellerId, payload: { pendenciaId: data.pendenciaId, titulo: data.titulo, diasRestantes: 0, clientPhone: data.clientPhone, clientName: data.clientName } };
    } else if (type === 'fiscal_documento_enviado') {
      baseContent.in_app.content = 'Um documento foi enviado em uma de suas pendências';
      baseContent.in_app.url = '/mercado/vendedor';
      baseContent.push.body = 'Novo documento recebido';
      baseContent.push.url = '/mercado/vendedor';

    } else if (type === 'seller_seat_cost_changed') {
      baseContent.in_app.content = `Sua equipe agora tem ${data.seats_ativos} membros. Custo adicional de R$${data.custo_seats?.toFixed(2) || '0,00'}/mês em seats.`;
      baseContent.in_app.url = '/mercado/vendedor/configuracoes';
      baseContent.push.body = 'Custo da equipe atualizado';
      baseContent.push.url = '/mercado/vendedor/configuracoes';

    // ── Game Invite ──
    } else if (type === 'game_invite') {
      const gameTitle = data.gameTitle || 'Jogo';
      baseContent.in_app.content = `Você foi convidado para "${gameTitle}"`;
      baseContent.in_app.url = '/convites';
      baseContent.push.body = `Convite para jogo: ${gameTitle}`;
      baseContent.push.url = '/convites';

    // ── Seller Team [TEAM-001] ──
    } else if (type === 'seller_team_invite') {
      baseContent.in_app.content = `Você foi convidado para a equipe de ${data.sellerName}`;
      baseContent.in_app.url = '/convites';
      baseContent.push.body = `Convite para equipe: ${data.sellerName}`;
      baseContent.push.url = '/convites';
      baseContent.email = { templateType: 'padrao', subject: `Convite para equipe — ${data.sellerName}`, data: { content: `Você foi convidado para fazer parte da equipe de ${data.sellerName} na ElosCloud. Acesse a plataforma para aceitar o convite.` } };

    // ── Business Invite — usuário existente [BIZ-004] ──
    } else if (type === 'business_invite_received') {
      const bSellerName = data.sellerName || 'Negócio';
      const bInviterName = data.inviterName || 'Um usuário';
      const frontendUrl = process.env.FRONTEND_URL || 'https://eloscloud.com';
      baseContent.in_app.content = `${bInviterName} convidou você para a equipe de ${bSellerName}`;
      baseContent.in_app.url = '/mercado/vendedor';
      baseContent.push.body = `Convite de equipe: ${bSellerName}`;
      baseContent.push.url = '/mercado/vendedor';
      baseContent.email = {
        templateType: 'business_invite',
        subject: `Convite para equipe — ${bSellerName}`,
        data: { ...data, userName: user?.full_name || user?.nome || 'Usuário', inviteLink: `${frontendUrl}/mercado/vendedor`, isNewUser: false },
      };

    // ── Business Invite — novo usuário (não cadastrado) [BIZ-004] ──
    } else if (type === 'business_invite_new_user') {
      const bSellerName = data.sellerName || 'Negócio';
      const bInviterName = data.inviterName || 'Um usuário';
      const frontendUrl = process.env.FRONTEND_URL || 'https://eloscloud.com';
      const registerUrl = `${frontendUrl}${data.registerUrl || '/registrar'}`;
      baseContent.in_app.content = `${bInviterName} convidou você para a equipe de ${bSellerName}`;
      baseContent.push.body = `Convite de equipe: ${bSellerName}`;
      baseContent.email = {
        templateType: 'business_invite',
        subject: `Convite para equipe — ${bSellerName}`,
        data: { ...data, userName: data.email || 'Futuro(a) colega', inviteLink: registerUrl, isNewUser: true },
      };

    } else if (type === 'support_ticket_created') {
      const title = data.ticketTitle || 'seu ticket';
      baseContent.in_app.content = `Seu ticket de suporte "${title}" foi criado. Prazo estimado: ${data.estimatedResolutionDate || 'em breve'}.`;
      baseContent.in_app.url = '/ajuda/chamados';
      baseContent.push.body = `Ticket criado: ${title}`;
      baseContent.push.url = '/ajuda/chamados';
      baseContent.email = {
        templateType: 'support_ticket_created',
        subject: `Ticket #${data.ticketId} criado — ${title}`,
        data: { ...data }
      };

    } else if (type === 'support_ticket_update') {
      const title = data.ticketTitle || 'seu ticket';
      baseContent.in_app.content = `Seu ticket "${title}" foi atualizado para: ${data.newStatus || 'em andamento'}.`;
      baseContent.in_app.url = '/ajuda/chamados';
      baseContent.push.body = `Ticket atualizado: ${title}`;
      baseContent.push.url = '/ajuda/chamados';
      baseContent.email = {
        templateType: 'support_ticket_update',
        subject: `Atualização no ticket #${data.ticketId} — ${title}`,
        data: { ...data }
      };

    } else if (type === 'support_ticket_resolved') {
      const title = data.ticketTitle || 'seu ticket';
      baseContent.in_app.content = `Seu ticket "${title}" foi resolvido! Confira o resumo.`;
      baseContent.in_app.url = '/ajuda/chamados';
      baseContent.push.body = `Ticket resolvido: ${title}`;
      baseContent.push.url = '/ajuda/chamados';
      baseContent.email = {
        templateType: 'support_ticket_resolved',
        subject: `Ticket #${data.ticketId} resolvido — ${title}`,
        data: { ...data }
      };

    // ── Wave 4: Webhook-enabled notification types ──
    } else if (type === 'pendencia_created') {
      baseContent.in_app.content = `Nova pendência criada: "${data.titulo}"`;
      baseContent.in_app.url = '/mercado/vendedor';
      baseContent.push.body = `Nova pendência: ${data.titulo}`;
      baseContent.push.url = '/mercado/vendedor';
      if (data.sellerId) baseContent.webhook = { event_type: 'pendencia.created', sellerId: data.sellerId, payload: { pendenciaId: data.pendenciaId, titulo: data.titulo, clientPhone: data.clientPhone, clientName: data.clientName } };
    } else if (type === 'pendencia_resolved') {
      baseContent.in_app.content = `Pendência "${data.titulo}" foi concluída`;
      baseContent.in_app.url = '/mercado/vendedor';
      if (data.sellerId) baseContent.webhook = { event_type: 'pendencia.resolved', sellerId: data.sellerId, payload: { pendenciaId: data.pendenciaId, titulo: data.titulo, clientPhone: data.clientPhone, clientName: data.clientName } };
    } else if (type === 'suspension_created') {
      baseContent.in_app.content = `Sua conta foi suspensa. Motivo: ${data.reason || 'Violação dos termos'}`;
      baseContent.in_app.url = '/ajuda/chamados';
      baseContent.push.body = 'Sua conta foi suspensa';
      baseContent.push.url = '/ajuda/chamados';
      baseContent.email = { templateType: 'padrao', subject: 'Conta suspensa', data: { content: `Sua conta na ElosCloud foi suspensa. Motivo: ${data.reason || 'Violação dos termos'}. Entre em contato pelo suporte se acredita que houve um erro.` } };
      if (data.sellerId) baseContent.webhook = { event_type: 'suspension.created', sellerId: data.sellerId, payload: { userId: data.userId, userName: data.userName, reason: data.reason, clientPhone: data.clientPhone } };
    } else if (type === 'trust_level_changed') {
      const levelName = data.levelName || `Nível ${data.newLevel}`;
      baseContent.in_app.content = `Seu nível de confiança mudou para: ${levelName}`;
      baseContent.in_app.url = '/confianca';
      baseContent.push.body = `Nível de confiança: ${levelName}`;
      baseContent.push.url = '/confianca';
      if (data.sellerId) baseContent.webhook = { event_type: 'trust.level_changed', sellerId: data.sellerId, payload: { userId: data.userId, userName: data.userName, newLevel: data.newLevel, levelName: data.levelName, clientPhone: data.clientPhone } };
    } else if (type === 'billing_overdue') {
      baseContent.in_app.content = 'Seu pagamento está em atraso. Regularize para evitar restrições.';
      baseContent.in_app.url = '/mercado/vendedor/configuracoes';
      baseContent.push.body = 'Pagamento em atraso';
      baseContent.push.url = '/mercado/vendedor/configuracoes';
      baseContent.email = { templateType: 'padrao', subject: 'Pagamento em atraso', data: { content: 'Seu pagamento na ElosCloud está em atraso. Regularize para evitar restrições de acesso.' } };
      if (data.sellerId) baseContent.webhook = { event_type: 'billing.overdue', sellerId: data.sellerId, payload: { sellerName: data.sellerName, clientPhone: data.clientPhone } };
    } else if (type === 'booking_no_show') {
      baseContent.in_app.content = `Cliente não compareceu ao agendamento`;
      baseContent.in_app.url = '/mercado/vendedor';
      baseContent.push.body = 'No-show: cliente não compareceu';
      baseContent.push.url = '/mercado/vendedor';
      if (data.sellerId) baseContent.webhook = { event_type: 'booking.no_show', sellerId: data.sellerId, payload: { bookingId: data.bookingId, bookingRef: data.bookingRef, clientName: data.clientName, clientPhone: data.clientPhone } };
    } else if (type === 'order_problem') {
      baseContent.in_app.content = `Problema reportado no pedido ${data.orderId || ''}`;
      baseContent.in_app.url = data.orderId ? `/mercado/pedidos/${data.orderId}` : '/mercado/pedidos';
      baseContent.push.body = 'Problema reportado no pedido';
      baseContent.push.url = data.orderId ? `/mercado/pedidos/${data.orderId}` : '/mercado/pedidos';
      baseContent.email = { templateType: 'padrao', subject: 'Problema em pedido', data: { content: `Um problema foi reportado no pedido ${data.orderId || ''}. Verifique na plataforma.` } };
      if (data.sellerId) baseContent.webhook = { event_type: 'order.problem', sellerId: data.sellerId, payload: { orderId: data.orderId, problemDescription: data.problemDescription, clientName: data.clientName, clientPhone: data.clientPhone } };
    } else if (type === 'delivery_stuck') {
      baseContent.in_app.content = `Entrega parada: ${data.reason || 'sem atualização'}`;
      baseContent.in_app.url = '/mercado/pedidos';
      baseContent.push.body = 'Entrega parada';
      baseContent.push.url = '/mercado/pedidos';
      if (data.sellerId) baseContent.webhook = { event_type: 'delivery.stuck', sellerId: data.sellerId, payload: { orderId: data.orderId, reason: data.reason, clientName: data.clientName, clientPhone: data.clientPhone } };

    // ── IconChat Billing ──────────────────────────────────
    } else if (type === 'iconchat_usage_warning') {
      const pct = data.pctUsed || data.thresholdPct || 80;
      baseContent.in_app.content = `Sua franquia IconChat está em ${pct}% (${data.messagesUsed || '?'}/${data.messagesQuota || '?'} mensagens)`;
      baseContent.in_app.url = '/mercado/vendedor/configuracoes';
      baseContent.push.title = 'IconChat — Franquia em uso';
      baseContent.push.body = `${pct}% da franquia de mensagens usada`;
      baseContent.push.url = '/mercado/vendedor/configuracoes';
      baseContent.email = { templateType: 'padrao', subject: `IconChat: ${pct}% da franquia utilizada`, data: { content: `Sua franquia de mensagens IconChat está em ${pct}%. Você usou ${data.messagesUsed || '?'} de ${data.messagesQuota || '?'} mensagens neste período. Considere fazer upgrade para ampliar sua franquia.` } };
    } else if (type === 'iconchat_usage_limit') {
      baseContent.in_app.content = `Franquia IconChat atingida (${data.messagesUsed || '?'}/${data.messagesQuota || '?'} mensagens). Considere fazer upgrade.`;
      baseContent.in_app.url = '/mercado/vendedor/configuracoes';
      baseContent.push.title = 'IconChat — Franquia atingida';
      baseContent.push.body = 'Sua franquia de mensagens foi atingida. Faça upgrade para continuar.';
      baseContent.push.url = '/mercado/vendedor/configuracoes';
      baseContent.email = { templateType: 'padrao', subject: 'IconChat: Franquia de mensagens atingida', data: { content: `Sua franquia de ${data.messagesQuota || '?'} mensagens IconChat foi atingida. A IA continuará respondendo até 150%, mas recomendamos fazer upgrade do seu plano para ampliar o limite.` } };
    } else if (type === 'iconchat_addon_deactivated') {
      baseContent.in_app.content = 'Seu add-on IconChat foi desativado conforme agendado.';
      baseContent.in_app.url = '/mercado/vendedor/configuracoes';
      baseContent.push.title = 'IconChat desativado';
      baseContent.push.body = 'Seu add-on IconChat foi desativado.';

    // ── Booking Reminders (RECALL-001) ─────────────────────────
    } else if (type === 'booking_reminder_1d') {
      baseContent.in_app.content = `Lembrete de agendamento: ${data.serviceName || 'Serviço'} é amanhã, ${data.date || ''} às ${data.time || ''}, em ${data.sellerName || 'Prestador'}`;
      baseContent.in_app.url = data.bookingId ? `/mercado/agendamentos` : '/mercado/agendamentos';
      baseContent.push = { title: `Lembrete: amanhã às ${data.time || ''}`, body: `${data.serviceName || 'Serviço'} em ${data.sellerName || 'Prestador'}`, url: '/mercado/agendamentos' };
      baseContent.email = { templateType: 'booking_reminder', subject: `Lembrete: ${data.serviceName || 'Serviço'} amanhã às ${data.time || ''}`, data: { ...data, reminderType: '1d' } };
      if (data.sellerId) baseContent.webhook = { event_type: 'booking.reminder', sellerId: data.sellerId, payload: { bookingId: data.bookingId, reminderType: '1d', clientName: data.clientName, clientPhone: data.clientPhone } };

    } else if (type === 'booking_reminder_2h') {
      baseContent.in_app.content = `Agendamento em 2 horas: ${data.serviceName || 'Serviço'} às ${data.time || ''}. Endereço: ${data.address || ''}`;
      baseContent.in_app.url = data.bookingId ? `/mercado/agendamentos` : '/mercado/agendamentos';
      baseContent.push = { title: `Em 2 horas: ${data.serviceName || 'Serviço'}`, body: `${data.sellerName || 'Prestador'} — ${data.address || ''}`, url: '/mercado/agendamentos' };
      baseContent.email = { templateType: 'booking_reminder', subject: `Em 2 horas: ${data.serviceName || 'Serviço'} às ${data.time || ''}`, data: { ...data, reminderType: '2h' } };
      if (data.sellerId) baseContent.webhook = { event_type: 'booking.reminder', sellerId: data.sellerId, payload: { bookingId: data.bookingId, reminderType: '2h', clientName: data.clientName, clientPhone: data.clientPhone } };

    // ── Recall Engine (RECALL-003) ────────────────────────────
    } else if (type === 'recall_return') {
      const msg = data.message || `Hora de voltar para ${data.sellerName || 'o negocio'}!`;
      baseContent.in_app.content = msg;
      baseContent.in_app.url = data.storeUrl || '/';
      baseContent.push = { title: 'Hora de voltar!', body: msg, url: data.storeUrl || '/' };
      baseContent.email = { templateType: 'recall_reminder', subject: `Hora de voltar para ${data.sellerName || 'o negocio'}!`, data: { sellerName: data.sellerName, serviceName: data.serviceName, daysSince: data.daysSince, message: msg, recallType: 'return', optoutUrl: data.optoutUrl } };
      if (data.sellerId) baseContent.webhook = { event_type: 'recall.reminder', sellerId: data.sellerId, payload: { clientPhone: data.clientPhone, clientName: data.clientName, sellerName: data.sellerName, serviceName: data.serviceName, daysSince: data.daysSince, message: msg, recallLogId: data.recallLogId, storeUrl: data.storeUrl, optoutUrl: data.optoutUrl } };

    } else if (type === 'recall_reorder') {
      const msg = data.message || `Hora de reabastecer em ${data.sellerName || 'o negocio'}!`;
      baseContent.in_app.content = msg;
      baseContent.in_app.url = data.storeUrl || '/';
      baseContent.push = { title: 'Hora de reabastecer!', body: msg, url: data.storeUrl || '/' };
      baseContent.email = { templateType: 'recall_reminder', subject: `Hora de reabastecer em ${data.sellerName || 'o negocio'}!`, data: { sellerName: data.sellerName, serviceName: data.serviceName, daysSince: data.daysSince, message: msg, recallType: 'reorder', optoutUrl: data.optoutUrl } };
      if (data.sellerId) baseContent.webhook = { event_type: 'recall.reminder', sellerId: data.sellerId, payload: { clientPhone: data.clientPhone, clientName: data.clientName, sellerName: data.sellerName, serviceName: data.serviceName, daysSince: data.daysSince, message: msg, recallLogId: data.recallLogId, storeUrl: data.storeUrl, optoutUrl: data.optoutUrl } };

    } else if (type === 'recall_no_show_followup') {
      const msg = data.message || `Sentimos sua falta! Agende novamente em ${data.sellerName || 'o negocio'}.`;
      baseContent.in_app.content = msg;
      baseContent.in_app.url = data.storeUrl || '/';
      baseContent.push = { title: 'Sentimos sua falta!', body: msg, url: data.storeUrl || '/' };
      baseContent.email = { templateType: 'recall_reminder', subject: `Sentimos sua falta em ${data.sellerName || 'o negocio'}!`, data: { sellerName: data.sellerName, serviceName: data.serviceName, daysSince: data.daysSince, message: msg, recallType: 'return', optoutUrl: data.optoutUrl } };
      if (data.sellerId) baseContent.webhook = { event_type: 'recall.reminder', sellerId: data.sellerId, payload: { clientPhone: data.clientPhone, clientName: data.clientName, sellerName: data.sellerName, serviceName: data.serviceName, daysSince: data.daysSince, message: msg, recallLogId: data.recallLogId, storeUrl: data.storeUrl, optoutUrl: data.optoutUrl } };

    // ── Agenda ────────────────────────────────────────────────
    } else if (type === 'agenda_task_assigned') {
      const dateStr = data.scheduled_at
        ? new Date(data.scheduled_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
        : '';
      baseContent.in_app.content = `Você tem uma nova tarefa agendada: "${data.title}"${dateStr ? ` em ${dateStr}` : ''}`;
      baseContent.in_app.url = '/mercado/agenda';
      baseContent.push.title = 'Nova tarefa agendada';
      baseContent.push.body = `${data.title}${dateStr ? ` — ${dateStr}` : ''}`;
      baseContent.push.url = '/mercado/agenda';

    } else if (data.emailSubject && data.emailContent) {
      baseContent.email = { templateType: 'padrao', subject: data.emailSubject, data: { content: data.emailContent } };
    }

    return baseContent;
  }

  /**
   * Processa um job de notificação.
   * @param {string} jobId
   * @param {Object} [cachedJob] - Job já carregado (evita re-leitura)
   */
  async processJob(jobId, cachedJob = null) {
    const supabase = sb();

    let job = cachedJob;

    if (!job && supabase) {
      // Atualização atômica: só processa se status for 'pending' ou 'retrying'
      const { data: updated } = await supabase
        .from('notification_jobs')
        .update({ status: 'processing', last_attempt_at: new Date().toISOString() })
        .in('status', ['pending', 'retrying'])
        .eq('id', jobId)
        .select()
        .single();

      if (!updated) return; // Já processado por outro processo
      job = { ...updated, userId: updated.user_id };
    } else if (!job) {
      logger.warn('processJob: sem Supabase e sem cachedJob', { jobId });
      return;
    }

    logger.info('Dispatcher: Processando Job', { service: 'NotificationDispatcher', jobId });

    const results = {};
    const user = await this._getUserWithPreferences(job.userId || job.user_id);

    for (const channel of (job.channels || [])) {
      try {
        if (channel === 'in_app' && job.content?.in_app) {
          const res = await notificationService.createNotification(
            job.userId || job.user_id,
            job.content.in_app
          );
          if (!res.success) throw new Error(res.message);
          results[channel] = { success: true };
        } else if (channel === 'email' && job.content?.email && (job.recipientEmail || job.recipient_email || user.email)) {
          const res = await emailService.sendEmail({
            to: job.recipientEmail || job.recipient_email || user.email,
            subject: job.content.email.subject,
            templateType: job.content.email.templateType,
            data: job.content.email.data,
            userId: job.userId || job.user_id,
            reference: job.metadata?.correlationId,
            referenceType: 'dispatcher_job'
          });
          if (!res.success) throw new Error(res.error);
          results[channel] = { success: true, externalId: res.messageId };
        } else if (channel === 'push' && job.content?.push) {
          const res = await pushService.sendToUser(
            job.userId || job.user_id,
            {
              title: job.content.push.title,
              body: job.content.push.body,
              url: job.content.push.url,
              type: job.type,
              jobId
            }
          );
          if (!res.success && res.error) throw new Error(res.error);
          results[channel] = { success: true, sent: res.sent };
        } else if (channel === 'webhook' && job.content?.webhook) {
          const res = await webhookOutboundService.dispatchForSeller(
            job.content.webhook.sellerId,
            job.content.webhook.event_type,
            job.content.webhook.payload
          );
          results[channel] = { success: res.success, eventId: res.eventId };
        }
      } catch (err) {
        logger.warn(`Dispatcher: Falha no canal ${channel}`, {
          service: 'NotificationDispatcher', jobId, channel, error: err.message
        });
        results[channel] = { success: false, error: err.message };
      }
    }

    const hasFailedChannel = Object.values(results).some(r => !r.success);
    const attemptCount = ((job.attempts || []).length) + 1;

    const newAttempt = { timestamp: new Date().toISOString(), results };

    if (supabase) {
      const updatePayload = {
        attempts: [...(job.attempts || []), newAttempt],
        last_attempt_at: new Date().toISOString()
      };

      if (hasFailedChannel) {
        if (attemptCount >= 3) {
          updatePayload.status = 'failed';
          updatePayload.completed_at = new Date().toISOString();
          logger.error('Dispatcher: Job falhou permanentemente', { service: 'NotificationDispatcher', jobId });
        } else {
          updatePayload.status = 'retrying';
          updatePayload.next_retry_at = new Date(Date.now() + 60000 * Math.pow(5, attemptCount)).toISOString();
        }
      } else {
        updatePayload.status = 'completed';
        updatePayload.completed_at = new Date().toISOString();
        logger.info('Dispatcher: Job completado com sucesso', { service: 'NotificationDispatcher', jobId });
      }

      await supabase
        .from('notification_jobs')
        .update(updatePayload)
        .eq('id', jobId);
    }
  }
  /**
   * Mapeia notification type interno para webhook event_type.
   * Retorna null se o tipo não deve gerar webhook.
   */
  _mapToWebhookEvent(type) {
    const map = {
      // Fiscal
      fiscal_prazo_7d: 'pendencia.deadline_approaching',
      fiscal_prazo_3d: 'pendencia.deadline_approaching',
      fiscal_prazo_1d: 'pendencia.deadline_approaching',
      fiscal_pendencia_vencida: 'pendencia.overdue',
      // Wave 4 — event map completo
      pendencia_created: 'pendencia.created',
      pendencia_resolved: 'pendencia.resolved',
      suspension_created: 'suspension.created',
      kyc_failed: 'kyc.rejected',
      trust_level_changed: 'trust.level_changed',
      billing_overdue: 'billing.overdue',
      booking_no_show: 'booking.no_show',
      order_problem: 'order.problem',
      delivery_stuck: 'delivery.stuck',
      // Booking reminders (RECALL-001)
      booking_reminder_1d: 'booking.reminder',
      booking_reminder_2h: 'booking.reminder',
      // Recall Engine (RECALL-003)
      recall_return: 'recall.reminder',
      recall_reorder: 'recall.reminder',
      recall_no_show_followup: 'recall.reminder',
    };
    return map[type] || null;
  }
}

module.exports = new NotificationDispatcher();
