/**
 * @fileoverview Serviço de Tickets OTP para validação de operações sensíveis.
 * Gera, valida e expira códigos temporários com HMAC-SHA256 e proteção anti-brute-force.
 * @module services/SecurityTicketService
 */

const crypto = require('crypto');
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

// Validade por tipo (em milissegundos)
const EXPIRY_MS = {
  email_verify:          60 * 60 * 1000,  // 60 min
  recovery_email_verify: 30 * 60 * 1000,  // 30 min
  login:                 10 * 60 * 1000,  // 10 min
  kyc:                   30 * 60 * 1000,  // 30 min
  saque:                  5 * 60 * 1000,  //  5 min
  pagamento_pix:          5 * 60 * 1000,  //  5 min
  account_recovery:      15 * 60 * 1000,  // 15 min
};

const MAX_ATTEMPTS    = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 min
const TABLE = 'security_tickets';

class SecurityTicketService {
  // ─── Geração ──────────────────────────────────────────────────────────────

  /**
   * Gera um ticket OTP para o usuário, invalida pendentes anteriores do mesmo tipo
   * e retorna o código em plaintext (para envio por e-mail).
   *
   * @param {string} userId   - Firebase UID do usuário
   * @param {string} type     - 'login' | 'saque' | 'kyc' | 'email_verify'
   * @param {Object} [opts]
   * @param {string} [opts.ipAddress]  - IP do cliente
   * @param {Object} [opts.metadata]   - Contexto extra (ex: { valor, caixinhaId })
   * @returns {Promise<{ code: string, expiresIn: number, expiresAt: Date }>}
   */
  async generateTicket(userId, type, opts = {}) {
    SecurityTicketService._assertValidType(type);

    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase indisponível');

    const expiryMs   = EXPIRY_MS[type];
    const expiresAt  = new Date(Date.now() + expiryMs);
    const code       = SecurityTicketService._generateCode();
    const codeHash   = SecurityTicketService._hmac(code, userId, expiresAt);

    // Lazy cleanup de tickets globais expirados
    this.cleanupExpired().catch(() => {});

    // Invalida tickets pendentes anteriores do mesmo userId+type
    const { error: expireError } = await supabase
      .from(TABLE)
      .update({ status: 'expired' })
      .eq('user_id', userId)
      .eq('type', type)
      .eq('status', 'pending');

    if (expireError) {
      logger.warn('SecurityTicketService: falha ao expirar tickets anteriores', {
        service: 'SecurityTicketService',
        userId,
        type,
        error: expireError.message,
      });
    }

    // Insere novo ticket
    const { error: insertError } = await supabase
      .from(TABLE)
      .insert({
        user_id:    userId,
        code_hash:  codeHash,
        type,
        expires_at: expiresAt.toISOString(),
        status:     'pending',
        ip_address: opts.ipAddress || null,
        metadata:   opts.metadata  || {},
      });

    if (insertError) {
      logger.error('SecurityTicketService: falha ao inserir ticket', {
        service: 'SecurityTicketService',
        userId,
        type,
        error: insertError.message,
      });
      throw new Error('Não foi possível gerar o código de verificação.');
    }

    logger.info('SecurityTicketService: ticket gerado', {
      service: 'SecurityTicketService',
      userId,
      type,
      expiresAt: expiresAt.toISOString(),
      ip: opts.ipAddress,
    });

    return { code, expiresIn: Math.floor(expiryMs / 1000), expiresAt };
  }

  // ─── Validação ────────────────────────────────────────────────────────────

  /**
   * Valida um código OTP. Incrementa tentativas em caso de falha.
   * Bloqueia o ticket após MAX_ATTEMPTS tentativas inválidas.
   *
   * @param {string} userId
   * @param {string} type
   * @param {string} code   - Código em plaintext digitado pelo usuário
   * @returns {Promise<{ id: string, type: string, metadata: Object }>}
   * @throws {Error} Com mensagem genérica em caso de falha
   */
  async validateTicket(userId, type, code) {
    SecurityTicketService._assertValidType(type);

    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase indisponível');

    // Busca o ticket pendente mais recente
    const { data: tickets, error: fetchError } = await supabase
      .from(TABLE)
      .select('id, code_hash, expires_at, status, attempts_count, locked_until, metadata')
      .eq('user_id', userId)
      .eq('type', type)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1);

    if (fetchError) {
      logger.error('SecurityTicketService: erro ao buscar ticket', {
        service: 'SecurityTicketService',
        userId,
        type,
        error: fetchError.message,
      });
      throw new Error('Verificação indisponível. Tente novamente.');
    }

