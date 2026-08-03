/**
 * @fileoverview Serviço de KYC Social Comunitário (Círculo de Confiança).
 * @module services/KYCSocialService
 *
 * Épico SOCIAL-KYC — implementa verificação de identidade baseada em comunidade,
 * sem custo e sem burocracia. Desbloqueia acesso à Loja Social (barter).
 *
 * Fluxo principal:
 *  1. Usuário (Trust Level 2+ Conhecido) solicita verificação → requestVerification()
 *  2. Vizinhos (Trust Level 4+ Pilar da Comunidade) confirmam identidade → validateIdentity()
 *  3. Ao atingir 3 validações → status 'approved' + kyc_social_verified = true
 *
 * LGPD:
 *  - Interface Cega: getRequestForValidation() NUNCA retorna document_photo_url
 *  - Dados do solicitante mascarados: apenas nome, foto e bairro
 */

const { getSupabaseClient } = require('../config/supabase');
const gamificationService   = require('./gamificationService');
const { logger }            = require('../logger');

const MIN_TRUST_REQUESTER  = 2;  // Trust Level mínimo para solicitar verificação social (Conhecido)
const MIN_TRUST_VALIDATOR  = 4;  // Trust Level mínimo para ser validador (Pilar da Comunidade)
const VALIDATIONS_REQUIRED = 3;  // Validações necessárias para aprovação automática

// ─── Helpers privados ─────────────────────────────────────────────────────────

function _log(fn, msg, extra = {}) {
  logger.info(`KYCSocialService.${fn} — ${msg}`, { service: 'KYCSocialService', ...extra });
}

function _warn(fn, msg, extra = {}) {
  logger.warn(`KYCSocialService.${fn} — ${msg}`, { service: 'KYCSocialService', ...extra });
}

// ─── Funções públicas ─────────────────────────────────────────────────────────

/**
 * Solicita verificação social comunitária.
 * Usuário deve ter Trust Level 2+ (Conhecido) e não ter solicitação ativa.
 *
 * @param {string} userId - Firebase UID do solicitante
 * @returns {Promise<object>} Solicitação criada
 * @throws {Error} com código ALREADY_PENDING | LEVEL_REQUIRED | DB_ERROR
 */
async function requestVerification(userId) {
  _log('requestVerification', 'Iniciando', { userId });

  const supabase = getSupabaseClient();
  if (!supabase) throw Object.assign(new Error('Supabase indisponível'), { code: 'DB_ERROR', status: 503 });

  // 1. Verificar level-gating (Trust Level 2+ — Conhecido)
  const { data: passport, error: errTp } = await supabase
    .from('trust_passports')
    .select('trust_level')
    .eq('user_id', userId)
    .single();

  if (errTp || !passport) {
    throw Object.assign(
      new Error('Passaporte de Confiança não encontrado. Participe da comunidade para construir sua reputação.'),
      { code: 'TRUST_LEVEL_REQUIRED', status: 403 }
    );
  }

  if (passport.trust_level < MIN_TRUST_REQUESTER) {
    throw Object.assign(
      new Error(`Nível de Confiança ${MIN_TRUST_REQUESTER}+ (Conhecido) necessário para solicitar verificação social. Seu nível: ${passport.trust_level}`),
      { code: 'TRUST_LEVEL_REQUIRED', status: 403 }
    );
  }

  // 2. Verificar se já existe solicitação ativa
  const { data: existing } = await supabase
    .from('kyc_social_requests')
    .select('id, status')
    .eq('user_id', userId)
    .single();

  if (existing && existing.status === 'pending') {
    throw Object.assign(new Error('Já existe uma solicitação de verificação pendente'), { code: 'ALREADY_PENDING', status: 400 });
  }

  // 3. Se existia solicitação expirada/rejeitada, atualizar; senão inserir
  let request;
  if (existing) {
    const { data: updated, error: errUpd } = await supabase
      .from('kyc_social_requests')
      .update({ status: 'pending', approved_at: null })
      .eq('user_id', userId)
      .select()
      .single();

    if (errUpd) throw Object.assign(new Error(`Falha ao atualizar solicitação: ${errUpd.message}`), { code: 'DB_ERROR', status: 500 });
    request = updated;
  } else {
    const { data: created, error: errIns } = await supabase
      .from('kyc_social_requests')
      .insert({ user_id: userId, status: 'pending' })
      .select()
      .single();

    if (errIns) throw Object.assign(new Error(`Falha ao criar solicitação: ${errIns.message}`), { code: 'DB_ERROR', status: 500 });
    request = created;
  }

  _log('requestVerification', 'Solicitação criada/atualizada', { userId, requestId: request.id });
  return request;
}

