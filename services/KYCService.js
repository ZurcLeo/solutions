/**
 * @fileoverview Serviço de Verificação de Identidade (KYC).
 * @module services/KYCService
 *
 * CPF  → scraper direto Receita Federal (cpfVerificationService)
 * CNPJ → scraper direto Receita Federal (cnpjVerificationService)
 * OCR  → adiado para próxima fase (verifyDocument retorna 'deferred')
 *
 * InfoSimples: removido completamente deste serviço.
 *
 * LGPD:
 *  - CPF/CNPJ NUNCA armazenados em plaintext. Apenas SHA-256 é persistido.
 *  - Dados da Receita (nome, situação) armazenados apenas quando verificado.
 *  - Logs mascaram CPF ("***.***.***-XX") e CNPJ ("**.***.**\/****-XX").
 */

const crypto  = require('crypto');
const { getSupabaseClient }   = require('../config/supabase');
const cpfVerificationService  = require('./cpfVerificationService');
const cnpjVerificationService = require('./cnpjVerificationService');
const gamificationService     = require('./gamificationService');
const notificationDispatcher  = require('./NotificationDispatcher');
const AuditService            = require('./AuditService');
const { logger }              = require('../logger');

// Lazy-load para evitar ciclos de dependência circular
const _getSupportService = () => require('./SupportService');
const _getEncryptionService = () => require('./encryptionService');

// Cache em memória para evitar consultas duplicadas em retry rápido.
// TTL de 10 minutos.
const _cache = new Map(); // key: userId → { result, expiresAt }
const CACHE_TTL_MS = 10 * 60 * 1000;

// Limite de tentativas por usuário (persistido no Supabase)
const MAX_ATTEMPTS = 5;

/**
 * Sanitiza CPF: remove tudo que não é dígito.
 */
const _sanitizeCPF = (cpf) => String(cpf).replace(/\D/g, '');

/**
 * Mascara CPF para logs: "***.***.***-89"
 */
const _maskCPF = (cpf) => {
  const digits = _sanitizeCPF(cpf);
  return `***.***.*${digits.slice(6, 9)}-${digits.slice(9)}`;
};

/**
 * Gera SHA-256(cpfDigitsOnly) para armazenamento e busca de duplicidade.
 */
const _hashCPF = (cpf) => {
  const digits = _sanitizeCPF(cpf);
  return crypto.createHash('sha256').update(digits).digest('hex');
};

/**
 * Valida formato básico do CNPJ (14 dígitos, dígitos verificadores corretos).
 */
const _isValidCNPJFormat = (cnpj) => {
  const digits = String(cnpj).replace(/\D/g, '');
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false; // todos iguais

  const calcDigit = (arr, weights) => {
    const sum = arr.reduce((acc, d, i) => acc + d * weights[i], 0);
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  };

  const arr = digits.split('').map(Number);
  const w1  = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2  = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return calcDigit(arr.slice(0, 12), w1) === arr[12]
      && calcDigit(arr.slice(0, 13), w2) === arr[13];
};

/**
 * Valida formato básico do CPF (11 dígitos, não todos iguais).
 */
const _isValidCPFFormat = (cpf) => {
  const digits = _sanitizeCPF(cpf);
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false; // 000.000.000-00, etc.

  // Verificação dos dígitos verificadores
  const calcDigit = (cpfArr, len) => {
    const sum = cpfArr.slice(0, len).reduce((acc, d, i) => acc + d * (len + 1 - i), 0);
    const rem = (sum * 10) % 11;
    return rem >= 10 ? 0 : rem;
  };
  const arr = digits.split('').map(Number);
  return calcDigit(arr, 9) === arr[9] && calcDigit(arr, 10) === arr[10];
};

/**
 * Formata data para o padrão ISO 8601 (YYYY-MM-DD).
 * Garante que não haja deslocamento de fuso horário e que zeros sejam incluídos.
 * Rejeita anos com ≠ 4 dígitos ou fora do intervalo 1900–(ano atual).
 */
const _formatDate = (dateInput) => {
  if (!dateInput) return null;

  let yearStr, month, day;

  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    // Já no formato YYYY-MM-DD — valida apenas o range do ano
    yearStr = dateInput.split('-')[0];
    const y = parseInt(yearStr, 10);
    if (y < 1900 || y > new Date().getFullYear()) return null;
    return dateInput;
  }

  if (typeof dateInput === 'string' && dateInput.includes('-')) {
    const parts = dateInput.split('-');
    if (parts.length === 3) {
      yearStr = parts[0];
      month   = parts[1].padStart(2, '0');
      day     = parts[2].padStart(2, '0');
      if (yearStr.length === 4 && month.length === 2 && day.length === 2) {
        const y = parseInt(yearStr, 10);
        if (y < 1900 || y > new Date().getFullYear()) return null;
        return `${yearStr}-${month}-${day}`;
      }
    }
  }

  // Fallback para objeto Date, evitando problemas de fuso horário
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return null;

  // Usamos ISOString para garantir UTC e evitar drift de fuso (-3h BRT)
  const iso = d.toISOString().split('T')[0];
  const y   = parseInt(iso.split('-')[0], 10);
  if (y < 1900 || y > new Date().getFullYear()) return null;
  return iso;
};

