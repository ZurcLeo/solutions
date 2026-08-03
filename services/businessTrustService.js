/**
 * @fileoverview businessTrustService — BIZ-005 Stub
 * Trust score por negócio (separado do trust pessoal).
 *
 * D5: Criar tabela agora, calcular depois. Retorna null até implementação real.
 * Cálculo real depende de:
 *   - GP-1~5 (Google Places)
 *   - Fulfillment consolidado
 *   - Conduta de equipe
 *   - Reviews marketplace
 */

'use strict';

const { getSupabaseClient } = require('../config/supabase');
const { logger }            = require('../logger');

const SERVICE = 'businessTrustService';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

/**
 * Retorna o business trust score de um seller.
 * Stub: retorna null se nenhum score foi calculado.
 */
async function getBusinessTrust(sellerId) {
  const { data, error } = await sb()
    .from('business_trust_scores')
    .select('*')
    .eq('seller_id', sellerId)
    .maybeSingle();

  if (error) {
    logger.error(`${SERVICE}.getBusinessTrust: ${error.message}`, { sellerId });
    return null;
  }

  return data;
}

/**
 * Calcula business trust score.
 * Stub: retorna null. Implementação real no backlog.
 */
async function calculateBusinessTrust(sellerId) {
  logger.info(`${SERVICE}.calculateBusinessTrust: stub — cálculo real no backlog`, { sellerId });
  return null;
}

module.exports = {
  getBusinessTrust,
  calculateBusinessTrust,
};
