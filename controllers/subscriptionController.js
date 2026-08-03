const subscriptionService = require('../services/subscriptionService');
const exemptionService = require('../services/exemptionService');
const addonService = require('../services/addonService');
const { logger } = require('../logger');

/**
 * Resolve CPF do usuário a partir do campo cpf_encrypted.
 * Retorna { cpf, cpfLast4 } ou { cpf: null, cpfLast4: null }.
 */
async function _resolveUserCpf(userId) {
  const { getSupabaseClient } = require('../config/supabase');
  const encryptionService = require('../services/encryptionService');
  const supabase = getSupabaseClient();

  const { data: row } = await supabase
    .from('users')
    .select('cpf_encrypted, cpf_last4')
    .eq('id', userId)
    .maybeSingle();

  if (!row?.cpf_encrypted) return { cpf: null, cpfLast4: row?.cpf_last4 || null };

  try {
    const parsed = typeof row.cpf_encrypted === 'string'
      ? JSON.parse(row.cpf_encrypted)
      : row.cpf_encrypted;
    const cpf = String(await encryptionService.decrypt(parsed, { dataType: 'cpf', aad: userId }));
    return { cpf, cpfLast4: row.cpf_last4 || cpf.slice(-4) };
  } catch (err) {
    logger.warn('_resolveUserCpf: falha ao decriptar', { userId, error: err.message });
    return { cpf: null, cpfLast4: row?.cpf_last4 || null };
  }
}

/**
 * Resolve actor context from request for audit logging.
 * If sellerContext exists (team member access), actor is the team member.
 * Otherwise, actor is the authenticated user (owner).
 */
function _resolveActorContext(req) {
  const ctx = req.sellerContext;
  if (ctx && ctx.role !== 'owner') {
    return { actorId: req.user.uid, actorType: 'team_member' };
  }
  return { actorId: req.user.uid, actorType: 'owner' };
}

/**
 * Calcula o valor da assinatura com base no plano e ciclo.
 */
function _calcSubscriptionValue(plan, billingCycle) {
  if (billingCycle === 'annual' && plan.annual_price_brl) {
    return Number(plan.annual_price_brl);
  } else if (plan.monthly_price_brl > 0) {
    return Number(plan.monthly_price_brl);
  }
  return Number(plan.minimum_monthly_brl) || 75;
}

/**
 * Cria cobrança no Asaas (PIX ou cartão) para assinatura de plano pago.
 * Chamado SOMENTE após o usuário confirmar o checkout no frontend.
 */