/**
 * Verifica se dois nomes são similares (fuzzy — normalização de acentos e case).
 */
const _namesMatch = (a, b) => {
  if (!a || !b) return false;
  const normalize = (str) =>
    str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const normA = normalize(a);
  const normB = normalize(b);
  return normA.includes(normB.split(' ')[0]) || normB.includes(normA.split(' ')[0]);
};

/**
 * Calcula um score de similaridade entre dois nomes (0-100).
 * Baseado na proporção de palavras coincidentes (case-insensitive, sem acentos).
 */
const _namesMatchScore = (a, b) => {
  if (!a || !b) return 0;
  const normalize = (str) =>
    str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const wordsA = normalize(a).split(/\s+/).filter(Boolean);
  const wordsB = normalize(b).split(/\s+/).filter(Boolean);
  if (!wordsA.length || !wordsB.length) return 0;
  const matches = wordsA.filter(w => wordsB.includes(w)).length;
  const total   = Math.max(wordsA.length, wordsB.length);
  return Math.round((matches / total) * 100);
};

/**
 * Gera SHA-256(documentNumber + documentType) para detecção de duplicidade.
 */
const _hashDocumentNumber = (documentNumber, documentType) => {
  const clean = String(documentNumber).replace(/\D/g, '');
  return crypto.createHash('sha256').update(`${documentType}:${clean}`).digest('hex');
};

// ─────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────

