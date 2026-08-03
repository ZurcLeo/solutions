const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const SERVICE = 'SubscriptionService';

// Cache do catálogo de planos (5 min TTL)
let _plansCache = null;
let _plansCacheAt = 0;
const PLANS_CACHE_TTL = 5 * 60 * 1000;

class SubscriptionService {
  // ──────────────────────────────────────────────────────────
  // Catálogo de planos
  // ──────────────────────────────────────────────────────────

  /**
   * Retorna planos do catálogo filtrados por tipo, com cache de 5 min.
   * @param {'lojista'|'entregador'} [planType] — filtra por tipo; null = todos
   */
  async getPlansFromCatalog(planType = null) {
    const now = Date.now();
    if (_plansCache && (now - _plansCacheAt) < PLANS_CACHE_TTL) {
      return planType ? _plansCache.filter(p => p.plan_type === planType) : _plansCache;
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) throw new Error(`[${SERVICE}] Erro ao buscar catálogo: ${error.message}`);

    _plansCache = data || [];
    _plansCacheAt = now;

    return planType ? _plansCache.filter(p => p.plan_type === planType) : _plansCache;
  }

  /**
   * Retorna um plano pelo slug.
   */
  async getPlanBySlug(slug) {
    const plans = await this.getPlansFromCatalog();
    return plans.find(p => p.slug === slug) || null;
  }

  // ──────────────────────────────────────────────────────────
  // Comissão centralizada
  // ──────────────────────────────────────────────────────────

