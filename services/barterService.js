const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');
const gamificationService = require('./gamificationService');

class BarterService {
  /**
   * Cria um produto barter com débito de 50 EloCoins.
   * Atômico: se débito falhar, produto não é criado.
   */
  async createBarterProduct(userId, sellerId, productData) {
    const supabase = getSupabaseClient();

    // 1. Debitar 50 EloCoins como pedágio de seriedade
    // spend_elo_coins(p_user_id, p_amount, p_source, p_target_user_id, p_metadata)
    const { data: debitResult, error: debitError } = await supabase
      .rpc('spend_elo_coins', {
        p_user_id: userId,
        p_amount: 50,
        p_source: 'spend',
        p_target_user_id: null,
        p_metadata: {
          description: 'Pedágio para anúncio de troca (barter)',
          source: 'barter_listing'
        }
      });

    if (debitError || !debitResult) {
      const isInsufficientFunds = debitError?.message?.includes('insuficiente') ||
        debitError?.code === 'P0001';
      if (isInsufficientFunds) {
        const err = new Error('Saldo insuficiente para criar anúncio de troca');
        err.code = 'INSUFFICIENT_COINS';
        err.required = 50;
        throw err;
      }
      throw new Error(`Erro ao debitar EloCoins: ${debitError?.message}`);
    }

    // 2. Criar produto barter
    const { data: product, error: productError } = await supabase
      .from('marketplace_products')
      .insert({
        seller_id: sellerId,
        name: productData.name,
        description: productData.description,
        category: productData.category || 'servicos',
        price_brl: null,
        is_barter_only: true,
        wishlist: productData.wishlist || [],
        images: productData.images || [],
        active: true
      })
      .select()
      .single();

    if (productError) {
      logger.error('barterService.createBarterProduct: produto não criado após débito de coins', {
        userId, error: productError.message
      });
      throw new Error(`Produto não criado: ${productError.message}`);
    }

    // 3. Gamificação fire-and-forget
    gamificationService.triggerEvent('seller_registered', userId, {
      source: 'barter_listing',
      product_id: product.id
    }).catch(() => {});

    return product;
  }