const KYCService = {

  /**
   * Verifica identidade do usuário via CPF + Receita Federal.
   *
   * @param {string} userId       - UID do usuário (Firebase)
   * @param {string} cpf          - CPF (com ou sem máscara)
   * @param {string|Date} birthDate - Data de nascimento
   * @param {string} declaredName - Nome declarado pelo usuário no perfil
   * @param {Object} [ctx]        - Contexto opcional (ip, userAgent)
   * @returns {Promise<{success, status, level, message, nameMatch, situation}>}
   */
  async verifyCPF(userId, cpf, birthDate, declaredName, ctx = {}, rfResultOverride = null) {
    const cpfDigits = _sanitizeCPF(cpf);
    const maskedCPF = _maskCPF(cpf);

    logger.info('KYCService.verifyCPF: iniciando verificação', {
      service: 'KYCService',
      userId,
      maskedCPF,
    });

    // 1. Validação de formato
    if (!_isValidCPFFormat(cpfDigits)) {
      return { success: false, status: 'failed', message: 'CPF inválido (formato).' };
    }

    // 2. Cache em memória (evita re-consulta em retry rápido)
    const cacheKey = `${userId}:${cpfDigits}`;
    const cached = _cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      logger.info('KYCService.verifyCPF: cache hit', { service: 'KYCService', userId });
      return cached.result;
    }

    const supabase = getSupabaseClient();

    // 3. Verificar tentativas anteriores
    const { data: existing } = await supabase
      .from('user_kyc_verifications')
      .select('id, status, attempts, cpf_hash')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existing && existing.attempts >= MAX_ATTEMPTS) {
      return {
        success: false,
        status: 'failed',
        message: 'Número máximo de tentativas atingido. Entre em contato com o suporte.',
      };
    }

    // 4. Verificar duplicidade de CPF (mesmo CPF em outra conta)
    const cpfHash = _hashCPF(cpfDigits);
    const isDuplicate = await KYCService.checkCPFDuplicity(cpfHash, userId);
    if (isDuplicate) {
      logger.warn('KYCService.verifyCPF: CPF já associado a outro usuário', {
        service: 'KYCService',
        userId,
        maskedCPF,
      });
      // SECURITY: nunca revelar ao cliente que o CPF existe no sistema.
      // Código interno ERR_KYC_1042 — interpretado apenas pelo suporte.
      return {
        success: false,
        status: 'failed',
        errorCode: 'ERR_KYC_1042',
        message: 'Não foi possível concluir a verificação. Código: ERR_KYC_1042. Contate o suporte.',
      };
    }

    // 5. Formatar data de nascimento
    const birthDateFormatted = _formatDate(birthDate);
    if (!birthDateFormatted) {
      return { success: false, status: 'failed', message: 'Data de nascimento inválida.' };
    }

    // 6. Consultar Receita Federal — scraper direto ou resultado pré-obtido via proxy
    const rfResult = rfResultOverride || await cpfVerificationService.verify(cpfDigits, birthDateFormatted);

    // 6a. Tratar erros do scraper
    if (rfResult.status === 'ERROR') {
      const { errorType } = rfResult;

      logger.error('KYCService.verifyCPF: erro na consulta Receita Federal', {
        service: 'KYCService',
        userId,
        errorType,
      });

      // Receita offline, circuit breaker aberto ou estrutura HTML mudou → revisão manual
      // (não punir o usuário por falha de infraestrutura)
      if (errorType === 'UNAVAILABLE' || errorType === 'CIRCUIT_OPEN' || errorType === 'PARSE_ERROR') {
        await KYCService._upsertVerification(supabase, userId, cpfHash, cpfDigits, {
          status:       'manual_review',
          failedReason: `Receita Federal indisponível: ${errorType}`,
          ipAddress:    ctx.ip,
          userAgent:    ctx.userAgent,
        });
        // Marcar kyc_status como manual_review na tabela users para feedback visual no frontend
        await supabase.from('users').update({ kyc_status: 'manual_review' }).eq('id', userId);
        // kyc_audit_log + ticket de suporte — fire-and-forget
        setImmediate(async () => {
          const { error } = await supabase.from('kyc_audit_log').insert({
            user_id:    userId,
            result:     errorType === 'CIRCUIT_OPEN' ? 'CIRCUIT_OPEN' : 'DEFERRED',
            name_match: null,
            provider:   'receita-federal-direct',
            error_type: errorType,
          });
          if (error) logger.error('KYCService: falha ao gravar kyc_audit_log', { error: error.message });
        });
        // Ticket de suporte automático — fire-and-forget
        setImmediate(() => KYCService._createManualReviewTicket(supabase, userId, 'cpf', errorType));
        // Notificação — KYC em revisão manual (fire-and-forget)
        setImmediate(() => {
          notificationDispatcher.dispatch({
            userId,
            type:       'kyc_pending_review',
            importance: 'low',
            data:       { documentType: 'CPF', reason: 'Receita Federal indisponível' },
            metadata:   { triggeredBy: 'system' },
            dedupKey:   `kyc_pending_review_${userId}`,
          }).catch(() => {});
        });

        return {
          success: false,
          status:  'manual_review',
          message: 'Verificação em andamento. Você será notificado quando concluída.',
        };
      }

      // Dados inválidos (CPF/nascimento incorretos) → failed
      if (errorType === 'INVALID_DATA') {
        await KYCService._upsertVerification(supabase, userId, cpfHash, cpfDigits, {
          status:       'failed',
          failedReason: 'CPF ou data de nascimento incorretos.',
          ipAddress:    ctx.ip,
          userAgent:    ctx.userAgent,
        });
        setImmediate(async () => {
          const { error } = await supabase.from('kyc_audit_log').insert({
            user_id:    userId,
            result:     'ERROR',
            name_match: null,
            provider:   'receita-federal-direct',
            error_type: 'INVALID_DATA',
          });
          if (error) logger.error('KYCService: falha ao gravar kyc_audit_log', { error: error.message });
        });
        // Notificação — KYC falhou (fire-and-forget)
        setImmediate(() => {
          notificationDispatcher.dispatch({
            userId,
            type:       'kyc_failed',
            importance: 'high',
            data:       { documentType: 'CPF', reason: 'Dados inválidos' },
            metadata:   { triggeredBy: 'system' },
            dedupKey:   `kyc_failed_cpf_${userId}_${Date.now()}`,
          }).catch(() => {});
        });

        return {
          success: false,
          status:  'failed',
          message: 'CPF ou data de nascimento incorretos. Confira os dados e tente novamente.',
        };
      }

      // Erro desconhecido — tratado como indisponível
      await KYCService._upsertVerification(supabase, userId, cpfHash, cpfDigits, {
        status:       'manual_review',
        failedReason: `Erro inesperado: ${errorType}`,
        ipAddress:    ctx.ip,
        userAgent:    ctx.userAgent,
      });
      setImmediate(() => KYCService._createManualReviewTicket(supabase, userId, 'cpf', errorType));
      return {
        success: false,
        status:  'manual_review',
        message: 'Verificação em andamento. Você será notificado quando concluída.',
      };
    }

    // 7. Avaliar situação cadastral retornada pelo scraper
    // rfResult.status já é o enum normalizado: REGULAR | PENDENTE_DE_REGULARIZACAO | CANCELADA | SUSPENSA | NULA
    const situation   = rfResult.status;
    const receitaName = rfResult.name || '';
    const isRegular   = situation === 'REGULAR';
    const nameMatch   = _namesMatch(receitaName, declaredName);

    if (!isRegular) {
      await KYCService._upsertVerification(supabase, userId, cpfHash, cpfDigits, {
        status: 'failed',
        failedReason: `CPF com situação irregular: ${situation}`,
        receitaName,
        receitaSituation: situation,
        nameMatch,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      });
      // kyc_audit_log — fire-and-forget
      setImmediate(async () => {
        const { error } = await supabase.from('kyc_audit_log').insert({
          user_id:    userId,
          result:     situation,
          name_match: nameMatch,
          provider:   'receita-federal-direct',
          error_type: null,
        });
        if (error) logger.error('KYCService: falha ao gravar kyc_audit_log', { error: error.message });
      });
      // Notificação — CPF irregular (fire-and-forget)
      setImmediate(() => {
        notificationDispatcher.dispatch({
          userId,
          type:       'kyc_failed',
          importance: 'high',
          data:       { documentType: 'CPF', reason: `Situação irregular: ${situation}` },
          metadata:   { triggeredBy: 'system' },
          dedupKey:   `kyc_failed_cpf_irregular_${userId}`,
        }).catch(() => {});
      });

      return {
        success: false,
        status: 'failed',
        situation,
        message: `CPF com situação irregular perante a Receita Federal: ${situation}.`,
      };
    }

    // 8. CPF regular — salvar verificação bem-sucedida
    await KYCService._upsertVerification(supabase, userId, cpfHash, cpfDigits, {
      status: 'verified',
      receitaName,
      receitaSituation: situation,
      nameMatch,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });

    // kyc_audit_log — fire-and-forget
    setImmediate(async () => {
      const { error } = await supabase.from('kyc_audit_log').insert({
        user_id:    userId,
        result:     'REGULAR',
        name_match: nameMatch,
        provider:   'receita-federal-direct',
        error_type: null,
      });
      if (error) logger.error('KYCService: falha ao gravar kyc_audit_log', { error: error.message });
    });

    // 9. Atualizar kyc_status/kyc_level na tabela users + salvar CPF criptografado (RISCO-01)
    const encryptionService = require('./encryptionService');
    const cpfEncrypted = await encryptionService.encrypt(cpfDigits, { dataType: 'cpf', aad: userId });

    await supabase
      .from('users')
      .update({
        kyc_status:      'verified',
        kyc_level:       'cpf',
        kyc_verified_at: new Date().toISOString(),
        cpf_encrypted:   JSON.stringify(cpfEncrypted),
        cpf_last4:       cpfDigits.slice(-4),
      })
      .eq('id', userId);

    // 10. Gamificação — identity_verified (fire-and-forget)
    setImmediate(() => {
      gamificationService.triggerEvent('identity_verified', userId, { level: 'cpf' })
        .catch((e) => logger.error('KYCService: falha ao disparar gamification', { error: e.message }));

      // Trust Passport — CPF verificado (+5 account)
      const trustPassportService = require('./trustPassportService');
      trustPassportService.recordEvent(userId, 'account', 'identity_verified', 5, false, { level: 'cpf' })
        .catch((e) => logger.warn('KYCService: trust event falhou', { event: 'identity_verified', error: e.message }));
    });

    // 10b. Notificação — CPF verificado (fire-and-forget)
    setImmediate(() => {
      notificationDispatcher.dispatch({
        userId,
        type:       'kyc_verified',
        importance: 'high',
        data:       { level: 'cpf', documentType: 'CPF' },
        metadata:   { triggeredBy: 'system' },
        dedupKey:   `kyc_verified_cpf_${userId}`,
      }).catch(() => {});
    });

    // 11. Auditoria
    setImmediate(() => {
      AuditService.log({
        userId,
        action:     'kyc_cpf_verified',
        entityType: 'user',
        entityId:   userId,
        ipAddress:  ctx.ip,
        userAgent:  ctx.userAgent,
        metadata:   { nameMatch, situation, maskedCPF },
      }).catch(() => {});
    });

    const result = {
      success: true,
      status: 'verified',
      level: 'cpf',
      nameMatch,
      situation,
      message: nameMatch
        ? 'CPF verificado com sucesso.'
        : 'CPF verificado, mas o nome não coincide completamente com o cadastro da Receita.',
    };

    // Cachear resultado por 10 minutos
    _cache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });

    logger.info('KYCService.verifyCPF: verificação concluída', {
      service: 'KYCService',
      userId,
      status: 'verified',
      nameMatch,
      situation,
    });

    return result;
  },

  /**
   * Retorna o status KYC atual do usuário.
   */
  async getKYCStatus(userId) {
    const supabase = getSupabaseClient();

    const { data: user } = await supabase
      .from('users')
      .select('kyc_status, kyc_level, kyc_verified_at')
      .eq('id', userId)
      .single();

    if (!user) return { kycStatus: 'none', kycLevel: 'none', kycVerifiedAt: null };

    return {
      kycStatus:     user.kyc_status      || 'none',
      kycLevel:      user.kyc_level       || 'none',
      kycVerifiedAt: user.kyc_verified_at || null,
    };
  },

  /**
   * Verifica se o CPF hash já está associado a OUTRO usuário.
   * @returns {boolean} true se duplicado
   */
  async checkCPFDuplicity(cpfHash, excludeUserId = null) {
    const supabase = getSupabaseClient();
    let query = supabase
      .from('user_kyc_verifications')
      .select('user_id')
      .eq('cpf_hash', cpfHash)
      .eq('status', 'verified')
      .limit(1);

    if (excludeUserId) {
      query = query.neq('user_id', excludeUserId);
    }

    const { data } = await query;
    return data && data.length > 0;
  },

  // ─────────────────────────────────────────────────────────────
  // FASE 3-A: OCR de Documento (RG / CNH / Passaporte)
  // ─────────────────────────────────────────────────────────────

  /**
   * Verifica identidade do usuário via OCR do documento de identidade.
   *
   * Pré-requisito: o usuário já deve ter kyc_level >= 'cpf'.
   *
   * @param {string} userId        - UID do usuário (Firebase)
   * @param {'rg'|'cnh'|'passport'} documentType - Tipo de documento
   * @param {string} imageBase64   - Imagem do documento em base64
   * @param {Object} [ctx]         - Contexto opcional (ip, userAgent)
   * @returns {Promise<{success, status, level, documentType, nameMatch, cpfCrossMatch, message}>}
   */
  /**
   * Verifica identidade do usuário via documento físico com prova de vida (liveness).
   *
   * Pré-requisito: usuário deve ter kyc_level >= 'cpf'.
   *
   * Aprovação híbrida:
   *  - Auto-aprovado se: livenessPassedClient=true + nameMatchScore >= 90 + documento não expirado
   *  - Caso contrário: manual_review (admin revisa vídeo + fotos via signed URL)
   *
   * @param {string} userId
   * @param {Object} data
   *   @param {'rg'|'cnh'|'passport'} data.documentType
   *   @param {string} data.documentNumber    — número do documento (será criptografado)
   *   @param {string|null} data.documentExpiry — YYYY-MM-DD ou null para RG sem validade
   *   @param {string} data.declaredName       — nome conforme o documento
   *   @param {string} data.livenessVideoPath  — path no bucket kyc-docs
   *   @param {string} data.docFrontPath       — path no bucket kyc-docs
   *   @param {string|null} data.docBackPath   — path no bucket kyc-docs (opcional)
   *   @param {string} data.livenessChallenge  — desafio exibido ao usuário
   *   @param {boolean} data.livenessPassedClient — resultado do motion detection client-side
   * @param {Object} [ctx]
   * @returns {Promise<{success, status, level, autoApproved?, nameMatchScore, message}>}
   */
  async verifyDocument(userId, data, ctx = {}) {
    const {
      documentType,
      documentNumber,
      documentExpiry,
      declaredName,
      livenessVideoPath,
      docFrontPath,
      docBackPath       = null,
      livenessChallenge = null,
      livenessPassedClient = false,
    } = data || {};

    logger.info('KYCService.verifyDocument: iniciando verificação de documento', {
      service: 'KYCService', userId, documentType,
    });

    const VALID_DOC_TYPES = ['rg', 'cnh', 'passport'];
    if (!documentType || !VALID_DOC_TYPES.includes(documentType)) {
      return { success: false, status: 'failed', message: `documentType deve ser: ${VALID_DOC_TYPES.join(', ')}.` };
    }
    if (!documentNumber) {
      return { success: false, status: 'failed', message: 'documentNumber é obrigatório.' };
    }
    if (!declaredName) {
      return { success: false, status: 'failed', message: 'declaredName é obrigatório.' };
    }
    if (!livenessVideoPath || !docFrontPath) {
      return { success: false, status: 'failed', message: 'Prova de vida e foto do documento são obrigatórias.' };
    }

    // Validar expiração do documento (passaporte e CNH têm validade)
    let docExpiryDate = null;
    if (documentExpiry) {
      docExpiryDate = _formatDate(documentExpiry);
      if (!docExpiryDate) {
        return { success: false, status: 'failed', message: 'Data de validade do documento inválida.' };
      }
      // Verificar se expirado
      if (new Date(docExpiryDate) < new Date()) {
        return { success: false, status: 'failed', message: 'Documento expirado. Utilize um documento válido.' };
      }
      // Verificar validade futura razoável (máx 15 anos)
      const maxFuture = new Date();
      maxFuture.setFullYear(maxFuture.getFullYear() + 15);
      if (new Date(docExpiryDate) > maxFuture) {
        return { success: false, status: 'failed', message: 'Data de validade do documento inválida.' };
      }
    }

    const supabase = getSupabaseClient();

    // Verificar pré-requisito: kyc_level >= 'cpf'
    const KYC_LEVELS = ['none', 'cpf', 'document', 'full'];
    const { data: userRow } = await supabase
      .from('users')
      .select('kyc_level')
      .eq('id', userId)
      .single();

    const currentIdx = KYC_LEVELS.indexOf(userRow?.kyc_level || 'none');
    if (currentIdx < 1) {
      return { success: false, status: 'failed', message: 'Verificação de CPF deve ser concluída antes da verificação de documento.' };
    }

    // Buscar receita_name da verificação CPF para cross-validation
    const { data: cpfVerif } = await supabase
      .from('user_kyc_verifications')
      .select('receita_name')
      .eq('user_id', userId)
      .eq('level', 'cpf')
      .eq('status', 'verified')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const receitaName = cpfVerif?.receita_name || '';
    const nameMatchScore = _namesMatchScore(declaredName, receitaName);

    // Criptografar número do documento
    let documentNumberEncrypted = null;
    try {
      const encSvc = _getEncryptionService();
      const encrypted = await encSvc.encrypt(documentNumber, { dataType: 'document', aad: userId });
      documentNumberEncrypted = JSON.stringify(encrypted);
    } catch (encErr) {
      logger.warn('KYCService.verifyDocument: falha ao criptografar número do documento', {
        service: 'KYCService', userId, error: encErr.message,
      });
    }

    // Hash do documento para detecção de duplicidade
    const docNumberHash = _hashDocumentNumber(documentNumber, documentType);

    // Determinar se aprovação automática é possível
    const isDocumentExpired = docExpiryDate ? new Date(docExpiryDate) < new Date() : false;
    const autoApprove = livenessPassedClient === true
      && nameMatchScore >= 90
      && !isDocumentExpired;

    const status = autoApprove ? 'verified' : 'manual_review';

    // Salvar verificação de documento
    const record = {
      user_id:                    userId,
      level:                      'document',
      status,
      document_type:              documentType,
      document_number_hash:       docNumberHash,
      document_expiry:            docExpiryDate,
      document_name_match:        nameMatchScore >= 70,
      receita_name:               receitaName || null,
      liveness_video_path:        livenessVideoPath,
      doc_front_path:             docFrontPath,
      doc_back_path:              docBackPath,
      liveness_challenge:         livenessChallenge,
      liveness_passed:            livenessPassedClient === true,
      name_match_score:           nameMatchScore,
      document_number_encrypted:  documentNumberEncrypted,
      ip_address:                 ctx.ip    || null,
      user_agent:                 ctx.userAgent || null,
      attempts:                   1,
    };

    const { data: inserted, error: insertErr } = await supabase
      .from('user_kyc_verifications')
      .insert(record)
      .select('id')
      .single();

    if (insertErr) {
      logger.error('KYCService.verifyDocument: erro ao inserir verificação', {
        service: 'KYCService', userId, error: insertErr.message,
      });
      throw insertErr;
    }

    const verificationId = inserted?.id;

    if (autoApprove) {
      // Atualizar usuário para kyc_level='document'
      const userUpdate = {
        kyc_status:                 'verified',
        kyc_level:                  'document',
        kyc_verified_at:            new Date().toISOString(),
        document_type:              documentType,
        document_expiry:            docExpiryDate,
      };
      if (documentNumberEncrypted) {
        userUpdate.document_number_encrypted = documentNumberEncrypted;
      }
      await supabase.from('users').update(userUpdate).eq('id', userId);

      // Gamificação, notificação e auditoria — fire-and-forget
      setImmediate(() => {
        gamificationService.triggerEvent('document_verified', userId, { documentType })
          .catch(e => logger.error('KYCService.verifyDocument: falha gamification', { error: e.message }));
        notificationDispatcher.dispatch({
          userId,
          type:       'kyc_document_verified',
          importance: 'high',
          data:       { level: 'document', documentType },
          metadata:   { triggeredBy: 'system' },
          dedupKey:   `kyc_document_verified_${userId}`,
        }).catch(() => {});
        AuditService.log({
          userId,
          action:    'kyc_document_auto_approved',
          entityType:'kyc_verification',
          entityId:   verificationId,
          ipAddress:  ctx.ip,
          userAgent:  ctx.userAgent,
          metadata:  { documentType, nameMatchScore, livenessChallenge },
        }).catch(() => {});
      });

      logger.info('KYCService.verifyDocument: auto-aprovado', {
        service: 'KYCService', userId, documentType, nameMatchScore,
      });

      return {
        success:         true,
        status:          'verified',
        level:           'document',
        autoApproved:    true,
        nameMatchScore,
        message:         'Documento verificado com sucesso.',
      };
    }

    // manual_review — atualizar usuário e criar ticket
    await supabase.from('users')
      .update({ kyc_status: 'manual_review', kyc_level: 'document' })
      .eq('id', userId);

    setImmediate(async () => {
      try {
        const supportService = _getSupportService();
        const ticket = await supportService.createTicket({
          userId,
          category:    'account',
          module:      'kyc',
          issueType:   'identity_verification_pending',
          description: `Documento ${documentType.toUpperCase()} enviado para análise manual. Name match: ${nameMatchScore}%. Liveness: ${livenessPassedClient ? 'ok' : 'falhou'}.`,
          context: {
            kycVerificationId: verificationId,
            level:             'document',
            documentType,
            nameMatchScore,
            livenessChallenge,
            livenessPassedClient,
          },
        });
        // Salvar referência do ticket na verificação
        if (ticket?.ticketId) {
          await supabase.from('user_kyc_verifications')
            .update({ support_ticket_id: ticket.ticketId })
            .eq('id', verificationId);
        }
      } catch (e) {
        logger.warn('KYCService.verifyDocument: falha ao criar ticket para manual_review', {
          service: 'KYCService', userId, error: e.message,
        });
      }
      notificationDispatcher.dispatch({
        userId,
        type:       'kyc_pending_review',
        importance: 'low',
        data:       { documentType, reason: 'Análise manual necessária' },
        metadata:   { triggeredBy: 'system' },
        dedupKey:   `kyc_doc_pending_${userId}`,
      }).catch(() => {});
    });

    logger.info('KYCService.verifyDocument: enviado para revisão manual', {
      service: 'KYCService', userId, documentType, nameMatchScore,
    });

    return {
      success:       true,
      status:        'manual_review',
      level:         'document',
      nameMatchScore,
      message:       'Documento enviado para análise. Você será notificado quando concluída.',
    };
  },

  // ─────────────────────────────────────────────────────────────
  // Verificação de CNPJ — scraper direto Receita Federal
  // ─────────────────────────────────────────────────────────────

  /**
   * Verifica CNPJ da organização via scraper direto da Receita Federal.
   *
   * @param {string} userId   - UID do usuário (Firebase)
   * @param {string} cnpj     - CNPJ (com ou sem máscara)
   * @param {Object} [ctx]    - Contexto opcional (ip, userAgent)
   * @returns {Promise<{success, status, level, situation, message}>}
   */
  async verifyCNPJ(userId, cnpj, ctx = {}) {
    const cnpjDigits = String(cnpj).replace(/\D/g, '');
    const maskCNPJ   = require('../utils/cnpjMask');
    const maskedCNPJ = maskCNPJ(cnpjDigits);

    logger.info('KYCService.verifyCNPJ: iniciando verificação', {
      service: 'KYCService', userId, maskedCNPJ,
    });

    if (!_isValidCNPJFormat(cnpjDigits)) {
      return { success: false, status: 'failed', message: 'CNPJ inválido (formato ou dígitos verificadores).' };
    }

    const supabase  = getSupabaseClient();
    const cnpjHash  = crypto.createHash('sha256').update(cnpjDigits).digest('hex');
    const cnpjLast4 = cnpjDigits.slice(-4);

    // Verificar tipo de conta e nível KYC
    const KYC_LEVELS = ['none', 'cpf', 'document', 'full'];
    const { data: userRow } = await supabase
      .from('users').select('tipo_de_conta, kyc_level').eq('id', userId).single();

    if (userRow?.tipo_de_conta !== 'Organização') {
      return { success: false, status: 'failed', message: 'Verificação de CNPJ é exclusiva para contas do tipo Organização.' };
    }

    const currentIdx = KYC_LEVELS.indexOf(userRow?.kyc_level || 'none');
    if (currentIdx < 1) {
      return { success: false, status: 'failed', message: 'É necessário verificar o CPF antes de verificar o CNPJ.' };
    }

    // Scraper direto Receita Federal
    const rfResult = await cnpjVerificationService.verify(cnpjDigits);

    if (rfResult.status === 'ERROR') {
      const { errorType } = rfResult;
      logger.error('KYCService.verifyCNPJ: erro na consulta Receita Federal', {
        service: 'KYCService', userId, errorType,
      });
      const isUnavailable = ['UNAVAILABLE', 'CIRCUIT_OPEN', 'PARSE_ERROR'].includes(errorType);
      await supabase.from('user_kyc_verifications').insert({
        user_id: userId, cnpj_hash: cnpjHash, cnpj_last4: cnpjLast4,
        status: isUnavailable ? 'manual_review' : 'failed', level: 'cnpj',
        failed_reason: `Receita Federal: ${errorType}`,
        ip_address: ctx.ip || null, user_agent: ctx.userAgent || null, attempts: 1,
      });
      setImmediate(async () => {
        const { error } = await supabase.from('kyc_audit_log').insert({
          user_id: userId, result: isUnavailable ? 'DEFERRED' : 'ERROR',
          provider: 'receita-federal-direct', error_type: errorType,
        });
        if (error) logger.error('KYCService: falha ao gravar kyc_audit_log', { error: error.message });
      });
      return isUnavailable
        ? { success: false, status: 'manual_review', message: 'Verificação em andamento. Você será notificado quando concluída.' }
        : { success: false, status: 'failed', message: 'CNPJ ou dados inválidos. Verifique e tente novamente.' };
    }

    const receitaSituation = rfResult.status;
    const isAtivo          = receitaSituation === 'ATIVA';

    if (!isAtivo) {
      await supabase.from('user_kyc_verifications').insert({
        user_id: userId, cnpj_hash: cnpjHash, cnpj_last4: cnpjLast4,
        status: 'failed', level: 'cnpj',
        receita_cnpj_situation: receitaSituation,
        failed_reason: `CNPJ com situação irregular: ${receitaSituation}`,
        ip_address: ctx.ip || null, user_agent: ctx.userAgent || null, attempts: 1,
      });
      setImmediate(async () => {
        await supabase.from('kyc_audit_log').insert({
          user_id: userId, result: receitaSituation, provider: 'receita-federal-direct',
        });
      });
      // Notificação — CNPJ irregular (fire-and-forget)
      setImmediate(() => {
        notificationDispatcher.dispatch({
          userId,
          type:       'kyc_failed',
          importance: 'high',
          data:       { documentType: 'CNPJ', reason: `Situação irregular: ${receitaSituation}` },
          metadata:   { triggeredBy: 'system' },
          dedupKey:   `kyc_failed_cnpj_${userId}`,
        }).catch(() => {});
      });

      return { success: false, status: 'failed', situation: receitaSituation,
        message: `CNPJ com situação irregular na Receita Federal: ${receitaSituation}.` };
    }

    // CNPJ ativo — persistir verificação
    await supabase.from('user_kyc_verifications').insert({
      user_id: userId, cnpj_hash: cnpjHash, cnpj_last4: cnpjLast4,
      status: 'verified', level: 'cnpj',
      receita_cnpj_situation: receitaSituation,
      ip_address: ctx.ip || null, user_agent: ctx.userAgent || null, attempts: 1,
    });

    await supabase.from('users')
      .update({ kyc_level: 'full', kyc_verified_at: new Date().toISOString() })
      .eq('id', userId);

    setImmediate(async () => {
      await supabase.from('kyc_audit_log').insert({
        user_id: userId, result: 'ATIVA', provider: 'receita-federal-direct',
      });
      gamificationService.triggerEvent('cnpj_verified', userId, {})
        .catch((e) => logger.error('KYCService.verifyCNPJ: falha gamification', { error: e.message }));
      AuditService.log({
        userId, action: 'kyc_cnpj_verified', entityType: 'user', entityId: userId,
        ipAddress: ctx.ip, userAgent: ctx.userAgent,
        metadata: { maskedCNPJ, receitaSituation },
      }).catch(() => {});
      // Notificação — CNPJ verificado
      notificationDispatcher.dispatch({
        userId,
        type:       'kyc_verified',
        importance: 'high',
        data:       { level: 'full', documentType: 'CNPJ' },
        metadata:   { triggeredBy: 'system' },
        dedupKey:   `kyc_verified_cnpj_${userId}`,
      }).catch(() => {});
    });

    logger.info('KYCService.verifyCNPJ: verificação concluída', {
      service: 'KYCService', userId, maskedCNPJ, receitaSituation,
    });

    return { success: true, status: 'verified', level: 'full',
      situation: receitaSituation, message: 'CNPJ verificado com sucesso.' };
  },

  // ─── INTERNAL ─────────────────────────────────────────────

  /**
   * Cria ticket de suporte automático quando KYC entra em manual_review.
   * Verifica se já existe ticket para este usuário/nível antes de criar.
   * Salva support_ticket_id no registro de verificação.
   *
   * @param {Object} supabase
   * @param {string} userId
   * @param {'cpf'|'document'} level
   * @param {string} [reason]
   */
  async _createManualReviewTicket(supabase, userId, level, reason = '') {
    try {
      // Buscar a verificação mais recente em manual_review para este usuário/nível
      const { data: verif } = await supabase
        .from('user_kyc_verifications')
        .select('id, support_ticket_id')
        .eq('user_id', userId)
        .eq('level', level)
        .eq('status', 'manual_review')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // Não criar ticket duplicado
      if (!verif || verif.support_ticket_id) return;

      const supportService = _getSupportService();
      const ticket = await supportService.createTicket({
        userId,
        category:    'account',
        module:      'kyc',
        issueType:   'identity_verification_pending',
        description: `Verificação de ${level.toUpperCase()} requer análise manual. Razão: ${reason || 'Receita Federal indisponível'}.`,
        context: {
          kycVerificationId: verif.id,
          level,
          reason,
        },
      });

      if (ticket?.ticketId) {
        await supabase.from('user_kyc_verifications')
          .update({ support_ticket_id: ticket.ticketId })
          .eq('id', verif.id);
      }
    } catch (e) {
      logger.warn('KYCService._createManualReviewTicket: falha', {
        service: 'KYCService', userId, level, error: e.message,
      });
    }
  },

  async _upsertVerification(supabase, userId, cpfHash, cpfDigits, fields) {
    const cpfLast4 = cpfDigits.slice(-4);
    const attempts = (fields.status === 'verified') ? 1 : undefined;

    // Busca registro existente para incrementar tentativas
    const { data: current } = await supabase
      .from('user_kyc_verifications')
      .select('id, attempts')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const newAttempts = (current?.attempts || 0) + 1;

    const record = {
      user_id:           userId,
      cpf_hash:          cpfHash,
      cpf_last4:         cpfLast4,
      status:            fields.status,
      level:             'cpf',
      receita_name:      fields.receitaName      || null,
      receita_situation: fields.receitaSituation || null,
      name_match:        fields.nameMatch        ?? null,
      failed_reason:     fields.failedReason     || null,
      attempts:          attempts ?? newAttempts,
      ip_address:        fields.ipAddress        || null,
      user_agent:        fields.userAgent        || null,
    };

    // Para manual_review, persiste CPF criptografado para que o admin possa
    // copiá-lo para users.cpf_encrypted ao aprovar (sem esta coluna, a validação
    // PIX falharia com "CPF não verificado" mesmo após aprovação manual).
    if (fields.status === 'manual_review') {
      try {
        const encryptionService = require('./encryptionService');
        const cpfEncrypted = await encryptionService.encrypt(cpfDigits, { dataType: 'cpf', aad: userId });
        record.cpf_encrypted = JSON.stringify(cpfEncrypted);
      } catch (encErr) {
        logger.warn('KYCService._upsertVerification: falha ao criptografar CPF para manual_review', {
          service: 'KYCService', userId, error: encErr.message,
        });
      }
    }

    if (current?.id) {
      await supabase
        .from('user_kyc_verifications')
        .update(record)
        .eq('id', current.id);
    } else {
      await supabase
        .from('user_kyc_verifications')
        .insert(record);
    }
  },
};

module.exports = KYCService;