/**
 * Retorna dados de uma solicitação para validação — Interface Cega (LGPD).
 * NUNCA retorna document_photo_url. Apenas nome, foto e bairro do solicitante.
 *
 * @param {string} requestId  - UUID da solicitação
 * @param {string} validatorId - Firebase UID do validador (para verificar se pode ver)
 * @returns {Promise<object>} Dados sanitizados da solicitação
 */
async function getRequestForValidation(requestId, validatorId) {
  _log('getRequestForValidation', 'Buscando solicitação', { requestId, validatorId });

  const supabase = getSupabaseClient();
  if (!supabase) throw Object.assign(new Error('Supabase indisponível'), { code: 'DB_ERROR', status: 503 });

  // 1. Buscar a solicitação
  const { data: request, error: errReq } = await supabase
    .from('kyc_social_requests')
    .select('id, user_id, status, created_at')
    .eq('id', requestId)
    .single();

  if (errReq || !request) {
    throw Object.assign(new Error('Solicitação não encontrada'), { code: 'NOT_FOUND', status: 404 });
  }

  if (request.status !== 'pending') {
    throw Object.assign(new Error('Solicitação não está pendente'), { code: 'NOT_PENDING', status: 400 });
  }

  // 2. Buscar dados públicos do solicitante (Interface Cega — apenas nome, foto e bairro)
  const { data: user } = await supabase
    .from('users')
    .select('full_name, avatar_url, neighborhood')
    .eq('id', request.user_id)
    .single();

  // 3. Contar validações recebidas
  const { count: validationCount } = await supabase
    .from('kyc_social_validations')
    .select('id', { count: 'exact', head: true })
    .eq('request_id', requestId);

  // 4. Verificar se o validador já votou nesta solicitação
  const { data: alreadyValidated } = await supabase
    .from('kyc_social_validations')
    .select('id')
    .eq('request_id', requestId)
    .eq('validator_id', validatorId)
    .single();

  // LGPD: document_photo_url NUNCA incluído na resposta
  return {
    id:             request.id,
    status:         request.status,
    created_at:     request.created_at,
    validations_received: validationCount || 0,
    validations_required: VALIDATIONS_REQUIRED,
    already_validated: Boolean(alreadyValidated),
    requester: {
      name:          user?.full_name  || null,
      profile_photo: user?.avatar_url || null,
      neighborhood:  user?.neighborhood || null,
      // CPF, RG, email e document_photo_url: NUNCA retornados aqui
    },
  };
}

/**
 * Valida a identidade de um solicitante (Círculo de Confiança).
 * Validador deve ter Nível 5+ e não ser o padrinho do solicitante.
 *
 * @param {string} requestId   - UUID da solicitação
 * @param {string} validatorId - Firebase UID do validador
 * @returns {Promise<{validated: boolean, approvalReached: boolean}>}
 */
