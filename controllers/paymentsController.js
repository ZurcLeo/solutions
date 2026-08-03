const { logger } = require('../logger');
const { createAssessment } = require('../services/recaptchaService');
const asaasService = require('../services/asaasService');
const { getSupabaseClient } = require('../config/supabase');

// REMOVED: createEloCoinsPayment (2026-07-09)
// Legacy path with double-credit vulnerability:
//   1. Card inline credit via credit_wallet (no idempotency)
//   2. Webhook elocoins: branch credits again (no idempotency)
// Also received raw creditCard data from client (PCI SAQ-D exposure).
// New purchases use /api/elcoin/checkout via eloCoinController (PIX-only, with dedup).

/**
 * Consulta status de pagamento via Asaas.
 */
exports.getPaymentStatus = async (req, res) => {
  try {
    const { paymentId } = req.params;
    if (!paymentId) return res.status(400).json({ error: 'paymentId é obrigatório' });

    const status = await asaasService.getPaymentStatus(paymentId);
    return res.status(200).json(status);
  } catch (error) {
    logger.error('Erro ao consultar status', {
      controller: 'PaymentsController', error: error.message,
    });
    return res.status(500).json({ error: 'Falha ao consultar pagamento', message: error.message });
  }
};

/**
 * Lista compras de ElosCoins do usuário (Supabase).
 */
exports.getPurchases = async (req, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('elo_coin_transactions')
      .select('*')
      .eq('user_id', userId)
      .eq('type', 'purchase')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return res.status(200).json(data || []);
  } catch (error) {
    logger.error('Erro ao buscar compras', {
      controller: 'PaymentsController', error: error.message,
    });
    return res.status(500).json({ error: 'Erro ao buscar compras', message: error.message });
  }
};

/**
 * Lista todas as compras (admin).
 */
exports.getAllPurchases = async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('elo_coin_transactions')
      .select('*')
      .eq('type', 'purchase')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw new Error(error.message);
    return res.status(200).json(data || []);
  } catch (error) {
    logger.error('Erro ao buscar todas as compras', {
      controller: 'PaymentsController', error: error.message,
    });
    return res.status(500).json({ error: 'Erro ao buscar compras', message: error.message });
  }
};