async function _createSubscriptionCharge(userId, plan, billingCycle, paymentMethod, cpfCnpj, creditCard, creditCardHolderInfo, remoteIp) {
  const asaasService = require('../services/asaasService');
  const { getSupabaseClient } = require('../config/supabase');
  const supabase = getSupabaseClient();

  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('id, full_name, email, telefone')
    .eq('id', userId)
    .maybeSingle();

  if (userErr || !user) {
    logger.error('_createSubscriptionCharge: usuário não encontrado', { userId, error: userErr?.message });
    throw new Error('Usuário não encontrado');
  }

  // Resolver CPF: usa o fornecido ou decripta do banco
  let resolvedCpf = cpfCnpj;
  if (!resolvedCpf) {
    const { cpf } = await _resolveUserCpf(userId);
    resolvedCpf = cpf;
  }

  if (!resolvedCpf) {
    throw Object.assign(
      new Error('CPF/CNPJ obrigatório. Complete sua verificação de identidade (KYC) antes de assinar.'),
      { code: 'CPF_REQUIRED' }
    );
  }

  // Criar/buscar customer no Asaas
  const customer = await asaasService.createCustomer({
    name: user.full_name || 'Vendedor ElosCloud',
    email: user.email,
    cpfCnpj: resolvedCpf.replace(/\D/g, ''),
    phone: user.telefone || undefined,
    externalReference: userId,
  });

  const value = _calcSubscriptionValue(plan, billingCycle);
  const periodLabel = billingCycle === 'annual' ? 'anual' : 'mensal';
  const externalReference = `subscription:${userId}:${plan.slug}:${billingCycle}`;

  let charge;
  if (paymentMethod === 'credit_card') {
    // Cartão recorrente: checkout transparente via POST /subscriptions
    if (!creditCard || !creditCardHolderInfo) {
      throw Object.assign(
        new Error('Dados do cartão são obrigatórios para pagamento com cartão de crédito.'),
        { code: 'CARD_DATA_REQUIRED' }
      );
    }

    // Enriquecer creditCardHolderInfo com dados do cadastro se ausentes
    const enrichedHolderInfo = { ...creditCardHolderInfo };
    if (!enrichedHolderInfo.cpfCnpj) {
      enrichedHolderInfo.cpfCnpj = resolvedCpf.replace(/\D/g, '');
    }
    if (!enrichedHolderInfo.name) {
      enrichedHolderInfo.name = user.full_name || creditCard.holderName || 'Titular';
    }
    if (!enrichedHolderInfo.email) {
      enrichedHolderInfo.email = user.email;
    }
    if (!enrichedHolderInfo.phone && user.telefone) {
      enrichedHolderInfo.phone = user.telefone.replace(/\D/g, '');
    }

    const sub = await asaasService.createCardSubscription({
      customer: customer.id,
      value,
      cycle: billingCycle === 'annual' ? 'YEARLY' : 'MONTHLY',
      description: `${plan.name} (${periodLabel}) — ElosCloud`,
      externalReference,
      creditCard,
      creditCardHolderInfo: enrichedHolderInfo,
      remoteIp,
    });

    // Se o primeiro pagamento já foi confirmado, ativar assinatura imediatamente
    const confirmedStatuses = ['ACTIVE', 'CONFIRMED', 'RECEIVED'];
    if (confirmedStatuses.includes(sub.status)) {
      await subscriptionService.createSubscription(userId, plan.slug, billingCycle, sub.subscriptionId);
      logger.info('Assinatura ativada imediatamente via cartão', {
        service: 'subscriptionController', userId, subscriptionId: sub.subscriptionId,
      });
    }

    charge = { id: sub.subscriptionId, status: sub.status };
  } else {
    // PIX (default)
    charge = await asaasService.createPixCharge({
      customerId: customer.id,
      value,
      description: `${plan.name} (${periodLabel}) — ElosCloud`,
      externalReference,
    });
  }

  logger.info('Cobrança de assinatura criada', {
    service: 'subscriptionController',
    userId, planSlug: plan.slug, billingCycle, paymentMethod,
    paymentId: charge.id || charge.paymentId, value,
  });

  return {
    paymentId: charge.id || charge.paymentId,
    subscriptionId: charge.subscriptionId || null,
    pixCopiaECola: charge.pixCopiaECola || null,
    encodedImage: charge.encodedImage || null,
    checkoutUrl: charge.checkoutUrl || null,
    value,
    planSlug: plan.slug,
    planName: plan.name,
    billingCycle,
    paymentMethod,
    status: charge.status || 'PENDING',
    expirationDate: charge.expirationDate || null,
  };
}