  /**
   * Método central para determinar a taxa de comissão efetiva de um seller.
   * Ordem de precedência:
   *   1. Isenção ativa (commission_rate_override com cap mensal)
   *   2. Assinatura Brasileirinho ativa (commission_rate do plano, tipicamente 0)
   *   3. Default: 5% lojista / 8% entregador
   */
  async getCommissionRate(sellerUserId, { context = 'order' } = {}) {
    const supabase = getSupabaseClient();

    // 1. Verifica isenção ativa
    const { data: exemption } = await supabase
      .from('seller_exemptions')
      .select('id, commission_rate_override, monthly_cap_brl, total_commission_absorbed_brl')
      .eq('beneficiary_user_id', sellerUserId)
      .eq('status', 'active')
      .eq('is_activated', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (exemption) {
      // Verifica se o cap mensal não foi atingido
      const absorbed = Number(exemption.total_commission_absorbed_brl) || 0;
      const cap = Number(exemption.monthly_cap_brl) || 100;
      if (absorbed < cap) {
        return {
          rate: Number(exemption.commission_rate_override),
          source: 'exemption',
          exemptionId: exemption.id,
          remainingCap: cap - absorbed,
        };
      }
      // Cap atingido — cai pro próximo nível
    }

    // 2. Verifica assinatura Brasileirinho ativa
    const subscription = await this.getActiveSubscription(sellerUserId);
    if (subscription && subscription.plan_slug) {
      const plan = await this.getPlanBySlug(subscription.plan_slug);
      if (plan && plan.tier > 0) {
        return {
          rate: Number(plan.commission_rate) || 0,
          source: 'subscription',
          planSlug: plan.slug,
          planName: plan.name,
        };
      }
    }

    // 3. Default: busca o plano básico do seller
    const { data: seller } = await supabase
      .from('seller_profiles')
      .select('plan_slug, commission_rate')
      .eq('user_id', sellerUserId)
      .maybeSingle();

    const planSlug = seller?.plan_slug || 'lojista_basico';
    const plan = await this.getPlanBySlug(planSlug);
    const defaultRate = plan ? Number(plan.commission_rate) : 0.05;

    return {
      rate: defaultRate,
      source: 'default',
      planSlug,
    };
  }

  // ──────────────────────────────────────────────────────────
  // Recomendação de tier
  // ──────────────────────────────────────────────────────────

  /**
   * Algoritmo "Qual plano vale mais pra mim":
   * Calcula custo de cada plano lojista baseado no faturamento dos últimos 30 dias.
   */
  async getRecommendedTier(sellerUserId) {
    const supabase = getSupabaseClient();

    // Faturamento rolling 30 dias
    const { data: revenue30d, error: revErr } = await supabase
      .rpc('get_seller_rolling_revenue', { p_seller_user_id: sellerUserId });

    if (revErr) {
      logger.warn(`[${SERVICE}] Erro ao buscar faturamento`, { sellerUserId, error: revErr.message });
    }

    const revenue = Number(revenue30d) || 0;

    // Conta seats ativos
    const { data: sellerProfile } = await supabase
      .from('seller_profiles')
      .select('id')
      .eq('user_id', sellerUserId)
      .maybeSingle();

    let seatsAtivos = 0;
    if (sellerProfile) {
      const { count } = await supabase
        .from('seller_team_members')
        .select('id', { count: 'exact', head: true })
        .eq('seller_id', sellerProfile.id)
        .eq('status', 'active');
      seatsAtivos = count || 0;
    }

    // Planos lojista
    const plans = await this.getPlansFromCatalog('lojista');

    const analysis = plans.map(plan => {
      const extraSeats = Math.max(0, seatsAtivos - plan.included_seats);
      const seatCost = extraSeats * Number(plan.extra_seat_price_brl);
      let planCost;

      if (plan.tier === 0) {
        // Básico: comissão pura
        planCost = revenue * Number(plan.commission_rate);
      } else if (plan.tier <= 2) {
        // T1/T2: mensalidade fixa
        planCost = Number(plan.monthly_price_brl) + seatCost;
      } else {
        // T3: percentual com mínimo
        const percentCost = revenue * Number(plan.commission_rate);
        const minimum = Number(plan.minimum_monthly_brl) || 0;
        planCost = Math.max(percentCost, minimum) + seatCost;
      }

      planCost = Math.round(planCost * 100) / 100;
      const basicCost = revenue * 0.05;
      const savingsVsBasic = Math.round((basicCost - planCost) * 100) / 100;

      return {
        slug: plan.slug,
        name: plan.name,
        tier: plan.tier,
        cost: planCost,
        savings_vs_basic: savingsVsBasic,
        is_best: false,
      };
    });

    // Marca o mais barato como best
    if (analysis.length > 0) {
      const minCost = Math.min(...analysis.map(a => a.cost));
      const best = analysis.find(a => a.cost === minCost);
      if (best) best.is_best = true;
    }

    const recommended = analysis.find(a => a.is_best);

    return {
      revenue_30d: revenue,
      seats_ativos: seatsAtivos,
      analysis,
      recommended_slug: recommended?.slug || 'lojista_basico',
    };
  }

  // ──────────────────────────────────────────────────────────
  // Boost multiplier
  // ──────────────────────────────────────────────────────────

  /**
   * Retorna o multiplicador de boost do plano do seller (1.0 / 1.5 / 2.0).
   */
  async getBoostMultiplier(sellerUserId) {
    const subscription = await this.getActiveSubscription(sellerUserId);
    if (subscription?.plan_slug) {
      const plan = await this.getPlanBySlug(subscription.plan_slug);
      if (plan) return Number(plan.boost_multiplier) || 1.0;
    }
    return 1.0;
  }

  // ──────────────────────────────────────────────────────────
  // Tier eligibility check
  // ──────────────────────────────────────────────────────────

  /**
   * Verifica se o seller deveria considerar upgrade/downgrade.
   * Não faz auto-switch — apenas recomenda.
   */
  async checkTierEligibility(sellerUserId) {
    const recommendation = await this.getRecommendedTier(sellerUserId);
    const subscription = await this.getActiveSubscription(sellerUserId);
    const currentSlug = subscription?.plan_slug || 'lojista_basico';

    if (recommendation.recommended_slug === currentSlug) {
      return { action: 'keep', current: currentSlug, recommendation };
    }

    const currentPlan = await this.getPlanBySlug(currentSlug);
    const recommendedPlan = await this.getPlanBySlug(recommendation.recommended_slug);
    const currentTier = currentPlan?.tier ?? 0;
    const recommendedTier = recommendedPlan?.tier ?? 0;

    return {
      action: recommendedTier > currentTier ? 'upgrade' : 'downgrade',
      current: currentSlug,
      recommended: recommendation.recommended_slug,
      recommendation,
    };
  }

  // ──────────────────────────────────────────────────────────
  // Cobrança acumulada (modo básico)
  // ──────────────────────────────────────────────────────────

  /**
   * Acumula comissão no saldo do seller (modo básico).
   * Cobrança PIX/boleto a cada 30 dias OU ao atingir R$300.
   */
  async processBasicModeBilling(sellerUserId, commissionBrl) {
    if (commissionBrl <= 0) return null;

    const supabase = getSupabaseClient();

    // Upsert: cria se não existe, incrementa se existe
    const { data: existing } = await supabase
      .from('seller_billing_balance')
      .select('id, balance_brl, next_billing_at')
      .eq('seller_user_id', sellerUserId)
      .maybeSingle();

    if (!existing) {
      const { data, error } = await supabase
        .from('seller_billing_balance')
        .insert({
          seller_user_id: sellerUserId,
          balance_brl: commissionBrl,
          next_billing_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .select()
        .single();

      if (error) {
        logger.error(`[${SERVICE}] Erro ao criar billing balance`, { sellerUserId, error: error.message });
      }
      return data;
    }

    const newBalance = Math.round((Number(existing.balance_brl) + commissionBrl) * 100) / 100;

    const { data, error } = await supabase
      .from('seller_billing_balance')
      .update({ balance_brl: newBalance })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) {
      logger.error(`[${SERVICE}] Erro ao atualizar billing balance`, { sellerUserId, error: error.message });
    }

    return data;
  }

  /**
   * Verifica se o seller está bloqueado por inadimplência.
   */
  async isSellerBlocked(sellerUserId) {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('seller_billing_balance')
      .select('is_blocked')
      .eq('seller_user_id', sellerUserId)
      .maybeSingle();

    return data?.is_blocked === true;
  }

  // ──────────────────────────────────────────────────────────
  // Assinaturas (métodos existentes refatorados)
  // ──────────────────────────────────────────────────────────

  /**
   * Retorna a assinatura ativa do usuário (qualquer plano).
   */
  async getActiveSubscription(userId) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Erro ao buscar assinatura: ${error.message}`);
    }
    return data || null;
  }

  /**
   * Cria uma nova assinatura com base no slug do plano e ciclo de cobrança.
   * Retrocompatível: aceita (userId, plan, billingMode) legado ou (userId, planSlug, billingCycle, paymentId) novo.
   */
  async createSubscription(userId, planSlugOrPlan, billingCycleOrMode = 'monthly', paymentId = null, { actorId, actorType } = {}) {
    const supabase = getSupabaseClient();
    const now = new Date().toISOString();

    // Detecta formato legado vs novo
    const isLegacy = ['monthly', 'commission'].includes(billingCycleOrMode);
    let planSlug, billingCycle, billingMode, plan;

    if (isLegacy) {
      // Formato legado: createSubscription(userId, 'seller', 'monthly', paymentId)
      plan = planSlugOrPlan;
      billingMode = billingCycleOrMode;
      planSlug = billingMode === 'monthly' ? 'brasileirinho_t1' : 'lojista_basico';
      billingCycle = 'monthly';
    } else {
      // Formato novo: createSubscription(userId, 'brasileirinho_t1', 'monthly', paymentId)
      planSlug = planSlugOrPlan;
      billingCycle = billingCycleOrMode;
      plan = 'seller';
      billingMode = billingCycle === 'annual' ? 'monthly' : 'monthly';
    }

    const catalogPlan = await this.getPlanBySlug(planSlug);
    const tier = catalogPlan?.tier ?? 0;

    const isMonthly = tier > 0; // Tier > 0 = tem mensalidade

    // Calcula período
    const periodDays = billingCycle === 'annual' ? 365 : 30;

    const record = {
      user_id: userId,
      plan,
      billing_mode: isMonthly ? 'monthly' : 'commission',
      plan_slug: planSlug,
      billing_cycle: billingCycle,
      tier_at_creation: tier,
      status: 'active',
      payment_id: paymentId,
      subscribed_at: isMonthly ? now : null,
      current_period_start: isMonthly ? now : null,
      current_period_end: isMonthly
        ? new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000).toISOString()
        : null,
      created_at: now,
    };

    const { data, error } = await supabase
      .from('user_subscriptions')
      .insert(record)
      .select()
      .single();

    if (error) throw new Error(`Erro ao criar assinatura: ${error.message}`);

    // Atualiza plan_slug no seller_profiles
    await supabase
      .from('seller_profiles')
      .update({ plan_slug: planSlug })
      .eq('user_id', userId);

    logger.info(`[${SERVICE}] Assinatura criada`, {
      userId, planSlug, billingCycle, tier,
      actor_id: actorId || userId, actor_type: actorType || 'owner',
    });

    return data;
  }

  /**
   * Cancela assinatura ativa do usuário.
   */
  async cancelSubscription(userId, { actorId, actorType } = {}) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('user_subscriptions')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('status', 'active')
      .select()
      .single();

    if (error) throw new Error(`Erro ao cancelar assinatura: ${error.message}`);

    // Volta seller_profiles para lojista_basico
    await supabase
      .from('seller_profiles')
      .update({ plan_slug: 'lojista_basico', commission_rate: 0.05 })
      .eq('user_id', userId);

    logger.info(`[${SERVICE}] Assinatura cancelada`, {
      userId, subscriptionId: data?.id,
      actor_id: actorId || userId, actor_type: actorType || 'owner',
    });

    return data;
  }

  /**
   * Troca o tier/plano do seller (upgrade ou downgrade).
   */
  async changeTier(userId, newPlanSlug, paymentId = null, { actorId, actorType } = {}) {
    const plan = await this.getPlanBySlug(newPlanSlug);
    if (!plan) throw new Error('Plano não encontrado');

    // Cancela assinatura anterior se existir
    const existing = await this.getActiveSubscription(userId);
    const oldSlug = existing?.plan_slug || 'lojista_basico';

    if (existing) {
      const supabase = getSupabaseClient();
      await supabase
        .from('user_subscriptions')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', existing.id);
    }

    // Reconciliar add-ons (ex: T1+addon → T2: desativa addon)
    if (oldSlug !== newPlanSlug) {
      try {
        const addonService = require('./addonService');
        const { data: seller } = await getSupabaseClient()
          .from('seller_profiles')
          .select('id')
          .eq('user_id', userId)
          .maybeSingle();

        if (seller) {
          await addonService.reconcileAddonForPlanChange(userId, seller.id, oldSlug, newPlanSlug);
        }
      } catch (err) {
        logger.warn(`[${SERVICE}] Reconciliação de addon falhou (não-bloqueante)`, { userId, error: err.message });
      }
    }

    logger.info(`[${SERVICE}] Troca de tier`, {
      userId, oldSlug, newPlanSlug,
      actor_id: actorId || userId, actor_type: actorType || 'owner',
    });

    // Cria nova assinatura com o novo plano
    return this.createSubscription(userId, newPlanSlug, 'monthly', paymentId, { actorId, actorType });
  }

  /**
   * Verifica se a venda está coberta pelo plano (regra do mesmo dia).
   */
  async isSaleCoveredByPlan(userId, saleDate) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .rpc('is_sale_covered_by_plan', {
        p_user_id: userId,
        p_sale_date: saleDate instanceof Date ? saleDate.toISOString() : saleDate
      });

    if (error) {
      logger.warn('isSaleCoveredByPlan: erro na RPC', { userId, error: error.message });
      return false;
    }
    return data === true;
  }

  /**
   * Registra um evento de cobrança (imutável — auditoria).
   * Agora inclui plan_slug, exemption_id e delivery_request_id.
   */
  async recordBillingEvent({
    sellerUserId,
    orderId,
    billingMode,
    commissionRate,
    commissionBrl,
    subscriptionId,
    saleDate,
    subscribedAtDate,
    planSlug,
    exemptionId,
    deliveryRequestId,
  }) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('billing_events')
      .insert({
        seller_user_id: sellerUserId,
        order_id: orderId,
        billing_mode: billingMode,
        commission_rate: commissionRate,
        commission_brl: commissionBrl,
        subscription_id: subscriptionId || null,
        sale_date: saleDate,
        subscribed_at_date: subscribedAtDate || null,
        plan_slug: planSlug || null,
        exemption_id: exemptionId || null,
        delivery_request_id: deliveryRequestId || null,
      });

    if (error) {
      logger.error('recordBillingEvent: FALHOU ao registrar evento de cobrança', {
        sellerUserId, orderId, error: error.message
      });
    }
  }

  /**
   * Alterna o billing_mode entre 'monthly' e 'commission'.
   * Retrocompatível com sistema legado.
   */
  async updateBillingMode(userId, newBillingMode, paymentId = null) {
    const supabase = getSupabaseClient();
    const updates = {
      billing_mode: newBillingMode,
      payment_id: paymentId
    };

    if (newBillingMode === 'monthly') {
      // SECURITY: billing_mode 'monthly' implica brasileirinho_t1 (tier>0, pago)
      throw new Error('PAYMENT_REQUIRED: Planos pagos requerem pagamento confirmado.');
    } else {
      updates.subscribed_at = null;
      updates.current_period_start = null;
      updates.current_period_end = null;
      updates.plan_slug = 'lojista_basico';
    }

    const { data, error } = await supabase
      .from('user_subscriptions')
      .update(updates)
      .eq('user_id', userId)
      .eq('plan', 'seller')
      .eq('status', 'active')
      .select()
      .single();

    if (error) throw new Error(`Erro ao atualizar billing_mode: ${error.message}`);
    return data;
  }

  /**
   * Calcula a mensalidade total do seller (tier-aware).
   * Lê valores do catálogo subscription_plans em vez de constantes hardcoded.
   */
  async calcularMensalidade(sellerId) {
    const supabase = getSupabaseClient();

    // 1. Busca seller info
    const { data: seller, error: sellerErr } = await supabase
      .from('seller_profiles')
      .select('billing_mode, user_id, plan_slug')
      .eq('id', sellerId)
      .single();

    if (sellerErr || !seller) return null;
    if (seller.billing_mode !== 'monthly' && seller.billing_mode !== 'subscription') return null;

    const planSlug = seller.plan_slug || 'brasileirinho_t1';
    const plan = await this.getPlanBySlug(planSlug);
    if (!plan || plan.tier === 0) return null;

    // 2. Conta seats ativos
    const { count, error: countErr } = await supabase
      .from('seller_team_members')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', sellerId)
      .eq('status', 'active');

    if (countErr) {
      logger.warn('calcularMensalidade: erro ao contar seats', { sellerId, error: countErr.message });
      return null;
    }

    const seatsAtivos = count || 0;
    const seatsAdicionais = Math.max(0, seatsAtivos - plan.included_seats);
    const custoSeats = seatsAdicionais * Number(plan.extra_seat_price_brl);

    let mensalidadeBase;
    if (plan.tier <= 2) {
      // T1/T2: preço fixo
      mensalidadeBase = Number(plan.monthly_price_brl);
    } else {
      // T3: percentual com mínimo — precisa do faturamento
      const { data: revenue } = await supabase
        .rpc('get_seller_rolling_revenue', { p_seller_user_id: seller.user_id });
      const rev = Number(revenue) || 0;
      const percentCost = rev * Number(plan.commission_rate);
      mensalidadeBase = Math.max(percentCost, Number(plan.minimum_monthly_brl) || 75);
    }

    // 3. Custo de add-ons (ex: IconChat para T1)
    let custoAddons = 0;
    try {
      const addonService = require('./addonService');
      custoAddons = await addonService.getAddonsMonthlyCost(seller.user_id);
    } catch (err) {
      logger.warn('calcularMensalidade: erro ao calcular add-ons', { sellerId, error: err.message });
    }

    return {
      mensalidade_base: Math.round(mensalidadeBase * 100) / 100,
      plan_slug: planSlug,
      plan_name: plan.name,
      tier: plan.tier,
      seats_incluidos: plan.included_seats,
      seats_ativos: seatsAtivos,
      seats_adicionais: seatsAdicionais,
      custo_seats: Math.round(custoSeats * 100) / 100,
      custo_addons: Math.round(custoAddons * 100) / 100,
      total: Math.round((mensalidadeBase + custoSeats + custoAddons) * 100) / 100,
    };
  }

  /**
   * Retorna resumo de billing do seller (saldo, histórico, próx cobrança).
   */
  async getBillingSummary(sellerUserId) {
    const supabase = getSupabaseClient();

    const [
      { data: balance },
      { data: recentEvents },
      subscription,
    ] = await Promise.all([
      supabase
        .from('seller_billing_balance')
        .select('*')
        .eq('seller_user_id', sellerUserId)
        .maybeSingle(),
      supabase
        .from('billing_events')
        .select('*')
        .eq('seller_user_id', sellerUserId)
        .order('created_at', { ascending: false })
        .limit(20),
      this.getActiveSubscription(sellerUserId),
    ]);

    const recommendation = await this.getRecommendedTier(sellerUserId);

    return {
      subscription,
      balance: balance || { balance_brl: 0, is_blocked: false, unpaid_cycles: 0 },
      recent_events: recentEvents || [],
      recommendation,
    };
  }
}

module.exports = new SubscriptionService();