    if (!tickets || tickets.length === 0) {
      throw new Error('Código inválido ou expirado.');
    }

    const ticket = tickets[0];

    // Verifica lock de brute-force
    if (ticket.locked_until && new Date(ticket.locked_until) > new Date()) {
      const remainingMs = new Date(ticket.locked_until) - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60000);
      throw new Error(`Muitas tentativas. Aguarde ${remainingMin} minuto(s) antes de tentar novamente.`);
    }

    // Verifica expiração
    if (new Date(ticket.expires_at) < new Date()) {
      await supabase
        .from(TABLE)
        .update({ status: 'expired' })
        .eq('id', ticket.id);
      throw new Error('Código inválido ou expirado.');
    }

    // Reconstrói HMAC e compara (timing-safe)
    const expectedHash = SecurityTicketService._hmac(code, userId, new Date(ticket.expires_at));
    const isValid = SecurityTicketService._timingSafeEqual(expectedHash, ticket.code_hash);

    if (!isValid) {
      const newAttempts = (ticket.attempts_count || 0) + 1;
      const shouldLock  = newAttempts >= MAX_ATTEMPTS;

      const updatePayload = { attempts_count: newAttempts };
      if (shouldLock) {
        updatePayload.locked_until = new Date(Date.now() + LOCK_DURATION_MS).toISOString();
      }

      await supabase.from(TABLE).update(updatePayload).eq('id', ticket.id);

      logger.warn('SecurityTicketService: código inválido', {
        service: 'SecurityTicketService',
        userId,
        type,
        attempts: newAttempts,
        locked: shouldLock,
      });

      if (shouldLock) {
        throw new Error(`Muitas tentativas. Aguarde ${Math.ceil(LOCK_DURATION_MS / 60000)} minuto(s) antes de tentar novamente.`);
      }

      throw new Error('Código inválido ou expirado.');
    }

    // Código correto — marca como usado, registra timestamp preciso para janela SCA
    const { error: useError } = await supabase
      .from(TABLE)
      .update({ status: 'used', used_at: new Date().toISOString() })
      .eq('id', ticket.id);

    if (useError) {
      logger.error('SecurityTicketService: falha ao marcar ticket como usado', {
        service: 'SecurityTicketService',
        ticketId: ticket.id,
        error: useError.message,
      });
      // Não lança — o código estava certo, não bloquear o usuário por falha interna
    }

    logger.info('SecurityTicketService: ticket validado com sucesso', {
      service: 'SecurityTicketService',
      userId,
      type,
      ticketId: ticket.id,
    });

    return { id: ticket.id, type, metadata: ticket.metadata || {} };
  }

  // ─── Limpeza ──────────────────────────────────────────────────────────────

  /**
   * Marca como 'expired' todos os tickets pendentes cujo expires_at já passou.
   * Chamado de forma lazy (fire-and-forget) a cada geração.
   */
  async cleanupExpired() {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const { error } = await supabase
      .from(TABLE)
      .update({ status: 'expired' })
      .eq('status', 'pending')
      .lt('expires_at', new Date().toISOString());

    if (error) {
      logger.warn('SecurityTicketService: falha no cleanup de expirados', {
        service: 'SecurityTicketService',
        error: error.message,
      });
    }
  }

  // ─── Helpers privados ─────────────────────────────────────────────────────

  /**
   * Gera código de 6 dígitos criptograficamente seguro.
   * @returns {string} Ex: "048291"
   */
  static _generateCode() {
    const n = crypto.randomInt(0, 1_000_000);
    return String(n).padStart(6, '0');
  }

  /**
   * Calcula HMAC-SHA256.
   * Mensagem: `${code}:${userId}:${expiresAt.toISOString()}`
   * Chave: SECURITY_OTP_SECRET
   *
   * @param {string} code
   * @param {string} userId
   * @param {Date}   expiresAt
   * @returns {string} hex digest
   */
  static _hmac(code, userId, expiresAt) {
    const secret = process.env.SECURITY_OTP_SECRET;
    if (!secret) throw new Error('SECURITY_OTP_SECRET não configurado.');

    const message = `${code}:${userId}:${expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt}`;
    return crypto
      .createHmac('sha256', secret)
      .update(message)
      .digest('hex');
  }

  /**
   * Comparação timing-safe de duas strings hex.
   */
  static _timingSafeEqual(a, b) {
    try {
      return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
    } catch {
      return false;
    }
  }

  static _assertValidType(type) {
    if (!EXPIRY_MS[type]) {
      throw new Error(`Tipo de ticket inválido: ${type}`);
    }
  }
}

module.exports = new SecurityTicketService();