const subscriptionController = {
  // ──────────────────────────────────────────────────────────
  // Endpoints existentes (retrocompatíveis)
  // ──────────────────────────────────────────────────────────

  /**
   * GET /api/subscriptions/my
   * Retorna a assinatura ativa do usuário autenticado.
   */
  async getMy(req, res) {
    try {
      const subscription = await subscriptionService.getActiveSubscription(req.user.uid);
      res.json({
        subscription: subscription || { plan: 'free', billing_mode: 'commission', status: 'none' }
      });
    } catch (err) {
      logger.error('subscriptionController.getMy error', { error: err.message });
      res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
    }
  },

  /**
   * POST /api/subscriptions/seller
   * Seleciona plano de assinatura.
   * Body: { plan_slug, billing_cycle, payment_id } (v2.1)
   *    OU { billing_mode, payment_id } (legado)
   *
   * Para planos pagos (tier > 0): retorna requiresCheckout com dados do plano.
   * Para plano básico (tier 0): ativa imediatamente.
   */
  async createSeller(req, res) {
    try {
      const { billing_mode, plan_slug, billing_cycle, payment_id } = req.body;

      // Verificar se já tem assinatura ativa
      const existing = await subscriptionService.getActiveSubscription(req.user.uid);
      if (existing && existing.plan === 'seller' && existing.status === 'active') {
        return res.status(409).json({
          code: 'SUBSCRIPTION_EXISTS',
          message: 'Você já possui uma assinatura de vendedor ativa',
          subscription: existing
        });
      }

      if (plan_slug) {
        const plan = await subscriptionService.getPlanBySlug(plan_slug);
        if (!plan) {
          return res.status(400).json({ code: 'INVALID_PLAN', message: 'Plano não encontrado' });
        }

        const cycle = billing_cycle || 'monthly';
        if (!['monthly', 'annual'].includes(cycle)) {
          return res.status(400).json({ code: 'INVALID_CYCLE', message: "billing_cycle deve ser 'monthly' ou 'annual'" });
        }

        if (cycle === 'annual' && !plan.annual_price_brl) {
          return res.status(400).json({ code: 'ANNUAL_NOT_AVAILABLE', message: 'Plano anual não disponível para este plano' });
        }

        // Planos pagos: retorna dados para o frontend exibir checkout
        if (plan.tier > 0 && !payment_id) {
          const value = _calcSubscriptionValue(plan, cycle);
          const { cpfLast4 } = await _resolveUserCpf(req.user.uid);
          return res.status(200).json({
            requiresCheckout: true,
            plan: { slug: plan.slug, name: plan.name, tier: plan.tier },
            billingCycle: cycle,
            value,
            cpfLast4: cpfLast4 || null,
            hasCpf: !!cpfLast4,
          });
        }

        // Plano básico ou plano pago já confirmado (payment_id fornecido)
        const actorCtx = _resolveActorContext(req);
        const subscription = await subscriptionService.createSubscription(
          req.user.uid, plan_slug, cycle, payment_id || null, actorCtx
        );
        return res.status(201).json({ subscription });
      } else {
        // Formato legado
        if (!billing_mode || !['monthly', 'commission'].includes(billing_mode)) {
          return res.status(400).json({
            code: 'INVALID_BILLING_MODE',
            message: "billing_mode deve ser 'monthly' ou 'commission'"
          });
        }

        if (billing_mode === 'monthly') {
          const plan = await subscriptionService.getPlanBySlug('brasileirinho_t1');
          if (plan) {
            const value = _calcSubscriptionValue(plan, 'monthly');
            const { cpfLast4 } = await _resolveUserCpf(req.user.uid);
            return res.status(200).json({
              requiresCheckout: true,
              plan: { slug: plan.slug, name: plan.name, tier: plan.tier },
              billingCycle: 'monthly',
              value,
              cpfLast4: cpfLast4 || null,
              hasCpf: !!cpfLast4,
            });
          }
        }

        const actorCtxLegacy = _resolveActorContext(req);
        const subscription = await subscriptionService.createSubscription(
          req.user.uid, 'seller', billing_mode, payment_id || null, actorCtxLegacy
        );
        return res.status(201).json({ subscription });
      }
    } catch (err) {
      logger.error('subscriptionController.createSeller error', { error: err.message });
      res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
    }
  },

  /**
   * PATCH /api/subscriptions/billing-mode
   * Alterna entre 'monthly' e 'commission'.
   */
  async updateBillingMode(req, res) {
    try {
      const { billing_mode, payment_id } = req.body;

      if (!billing_mode || !['monthly', 'commission'].includes(billing_mode)) {
        return res.status(400).json({
          code: 'INVALID_BILLING_MODE',
          message: "billing_mode deve ser 'monthly' ou 'commission'"
        });
      }

      // billing_mode 'monthly' = plano pago → retorna dados para checkout
      if (billing_mode === 'monthly' && !payment_id) {
        const plan = await subscriptionService.getPlanBySlug('brasileirinho_t1');
        if (plan) {
          const value = _calcSubscriptionValue(plan, 'monthly');
          const { cpfLast4 } = await _resolveUserCpf(req.user.uid);
          return res.status(200).json({
            requiresCheckout: true,
            plan: { slug: plan.slug, name: plan.name, tier: plan.tier },
            billingCycle: 'monthly',
            value,
            cpfLast4: cpfLast4 || null,
            hasCpf: !!cpfLast4,
          });
        }
      }

      const subscription = await subscriptionService.updateBillingMode(
        req.user.uid, billing_mode, payment_id || null
      );

      res.json({ subscription });
    } catch (err) {
      logger.error('subscriptionController.updateBillingMode error', { error: err.message });
      res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
    }
  },

  /**
   * POST /api/subscriptions/cancel
   * Cancela assinatura ativa.
   */
  async cancel(req, res) {
    try {
      const actorCtx = _resolveActorContext(req);
      const subscription = await subscriptionService.cancelSubscription(req.user.uid, actorCtx);
      res.json({ subscription, message: 'Assinatura cancelada com sucesso' });
    } catch (err) {
      logger.error('subscriptionController.cancel error', { error: err.message });
      res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
    }
  },

  // ──────────────────────────────────────────────────────────
  // Novos endpoints v2.1
  // ──────────────────────────────────────────────────────────

  /**
   * GET /api/subscriptions/plans
   * Catálogo de planos (público).
   */
  async getPlans(req, res) {
    try {
      const { type } = req.query; // 'lojista' | 'entregador' | undefined
      const plans = await subscriptionService.getPlansFromCatalog(type || null);
      res.json({ plans });
    } catch (err) {
      logger.error('subscriptionController.getPlans error', { error: err.message });
      res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
    }
  },

  /**
   * GET /api/subscriptions/recommend
   * "Qual plano vale mais" — análise com faturamento real (auth).
   */
  async getRecommendation(req, res) {
    try {
      const recommendation = await subscriptionService.getRecommendedTier(req.user.uid);
      res.json(recommendation);
    } catch (err) {
      logger.error('subscriptionController.getRecommendation error', { error: err.message });
      res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
    }
  },

  /**
   * PATCH /api/subscriptions/tier
   * Trocar tier (upgrade/downgrade).
   * Body: { plan_slug: string, payment_id?: string, billing_cycle?: string }
   */
  async changeTier(req, res) {
    try {
      const { plan_slug, payment_id } = req.body;

      if (!plan_slug) {
        return res.status(400).json({ code: 'MISSING_PLAN', message: 'plan_slug é obrigatório' });
      }

      const plan = await subscriptionService.getPlanBySlug(plan_slug);
      if (!plan) {
        return res.status(400).json({ code: 'INVALID_PLAN', message: 'Plano não encontrado' });
      }

      // Planos pagos sem payment_id: retorna dados para checkout
      if (plan.tier > 0 && !payment_id) {
        const cycle = req.body.billing_cycle || 'monthly';
        const value = _calcSubscriptionValue(plan, cycle);
        const { cpfLast4 } = await _resolveUserCpf(req.user.uid);
        return res.status(200).json({
          requiresCheckout: true,
          plan: { slug: plan.slug, name: plan.name, tier: plan.tier },
          billingCycle: cycle,
          value,
          cpfLast4: cpfLast4 || null,
          hasCpf: !!cpfLast4,
        });
      }

      // Plano básico ou com payment_id (já pagou)
      const actorCtx = _resolveActorContext(req);
      const subscription = await subscriptionService.changeTier(
        req.user.uid, plan_slug, payment_id || null, actorCtx
      );

      res.json({ subscription, message: `Plano alterado para ${plan.name}` });
    } catch (err) {
      logger.error('subscriptionController.changeTier error', { error: err.message });
      res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
    }
  },

  /**
   * POST /api/subscriptions/checkout
   * Gera cobrança no Asaas após o usuário confirmar no modal de checkout.
   * Body: { plan_slug, billing_cycle, payment_method: 'pix'|'credit_card' }
   */
  async checkout(req, res) {
    try {
      const { plan_slug, billing_cycle, payment_method, credit_card, credit_card_holder_info } = req.body;

      if (!plan_slug) {
        return res.status(400).json({ code: 'MISSING_PLAN', message: 'plan_slug é obrigatório' });
      }
      if (!payment_method || !['pix', 'credit_card'].includes(payment_method)) {
        return res.status(400).json({ code: 'INVALID_METHOD', message: "payment_method deve ser 'pix' ou 'credit_card'" });
      }

      const plan = await subscriptionService.getPlanBySlug(plan_slug);
      if (!plan) {
        return res.status(400).json({ code: 'INVALID_PLAN', message: 'Plano não encontrado' });
      }

      const cycle = billing_cycle || 'monthly';
      const remoteIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
      const checkout = await _createSubscriptionCharge(
        req.user.uid, plan, cycle, payment_method, null,
        credit_card, credit_card_holder_info, remoteIp
      );
      return res.status(200).json({ checkout });
    } catch (err) {
      logger.error('subscriptionController.checkout error', { error: err.message, code: err.code });
      const status = err.code === 'CPF_REQUIRED' ? 422
        : err.code === 'CARD_DATA_REQUIRED' ? 400
        : 500;
      res.status(status).json({ code: err.code || 'INTERNAL_ERROR', message: err.message });
    }
  },

  /**
   * GET /api/subscriptions/billing-summary
   * Saldo, histórico, próxima cobrança.
   */
  async getBillingSummary(req, res) {
    try {
      const summary = await subscriptionService.getBillingSummary(req.user.uid);
      res.json(summary);
    } catch (err) {
      logger.error('subscriptionController.getBillingSummary error', { error: err.message });
      res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
    }
  },

  // ──────────────────────────────────────────────────────────
  // Isenções
  // ──────────────────────────────────────────────────────────

  /**
   * GET /api/subscriptions/exemptions/my
   * Minhas isenções ativas (como beneficiário).
   */
  async getMyExemptions(req, res) {
    try {
      const exemptions = await exemptionService.getExemptionSummary(req.user.uid);
      res.json({ exemptions });
    } catch (err) {
      logger.error('subscriptionController.getMyExemptions error', { error: err.message });
      res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
    }
  },

  /**
   * POST /api/subscriptions/exemptions
   * Criar isenção (sponsor).
   * Body: { beneficiary_user_id, exemption_level, beneficiary_type }
   */
  async createExemption(req, res) {
    try {
      const { beneficiary_user_id, exemption_level, beneficiary_type } = req.body;

      if (!beneficiary_user_id || !exemption_level || !beneficiary_type) {
        return res.status(400).json({
          code: 'MISSING_FIELDS',
          message: 'beneficiary_user_id, exemption_level e beneficiary_type são obrigatórios'
        });
      }

      if (!['n1_fundador', 'n2_rede', 'guardiao'].includes(exemption_level)) {
        return res.status(400).json({
          code: 'INVALID_LEVEL',
          message: "exemption_level deve ser 'n1_fundador', 'n2_rede' ou 'guardiao'"
        });
      }

      if (!['lojista', 'entregador'].includes(beneficiary_type)) {
        return res.status(400).json({
          code: 'INVALID_TYPE',
          message: "beneficiary_type deve ser 'lojista' ou 'entregador'"
        });
      }

      const exemption = await exemptionService.createExemption(
        req.user.uid, beneficiary_user_id, exemption_level, beneficiary_type
      );

      res.status(201).json({ exemption });
    } catch (err) {
      logger.error('subscriptionController.createExemption error', { error: err.message });
      const status = err.message.includes('Limite') || err.message.includes('selo') ? 403 : 500;
      res.status(status).json({ code: 'EXEMPTION_ERROR', message: err.message });
    }
  },

  // ──────────────────────────────────────────────────────────
  // Add-ons (IconChat billing module)
  // ──────────────────────────────────────────────────────────

  /**
   * POST /api/subscriptions/addon
   * Ativa ou desativa add-on IconChat.
   * Body: { action: 'activate'|'deactivate', billing_cycle?: 'monthly'|'annual' }
   */
  async toggleAddon(req, res) {
    try {
      const { action, billing_cycle } = req.body;

      if (!action || !['activate', 'deactivate'].includes(action)) {
        return res.status(400).json({
          code: 'INVALID_ACTION',
          message: "action deve ser 'activate' ou 'deactivate'",
        });
      }

      const { getSupabaseClient } = require('../config/supabase');
      const supabase = getSupabaseClient();
      const { data: seller } = await supabase
        .from('seller_profiles')
        .select('id')
        .eq('user_id', req.user.uid)
        .maybeSingle();

      if (!seller) {
        return res.status(404).json({ code: 'SELLER_NOT_FOUND', message: 'Perfil de vendedor não encontrado' });
      }

      let result;
      if (action === 'activate') {
        result = await addonService.activateAddon(req.user.uid, seller.id, billing_cycle || 'monthly');
      } else {
        result = await addonService.deactivateAddon(req.user.uid);
      }

      res.json({ addon: result, message: action === 'activate' ? 'Add-on ativado' : 'Desativação agendada para o fim do ciclo' });
    } catch (err) {
      logger.error('subscriptionController.toggleAddon error', { error: err.message });
      const status = err.message.includes('disponível apenas') || err.message.includes('já está') ? 400 : 500;
      res.status(status).json({ code: 'ADDON_ERROR', message: err.message });
    }
  },

  /**
   * GET /api/subscriptions/addon
   * Retorna add-ons ativos do seller.
   */
  async getAddons(req, res) {
    try {
      const addons = await addonService.getActiveAddons(req.user.uid);
      res.json({ addons });
    } catch (err) {
      logger.error('subscriptionController.getAddons error', { error: err.message });
      res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
    }
  },

  /**
   * GET /api/subscriptions/iconchat-usage
   * Retorna quota + snapshot de uso do IconChat.
   */
  async getIconChatUsage(req, res) {
    try {
      const [quota, snapshot] = await Promise.all([
        addonService.getSellerIconChatQuota(req.user.uid),
        addonService.getUsageSnapshot(req.user.uid),
      ]);

      res.json({
        quota,
        usage: snapshot ? {
          messagesUsed: snapshot.messages_used,
          messagesQuota: snapshot.messages_quota,
          lastThresholdPct: snapshot.last_threshold_pct,
          periodStart: snapshot.period_start,
          periodEnd: snapshot.period_end,
          updatedAt: snapshot.updated_at,
        } : null,
      });
    } catch (err) {
      logger.error('subscriptionController.getIconChatUsage error', { error: err.message });
      res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
    }
  },

  /**
   * GET /api/subscriptions/exemptions/sponsor
   * Dashboard do patrocinador.
   */
  async getSponsorDashboard(req, res) {
    try {
      const dashboard = await exemptionService.getSponsorDashboard(req.user.uid);
      res.json({ exemptions: dashboard });
    } catch (err) {
      logger.error('subscriptionController.getSponsorDashboard error', { error: err.message });
      res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
    }
  },
};

module.exports = subscriptionController;