  /**
   * Cria uma solicitação de troca com débito de 50 EloCoins.
   * A idempotência é garantida via UNIQUE constraint em trade_requests.coins_idempotency_key.
   */
  async createTradeRequest(requesterId, productId, offerDescription, offerProductId = null) {
    const supabase = getSupabaseClient();

    // 1. Verificar produto existe e é barter_only
    const { data: product, error: productError } = await supabase
      .from('marketplace_products')
      .select('id, is_barter_only, seller_id, active')
      .eq('id', productId)
      .single();

    if (productError || !product) {
      throw Object.assign(new Error('Produto não encontrado'), { code: 'PRODUCT_NOT_FOUND' });
    }
    if (!product.is_barter_only) {
      throw Object.assign(new Error('Produto não disponível para troca'), { code: 'NOT_BARTER_PRODUCT' });
    }
    if (!product.active) {
      throw Object.assign(new Error('Produto indisponível'), { code: 'PRODUCT_INACTIVE' });
    }

    // 2. Verificar que solicitante não é o dono do produto
    const { data: sellerProfile } = await supabase
      .from('seller_profiles')
      .select('user_id')
      .eq('id', product.seller_id)
      .single();

    if (sellerProfile?.user_id === requesterId) {
      throw Object.assign(new Error('Você não pode solicitar troca do próprio produto'), {
        code: 'SELF_TRADE_NOT_ALLOWED'
      });
    }

    // 3. Chave de idempotência: evita solicitações duplicadas para o mesmo produto
    const idempotencyKey = `barter_req_${productId}_${requesterId}`;

    // 3a. Verificar se já existe solicitação com esta chave (duplicada)
    const { data: existingRequest } = await supabase
      .from('trade_requests')
      .select('id, status')
      .eq('coins_idempotency_key', idempotencyKey)
      .single();

    if (existingRequest) {
      throw Object.assign(
        new Error('Você já fez uma solicitação de troca para este produto'),
        { code: 'DUPLICATE_TRADE_REQUEST' }
      );
    }

    // 4. Débito de 50 EloCoins
    // Idempotência primária: RPC verifica p_idempotency_key em xp_events antes de debitar.
    // Backup: UNIQUE constraint em trade_requests.coins_idempotency_key.
    const { data: debitResult, error: debitError } = await supabase
      .rpc('spend_elo_coins', {
        p_user_id: requesterId,
        p_amount: 50,
        p_source: 'spend',
        p_target_user_id: null,
        p_metadata: {
          description: 'Pedágio para solicitação de troca',
          source: 'barter_request',
          product_id: productId
        },
        p_idempotency_key: idempotencyKey
      });

    if (debitError || !debitResult) {
      const isInsufficientFunds = debitError?.message?.includes('insuficiente') ||
        debitError?.code === 'P0001';
      if (isInsufficientFunds) {
        throw Object.assign(new Error('Saldo insuficiente para solicitar troca'), {
          code: 'INSUFFICIENT_COINS',
          required: 50
        });
      }
      throw new Error(`Erro ao debitar EloCoins: ${debitError?.message}`);
    }

    // 5. Inserir trade_request
    const { data: tradeRequest, error: insertError } = await supabase
      .from('trade_requests')
      .insert({
        product_id: productId,
        requester_id: requesterId,
        offer_description: offerDescription,
        offer_product_id: offerProductId || null,
        coins_paid: 50,
        coins_idempotency_key: idempotencyKey,
        status: 'pending'
      })
      .select()
      .single();

    if (insertError) {
      logger.error('barterService.createTradeRequest: insert falhou após débito de coins', {
        requesterId, productId, error: insertError.message
      });
      throw new Error(`Solicitação não criada: ${insertError.message}`);
    }

    return tradeRequest;
  }

  /**
   * Aceita uma solicitação de troca.
   * Gamificação para ambas as partes.
   */
  async acceptTradeRequest(ownerId, tradeRequestId) {
    const supabase = getSupabaseClient();

    // 1. Buscar trade_request e verificar ownership
    const { data: tr, error: fetchError } = await supabase
      .from('trade_requests')
      .select('*, marketplace_products(seller_id, seller_profiles(user_id))')
      .eq('id', tradeRequestId)
      .single();

    if (fetchError || !tr) {
      throw Object.assign(new Error('Solicitação não encontrada'), { code: 'NOT_FOUND' });
    }
    if (tr.status !== 'pending') {
      throw Object.assign(new Error(`Solicitação já está ${tr.status}`), { code: 'INVALID_STATUS' });
    }

    const productOwnerId = tr.marketplace_products?.seller_profiles?.user_id;
    if (productOwnerId !== ownerId) {
      throw Object.assign(new Error('Sem permissão para aceitar esta solicitação'), { code: 'FORBIDDEN' });
    }

    // 2. Atualizar status
    const { data: updated, error: updateError } = await supabase
      .from('trade_requests')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', tradeRequestId)
      .select()
      .single();

    if (updateError) throw new Error(`Erro ao aceitar troca: ${updateError.message}`);

    // 3. Gamificação fire-and-forget para ambas as partes
    gamificationService.triggerEvent('barter_completed', tr.requester_id, {
      trade_request_id: tradeRequestId
    }).catch(() => {});

    gamificationService.triggerEvent('barter_accepted', ownerId, {
      trade_request_id: tradeRequestId
    }).catch(() => {});

    return updated;
  }

