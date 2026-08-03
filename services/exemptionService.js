const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const SERVICE = 'ExemptionService';

// Limites por nível
const EXEMPTION_RULES = {
  n1_fundador: { duration_months: 12, max_beneficiaries: 10, commission_lojista: 0.05, commission_entregador: 0.08 },
  n2_rede:     { duration_months: 6,  max_beneficiaries: null, commission_lojista: 0.05, commission_entregador: 0.08 },
  guardiao:    { duration_months: 12, max_beneficiaries: null, commission_lojista: 0.05, commission_entregador: 0.08 },
};

class ExemptionService {
  /**
   * Cria uma isenção temporária para um negócio âncora.
   * Regras:
   *   - N1 Fundador: sponsor precisa de selo guardiao_verificado, max 10 beneficiários
   *   - N2 Rede: vinculados a N1
   *   - Guardiões: sponsor precisa de selo guardiao_verificado
   */
  async createExemption(sponsorId, beneficiaryId, level, beneficiaryType) {
    const supabase = getSupabaseClient();
    const rules = EXEMPTION_RULES[level];
    if (!rules) throw new Error(`Nível de isenção inválido: ${level}`);

    // Validação: sponsor não pode ser beneficiário
    if (sponsorId === beneficiaryId) {
      throw new Error('Sponsor não pode ser beneficiário da própria isenção');
    }

    // Validação: para N1 e Guardiões, sponsor precisa de selo guardiao_verificado
    if (level === 'n1_fundador' || level === 'guardiao') {
      const { data: selo } = await supabase
        .from('user_selos')
        .select('id')
        .eq('user_id', sponsorId)
        .eq('selo_slug', 'guardiao_verificado')
        .maybeSingle();

      if (!selo) {
        throw new Error('Sponsor precisa do selo Guardião Verificado para criar isenções N1/Guardião');
      }
    }

    // Validação: limite de beneficiários para N1
    if (rules.max_beneficiaries) {
      const { count } = await supabase
        .from('seller_exemptions')
        .select('id', { count: 'exact', head: true })
        .eq('sponsor_user_id', sponsorId)
        .eq('exemption_level', level)
        .in('status', ['pending', 'active']);

      if ((count || 0) >= rules.max_beneficiaries) {
        throw new Error(`Limite de ${rules.max_beneficiaries} beneficiários atingido para ${level}`);
      }
    }

    // Validação: beneficiário não pode ter isenção ativa do mesmo nível
    const { data: existing } = await supabase
      .from('seller_exemptions')
      .select('id')
      .eq('beneficiary_user_id', beneficiaryId)
      .eq('exemption_level', level)
      .in('status', ['pending', 'active'])
      .maybeSingle();

    if (existing) {
      throw new Error('Beneficiário já possui isenção ativa ou pendente deste nível');
    }

    const now = new Date();
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + rules.duration_months);

    const ordersDeadline = new Date(now);
    ordersDeadline.setDate(ordersDeadline.getDate() + 30);

    const commissionRate = beneficiaryType === 'entregador'
      ? rules.commission_entregador
      : rules.commission_lojista;

