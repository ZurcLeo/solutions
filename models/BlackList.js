// models/BlackList.js — Supabase-first (migrado de Firestore em 2026-05-19)
const { getSupabaseClient } = require('../config/supabase');
const { logger } = require('../logger');

const TABLE = 'jwt_blacklist';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client indisponível');
  return client;
}

class Blacklist {
  constructor() {
    // Purely static — no instance state needed
  }

  async addToBlacklist(token) {
    try {
      const { error } = await sb()
        .from(TABLE)
        .upsert({ token }, { onConflict: 'token' });

      if (error) throw error;
      logger.info('Token adicionado à blacklist', { service: 'blacklistService' });
    } catch (error) {
      logger.error('Erro ao adicionar token à blacklist', {
        service: 'blacklistService',
        error: error.message,
      });
      throw new Error('Erro ao adicionar token à blacklist.');
    }
  }

  async isTokenBlacklisted(token) {
    try {
      const { data, error } = await sb()
        .from(TABLE)
        .select('token')
        .eq('token', token)
        .maybeSingle();

      if (error) {
        // Fail-open: se a tabela não existe ou DB indisponível, não bloquear auth
        logger.warn('Tabela jwt_blacklist indisponível — assumindo token válido', {
          service: 'blacklistService',
          error: error.message,
        });
        return false;
      }

      const found = !!data;
      if (found) logger.info('Token está na blacklist', { service: 'blacklistService' });
      return found;
    } catch (error) {
      // Fail-open: erro inesperado não deve bloquear autenticação
      logger.warn('Erro ao verificar blacklist — assumindo token válido', {
        service: 'blacklistService',
        error: error.message,
      });
      return false;
    }
  }

  async removeExpiredTokens() {
    try {
      // JWTs access token têm TTL de 15 min — remove tokens mais antigos que isso
      const expiry = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { error } = await sb().from(TABLE).delete().lt('created_at', expiry);
      if (error) throw error;
      logger.info('Tokens expirados removidos da blacklist', { service: 'blacklistService' });
    } catch (error) {
      logger.error('Erro ao remover tokens expirados', {
        service: 'blacklistService',
        error: error.message,
      });
      throw new Error('Erro ao remover tokens expirados.');
    }
  }
}

module.exports = Blacklist;