async function validateIdentity(requestId, validatorId) {
  _log('validateIdentity', 'Iniciando validação', { requestId, validatorId });

  const supabase = getSupabaseClient();
  if (!supabase) throw Object.assign(new Error('Supabase indisponível'), { code: 'DB_ERROR', status: 503 });

  // 1. Buscar a solicitação
  const { data: request, error: errReq } = await supabase
    .from('kyc_social_requests')
    .select('id, user_id, status')
    .eq('id', requestId)
    .single();

  if (errReq || !request) {
    throw Object.assign(new Error('Solicitação não encontrada'), { code: 'NOT_FOUND', status: 404 });
  }

  if (request.status !== 'pending') {
    throw Object.assign(new Error('Solicitação não está mais pendente'), { code: 'NOT_PENDING', status: 400 });
  }

  // 2. Validador não pode ser o próprio solicitante
  if (validatorId === request.user_id) {
    throw Object.assign(new Error('Você não pode validar a própria solicitação'), { code: 'SELF_VALIDATION', status: 400 });
  }

  // 3. Verificar Trust Level do validador (Nível 4+ — Pilar da Comunidade)
  const { data: validatorPassport, error: errTp } = await supabase
    .from('trust_passports')
    .select('trust_level')
    .eq('user_id', validatorId)
    .single();

  if (errTp || !validatorPassport || validatorPassport.trust_level < MIN_TRUST_VALIDATOR) {
    throw Object.assign(
      new Error(`Nível de Confiança ${MIN_TRUST_VALIDATOR}+ (Pilar da Comunidade) necessário para validar identidades`),
      { code: 'VALIDATOR_LEVEL_REQUIRED', status: 403 }
    );
  }

  // 4. Verificar que o validador não é o padrinho do solicitante (anti-conluio)
  const { data: godfatherBond } = await supabase
    .from('kyc_godfather_bonds')
    .select('id')
    .eq('godfather_id', validatorId)
    .eq('protege_id', request.user_id)
    .single();

  if (godfatherBond) {
    throw Object.assign(
      new Error('Padrinho não pode validar o próprio afilhado'),
      { code: 'GODFATHER_CONFLICT', status: 400 }
    );
  }

  // 5. Inserir validação (UNIQUE constraint garante idempotência)
  const { error: errIns } = await supabase
    .from('kyc_social_validations')
    .insert({ request_id: requestId, validator_id: validatorId });

  if (errIns) {
    if (errIns.code === '23505') {
      // Violação de UNIQUE — validador já votou
      throw Object.assign(new Error('Você já validou esta solicitação'), { code: 'ALREADY_VALIDATED', status: 400 });
    }
    throw Object.assign(new Error(`Falha ao registrar validação: ${errIns.message}`), { code: 'DB_ERROR', status: 500 });
  }

  // 6. Contar validações totais
  const { count: validationCount } = await supabase
    .from('kyc_social_validations')
    .select('id', { count: 'exact', head: true })
    .eq('request_id', requestId);

  let approvalReached = false;

  // 7. Aprovar automaticamente se atingiu o quórum
  if (validationCount >= VALIDATIONS_REQUIRED) {
    const { error: errApprove } = await supabase
      .from('kyc_social_requests')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', requestId);

    if (errApprove) {
      _warn('validateIdentity', 'Falha ao atualizar status para approved', { requestId, error: errApprove.message });
    } else {
      // Conceder flag kyc_social_verified ao solicitante
      await supabase
        .from('users')
        .update({ kyc_social_verified: true })
        .eq('id', request.user_id);

      approvalReached = true;
      _log('validateIdentity', 'KYC Social aprovado!', { requestId, userId: request.user_id });
    }
  }

  // 8. Recalcular social_score do solicitante on-demand (Anti-Panelinha, SOCIAL-KYC-006)
  //    Falha silenciosa — score diário será recalculado pelo pg_cron às 04:00 UTC
  try {
    await supabase.rpc('calculate_social_score', { p_user_id: request.user_id });
  } catch (scoreErr) {
    _warn('validateIdentity', 'Falha ao recalcular social_score (non-blocking)', { userId: request.user_id, error: scoreErr.message });
  }

  // 9. Disparar evento de gamificação (Lei do Time) — apenas em sucesso
  try {
    await gamificationService.triggerEvent('community_kyc_verified', validatorId);
  } catch (gamErr) {
    _warn('validateIdentity', 'Falha ao disparar evento de gamificação', { validatorId, error: gamErr.message });
  }

  // 10. Trust Passport — validação KYC social (+3 para o validado, +1 para o validador)
  try {
    const trustPassportService = require('./trustPassportService');
    trustPassportService.recordEvent(request.user_id, 'social', 'kyc_validation_received', 3, false, {
      validatorId, requestId: request.id,
    }).catch(() => {});
    trustPassportService.recordEvent(validatorId, 'social', 'kyc_validation_given', 1, false, {
      validatedUserId: request.user_id, requestId: request.id,
    }).catch(() => {});
  } catch { /* fire-and-forget */ }

  return { validated: true, approvalReached };
}

/**
 * Retorna a solicitação KYC Social do próprio usuário com contagem de validações.
 *
 * @param {string} userId - Firebase UID
 * @returns {Promise<object|null>} Solicitação ou null se não existe
 */
async function getMyRequest(userId) {
  const supabase = getSupabaseClient();
  if (!supabase) throw Object.assign(new Error('Supabase indisponível'), { code: 'DB_ERROR', status: 503 });

  const { data: request } = await supabase
    .from('kyc_social_requests')
    .select('id, status, created_at, approved_at, document_expires_at')
    .eq('user_id', userId)
    .single();

  if (!request) return null;

  const { count: validationCount } = await supabase
    .from('kyc_social_validations')
    .select('id', { count: 'exact', head: true })
    .eq('request_id', request.id);

  return {
    ...request,
    validations_received: validationCount || 0,
    validations_required: VALIDATIONS_REQUIRED,
  };
}

module.exports = {
  requestVerification,
  getRequestForValidation,
  validateIdentity,
  getMyRequest,
};