    const { data, error } = await supabase
      .from('seller_exemptions')
      .insert({
        exemption_level: level,
        sponsor_user_id: sponsorId,
        beneficiary_user_id: beneficiaryId,
        beneficiary_type: beneficiaryType,
        duration_months: rules.duration_months,
        commission_rate_override: commissionRate,
        monthly_cap_brl: 100.00,
        start_date: now.toISOString(),
        end_date: endDate.toISOString(),
        min_orders_required: 5,
        orders_deadline: ordersDeadline.toISOString(),
        orders_completed: 0,
        is_activated: false,
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw new Error(`Erro ao criar isenção: ${error.message}`);

    logger.info(`[${SERVICE}] Isenção criada`, {
      exemptionId: data.id, level, sponsorId, beneficiaryId, beneficiaryType,
    });

    return data;
  }

  /**
   * Verifica e ativa isenção após pedido completado.
   * Chamado a cada pedido do beneficiário.
   */
  async checkActivation(beneficiaryUserId) {
    const supabase = getSupabaseClient();

    const { data: pendingExemptions } = await supabase
      .from('seller_exemptions')
      .select('*')
      .eq('beneficiary_user_id', beneficiaryUserId)
      .eq('status', 'pending')
      .eq('is_activated', false);

    if (!pendingExemptions?.length) return null;

    const results = [];

    for (const exemption of pendingExemptions) {
      // Incrementa orders_completed
      const newCount = (exemption.orders_completed || 0) + 1;

      const updates = { orders_completed: newCount };

      if (newCount >= exemption.min_orders_required) {
        updates.is_activated = true;
        updates.status = 'active';

        logger.info(`[${SERVICE}] Isenção ativada!`, {
          exemptionId: exemption.id,
          beneficiaryUserId,
          ordersCompleted: newCount,
        });
      }

      const { data } = await supabase
        .from('seller_exemptions')
        .update(updates)
        .eq('id', exemption.id)
        .select()
        .single();

      results.push(data);
    }

    return results;
  }

  /**
   * Expira isenções vencidas e falha ativações que não atingiram mínimo.
   * Chamado pelo cron job diário.
   */
  async checkExpiration() {
    const supabase = getSupabaseClient();
    const now = new Date().toISOString();
    let expired = 0;
    let failed = 0;

    // 1. Expirar isenções ativas com end_date passada
    const { data: toExpire } = await supabase
      .from('seller_exemptions')
      .select('id')
      .eq('status', 'active')
      .lt('end_date', now);

    if (toExpire?.length) {
      const { error } = await supabase
        .from('seller_exemptions')
        .update({ status: 'expired' })
        .in('id', toExpire.map(e => e.id));

      if (!error) expired = toExpire.length;
    }

    // 2. Falhar pendentes com prazo de ativação expirado
    const { data: toFail } = await supabase
      .from('seller_exemptions')
      .select('id')
      .eq('status', 'pending')
      .eq('is_activated', false)
      .lt('orders_deadline', now);

    if (toFail?.length) {
      const { error } = await supabase
        .from('seller_exemptions')
        .update({ status: 'failed_activation' })
        .in('id', toFail.map(e => e.id));

      if (!error) failed = toFail.length;
    }

    logger.info(`[${SERVICE}] Verificação de expiração concluída`, { expired, failed });
    return { expired, failed };
  }

  /**
   * Resumo de isenções do beneficiário (para dashboard).
   */
  async getExemptionSummary(userId) {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('seller_exemptions')
      .select('*, sponsor:users!seller_exemptions_sponsor_user_id_fkey(id, display_name)')
      .eq('beneficiary_user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.warn(`[${SERVICE}] Erro ao buscar resumo`, { userId, error: error.message });
      return [];
    }

    return data || [];
  }

  /**
   * Dashboard do patrocinador: lista negócios isentos com uso do cap.
   */
  async getSponsorDashboard(sponsorId) {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('seller_exemptions')
      .select('*, beneficiary:users!seller_exemptions_beneficiary_user_id_fkey(id, display_name)')
      .eq('sponsor_user_id', sponsorId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.warn(`[${SERVICE}] Erro ao buscar dashboard sponsor`, { sponsorId, error: error.message });
      return [];
    }

    return data || [];
  }

  /**
   * Absorve comissão na isenção (atualiza total_commission_absorbed_brl).
   * Chamado quando uma venda ocorre dentro da isenção.
   */
  async absorbCommission(exemptionId, commissionBrl) {
    const supabase = getSupabaseClient();

    const { data: exemption } = await supabase
      .from('seller_exemptions')
      .select('total_commission_absorbed_brl, monthly_cap_brl')
      .eq('id', exemptionId)
      .single();

    if (!exemption) return;

    const currentAbsorbed = Number(exemption.total_commission_absorbed_brl) || 0;
    const cap = Number(exemption.monthly_cap_brl) || 100;
    const toAbsorb = Math.min(commissionBrl, cap - currentAbsorbed);

    if (toAbsorb <= 0) return;

    await supabase
      .from('seller_exemptions')
      .update({
        total_commission_absorbed_brl: Math.round((currentAbsorbed + toAbsorb) * 100) / 100,
      })
      .eq('id', exemptionId);
  }
}

module.exports = new ExemptionService();