  /**
   * Rejeita uma solicitação de troca.
   */
  async rejectTradeRequest(ownerId, tradeRequestId, reason = null) {
    const supabase = getSupabaseClient();

    const { data: tr } = await supabase
      .from('trade_requests')
      .select('status, marketplace_products(seller_profiles(user_id))')
      .eq('id', tradeRequestId)
      .single();

    if (!tr || tr.status !== 'pending') {
      throw Object.assign(new Error('Solicitação não encontrada ou já processada'), { code: 'INVALID_STATUS' });
    }

    const productOwnerId = tr.marketplace_products?.seller_profiles?.user_id;
    if (productOwnerId !== ownerId) {
      throw Object.assign(new Error('Sem permissão'), { code: 'FORBIDDEN' });
    }

    const { data, error } = await supabase
      .from('trade_requests')
      .update({
        status: 'rejected',
        rejected_reason: reason,
        updated_at: new Date().toISOString()
      })
      .eq('id', tradeRequestId)
      .select()
      .single();

    if (error) throw new Error(`Erro ao rejeitar troca: ${error.message}`);
    return data;
  }

  /**
   * Cancela uma solicitação de troca (apenas pelo solicitante, apenas se pending).
   * NÃO reembolsa EloCoins — pedágio de seriedade intencional.
   */
  async cancelTradeRequest(requesterId, tradeRequestId) {
    const supabase = getSupabaseClient();

    const { data: tr } = await supabase
      .from('trade_requests')
      .select('status, requester_id')
      .eq('id', tradeRequestId)
      .single();

    if (!tr) {
      throw Object.assign(new Error('Solicitação não encontrada'), { code: 'NOT_FOUND' });
    }
    if (tr.requester_id !== requesterId) {
      throw Object.assign(new Error('Sem permissão para cancelar esta solicitação'), { code: 'FORBIDDEN' });
    }
    if (tr.status !== 'pending') {
      throw Object.assign(new Error(`Não é possível cancelar solicitação com status ${tr.status}`), {
        code: 'INVALID_STATUS'
      });
    }

    const { data, error } = await supabase
      .from('trade_requests')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', tradeRequestId)
      .select()
      .single();

    if (error) throw new Error(`Erro ao cancelar troca: ${error.message}`);

    // Aviso: EloCoins NÃO são reembolsados (decisão de produto)
    logger.info('barterService.cancelTradeRequest: solicitação cancelada, coins não reembolsados', {
      requesterId, tradeRequestId
    });

    return data;
  }

  /**
   * Lista solicitações de troca do usuário (como solicitante OU como dono de produto).
   */
  async listTradeRequests(userId, role = 'both') {
    const supabase = getSupabaseClient();

    let query = supabase
      .from('trade_requests')
      .select(`
        *,
        marketplace_products(id, name, images, wishlist, seller_id,
          seller_profiles(id, business_name, user_id)
        )
      `)
      .order('created_at', { ascending: false });

    if (role === 'requester') {
      query = query.eq('requester_id', userId);
    } else if (role === 'owner') {
      // Produtos do usuário
      const { data: sellerProfile } = await supabase
        .from('seller_profiles')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (!sellerProfile) return [];

      const { data: productIds } = await supabase
        .from('marketplace_products')
        .select('id')
        .eq('seller_id', sellerProfile.id);

      const ids = (productIds || []).map(p => p.id);
      if (ids.length === 0) return [];

      query = query.in('product_id', ids);
    } else {
      // both: solicitações enviadas OU recebidas
      const { data: sellerProfile } = await supabase
        .from('seller_profiles')
        .select('id')
        .eq('user_id', userId)
        .single();

      const productIds = [];
      if (sellerProfile) {
        const { data: products } = await supabase
          .from('marketplace_products')
          .select('id')
          .eq('seller_id', sellerProfile.id);
        productIds.push(...(products || []).map(p => p.id));
      }

      if (productIds.length > 0) {
        query = query.or(`requester_id.eq.${userId},product_id.in.(${productIds.join(',')})`);
      } else {
        query = query.eq('requester_id', userId);
      }
    }

    const { data, error } = await query;
    if (error) throw new Error(`Erro ao listar trocas: ${error.message}`);
    return data || [];
  }
}

module.exports = new BarterService();
